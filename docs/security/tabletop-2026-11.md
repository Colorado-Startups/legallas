# Tabletop exercise, November 2026

Part of [Incident response](incident-response.md). Held 2026-11-05.

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
| Contain | Remove the email from Access and revoke sessions | Printed steps in `web/scripts/member.ts` | Manual |
| Assess | The audit log lists every document read and file sent, with the AI app, without text | `web/mcp/audit.ts`, `web/worker/audit.ts` | Yes |
| Notify | Room owner writes to members and the firm, with the audit rows | [Incident response](incident-response.md) | Process |
| Fix | Require a second factor for counsel in Access | [Access](access.md) | Gap |

## Findings

| Finding | Action |
|---|---|
| Detection relies on the room owner reading email | Accepted for one-owner rooms. A second recipient is a setting to add |
| Access removal is a manual step | Being automated (access hardening work) |
| A code-only sign-in let the attacker in | Room setting to require MFA, being built |
| Member removal writes no audit row | Being built |

## Next exercise

November 2027, or after any level 1 or 2 incident.
