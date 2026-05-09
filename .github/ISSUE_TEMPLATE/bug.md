---
name: Bug report
about: Something isn't working as documented
title: '[bug] '
labels: bug
---

**What happened**
A clear description of the bug.

**Expected behaviour**
What you thought would happen.

**Reproduction**
Steps to reproduce. Include the request you sent and the response you got.

```bash
$ curl ...
```

**Environment**
- mcpmeter-proxy version / git SHA:
- Node version: `node --version`
- MySQL version:
- Redis version:
- Behind a CDN / load balancer? (Cloudflare, etc.)

**Logs**
Anything relevant from the proxy logs (`LOG_LEVEL=debug` if needed).

**Request ID**
If reproducible against `proxy.mcpmeter.com`, paste the `X-Mcpmeter-Request-Id` header value — we can pull the full call trace from that.
