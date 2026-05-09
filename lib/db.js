// MySQL access — connection pool shared across requests.
// Statements are kept narrow and indexed; the proxy is on the hot path.

import mysql from 'mysql2/promise';

let pool;

export function initDb() {
  pool = mysql.createPool({
    host:     process.env.DB_HOST,
    port:     Number(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
    timezone: 'Z',
  });
  return pool;
}

export function db() {
  if (!pool) throw new Error('initDb() must be called before db()');
  return pool;
}

// ────── KEY LOOKUP ──────

export async function findApiKeyByHash(keyHash) {
  const [rows] = await db().execute(
    `SELECT k.id, k.user_id, k.project_id, k.env, k.revoked_at,
            p.spending_cap_cents_per_month,
            u.credit_micro_cents
       FROM api_keys k
       JOIN projects p ON p.id = k.project_id
       JOIN users    u ON u.id = k.user_id
      WHERE k.key_hash = :hash
      LIMIT 1`,
    { hash: keyHash },
  );
  return rows[0] || null;
}

// ────── MCP LOOKUP ──────

export async function findMcpBySlug(slug) {
  const [rows] = await db().execute(
    `SELECT m.id, m.slug, m.upstream_url, m.transport, m.status,
            m.free_calls_per_consumer,
            m.rate_limit_per_minute,
            m.rate_limit_per_day,
            (SELECT pr.price_micro_cents FROM pricing_rules pr
              WHERE pr.mcp_id = m.id AND pr.tool_name IS NULL
              LIMIT 1) AS default_price_micro_cents
       FROM mcps m
      WHERE m.slug = :slug
      LIMIT 1`,
    { slug },
  );
  return rows[0] || null;
}

// ────── DEMO ALLOWANCE ──────

export async function findOrCreateConsumerUsage(mcpId, userId) {
  // Use INSERT … ON DUPLICATE KEY UPDATE to create-or-no-op.
  await db().execute(
    `INSERT INTO mcp_consumer_usage
       (mcp_id, user_id, free_calls_used, billable_calls,
        period_year_month, first_called_at, last_called_at,
        created_at, updated_at)
     VALUES (:mcp, :user, 0, 0, :period, NOW(), NOW(), NOW(), NOW())
     ON DUPLICATE KEY UPDATE id = id`,
    { mcp: mcpId, user: userId, period: currentPeriod() },
  );

  // Read back. If the period rolled over, reset the free counter.
  const [rows] = await db().execute(
    `SELECT * FROM mcp_consumer_usage WHERE mcp_id = :mcp AND user_id = :user`,
    { mcp: mcpId, user: userId },
  );
  const row = rows[0];

  const period = currentPeriod();
  if (row.period_year_month !== period) {
    await db().execute(
      `UPDATE mcp_consumer_usage
          SET free_calls_used = 0,
              period_year_month = :period,
              updated_at = NOW()
        WHERE id = :id`,
      { period, id: row.id },
    );
    row.free_calls_used = 0;
    row.period_year_month = period;
  }
  return row;
}

export async function bumpUsage(usageId, isFree) {
  const col = isFree ? 'free_calls_used' : 'billable_calls';
  await db().execute(
    `UPDATE mcp_consumer_usage
        SET ${col} = ${col} + 1,
            last_called_at = NOW(),
            updated_at = NOW()
      WHERE id = :id`,
    { id: usageId },
  );
}

// ────── CREDIT DEBIT (atomic) ──────

/**
 * Atomically debit `amount_micro_cents` from a user's balance.
 * Returns true iff the row was updated (i.e. balance was sufficient).
 */
export async function tryDebitCredit(userId, amountMicroCents) {
  const [result] = await db().execute(
    `UPDATE users
        SET credit_micro_cents = credit_micro_cents - :amount,
            updated_at = NOW()
      WHERE id = :id
        AND credit_micro_cents >= :amount`,
    { id: userId, amount: amountMicroCents },
  );
  return result.affectedRows === 1;
}

// ────── LEDGER WRITES ──────

export async function recordUsageEvent({
  projectId, mcpId, apiKeyId, toolName, status, durationMs,
  billedMicroCents, publisherPayoutMicroCents, platformFeeMicroCents,
  requestId, isFree,
}) {
  const [result] = await db().execute(
    `INSERT INTO usage_events
       (project_id, mcp_id, api_key_id, tool_name, called_at, duration_ms,
        status, billed_micro_cents, publisher_payout_micro_cents,
        platform_fee_micro_cents, request_id,
        created_at, updated_at)
     VALUES (:project, :mcp, :key, :tool, NOW(), :ms,
             :status, :billed, :payout, :fee, :rid,
             NOW(), NOW())`,
    {
      project: projectId,
      mcp:     mcpId,
      key:     apiKeyId,
      tool:    toolName,
      ms:      durationMs,
      status,
      billed:  isFree ? 0 : billedMicroCents,
      payout:  isFree ? 0 : publisherPayoutMicroCents,
      fee:     isFree ? 0 : platformFeeMicroCents,
      rid:     requestId,
    },
  );
  return result.insertId;
}

export async function recordCreditTransaction({
  userId, amountMicroCents, type, referenceType, referenceId,
  balanceAfter, description,
}) {
  await db().execute(
    `INSERT INTO credit_transactions
       (user_id, amount_micro_cents, type,
        reference_type, reference_id, balance_after_micro_cents,
        description, created_at, updated_at)
     VALUES (:user, :amount, :type,
             :rtype, :rid, :balance,
             :desc, NOW(), NOW())`,
    {
      user: userId, amount: amountMicroCents, type,
      rtype: referenceType, rid: referenceId, balance: balanceAfter,
      desc: description,
    },
  );
}

// ────── HELPERS ──────

export function currentPeriod() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
