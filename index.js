// mcpmeter proxy — main entry.
// Implements the hot path defined in TECH_PLAN.md §5:
//   authenticate → resolve MCP → rate-limit → free-tier or credit-debit →
//   forward to upstream → record ledger.

import 'dotenv/config';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import { request as undiciRequest } from 'undici';

import {
  initDb, db, findApiKeyByHash, findMcpBySlug, findOrCreateConsumerUsage,
  bumpUsage, tryDebitCredit, recordUsageEvent, recordCreditTransaction,
} from './lib/db.js';

import {
  initRedis, cacheGetJson, cacheSetJson, consumeRateLimit,
} from './lib/redis.js';

const PORT = Number(process.env.PORT) || 3010;
const HOST = process.env.HOST || '127.0.0.1';
const KEY_TTL = Number(process.env.KEY_CACHE_TTL_SECONDS) || 300;
const MCP_TTL = Number(process.env.MCP_CACHE_TTL_SECONDS) || 300;
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 15000;
const DEFAULT_RPM = Number(process.env.DEFAULT_RPM) || 60;
const DEFAULT_RPD = Number(process.env.DEFAULT_RPD) || 10000;

const fastify = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  trustProxy: process.env.TRUST_PROXY === 'true',
  bodyLimit: 10 * 1024 * 1024, // 10 MB — generous for MCP tool calls
});

initDb();
initRedis();

// ────── Health ──────
fastify.get('/health', async () => ({ ok: true, ts: Date.now() }));

// ────── PROXY ROUTE ──────
// Accept any HTTP method on /:slug and /:slug/* so SSE-streamable endpoints work.
fastify.all('/:slug', proxyHandler);
fastify.all('/:slug/*', proxyHandler);

async function proxyHandler(req, reply) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  reply.header('X-Mcpmeter-Request-Id', requestId);

  const { slug } = req.params;
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return reply.code(400).send({ error: 'invalid_slug' });
  }

  // 1. AUTHENTICATE — resolve bearer key.
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/^Bearer\s+(mcpm_(?:live|test)_[A-Za-z0-9]+)$/);
  if (!m) {
    return reply.code(401).send({ error: 'missing_or_invalid_bearer' });
  }
  const rawKey  = m[1];
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  const keyData = await getKeyData(keyHash);
  if (!keyData) {
    return reply.code(401).send({ error: 'unknown_key' });
  }
  if (keyData.revoked_at) {
    return reply.code(401).send({ error: 'revoked_key' });
  }

  // 2. RESOLVE MCP.
  const mcp = await getMcpData(slug);
  if (!mcp) {
    return reply.code(404).send({ error: 'no_such_mcp', slug });
  }
  if (mcp.status === 'archived') {
    return reply.code(410).send({ error: 'mcp_archived', slug });
  }
  if (mcp.status === 'paused') {
    return reply.code(503).send({ error: 'mcp_paused', slug, hint: 'Publisher has paused this listing.' });
  }

  // 3. RATE LIMIT — Redis only, no DB.
  const rpm = mcp.rate_limit_per_minute || DEFAULT_RPM;
  const rpd = mcp.rate_limit_per_day    || DEFAULT_RPD;
  const rl = await consumeRateLimit({
    mcpId: mcp.id, userId: keyData.user_id, rpm, rpd,
  });
  if (!rl.ok) {
    reply.header('Retry-After', String(rl.retryAfterSeconds));
    return reply.code(429).send({
      error: 'rate_limited',
      scope: rl.scope,
      retry_after_seconds: rl.retryAfterSeconds,
    });
  }

  // 4. FREE-TIER vs CREDIT.
  const usage = await findOrCreateConsumerUsage(mcp.id, keyData.user_id);
  const allowance = mcp.free_calls_per_consumer || 0;
  const freeRemaining = Math.max(0, allowance - usage.free_calls_used);
  const isFreeMcp = (mcp.default_price_micro_cents ?? null) === null
    || mcp.default_price_micro_cents === 0;

  let pricedAt = 0;
  let isFree = false;

  if (isFreeMcp) {
    // Free MCP — no debit, no demo gate. Rate limit alone bounds use.
    isFree = true;
  } else if (freeRemaining > 0) {
    // Within publisher's free monthly tier.
    isFree = true;
  } else {
    // Paid call. Try to debit credit atomically.
    pricedAt = mcp.default_price_micro_cents;

    const debited = await tryDebitCredit(keyData.user_id, pricedAt);
    if (!debited) {
      return reply.code(402).send({
        error: 'insufficient_credit',
        balance_micro_cents: keyData.credit_micro_cents,
        required_micro_cents: pricedAt,
        hint: 'Top up at https://mcpmeter.com/dashboard',
      });
    }
  }

  // 5. FORWARD to upstream.
  let upstreamRes;
  try {
    upstreamRes = await forwardToUpstream(req, mcp.upstream_url);
  } catch (err) {
    fastify.log.warn({ err: err.message, slug }, 'upstream_failed');

    // Refund the call if we already debited.
    if (!isFree && pricedAt > 0) {
      await refundDebit(keyData.user_id, pricedAt, requestId);
    }

    return reply.code(502).send({ error: 'upstream_failed', detail: err.message });
  }

  // 6. RECORD ledger (non-blocking — fire and forget for MVP, queue later).
  const elapsed = Date.now() - startedAt;
  const toolName = extractToolName(req.body);
  recordCallAsync({
    keyData, mcp, toolName, status: upstreamRes.statusCode,
    durationMs: elapsed, isFree, pricedAt, requestId, usageId: usage.id,
  }).catch((err) => fastify.log.error({ err: err.message }, 'ledger_record_failed'));

  // 7. STREAM response back.
  // Copy through headers (minus hop-by-hop) and the body stream.
  const passHeaders = stripHopByHop(upstreamRes.headers);
  reply.code(upstreamRes.statusCode);
  for (const [k, v] of Object.entries(passHeaders)) {
    reply.header(k, v);
  }
  reply.header('X-Mcpmeter-Billed', isFree ? 'free' : `${pricedAt}`);
  reply.header('X-Mcpmeter-Duration-Ms', String(elapsed));

  return reply.send(upstreamRes.body);
}

// ────── helpers ──────

async function getKeyData(hash) {
  const cacheKey = `key:${hash}`;
  let cached = await cacheGetJson(cacheKey);
  if (cached !== null) return cached;

  const row = await findApiKeyByHash(hash);
  if (row) {
    await cacheSetJson(cacheKey, row, KEY_TTL);
  } else {
    // Negative-cache for a short window to thwart guessing.
    await cacheSetJson(cacheKey, false, 30);
    return null;
  }
  return row;
}

async function getMcpData(slug) {
  const cacheKey = `mcp:${slug}`;
  let cached = await cacheGetJson(cacheKey);
  if (cached !== null) return cached;

  const row = await findMcpBySlug(slug);
  if (row) {
    await cacheSetJson(cacheKey, row, MCP_TTL);
  } else {
    await cacheSetJson(cacheKey, false, 30);
    return null;
  }
  return row;
}

async function forwardToUpstream(req, upstreamUrl) {
  // Strip the slug prefix if the URL doesn't already encode it.
  const subpath = req.url.replace(/^\/[^/]+/, '');
  const target  = upstreamUrl.replace(/\/$/, '') + subpath;

  const headers = { ...req.headers };
  delete headers['authorization'];   // Don't forward the bearer mcpm_ key.
  delete headers['host'];
  delete headers['x-forwarded-host'];

  const body = req.body !== undefined && req.body !== null
    ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body))
    : undefined;

  const res = await undiciRequest(target, {
    method: req.method,
    headers,
    body,
    bodyTimeout: UPSTREAM_TIMEOUT_MS,
    headersTimeout: UPSTREAM_TIMEOUT_MS,
  });

  return res;
}

function stripHopByHop(headers) {
  const drop = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailers', 'transfer-encoding', 'upgrade',
    'content-length', // let Fastify recompute
  ]);
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!drop.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

function extractToolName(body) {
  // Best-effort: read params.name from a JSON-RPC tools/call body.
  try {
    if (!body || typeof body !== 'object') return null;
    if (body.method === 'tools/call' && body.params && body.params.name) {
      return String(body.params.name).slice(0, 120);
    }
    return null;
  } catch {
    return null;
  }
}

async function recordCallAsync(opts) {
  const platformFee = 0.20; // platform_fee_rate fallback; per-publisher rate later
  const billedMicro = opts.isFree ? 0 : opts.pricedAt;
  const payoutMicro = opts.isFree ? 0 : Math.round(opts.pricedAt * (1 - platformFee));

  const feeMicro = opts.isFree ? 0 : (billedMicro - payoutMicro);
  await recordUsageEvent({
    projectId: opts.keyData.project_id,
    mcpId:     opts.mcp.id,
    apiKeyId:  opts.keyData.id,
    toolName:  opts.toolName,
    status:    opts.status,
    durationMs: opts.durationMs,
    billedMicroCents: billedMicro,
    publisherPayoutMicroCents: payoutMicro,
    platformFeeMicroCents: feeMicro,
    requestId: opts.requestId,
    isFree: opts.isFree,
  });

  await bumpUsage(opts.usageId, opts.isFree);

  if (!opts.isFree && billedMicro > 0) {
    // Persist the credit-transaction matching the debit applied earlier.
    // balance_after is best-effort here; the materialised tip is on users.
    await recordCreditTransaction({
      userId: opts.keyData.user_id,
      amountMicroCents: -billedMicro,
      type: 'usage',
      referenceType: 'usage_event',
      referenceId: null, // could insert and round-trip, skipping for hot path
      balanceAfter: 0,
      description: `${opts.mcp.slug}.${opts.toolName || '*'}`,
    });
  }

  // Last-used timestamp on the key (doesn't need to be transactional).
  await db().execute(
    'UPDATE api_keys SET last_used_at = NOW() WHERE id = :id',
    { id: opts.keyData.id },
  );
}

async function refundDebit(userId, amountMicro, requestId) {
  await db().execute(
    `UPDATE users SET credit_micro_cents = credit_micro_cents + :amount, updated_at = NOW()
      WHERE id = :id`,
    { id: userId, amount: amountMicro },
  );
  await recordCreditTransaction({
    userId,
    amountMicroCents: amountMicro,
    type: 'refund',
    referenceType: 'request',
    referenceId: null,
    balanceAfter: 0,
    description: `Upstream failed; debit refunded (${requestId})`,
  });
}

// ────── BOOT ──────
fastify.listen({ port: PORT, host: HOST }).then(() => {
  fastify.log.info(`mcpmeter proxy listening on ${HOST}:${PORT}`);
}).catch((err) => {
  fastify.log.error({ err }, 'failed to start');
  process.exit(1);
});
