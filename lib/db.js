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

// ────── OAUTH TOKEN LOOKUP ──────
// OAuth access tokens issued by /oauth/token. Returned in the same shape as
// findApiKeyByHash so the proxy hot-path treats both identically.
// Per-user; project_id is the user's oldest project (default).
export async function findOAuthAccessTokenByHash(tokenHash) {
  const [rows] = await db().execute(
    `SELECT t.id, t.user_id, t.expires_at, t.revoked_at,
            u.credit_micro_cents,
            (SELECT id FROM projects WHERE user_id = t.user_id ORDER BY id LIMIT 1) AS project_id
       FROM oauth_access_tokens t
       JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = :hash
      LIMIT 1`,
    { hash: tokenHash },
  );
  const r = rows[0];
  if (!r) return null;
  // Reject if revoked or expired (proxy treats null project_id as fatal too).
  if (r.revoked_at) return null;
  if (r.expires_at && new Date(r.expires_at) <= new Date()) return null;
  return {
    id: r.id,
    user_id: r.user_id,
    project_id: r.project_id,
    env: 'oauth',
    revoked_at: null,
    spending_cap_cents_per_month: null,
    credit_micro_cents: r.credit_micro_cents,
  };
}

// ────── MCP LOOKUP ──────

export async function findMcpBySlug(slug) {
  const [rows] = await db().execute(
    `SELECT m.id, m.slug, m.upstream_url, m.upstream_headers, m.transport, m.status,
            m.free_calls_per_consumer,
            m.rate_limit_per_minute,
            m.rate_limit_per_day,
            m.upstream_timeout_seconds,
            (SELECT pr.price_micro_cents FROM pricing_rules pr
              WHERE pr.mcp_id = m.id AND pr.tool_name IS NULL
              LIMIT 1) AS default_price_micro_cents
       FROM mcps m
      WHERE m.slug = :slug
      LIMIT 1`,
    { slug },
  );
  const row = rows[0];
  if (!row) return null;
  // upstream_headers is a JSON column — MySQL driver returns string, parse it.
  if (row.upstream_headers && typeof row.upstream_headers === 'string') {
    try { row.upstream_headers = JSON.parse(row.upstream_headers); }
    catch { row.upstream_headers = null; }
  }
  // Per-tool price overrides. Map of {tool_name: price_micro_cents}.
  // Hot-path lookup at proxy: priceFor(tool) returns the override or default.
  const [priceRows] = await db().execute(
    `SELECT tool_name, price_micro_cents
       FROM pricing_rules
      WHERE mcp_id = :id AND tool_name IS NOT NULL`,
    { id: row.id },
  );
  row.tool_prices = {};
  for (const p of priceRows) {
    row.tool_prices[p.tool_name] = Number(p.price_micro_cents);
  }
  return row;
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
  projectId, mcpId, apiKeyId, toolName, client, userAgent,
  status, durationMs,
  billedMicroCents, publisherPayoutMicroCents, platformFeeMicroCents,
  requestId, isFree,
}) {
  const [result] = await db().execute(
    `INSERT INTO usage_events
       (project_id, mcp_id, api_key_id, tool_name, client, user_agent,
        called_at, duration_ms,
        status, billed_micro_cents, publisher_payout_micro_cents,
        platform_fee_micro_cents, request_id,
        created_at, updated_at)
     VALUES (:project, :mcp, :key, :tool, :client, :ua,
             NOW(), :ms,
             :status, :billed, :payout, :fee, :rid,
             NOW(), NOW())`,
    {
      project: projectId,
      mcp:     mcpId,
      key:     apiKeyId,
      tool:    toolName,
      client:  client || null,
      ua:      userAgent ? String(userAgent).slice(0, 255) : null,
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
