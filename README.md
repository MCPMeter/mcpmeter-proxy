# mcpmeter-proxy

> The metering gateway in front of every MCP server listed on [mcpmeter.com](https://mcpmeter.com).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Node](https://img.shields.io/badge/node-%3E%3D20-339933.svg)
![Status](https://img.shields.io/badge/status-production-green.svg)

A small, fast Fastify proxy that authenticates a bearer key, rate-limits, debits pre-paid credit, and forwards a JSON-RPC MCP call to the publisher's upstream &mdash; in roughly 50ms.

We open-source it because **the meter should be inspectable, not just trusted**.

---

## What it does

For every request to `https://proxy.mcpmeter.com/<slug>`:

1. **Authenticate.** SHA-256 the bearer, look it up in Redis (with MySQL fallback). Resolves to a project + monthly cap.
2. **Resolve listing.** Slug &rarr; publisher's upstream URL, transport, free-tier allowance, rate limits.
3. **Rate-limit.** Per-(MCP, consumer) sliding-window counters in Redis. Over &rarr; `429` with `Retry-After`.
4. **Free tier.** If within the publisher's monthly free allowance, mark `FREE` and skip the debit.
5. **Credit gate.** Atomic debit in MySQL. Insufficient balance &rarr; `402`.
6. **Forward.** Stream the JSON-RPC body to the publisher's MCP. Supports HTTP / streamable HTTP / SSE.
7. **Record.** One row per call to `usage_events`.

That's the whole thing. ~600 lines of JavaScript.

---

## Quickstart

Requires Node ≥ 20, MySQL 8, and Redis 6.

```bash
git clone https://github.com/MCPMeter/mcpmeter-proxy.git
cd mcpmeter-proxy
cp .env.example .env                 # fill in DB + Redis creds

# Bootstrap the schema (one-time):
mysql -u root -e "CREATE DATABASE mcpmeter CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
npm run db:init                      # loads schema.sql into $DB_NAME

npm install
npm start                            # dev: npm run dev
```

Health check:

```bash
curl http://127.0.0.1:3010/health
```

### About the schema

`schema.sql` is a snapshot of the canonical schema — the [mcpmeter Laravel app](https://mcpmeter.com) owns the migrations. We don't ship a Node migration tool here on purpose: two sources of truth would drift.

When the upstream Laravel app changes the schema, regenerate the snapshot:

```bash
mysqldump --no-data --skip-comments --no-tablespaces \
  -h "$DB_HOST" -u "$DB_USER" -p mcpmeter \
  users api_keys projects mcps mcp_tools pricing_rules \
  usage_events credit_transactions mcp_consumer_usage \
  > schema.sql
```

The proxy only reads / writes columns documented in [`lib/db.js`](lib/db.js) — the rest of the Laravel-managed tables are irrelevant here.

---

## Configuration

All via env vars (see `.env.example`):

| Variable          | Default       | Notes                                      |
|------------------|---------------|--------------------------------------------|
| `HOST`           | `127.0.0.1`   | Bind address                               |
| `PORT`           | `3010`        | Listen port                                |
| `DB_HOST`        | `127.0.0.1`   | MySQL host                                 |
| `DB_PORT`        | `3306`        |                                            |
| `DB_USER`        | —             | Required                                   |
| `DB_PASSWORD`    | —             |                                            |
| `DB_NAME`        | `mcpmeter`    | Database name                              |
| `REDIS_HOST`     | `127.0.0.1`   |                                            |
| `REDIS_PORT`     | `6379`        |                                            |
| `REDIS_DB`       | `2`           | Logical DB index                           |
| `LOG_LEVEL`      | `info`        | `trace`/`debug`/`info`/`warn`/`error`/`fatal` |

---

## Status codes

| Code  | Source    | Meaning                                              | Refunded? |
|-------|-----------|------------------------------------------------------|-----------|
| `200` | Proxy     | Forwarded successfully                               | —         |
| `2xx` | Publisher | Upstream success (passed through)                    | —         |
| `400` | Proxy     | Invalid slug / malformed request                     | n/a       |
| `401` | Proxy     | Missing / unknown / revoked bearer key               | n/a       |
| `402` | Proxy     | Out of credit, no free-tier remaining                | n/a       |
| `402` | Proxy     | Project's monthly cap exceeded                       | n/a       |
| `403` | Proxy     | Account suspended                                    | n/a       |
| `404` | Proxy     | No such MCP slug                                     | n/a       |
| `410` | Proxy     | Listing archived                                     | n/a       |
| `429` | Proxy     | Rate-limit exceeded (`Retry-After` header set)       | n/a       |
| `502` | Proxy     | Upstream failed mid-call                             | **yes**   |
| `503` | Proxy     | Publisher paused the listing                         | n/a       |
| `504` | Proxy     | Upstream timeout (>30s)                              | **yes**   |

Full reference at [mcpmeter.com/docs/errors](https://mcpmeter.com/docs/errors).

## Response headers

Every proxied response carries:

| Header                    | Value                          |
|---------------------------|--------------------------------|
| `X-Mcpmeter-Request-Id`   | UUID v4 — quote when reporting |
| `X-Mcpmeter-Billed`       | `free` or µ¢ amount debited    |
| `X-Mcpmeter-Duration-Ms`  | Total proxy latency incl. upstream |
| `X-Mcpmeter-Balance`      | Remaining µ¢ on the consumer's account |

## Demo MCPs

`demos/` contains five reference MCP servers consolidated into a single PM2 service. Useful both as integration smoke-tests and as examples for publishers building their first MCP.

- `echo-test` — round-trip a JSON-RPC call
- `weather` — Open-Meteo current conditions
- `currency` — Frankfurter FX rates
- `wikipedia` — Wikipedia REST search
- `github-public` — public GitHub repo metadata

Run them:

```bash
cd demos && node server.js     # starts on PORT (default 3011)
```

---

## Architecture notes

- **Stateless.** Horizontally scale by adding instances behind a load balancer; auth + rate-limit state lives in Redis.
- **Atomic credit debit.** MySQL `UPDATE users SET credit_micro_cents = credit_micro_cents - X WHERE id = ? AND credit_micro_cents >= X`. No race window.
- **Negative caching** of unknown keys/slugs for 30s — thwarts brute-forcing without slowing legitimate traffic.
- **Auto-refunds.** A `5xx` from the upstream rolls back the debit and writes a `refund` ledger row in the same transaction.
- **Streaming pass-through** via `undici` — no body buffering for SSE / streamable HTTP responses.
- **No payload retention.** JSON-RPC bodies stream through; we log metadata only (slug, tool, status, duration, byte counts).

---

## Production deployment

Reference deploy uses PM2 + nginx + Cloudflare:

```bash
# 1. Run as a service
pm2 start npm --name mcpmeter-proxy -- start
pm2 save

# 2. nginx in front of 127.0.0.1:3010 with SSE-friendly settings (see deploy/nginx.conf)
# 3. Cloudflare in front (optional) for DDoS + TLS at the edge
```

Key nginx settings for streamable transports:

```nginx
proxy_buffering         off;
proxy_request_buffering off;
proxy_read_timeout      300s;
proxy_http_version      1.1;
proxy_set_header        Connection '';
```

---

## Roadmap (what's not built yet)

- [ ] Tests
- [ ] Per-tool pricing overrides (today every listing has one price)
- [ ] Circuit breaker that auto-pauses listings after N consecutive failures
- [ ] Async batched ledger writes via a queue (currently per-call inserts)
- [ ] Auth-header pass-through to upstream (for publishers wanting their own bearer)

---

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). For security issues, see [SECURITY.md](SECURITY.md) — please do **not** open public issues for vulnerabilities.

---

## License

MIT. See [LICENSE](LICENSE).

---

### Related

- **Marketplace + dashboard:** [mcpmeter.com](https://mcpmeter.com) (closed-source Laravel app)
- **Docs:** [mcpmeter.com/docs](https://mcpmeter.com/docs)
- **Status codes ref:** [mcpmeter.com/docs/errors](https://mcpmeter.com/docs/errors)
- **Pricing model:** [mcpmeter.com/docs/pricing](https://mcpmeter.com/docs/pricing)
