# Access management

Part of the [security policies](README.md). Version 1.0, 2026-11-05.

## Purpose

Only people the room owner invited, one by one, reach a room. Each sees only what their role allows. Removing a person
ends every way they had in.

## Two locks on every request

```mermaid
flowchart LR
  P[Person or AI app] --> A["Lock 1: Cloudflare Access proves the email"]
  A --> M["Lock 2: the members table decides what that email may see"]
  M --> R[Room, files, MCP tools]
```

| Rule | Kind | Evidence |
|---|---|---|
| The Worker verifies the signed Access token on every request, static files included: issuer, audience, RS256, expiry, email | Built in | `web/worker/auth.ts` |
| No Access team or audience configured: every request is refused | Built in | `web/worker/auth.ts` |
| No members row: no entry | Built in | `web/worker/auth.ts` |
| The development identity works only on localhost, and a test bans it from production config | Built in | `web/worker/auth.ts`, `web/worker/config.test.ts` |
| Writes check the exact Origin and `Sec-Fetch-Site` | Built in | `web/worker/http.ts` |
| No `workers.dev` or preview URL: the custom domain behind Access is the only way in | Built in | `web/wrangler.example.jsonc` |

## Sign-in

| Rule | Kind | Evidence |
|---|---|---|
| Access lists each person's email. Never a whole domain | Room owner | `web/connect/security-brief.md` |
| Members sign in with a one-time email code. The room owner uses the Cloudflare login with its own multi-factor sign-in | Room owner | `docs/design/rooms-and-grants.md`, "Sign-in, and keeping Access in step without a token" |
| Access can add independent MFA (a security key or a biometric; `REQUIRE_MFA` counts only these) on top of the code, at no cost on Zero Trust Free | Room owner, recommended | `docs/design/rooms-and-grants.md` |
| Sign-ins limited to the room owner's chosen countries | Room owner | An Access policy rule |
| Session length is set on the Access application. The Worker enforces the token's expiry | Room owner | `docs/design/rooms-and-grants.md` |
| The room owner gets an email on every new session by another member | Built in | `web/worker/signins.ts` |

## Roles

| Role | Sees | Can do |
|---|---|---|
| Owner | Everything, privileged included | Everything counsel can, plus the activity log and admin pages |
| Counsel | Everything, privileged included | View, download, upload, comment, Ask, connect their own AI, approve their own AI's drafts |
| Guest (deal and matter rooms, off unless `ROOMS_ENABLED`) | That room's folders. Investors never see privileged; matter-room counsel do | Only that room's guest routes. Never a member route or the MCP server |

Evidence: `web/worker/auth.ts`, `web/worker/rooms.ts`, `web/worker/privilege.ts`. A path with "privileged" in any segment
is hidden from a role without access, and answers like a missing document.

## AI connections (MCP)

| Rule | Kind | Evidence |
|---|---|---|
| OAuth 2.1 with PKCE, one scope, `case.read`. Tokens bound to this server | Built in | `web/mcp/contract.ts`, `web/mcp/oauth.ts` |
| Access tokens last 1 hour. Refresh tokens rotate and end 30 days after sign-in | Built in | `web/mcp/contract.ts` |
| A consent page names the app before access is granted | Built in | `web/mcp/authorize.ts` |
| Every tool call re-reads the member's row and role | Built in | `web/mcp/server.ts` |
| Self-registration accepts only allowlisted callbacks, caps metadata at 4 KB, and expires unused registrations after 30 days | Built in | `web/mcp/oauth.ts`, `web/mcp/contract.ts` |
| Members see and revoke their own connections; the room owner can revoke anyone's | Built in | `web/mcp/connections.ts` |
| A daily sweep revokes grants whose member is gone | Built in | `web/mcp/sweep.ts` |

## Joining and leaving

| Step | Kind | Evidence |
|---|---|---|
| Add a member: the room owner's command line, then the Access policy | Room owner | `web/scripts/member.ts` |
| Remove a member: deletes the row and revokes their room invitations. Their next MCP call fails | Built in | `web/scripts/member.ts`, `web/mcp/server.ts` |
| Then remove the email from Access and revoke their sessions. The command prints these steps | Room owner | `web/scripts/member.ts` |
| Guest invitations expire: 120 days by default, 730 at most | Built in | `web/scripts/room.ts` |
| Admin pages (`/admin/clients`) are owner-only | Built in | `web/mcp/admin-clients.ts` |

## Who administers the room

| Rule | Kind |
|---|---|
| The room owner's Cloudflare account has multi-factor sign-in on every member | Room owner |
| Cloudflare's account-wide "enforce two-factor" setting is on when the account has more than one member | Room owner |
| Worker secrets and the deploy token live in Cloudflare and the room's GitHub environment, never in a repository | Room owner |
| Colorado Startups holds no access to any room or room account | Built in by design ([`SECURITY.md`](../../SECURITY.md)) |

## Gaps

| Gap | What it would take |
|---|---|
| Counsel and guests sign in with an emailed code only, unless the room owner adds independent MFA | One Access setting; each person enrolls once |
| Adding or removing a member writes no audit row | One `audit_log` insert in `web/scripts/member.ts` |
| Removing someone from Access is a printed manual step | An Access API call, which needs a token the room owner creates |
| The Worker doesn't check the token's MFA claim (`amr`) | Read `amr` and refuse a code-only session where the room requires MFA |

## Review

Every 12 months, and when a role, a sign-in method or an MCP tool changes.
