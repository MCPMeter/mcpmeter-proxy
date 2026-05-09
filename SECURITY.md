# Security policy

## Reporting a vulnerability

If you find a security issue in mcpmeter-proxy, **please do not open a public GitHub issue.**

Email **security@mcpmeter.com** with:

- A clear description of the issue
- Steps to reproduce (or a proof-of-concept)
- Your assessment of impact
- Any suggested mitigation

We'll acknowledge within **2 business days** and aim to ship a fix or mitigation within **7 days** for critical issues, **30 days** for non-critical.

## Scope

In scope:
- Auth bypass (any path that grants access without a valid bearer key)
- Rate-limit bypass
- Credit-debit race conditions or double-charges
- Information disclosure between consumers
- Information disclosure of JSON-RPC bodies (we should never persist or log them)
- SSRF / RCE / SQLi
- Supply-chain issues with our direct dependencies

Out of scope:
- Issues in upstream MCP servers (those are the publisher's responsibility)
- Reports requiring physical access to the host
- Self-XSS in browser dev tools
- Theoretical issues without a working exploit
- Dependency CVEs not exploitable in our usage

## Hall of fame

We list reporters who responsibly disclose with their permission. Email if you'd like to be included.
