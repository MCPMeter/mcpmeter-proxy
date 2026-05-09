# Contributing

Thanks for considering a contribution. The bar for the proxy is **simple, fast, correct** — in that order.

## Quick rules

- **Open an issue before a big PR.** Saves both of us time. Small fixes (typo, obvious bug, missing test) — just send the PR.
- **One concern per PR.** Don't bundle a refactor with a feature. Don't bundle a feature with a config change.
- **No new dependencies without a strong reason.** Every npm package is a supply-chain liability. We currently rely on Fastify, undici, ioredis, mysql2, and dotenv — that's the whole tree.
- **Be explicit about backwards compatibility.** This proxy is in production; consumer keys, ledger rows, and response headers must remain stable across minor versions.
- **Tests for hot-path changes.** The credit-debit and rate-limit paths have non-obvious correctness properties; touching them needs coverage.

## Local setup

```bash
git clone https://github.com/mcpmeter/mcpmeter-proxy.git
cd mcpmeter-proxy
cp .env.example .env
# Point at a local MySQL + Redis with the mcpmeter schema loaded
npm install
npm run dev   # restarts on file change
```

You'll need a database with the mcpmeter schema. The cleanest way today is to run the [main mcpmeter Laravel app](https://mcpmeter.com) locally so the migrations are applied; we'll publish a standalone `schema.sql` here once the schema stabilises.

## Style

- Plain JS, ESM, Node ≥ 20.
- Two-space indent, single quotes, semicolons, trailing commas where syntactically allowed. Match the existing file you're editing.
- Comments only when the *why* is non-obvious. Don't restate what the code does.

## Commit messages

Single-purpose commits. The first line is a short imperative — `add per-tool pricing override`, not `Added per-tool pricing override.`. Body explains *why* if it's not obvious from the diff.

## Reviews

We review every PR. Expect at least one round of feedback. Don't take it personally — if it's a fit, we'll merge it.

## License

By contributing you agree that your contributions are licensed under the same terms as this repository (MIT).
