# Vendor register

Template. Relies on [governance, suppliers](../governance.md#suppliers) and [AI governance](../ai-governance.md), which
win where they disagree. An AI processor other than the room's Cloudflare account needs zero data retention (ZDR),
confirmed from the vendor's own page.

| | |
|---|---|
| Operator | `<Operator name>` |
| Updated | `<YYYY-MM-DD>` |

## Vendors

| Vendor | Service | Sees case content | Retention | ZDR | Source read | Agreement | Owner | Next review |
|---|---|---|---|---|---|---|---|---|
| Cloudflare | Workers, D1, R2, KV, Access, AI Search, Workers AI | Yes | Until the operator deletes | Not needed: the room's own account | `<URL>`, `<YYYY-MM-DD>` | Subscription Agreement, DPA `<version>` | `<Name>` | `<YYYY-MM-DD>` |
| GitHub | Deploy token, Actions | No | `<Log retention>` | Not needed: no case content | `<URL>`, `<YYYY-MM-DD>` | `<Terms>` | `<Name>` | |
| `<Outside Ask backend, or none>` | Ask answers | Yes | `<None>` | `<Yes, zdr_confirmed>` | `<URL>`, `<YYYY-MM-DD>` | `<DPA>` | `<Name>` | |
| `<Email provider>` | Sign-in alerts | No | `<Days>` | Not needed | `<URL>` | `<Terms>` | `<Name>` | |
| `<Other>` | | | | | | | | |

## Members' AI apps

Each member's AI vendor is under that member's own agreement. Record what the room allows.

| AI app | Allowed by callback list | ZDR state the operator read | Source | Date |
|---|---|---|---|---|
| Claude | Default | `<Yes or no, and plan>` | `<URL>` | `<YYYY-MM-DD>` |
| Microsoft 365 Copilot | Default | `<Yes or no>` | `<URL>` | |
| Harvey | Default | `<Yes or no>` | `<URL>` | |
| `<Other, added on /admin/clients>` | Added `<YYYY-MM-DD>` | | | |

## Cloudflare: the operator's duties

| Duty | Where set | Done |
|---|---|---|
| MFA on every account member; enforce two-factor | Account, Members | `<YYYY-MM-DD>` |
| Access lists each email; countries limited | Zero Trust, Access | |
| Invocation logs and traces off | Each Worker | |
| AI Search reranking and cache off; AI Gateway logs off | AI, AI Search | |
| No `workers.dev` or preview URL | Each Worker | |
| D1 and R2 created with a jurisdiction where residency matters | At creation | |
| Backup Worker scheduled | `legallas-backup` | |
| WAF rules and edge settings | [Edge check](edge-check.md) | |
| Compliance reports read (Trust Hub) | Dashboard | `<YYYY-MM-DD>` |
