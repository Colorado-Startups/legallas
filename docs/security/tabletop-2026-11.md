# Tabletop exercise, November 2026

Part of [Incident response](incident-response.md). Held 2026-11-05. Findings updated 2026-11-17.

| | |
|---|---|
| Kind | Desk exercise: the response steps walked against the code, on the fictional room (Doe v. Harbor Labs, prefix `DOE`) |
| Run by | The maintainer's AI session. No live system was touched and no person was paged |
| Scenario | A counsel member's mailbox is taken over. The attacker signs in with the emailed code, connects an AI app, and pulls files |

## Walk-through

| Step | What happens | Evidence | Held? |
|---|---|---|---|
| Detect | The room owner gets an email for the new session, and another for the new AI connection | `web/worker/signins.ts`, `web/connect/security-brief.md` | Yes, if the room owner reads it |
| Contain | `member remove` deletes the row and the member's room invitations. The next MCP call fails. The owner revokes the connection on `/connections` | `web/scripts/member.ts`, `web/mcp/server.ts`, `web/mcp/connections.ts` | Yes |
| Contain | Remove the email from Access and revoke sessions | `web/scripts/access-offboard.ts` with the room owner's token; else printed steps | Yes, with the token |
| Assess | The audit log lists every document read and file sent, with the AI app, without text | `web/mcp/audit.ts`, `web/worker/audit.ts` | Yes |
| Notify | Room owner writes to members and the firm, with the audit rows | [Incident response](incident-response.md) | Process |
| Fix | Require a second factor: `REQUIRE_MFA` | `web/worker/mfa.ts` | Built; the room owner turns it on |

## Findings

| Finding | Action |
|---|---|
| Detection relies on the room owner reading email | Accepted for one-owner rooms. A second recipient is a setting to add |
| Access removal is a manual step | Built: `web/scripts/access-offboard.ts`, with the room owner's Access token |
| A code-only sign-in let the attacker in | Built: `REQUIRE_MFA` (`web/worker/mfa.ts`); the room owner turns it on |
| Member removal writes no audit row | Built: an `access_events` row per change (`web/scripts/member.ts`) |

## Next exercise

November 2027, or after any level 1 or 2 incident.
