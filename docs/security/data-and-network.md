# Data and network security

Part of the [security policies](README.md). Version 1.1, 2026-11-17.

## Purpose

Case content stays in the room owner's Cloudflare account, reaches only the people and AI allowed to see it, and never
lands in a log.

## Data classes

| Class | Examples | Handling |
|---|---|---|
| Case content | Documents, page text, passages, the case picture, questions, answers | Only the room's stores, the reader's browser and processors allowed by [AI governance](ai-governance.md) |
| Privileged | Any document with "privileged" in a path segment, or marked in the privilege manifest | As case content, and hidden from any role without access (`web/worker/privilege.ts`) |
| Member identity | Emails, sign-in times, IP, browser | D1 only. Never in application logs |
| Audit metadata | Who opened which document, when, through which AI app | D1 `audit_log`, append-only. Never query or page text |
| Public law | The law library | Its own bucket and search index, never mixed with the record |

## Where data lives

| Store | Location | Kind |
|---|---|---|
| D1 and R2 | The region the room owner picks when creating them, with an optional jurisdiction | Room owner |
| Workers KV (OAuth state) | Replicated globally by Cloudflare. Hashes and encrypted grants only, never case text | Platform |
| The Worker | Runs near the caller. Case text passes through memory and is not stored | Platform |

Subprocessors on the case-content path: Cloudflare only, plus any outside Ask backend the room owner turns on. A member's
own AI vendor processes what that member asks for, under the member's own agreement.

## Logging

| Rule | Kind | Evidence |
|---|---|---|
| Application logs carry error codes only: no request bodies, queries, file names or document text | Built in | `web/worker/room.ts` |
| Invocation logs and traces are off, because they record URLs and storage keys | Built in | `web/wrangler.example.jsonc` |
| Every document read, search and file sent is audited without its text. On MCP, no audit row means no data goes out | Built in | `web/worker/audit.ts`, `web/mcp/audit.ts` |
| The audit log is append-only by database trigger, and exports as a hash chain | Built in | `web/migrations/0019_audit_append_only.sql`, `web/worker/audit-chain.ts` |
| The activity log is readable by the room owner only | Built in | `web/worker/auth.ts` (`viewActivity`) |
| CI never prints case content. The replica eval prints only aggregates and uploads nothing | Built in | `.github/workflows/replica-eval.yml` |

## Retention and deletion

| Data | Kept | Evidence |
|---|---|---|
| A replaced original | 30 days, then deleted | `web/worker/sync-rules.ts` (`RETAIN_DAYS`) |
| Research chat threads | 90 days, deletable sooner | `web/worker/agent/protocol.ts` |
| Expired OAuth grants and registrations | Purged by the daily sweep | `web/mcp/sweep.ts` |
| Sign-in records: email, IP, browser, country | `RETAIN_SIGNINS_DAYS`, at least 30. Unset: until close-out | `web/worker/data-retention.ts`, daily cron |
| Audit log | `RETAIN_AUDIT_DAYS_AFTER_CLOSE` after the matter closes; a hash-chained copy is saved first. Unset: until close-out | `web/worker/data-retention.ts`, daily cron |
| Documents, page text, comments, members | Until close-out | `npm run close-out -- --delete` (`web/scripts/close-out.ts`) |

The schedule: `web/README.md`, "Retention and close-out", which wins. A legal hold that is on refuses every purge, in the code
and in the database (migration 0022), and refuses `close-out --revoke` and `--delete`. Research threads still expire under a hold.

## What enters a room

| Rule | Kind | Evidence |
|---|---|---|
| Sync aborts on a symlink, a file outside the room's folder, or a private key | Built in | `web/scripts/guard.ts` |
| Sync scans for Social Security numbers and blocks the upload unless that one file is allowed by its hash | Built in | `web/scripts/pii.ts`, `web/scripts/sync.ts` |
| Uploads: an allowlist of types checked against the file's first bytes, 95 MB at most | Built in | `web/worker/files-upload.ts` |
| Uploads and sync refuse active content: PDF scripts, Office macros or ActiveX, programs in a zip | Built in | `web/worker/active-content.ts` |

## Network

| Rule | Kind | Evidence |
|---|---|---|
| Strict Content Security Policy per response type, `frame-ancestors 'none'`, nosniff, same-origin opener and resource policies, no referrer, no-store caching | Built in | `web/worker/headers.ts` |
| The build fails if a page breaks the Content Security Policy | Built in | `web/integrations/dist-audit.mjs` |
| No CORS headers anywhere in `web/worker` or `web/mcp`: other sites can't read room responses | Built in | `web/worker/headers.ts` |
| Rate limits: Ask 6 a minute per member; MCP registration 10 and token 120 a minute per IP; daily caps per member. If the limiter errors, `/register` and `/token` refuse (503, fail closed) | Built in | `web/wrangler.example.jsonc`, `web/wrangler.mcp.example.jsonc`, `web/mcp/contract.ts`, `web/mcp/gates.ts` |
| DDoS protection at Cloudflare's edge, on every plan | Platform | The room owner's zone |
| Default callback allowlist: Claude, Microsoft and Harvey. The room owner can allow others, including loopback (`localhost`, `127.0.0.1`) for a local tool, on `/admin/clients` or in config | Built in | `web/mcp/contract.ts`, `web/mcp/redirects.ts` |

## Gaps

| Gap | What it would take |
|---|---|
| Ask, tool-call and Copilot package limits pass if Cloudflare's limiter errors; daily caps still hold | Fail closed per route, as `/register` and `/token` do |
| The MCP Origin check logs but doesn't refuse (`MCP_ORIGIN_ENFORCE` is `"0"`) | Turn it on once each AI vendor's Origin is confirmed |
| No WAF rules of the room's own | Cloudflare WAF custom rules on the room owner's zone |
| No antivirus scan of uploads; active content is refused, other malware isn't detected | A scanning service |
| D1 and R2 regions are location hints, not a residency guarantee, unless a jurisdiction is set at creation | Create rooms with a jurisdiction where residency matters |

## Review

Every 12 months, and when a store, a log setting or a route's exposure changes.
