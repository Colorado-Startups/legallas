# Encryption

Part of the [security policies](README.md). Version 1.2, 2026-11-17.

## Purpose

Case content is encrypted on every network hop and wherever it is stored. Secrets never sit in a repository.

## In transit

| Rule | Kind | Evidence |
|---|---|---|
| Every room and MCP route is served over HTTPS on the room owner's custom domain. No `workers.dev` or preview URL | Built in | `web/wrangler.example.jsonc` |
| HSTS on every response, one year, `includeSubDomains` | Built in | `web/worker/headers.ts` |
| The zone's SSL mode is Full (strict), minimum TLS 1.2, TLS 1.3 on, Always Use HTTPS on | Room owner | Cloudflare dashboard, SSL/TLS |
| Outbound calls go to https hosts only: a model host must be https, an OAuth origin must be https | Built in | `web/worker/ask-host.ts`, `web/mcp/gates.ts` |
| Outbound `fetch()` always goes over the public internet, never to another route on the same zone | Built in | `global_fetch_strictly_public` in `web/wrangler.example.jsonc` |
| Traffic between the Worker and D1, R2, KV and AI Search stays inside Cloudflare, over TLS | Platform | Cloudflare's [D1](https://developers.cloudflare.com/d1/reference/data-security/) and [R2](https://developers.cloudflare.com/r2/reference/data-security/) data security pages |

## At rest

| Store | Holds | Encryption | Kind |
|---|---|---|---|
| D1 | Catalog, members, comments, audit log | AES-256 (GCM), keys managed by Cloudflare | Platform |
| R2 | Original files, page-text index, law library | AES-256 (GCM), keys managed by Cloudflare | Platform |
| Workers KV | OAuth state: token hashes and grant details | Tokens stored only as hashes; grant details encrypted by the OAuth library | Built in |
| Workers KV | Repeated-consent state, the admin client-secret handoff | AES-GCM in the app | Built in (`web/mcp/consent-repeat.ts`, `web/mcp/admin-clients.ts`) |
| The Mac app's store | The local case tracker | The app is sandboxed. The disk relies on FileVault | Room owner |

Known Social Security numbers are kept only as salted scrypt hashes (`web/scripts/pii-hash.ts`).

## Secrets and keys

| Rule | Kind | Evidence |
|---|---|---|
| Worker secrets (`CONTROL_PREFIX`, model API keys, `ACCESS_AUD` on the MCP Worker) are set with `wrangler secret put`, never in config | Built in | `web/wrangler.example.jsonc`, `web/wrangler.mcp.example.jsonc` |
| `nodejs_compat_do_not_populate_process_env` keeps secrets out of `process.env`, so a library can't read them | Built in | `web/wrangler.example.jsonc` |
| `.dev.vars` and every room's settings file are gitignored | Built in | `.gitignore` |
| CI's secret scan runs on every change and fails it on a credential | Built in | `.github/scripts/secret-scan.sh` |
| Deploy tokens live in a GitHub environment limited to `main` | Room owner | The room's own release workflow |
| Every key expires or is rotated within 90 days | Policy | This file, [Key life cycle](#key-life-cycle) |
| Key age: the collector exists, but its read-out job has been skipped since 2026-11-17 (no lane takes the private read-out), so there is no current reading | Built, not running | `quality-speed/pages/security/collect-keys.ts`, `admin-read` in `.github/workflows/quality-speed.yml` |
| An exposed secret counts as compromised and is rotated first | Policy | [Incident response](incident-response.md) |

## Crypto risk

| Rule | |
|---|---|
| Choice | Only the platform's AES-256 (GCM) at rest, TLS 1.2 or later in transit, and Web Crypto (AES-GCM, SHA-256, scrypt) in the app. No home-made primitives |
| Before a change | A PR that adds an algorithm, a key or a store states its risk (likelihood times impact, as in [governance](governance.md#risk-management)) and its cost in latency and features, for example that app-level encryption would break AI Search |
| Watch | Dependency and code scans ([vulnerability management](vulnerability-management.md)) flag weak crypto; a deprecated algorithm is a high finding |
| Audit | Each [internal audit](governance.md#internal-audit) checks this file against the code |

## Key life cycle

| Key | Held by | Made | Rotated | Destroyed |
|---|---|---|---|---|
| D1, R2 and KV at-rest keys | Cloudflare | By Cloudflare | By Cloudflare | By Cloudflare, with the store |
| Worker secrets: model API keys, `COURTLISTENER_TOKEN` | Room owner, `wrangler secret put` | At the provider | 90 days | Revoked at the provider, then `wrangler secret delete` |
| Sync's Access service token, the Access API token (`LEGALLAS_ACCESS_API_TOKEN`) | Room owner | Cloudflare Zero Trust | 90 days | Revoked in Zero Trust |
| OAuth tokens for AI connections | KV, hashes only | At each grant | Expire with the grant | Daily sweep (`web/mcp/sweep.ts`). A removed member's next call fails |
| AES-GCM keys for consent and admin handoff | Derived per record from a value only the caller holds; never stored | Per request | Per record | When the KV record expires |
| Commit signing keys, GitHub sign-in | Each maintainer's device | On the device | On device change | [People and endpoints](people-and-endpoints.md#disposal) |

| Key event | Record |
|---|---|
| A compromised key | [Incident response](incident-response.md): rotated first, then recorded in the incident record |

## Gaps

| Gap | What it would take |
|---|---|
| No application-level encryption of documents in D1 or R2 beyond Cloudflare's | Per-room keys in Cloudflare's Secrets Store, and encrypting before each write. It would break AI Search over the index |
| Keys are Cloudflare-managed, not customer-held | Not offered by D1 or R2 today |
| HSTS has no `preload` | Left off on purpose: it binds the whole domain, not just the room's subdomains |

## Review

Every 12 months, and when a store, a secret or a TLS setting changes.
