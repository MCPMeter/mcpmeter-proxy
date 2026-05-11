// mcpmeter proxy — main entry.
// Implements the hot path defined in TECH_PLAN.md §5:
//   authenticate → resolve MCP → rate-limit → free-tier or credit-debit →
//   forward to upstream → record ledger.

import 'dotenv/config';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import { request as undiciRequest } from 'undici';

import {
  initDb, db, findApiKeyByHash, findOAuthAccessTokenByHash, findMcpBySlug, findOrCreateConsumerUsage,
  bumpUsage, tryDebitCredit, recordUsageEvent, recordCreditTransaction,
} from './lib/db.js';

import {
  initRedis, cacheGetJson, cacheSetJson, consumeRateLimit,
} from './lib/redis.js';

const PORT = Number(process.env.PORT) || 3010;
const HOST = process.env.HOST || '127.0.0.1';
const KEY_TTL = Number(process.env.KEY_CACHE_TTL_SECONDS) || 300;
const MCP_TTL = Number(process.env.MCP_CACHE_TTL_SECONDS) || 300;
// Default upstream timeout (60s) — covers most agent tool calls. Premium MCPs
// that need longer (image gen, video gen, slow LLMs) override per-listing
// via mcps.upstream_timeout_seconds, capped at MAX_UPSTREAM_TIMEOUT_MS.
const UPSTREAM_TIMEOUT_MS     = Number(process.env.UPSTREAM_TIMEOUT_MS) || 60_000;
const MAX_UPSTREAM_TIMEOUT_MS = Number(process.env.MAX_UPSTREAM_TIMEOUT_MS) || 300_000;
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

// RFC9728 — OAuth 2.0 Protected Resource Metadata. Tells MCP clients which
// authorization server can mint tokens for this resource, plus the RFC8414
// discovery URL on that AS.
fastify.get('/.well-known/oauth-protected-resource', async () => ({
  resource:                    'https://proxy.mcpmeter.com',
  authorization_servers:       ['https://mcpmeter.com'],
  bearer_methods_supported:    ['header'],
  scopes_supported:            ['mcp'],
  resource_documentation:      'https://mcpmeter.com/docs/auth',
}));

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

  // 1. AUTHENTICATE — resolve bearer key OR OAuth access token.
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/^Bearer\s+(mcpm_(?:live|test|oauth)_[A-Za-z0-9]+)$/);
  if (!m) {
    return sendUnauthorized(reply, slug, 'invalid_token', 'Bearer token missing or malformed');
  }
  const rawKey  = m[1];
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const isOAuth = rawKey.startsWith('mcpm_oauth_');

  const keyData = await getKeyData(keyHash, isOAuth);
  if (!keyData) {
    return sendUnauthorized(reply, slug, 'invalid_token', 'Bearer token not found, expired, or revoked');
  }
  if (keyData.revoked_at) {
    return sendUnauthorized(reply, slug, 'invalid_token', 'Bearer token revoked');
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
  if (mcp.status === 'review' || mcp.status === 'draft' || !mcp.upstream_url) {
    return reply.code(503).send({
      error: 'mcp_not_yet_live',
      slug,
      status: mcp.status,
      hint: 'This listing is in the catalog but not yet wired to an upstream. Check back soon.',
    });
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
  // Per-tool pricing — if the publisher set tier rules per tool, look up the
  // override; else fall back to the listing default. Tool name comes from the
  // JSON-RPC params.name extracted upstream of this block.
  const toolName  = extractToolName(req.body);
  const toolPrice = (toolName && mcp.tool_prices && mcp.tool_prices[toolName] !== undefined)
    ? mcp.tool_prices[toolName]
    : mcp.default_price_micro_cents;

  const isFreeMcp = (toolPrice ?? null) === null || toolPrice === 0;

  let pricedAt = 0;
  let isFree = false;

  if (isFreeMcp) {
    // Free MCP / free tool — no debit, no demo gate. Rate limit alone bounds use.
    isFree = true;
  } else if (freeRemaining > 0) {
    // Within publisher's free monthly tier.
    isFree = true;
  } else {
    // Paid call. Try to debit credit atomically.
    pricedAt = toolPrice;

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
    upstreamRes = await forwardToUpstream(req, mcp.upstream_url, mcp.upstream_headers || null, mcp.upstream_timeout_seconds);
  } catch (err) {
    fastify.log.warn({ err: err.message, slug }, 'upstream_failed');

    // Refund the call if we already debited.
    if (!isFree && pricedAt > 0) {
      await refundDebit(keyData.user_id, pricedAt, requestId);
    }

    return reply.code(502).send({ error: 'upstream_failed', detail: err.message });
  }

  // 6. PEEK at JSON responses to catch JSON-RPC errors (server-side tool
  // failures returned over HTTP 200). On error, refund the call before
  // forwarding the body. SSE responses pass through unchanged.
  const respCT = String(upstreamRes.headers['content-type'] || '');
  let bodyBuffer = null;
  let wasJsonRpcError = false;

  if (respCT.startsWith('application/json')) {
    const chunks = [];
    for await (const chunk of upstreamRes.body) chunks.push(chunk);
    bodyBuffer = Buffer.concat(chunks);
    try {
      const parsed = JSON.parse(bodyBuffer.toString('utf8'));
      if (parsed && parsed.error && typeof parsed.error === 'object') {
        wasJsonRpcError = true;
        if (!isFree && pricedAt > 0) {
          await refundDebit(keyData.user_id, pricedAt, requestId);
        }
      }
    } catch {
      // Not parseable JSON — fall through and forward raw.
    }
  }

  // 7. RECORD ledger (non-blocking).
  const elapsed = Date.now() - startedAt;
  const userAgent = req.headers['user-agent'] || null;
  const client = classifyClient(userAgent);
  const billedAfterRefund = wasJsonRpcError ? 0 : pricedAt;
  recordCallAsync({
    keyData, mcp, toolName, client, userAgent,
    status: upstreamRes.statusCode,
    durationMs: elapsed,
    isFree: isFree || wasJsonRpcError,
    pricedAt: billedAfterRefund,
    requestId, usageId: usage.id,
  }).catch((err) => fastify.log.error({ err: err.message }, 'ledger_record_failed'));

  // 8. STREAM response back. Headers minus hop-by-hop + mcpmeter receipts.
  const passHeaders = stripHopByHop(upstreamRes.headers);
  reply.code(upstreamRes.statusCode);
  for (const [k, v] of Object.entries(passHeaders)) reply.header(k, v);
  reply.header('X-Mcpmeter-Billed', billedAfterRefund > 0 ? `${billedAfterRefund}` : 'free');
  reply.header('X-Mcpmeter-Duration-Ms', String(elapsed));
  if (wasJsonRpcError) reply.header('X-Mcpmeter-Refunded', '1');

  return reply.send(bodyBuffer ?? upstreamRes.body);
}

// ────── helpers ──────

async function getKeyData(hash, isOAuth = false) {
  const cacheKey = isOAuth ? `oauth:${hash}` : `key:${hash}`;
  let cached = await cacheGetJson(cacheKey);
  if (cached !== null) return cached;

  const row = isOAuth
    ? await findOAuthAccessTokenByHash(hash)
    : await findApiKeyByHash(hash);

  if (row) {
    await cacheSetJson(cacheKey, row, KEY_TTL);
  } else {
    await cacheSetJson(cacheKey, false, 30);   // negative cache thwarts guessing
    return null;
  }
  return row;
}

// RFC6750 — tells the client this is bearer-auth + points to discovery so a
// well-behaved MCP client can run the OAuth dance instead of giving up.
function sendUnauthorized(reply, slug, error, description) {
  const resourceMeta = `https://proxy.mcpmeter.com/.well-known/oauth-protected-resource`;
  const authServer   = `https://mcpmeter.com`;
  reply.header(
    'WWW-Authenticate',
    `Bearer realm="mcpmeter", error="${error}", error_description="${description}", resource_metadata="${resourceMeta}", as_uri="${authServer}"`
  );
  return reply.code(401).send({
    error,
    error_description: description,
    docs:              'https://mcpmeter.com/docs/auth',
    oauth_metadata:    `${authServer}/.well-known/oauth-authorization-server`,
  });
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

async function forwardToUpstream(req, upstreamUrl, mcpUpstreamHeaders = null, mcpTimeoutSeconds = null) {
  // Resolve effective timeout: per-MCP override > default. Capped at the platform max.
  const timeoutMs = mcpTimeoutSeconds
    ? Math.min(MAX_UPSTREAM_TIMEOUT_MS, Number(mcpTimeoutSeconds) * 1000)
    : UPSTREAM_TIMEOUT_MS;
  // Strip the slug prefix if the URL doesn't already encode it.
  const subpath = req.url.replace(/^\/[^/]+/, '');
  const target  = upstreamUrl.replace(/\/$/, '') + subpath;

  const headers = { ...req.headers };
  delete headers['authorization'];   // Don't forward the bearer mcpm_ key.
  delete headers['host'];
  delete headers['x-forwarded-host'];
  // Body is re-serialised below, so the original Content-Length is meaningless.
  // Let undici recompute. (Guzzle adds CL on POST; without this strip the
  // upstream sees a length-mismatch and 400s.)
  delete headers['content-length'];

  // Cookies are session-shaped data the consumer's browser/runtime added —
  // upstream MCPs should not receive them.
  delete headers['cookie'];

  // Forward consumer-opted headers: any header named X-Forward-{name} is
  // unwrapped and sent upstream as {name}. Lets a consumer pass extra auth
  // (e.g., the upstream MCP's own bearer key) without us hard-coding it.
  //   X-Forward-Authorization: Bearer their_key   →   Authorization: Bearer their_key
  //   X-Forward-API-Key: xyz                       →   API-Key: xyz
  for (const [k, v] of Object.entries(req.headers)) {
    const lower = k.toLowerCase();
    if (lower.startsWith('x-forward-')) {
      const target = lower.slice('x-forward-'.length);
      if (target) headers[target] = v;
      delete headers[lower];   // don't double-send the wrapped form
    }
  }

  // Publisher-configured upstream headers (private endpoints). These win
  // over consumer-supplied X-Forward-* — the publisher's auth is canonical.
  if (mcpUpstreamHeaders && typeof mcpUpstreamHeaders === 'object') {
    for (const [k, v] of Object.entries(mcpUpstreamHeaders)) {
      if (k && v) headers[k] = String(v);
    }
  }

  const body = req.body !== undefined && req.body !== null
    ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body))
    : undefined;

  const res = await undiciRequest(target, {
    method: req.method,
    headers,
    body,
    bodyTimeout: timeoutMs,
    headersTimeout: timeoutMs,
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

// Map a User-Agent string to a normalized client label for the leaderboard.
// Order matters — first match wins. Add more as we see them in usage_events.user_agent.
const CLIENT_PATTERNS = [
  [/claude-code/i,                   'Claude Code'],
  [/claude.{0,4}desktop/i,           'Claude Desktop'],
  [/claude\.ai|anthropic-(web|claude)/i, 'Claude.ai'],
  [/cursor/i,                        'Cursor'],
  [/cline/i,                         'Cline'],
  [/windsurf|codeium/i,              'Windsurf'],
  [/zed/i,                           'Zed'],
  [/code(\s|-)?(insiders|server)?\/[\d.]+|vscode/i, 'VS Code'],
  [/gemini/i,                        'Gemini CLI'],
  [/codex/i,                         'Codex CLI'],
  [/openai/i,                        'OpenAI'],
  [/witsy/i,                         'Witsy'],
  [/raycast/i,                       'Raycast'],
  [/continue\.dev|continuedev/i,     'Continue'],
  [/mcp-remote/i,                    'mcp-remote'],
  [/mcpmeter-tryit/i,                'mcpmeter (try-it)'],
  [/postman/i,                       'Postman'],
  [/insomnia/i,                      'Insomnia'],
  [/^curl/i,                         'curl'],
  [/python|httpx|requests|urllib/i,  'Python'],
  [/go-http-client/i,                'Go'],
  [/node-fetch|undici|axios/i,       'Node'],
];

function classifyClient(ua) {
  if (!ua) return null;
  for (const [re, name] of CLIENT_PATTERNS) {
    if (re.test(ua)) return name;
  }
  return 'Other';
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
    client:    opts.client,
    userAgent: opts.userAgent,
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
