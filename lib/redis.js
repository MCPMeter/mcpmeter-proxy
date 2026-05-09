// Redis: auth cache, MCP config cache, rate-limit windows.

import Redis from 'ioredis';

let client;

export function initRedis() {
  client = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    db:   Number(process.env.REDIS_DB)   || 0,
    lazyConnect: false,
    maxRetriesPerRequest: 2,
  });
  return client;
}

export function r() {
  if (!client) throw new Error('initRedis() must be called before r()');
  return client;
}

// ────── Cache helpers ──────

export async function cacheGetJson(key) {
  const raw = await r().get(key);
  return raw ? JSON.parse(raw) : null;
}

export async function cacheSetJson(key, value, ttlSeconds) {
  await r().set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

// ────── Rate limiting ──────

/**
 * Token-bucket-ish: increment two counters, one per minute and one per day.
 * Returns { ok, retryAfterSeconds, scope } — rejecting on the first scope
 * that's over its cap.
 */
export async function consumeRateLimit({ mcpId, userId, rpm, rpd }) {
  const minuteKey = `rl:min:${mcpId}:${userId}`;
  const dayKey    = `rl:day:${mcpId}:${userId}`;

  const tx = r().multi();
  tx.incr(minuteKey);
  tx.expire(minuteKey, 60, 'NX');
  tx.incr(dayKey);
  tx.expire(dayKey, 86400, 'NX');
  const results = await tx.exec();

  // results: [[err, val], ...]
  const minuteCount = Number(results[0][1]);
  const dayCount    = Number(results[2][1]);

  if (minuteCount > rpm) {
    const ttl = await r().ttl(minuteKey);
    return { ok: false, scope: 'minute', retryAfterSeconds: Math.max(1, ttl) };
  }
  if (dayCount > rpd) {
    const ttl = await r().ttl(dayKey);
    return { ok: false, scope: 'day', retryAfterSeconds: Math.max(1, ttl) };
  }

  return { ok: true };
}
