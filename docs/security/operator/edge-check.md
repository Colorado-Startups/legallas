# Edge settings record

Template. The settings are in `web/README.md`, "Edge rules: Cloudflare WAF, Free plan", [access management](../access.md)
and [data and network security](../data-and-network.md), which win. Run `npm run harden -- --check` from `web/`; it
reads the settings and changes nothing. Copy each row's result here: `pass`, `drift`, `warn` or `error`.

| | |
|---|---|
| Zone | `example.com` |
| Room hosts | `room.example.com`, `mcp.room.example.com` |
| Checked by | `<Name>` |

## Rows `harden` prints

In its order. Pass when: `web/README.md`, "Edge rules".

| Row | Pass when | `<YYYY-MM-DD>` | `<YYYY-MM-DD>` | `<YYYY-MM-DD>` |
|---|---|---|---|---|
| Backup bucket lock | A rule keeps `objects/` 30+ days | `<pass>` | | |
| security.txt | On, a Contact, Expires ahead | | | |
| Custom firewall rules | Rules 2 to 5 present and on | | | |
| Sign-in rate limit | Rule 1 present and on | | | |
| Managed and OWASP rulesets | Both deployed (Pro plan or above) | | | |
| Account 2FA enforced | `enforce_twofactor` on | | | |
| Access MFA on room apps | Every room app asks for a security key or biometric | | | |
| Min TLS, Always HTTPS, HSTS | TLS 1.2+, on, on | | | |
| Bot Fight Mode off | Off | | | |
| Backup running | Newest backup under 48 h old | | | |
| Restore drill age | Newest drill under 90 days old | | | |
| Retention keys set | `RETAIN_SIGNINS_DAYS`, `RETAIN_AUDIT_DAYS_AFTER_CLOSE` set | | | |
| Exit code | 0 | `<0, 1 or 2>` | | |
| Rows not `pass` | 0 | `<Count, and Risks ids>` | | |

## Checked by hand

`harden` does not read these.

| Setting | Expected | `<YYYY-MM-DD>` | `<YYYY-MM-DD>` | `<YYYY-MM-DD>` |
|---|---|---|---|---|
| Zone HSTS subdomains | Off | | | |
| `workers.dev` and preview URLs | Off | | | |
| Invocation logs and traces | Off | | | |
| Access application on each host | On, emails listed | | | |
| `REQUIRE_MFA` | `"1"` | | | |
| AI Gateway logs | Off | | | |
