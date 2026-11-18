# Edge settings record

Template. The settings are in `web/README.md`, "Edge rules: Cloudflare WAF, Free plan", [access management](../access.md)
and [data and network security](../data-and-network.md), which win. Run `npm run harden -- --check` from `web/`; it
reads the settings and changes nothing. Copy each row's result here.

| | |
|---|---|
| Zone | `example.com` |
| Room hosts | `room.example.com`, `mcp.room.example.com` |
| Checked by | `<Name>` |

| Setting | Expected | `<YYYY-MM-DD>` | `<YYYY-MM-DD>` | `<YYYY-MM-DD>` |
|---|---|---|---|---|
| WAF 1: rate limit `/token`, `/register` | Block, 20 per 10 s | `<Pass or fail>` | | |
| WAF 2: members' countries only | Block outside `<US>` | | | |
| WAF 3: no crawlers on the room | Block | | | |
| WAF 4: scanner probes | Block | | | |
| WAF 5: attack tool user agents | Managed Challenge | | | |
| Bot Fight Mode | Off | | | |
| Zone HSTS subdomains | Off | | | |
| `workers.dev` and preview URLs | Off | | | |
| Invocation logs and traces | Off | | | |
| Access application on each host | On, emails listed | | | |
| `REQUIRE_MFA` | `"1"` | | | |
| AI Gateway logs | Off | | | |
| `<Other row the check prints>` | | | | |
| Failed rows | 0 | `<Count, and Risks ids>` | | |
