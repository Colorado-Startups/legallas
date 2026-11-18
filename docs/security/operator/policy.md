# Operator security policy

Template. Relies on [access management](../access.md) and [people and endpoints](../people-and-endpoints.md), which win
where they disagree.

| | |
|---|---|
| Operator | `<Operator name>` |
| Room | `room.example.com`, MCP at `mcp.room.example.com` |
| Matter | `<Matter id, for example DOE>` |
| Version | `<1.0>`, `<YYYY-MM-DD>` |
| Approved by | `<Name>`, `<Role>` |

## Owner

| Role | Name | Backup |
|---|---|---|
| Room owner | `<Name>` | `<Name>` |
| Cloudflare account super administrator | `<Name>` | `<Name, a second administrator>` |
| Incident lead | `<Name>` | `<Name>` |
| Security contact, published at `/.well-known/security.txt` | `<email>` | |

## Access

| Rule | Setting | Done |
|---|---|---|
| Access lists each person's email, never a domain | `<Access application name>` | `<YYYY-MM-DD>` |
| Every member added with `web/scripts/member.ts`, then Access | Yes | |
| Countries allowed to sign in | `<US>` | `<YYYY-MM-DD>` |
| Access session length | `<24 hours>` | `<YYYY-MM-DD>` |
| AI apps allowed (`AI_POLICY`) | `<zdr or any listed>` | `<YYYY-MM-DD>` |
| Quarterly access review: `npm run access-review` | Logged in [Watch log](watch-log.md) | `<YYYY-MM-DD>` |
| Leaver removed within | `<1 business day>` | |

## MFA

| Who | Method | Done |
|---|---|---|
| Every Cloudflare account member | `<Security key or passkey>` | `<YYYY-MM-DD>` |
| Cloudflare "enforce two-factor" | On | `<YYYY-MM-DD>` |
| Room members (`REQUIRE_MFA` = `"1"`) | `<Security key or biometric>` | `<YYYY-MM-DD>` |
| GitHub account holding the deploy token | `<Passkey>` | `<YYYY-MM-DD>` |

## Devices

| Rule | Setting |
|---|---|
| Devices that run admin commands | `<List: device, owner>` |
| Disk encryption | On, checked `<YYYY-MM-DD>` |
| Screen lock | `<5 minutes>` |
| OS updates | Within `<14 days>` |
| Synced originals folder | Only on the devices above |
| Lost device | Report to the incident lead within `<1 hour>`; follow [Incidents](incidents.md) |

## Review

| Date | Reviewer | Changes |
|---|---|---|
| `<YYYY-MM-DD>` | `<Name>` | `<None, or what changed>` |
