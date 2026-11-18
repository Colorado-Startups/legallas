# Incident plan and register

Template. The steps, severity levels and deadlines are in [incident response](../incident-response.md), which wins. A
record holds no case content and no secret.

| | |
|---|---|
| Room | `room.example.com` |
| Updated | `<YYYY-MM-DD>` |

## Contacts

| Role | Name | Reach | Checked |
|---|---|---|---|
| Incident lead | `<Name>` | `<Phone, email>` | `<YYYY-MM-DD>` |
| Backup lead | `<Name>` | `<Phone, email>` | |
| Cloudflare administrator | `<Name>` | `<Phone>` | |
| Members' firms | `<Firm>` | `<Email>` | |
| Outside counsel for notice duties | `<Name>` | `<Email>` | |
| Product flaw | Colorado Startups, private report per [`SECURITY.md`](../../../SECURITY.md) | | |

## First hour, level 1

| Step | Command or place | Done at |
|---|---|---|
| Rotate the exposed key or token | Cloudflare dashboard, `npx wrangler secret put` | `<HH:MM>` |
| Remove the member, end sessions and AI connections | `web/scripts/member.ts` | |
| Roll back a bad release | `npx wrangler deployments list`, then rollback | |
| Read the audit log | `/admin` activity log | |
| Open a register row | Below | |

## Register

| Id | Detected | Level | Signal | Contained | Members told | Cause | Fix | Review note |
|---|---|---|---|---|---|---|---|---|
| `<DOE-INC-1>` | `<YYYY-MM-DD HH:MM>` | `<1, 2 or 3>` | `<Sign-in alert, audit log, report>` | `<YYYY-MM-DD HH:MM>` | `<YYYY-MM-DD>` | `<Cause>` | `<Change made>` | `<Private store link>` |
