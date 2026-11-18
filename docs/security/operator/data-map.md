# Data map

Template. Relies on [data and network security](../data-and-network.md) and [AI governance](../ai-governance.md), which
win where they disagree.

| | |
|---|---|
| Room | `room.example.com` |
| D1 and R2 region | `<Location hint>`; jurisdiction `<eu, fedramp or none>` |
| Updated | `<YYYY-MM-DD>` |

## Data

| Data | Class | Store | Retention set | Who can read | Checked |
|---|---|---|---|---|---|
| Original documents | Case content | R2 `legallas-files` | Until close-out | Owner, counsel; guests per room | `<YYYY-MM-DD>` |
| Replaced originals | Case content | R2 `legallas-files` | 30 days | Owner, counsel | |
| Page text | Case content | R2 `legallas-index`, D1 `page_fts` | Until close-out | Owner, counsel | |
| Search index | Case content, as embeddings | AI Search `legallas` | Until close-out; re-indexed from page text | The Worker only | |
| Catalog, comments | Case content | D1 | Until close-out | Owner, counsel | |
| Privileged documents | Privileged | R2, D1 | Until close-out | Roles with privileged access | |
| Members | Member identity | D1 | Until close-out | Owner | |
| Sign-in records | Member identity | D1 | `RETAIN_SIGNINS_DAYS` = `<days>` | Owner | |
| Audit log | Audit metadata | D1 `audit_log` | `RETAIN_AUDIT_DAYS_AFTER_CLOSE` = `<days>` | Owner | |
| Research threads | Case content | D1 | 90 days | That member | |
| OAuth state | Hashes, encrypted grants | Workers KV | Purged daily when expired | The MCP Worker only | |
| Law library | Public law | R2 `legallas-law`, its own AI Search | Rebuilt | Every member | |
| Backups | All of the above | R2 `legallas-backup` | `<Never pruned, or rule>` | Owner | |
| `<Other>` | `<Class>` | `<Store>` | `<Rule>` | `<Roles>` | |

## Outside the account

| Flow | To | Allowed by | On |
|---|---|---|---|
| Ask passages | `<Workers AI only, or outside backend>` | [Vendors](vendors.md) row | `<YYYY-MM-DD>` |
| A member's AI app | That member's AI vendor | `AI_POLICY` = `<value>` | |
| Counsel pack | `<Firm storage>` | `npm run counsel-pack` | |
| Export | `<Where>` | `npm run close-out -- --export` | |

## Legal hold

| Hold | On | Off | By |
|---|---|---|---|
| `<DOE-hold-1>` | `<YYYY-MM-DD>` | `<YYYY-MM-DD or open>` | `<Name>` |
