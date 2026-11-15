# Automated dynamic scan, 2026-11-06

An automated dynamic application security test (DAST) of Legallas, run by OWASP ZAP against the fictional sample room.
It is not a penetration test: no person tried to break in, and it does not judge business logic or one member's access to another's data.

| | |
|---|---|
| Date | 2026-11-06 |
| Code | `03775e4bd7a3` |
| Run | [GitHub Actions](https://github.com/Colorado-Startups/legallas/actions/runs/42231161956) |
| Scanner | OWASP ZAP 2.17.0, official image `sha256:9624669db72f`, with its MCP add-on 0.4.0 |
| Target | The fictional sample room, both Workers, served inside the CI job on localhost. No customer room and no deployed host |
| Time | 28 minutes |
| ZAP plan | Finished, with warnings |

## Findings by severity

| Severity | Open | Accepted | Fixed |
|---|---|---|---|
| High | 0 | 0 | 0 |
| Medium | 0 | 7 | 0 |
| Low | 4 | 3 | 0 |
| Informational | 0 | 6 | 0 |
| **Total** | **4** | **16** | **0** |

One finding is one ZAP rule on one target, however many pages it was seen on. Open means not yet fixed or judged.
Accepted means judged in `quality-speed/pages/security/dast/triage.json`, with the reason below.

## What was scanned

| Target | Requests sent | Active scan limit |
|---|---|---|
| Room, signed in as its owner | 650 | 15 minutes |
| Room, as a stranger | 163 | 3 minutes |
| MCP server, with a member's AI token | 95 | 12 minutes |
| MCP server, as a stranger | 78 | 3 minutes |

| Reach check | Result |
|---|---|
| Room routes in the route table | 48, all imported into the scan |
| Room GET routes that answered the owner with 2xx | 22 of 28 |
| Room routes refused to a stranger | 48 of 48 |
| MCP tools ZAP's import reached | 9 of 9; 9 refused ZAP's placeholder arguments, so ran only their checks |

## Findings

| Severity | Finding | Rule | Target | Seen at | Status | Reason |
|---|---|---|---|---|---|---|
| Medium | Absence of Anti-CSRF Tokens | [10202](https://www.zaproxy.org/docs/alerts/10202/) | MCP server, with a member's AI token | `GET /authorize`, `GET /connect` | accepted | ZAP looks for a token by name only. The consent form carries the OAuth library's consent handle: single-use, 10 minutes, tied to the browser that opened it (web/mcp/authorize.ts). The /connect form downloads the Copilot package and changes nothing. |
| Medium | Absence of Anti-CSRF Tokens | [10202](https://www.zaproxy.org/docs/alerts/10202/) | MCP server, as a stranger | `GET /connect` | accepted | ZAP looks for a token by name only. The consent form carries the OAuth library's consent handle: single-use, 10 minutes, tied to the browser that opened it (web/mcp/authorize.ts). The /connect form downloads the Copilot package and changes nothing. |
| Medium | CSP: Failure to Define Directive with No Fallback | [10055-13](https://www.zaproxy.org/docs/alerts/10055/) | MCP server, with a member's AI token | `GET /admin/clients`, `GET /authorize`, `GET /connections`, `GET /privacy`, `GET /terms` | accepted | No form-action on purpose (web/mcp/pages/index.ts htmlResponse): Chrome applies it to the redirect after the consent form's POST, which goes to the AI app's own callback. The pages allow no script, and their templates escape every value a request can carry (quality-speed/pages/security/PLAN.md, the audits). |
| Medium | CSP: Failure to Define Directive with No Fallback | [10055-13](https://www.zaproxy.org/docs/alerts/10055/) | MCP server, as a stranger | `GET /admin/clients`, `GET /authorize`, `GET /connections`, `GET /privacy`, `GET /terms` | accepted | No form-action on purpose (web/mcp/pages/index.ts htmlResponse): Chrome applies it to the redirect after the consent form's POST, which goes to the AI app's own callback. The pages allow no script, and their templates escape every value a request can carry (quality-speed/pages/security/PLAN.md, the audits). |
| Medium | CSP: style-src unsafe-inline | [10055-6](https://www.zaproxy.org/docs/alerts/10055/) | MCP server, with a member's AI token | `GET /admin/clients`, `GET /authorize`, `GET /connections`, `GET /privacy`, `GET /terms` | accepted | The MCP server's pages allow no script (default-src 'none') and load images only as data: URLs, so injected CSS can neither run code nor fetch or send anything. The inline style is each page's own stylesheet. |
| Medium | CSP: style-src unsafe-inline | [10055-6](https://www.zaproxy.org/docs/alerts/10055/) | MCP server, as a stranger | `GET /admin/clients`, `GET /authorize`, `GET /connections`, `GET /privacy`, `GET /terms` | accepted | The MCP server's pages allow no script (default-src 'none') and load images only as data: URLs, so injected CSS can neither run code nor fetch or send anything. The inline style is each page's own stylesheet. |
| Medium | HTTP Only Site | [10106](https://www.zaproxy.org/docs/alerts/10106/) | Room, signed in as its owner | `GET /regulator/` | accepted | The scan reaches the Workers over plain HTTP on localhost by design. A deployed room runs on a Cloudflare custom domain, which serves HTTPS, and the room sends HSTS for a year (web/worker/headers.ts). |
| Low | Application Error Disclosure | [90022](https://www.zaproxy.org/docs/alerts/90022/) | Room, signed in as its owner | `POST /api/hold` | open |  |
| Low | Cross Site Scripting Weakness (Persistent in JSON Response) | [40014-2](https://www.zaproxy.org/docs/alerts/40014/) | Room, signed in as its owner | `GET /api/documents/:id/comments` | open |  |
| Low | X-Content-Type-Options Header Missing | [10021](https://www.zaproxy.org/docs/alerts/10021/) | MCP server, with a member's AI token | `GET /.well-known/oauth-authorization-server`, `GET /.well-known/oauth-protected-resource`, `GET /.well-known/oauth-protected-resource/mcp`, `POST /mcp`, `POST /register` | open |  |
| Low | X-Content-Type-Options Header Missing | [10021](https://www.zaproxy.org/docs/alerts/10021/) | MCP server, as a stranger | `GET /.well-known/oauth-authorization-server`, `POST /register` | open |  |
| Low | Timestamp Disclosure - Unix | [10096](https://www.zaproxy.org/docs/alerts/10096/) | MCP server, with a member's AI token | `POST /register` | accepted | The Unix times are RFC 7591's client_id_issued_at in /register answers and numeric constants in the build's script files. Neither says anything about the room. |
| Low | Timestamp Disclosure - Unix | [10096](https://www.zaproxy.org/docs/alerts/10096/) | MCP server, as a stranger | `POST /register` | accepted | The Unix times are RFC 7591's client_id_issued_at in /register answers and numeric constants in the build's script files. Neither says anything about the room. |
| Low | Timestamp Disclosure - Unix | [10096](https://www.zaproxy.org/docs/alerts/10096/) | Room, signed in as its owner | `GET /_astro/*` | accepted | The Unix times are RFC 7591's client_id_issued_at in /register answers and numeric constants in the build's script files. Neither says anything about the room. |
| Informational | Information Disclosure - Sensitive Information in URL | [10024](https://www.zaproxy.org/docs/alerts/10024/) | Room, signed in as its owner | `GET /activity/`, `GET /hold/` | accepted | The address in the URL is the crawler's own invented one, which it typed into the Activity filter and the hold page's forms. The room sends Referrer-Policy: no-referrer, so a URL never leaves for another site. |
| Informational | Modern Web Application | [10109](https://www.zaproxy.org/docs/alerts/10109/) | Room, signed in as its owner | `GET /doc/` | accepted | Informational: the pages use script, so ZAP suggests its browser-driven spider. The room's route table, imported as an API definition, covers every route the pages call. |
| Informational | Session Management Response Identified | [10112](https://www.zaproxy.org/docs/alerts/10112/) | MCP server, with a member's AI token | `GET /admin/clients`, `GET /authorize`, `GET /connections` | accepted | Informational: ZAP notes a response that sets a cookie it takes for a session token. It is the forms' anti-forgery token (web/mcp/forms.ts) or the OAuth library's consent cookie, and names no weakness. |
| Informational | User Agent Fuzzer | [10104](https://www.zaproxy.org/docs/alerts/10104/) | MCP server, as a stranger | `POST /connect/copilot-package`, `POST /register`, `POST /token` | accepted | Informational: ZAP lists answers that differ when it changes the User-Agent header. Neither Worker decides access by User-Agent; the room only records it in its audit log. |
| Informational | User Agent Fuzzer | [10104](https://www.zaproxy.org/docs/alerts/10104/) | Room, signed in as its owner | `POST /api/ask` | accepted | Informational: ZAP lists answers that differ when it changes the User-Agent header. Neither Worker decides access by User-Agent; the room only records it in its audit log. |
| Informational | User Controllable HTML Element Attribute (Potential XSS) | [10031](https://www.zaproxy.org/docs/alerts/10031/) | Room, signed in as its owner | `GET /activity/`, `GET /proposals/` | accepted | Informational. The query values ZAP matched (action=sign_in, view=decided) are the filters' own fixed option values. The room serves these pages as files built ahead of time and never writes a query value into them. |

Judgments in `triage.json` that matched nothing this run:

- 40014-2 at `^/api/comments$`: The scan's script string comes back as JSON data (application/json, nosniff, CSP default-src 'none'). The room's pages put comment bodies in with textContent and el(), never innerHTML (web/src/scripts/comments.ts).

## Not covered

| Not covered | Why |
|---|---|
| Cloudflare Access, TLS and the edge | The scan reaches the Workers directly on localhost over HTTP. In a real room Cloudflare Access refuses a stranger before the Worker runs |
| Deal-room guest routes and the laptop sync endpoints | Each needs an identity the harness does not make: an invited guest, or a sync service token |
| The Mac app | It is not a web application |
| Access between members, and business logic | A scanner cannot judge who should see what. That is what a penetration test adds |

How it runs, and how to judge a finding: `quality-speed/pages/security/dast/README.md`.
