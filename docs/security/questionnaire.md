# Questionnaire answers

Part of the [security policies](README.md). Version 1.1, 2026-11-17.

Short answers to the questions vendor risk reviews ask most (SIG Lite, CAIQ and firms' own forms), for the product. A room
owner adds their own settings, from their Cloudflare account, before sending. Each answer links its policy.

| # | Question | Answer | Policy |
|---|---|---|---|
| 1 | SOC 2, ISO 27001 or ISO 42001 certification? | No. None held or under way | [README](README.md) |
| 2 | Latest penetration test? | No third-party test yet. Automated: secret scan and CodeQL on every change; dependency and code scans nightly; a monthly dynamic scan of the fictional room (`.github/workflows/dynamic-scan.yml`). Fix deadlines apply | [Vulnerability management](vulnerability-management.md) |
| 3 | Where is data hosted? | In the room owner's own Cloudflare account, in the region they choose. The vendor hosts nothing | [Data and network](data-and-network.md) |
| 4 | Who are the subprocessors? | Cloudflare. Any outside AI backend only if the room owner turns it on, and only with zero data retention | [AI governance](ai-governance.md) |
| 5 | Can the vendor see our data? | No. Colorado Startups has no access to any room or room account | [Access](access.md) |
| 6 | Encryption at rest? | Yes. AES-256 (GCM) in D1 and R2, keys managed by Cloudflare | [Encryption](encryption.md) |
| 7 | Encryption in transit? | Yes. HTTPS only, TLS 1.2 or higher, HSTS | [Encryption](encryption.md) |
| 8 | How do users sign in? | Cloudflare Access: per-person allowlist, emailed one-time code, optional security key or biometric | [Access](access.md) |
| 9 | MFA? | The room owner signs in with multi-factor. For members, `REQUIRE_MFA` makes the room refuse any sign-in without a security key or biometric; the room owner turns it on | [Access](access.md) |
| 10 | SSO? | Access can use an identity provider such as Microsoft Entra ID; the room owner configures it | [Access](access.md) |
| 11 | Role-based access? | Yes. Owner, counsel and guest; privileged documents hidden from roles without access | [Access](access.md) |
| 12 | How is access removed? | Remove the member: their row, invitations and AI connections end at once. With the room owner's Access token, their Access entry and sessions go too; each step is logged | [Access](access.md) |
| 13 | Is access logged? | Yes. Every read, search and file sent: who, when, which document, which AI app. No query or document text | [Data and network](data-and-network.md) |
| 14 | Can logs be changed? | No. The audit log is append-only by database trigger and exports as a hash chain | [Data and network](data-and-network.md) |
| 15 | Backups? | Database: point-in-time restore for 30 days on Workers Paid, 7 on Free. Files and database: a second copy in another location, daily when scheduled, with a restore drill | [BCP/DR](bcp-dr.md) |
| 16 | Recovery time and point? | Goals: 1 hour and 1 minute for the database. Not yet measured by a drill | [BCP/DR](bcp-dr.md) |
| 17 | Incident notice? | Goals: case content exposed or a live key exposed (level 1), members told within 24 hours; other incidents that could expose content (level 2), 72 hours; no exposure path (level 3), the next routine note | [Incident response](incident-response.md) |
| 18 | Vulnerability fix times? | Goals: 3 days critical and high, 14 days medium and low; never past 60 | [Vulnerability management](vulnerability-management.md) |
| 19 | Secure development? | `Signed-off-by` on every commit, verified signatures on `main`, pull requests, required CI, secret scan and CodeQL on every change, push protection, pinned dependencies, an SBOM per release | [Vulnerability management](vulnerability-management.md) |
| 20 | Does the product use AI on our data? | Ask uses an open-weight model on Cloudflare Workers AI in the room owner's account. Cloudflare keeps no inputs or outputs and doesn't train on them | [AI risk assessment](ai-risk-assessment.md) |
| 21 | Is our data used to train models? | Not by the product or Cloudflare Workers AI. A member's own AI vendor, or an outside backend the room owner enables, follows its own terms | [AI risk assessment](ai-risk-assessment.md) |
| 22 | Can the AI change or send our data? | No. The connector is read-only; drafts need a person's approval in the room | [AI governance](ai-governance.md) |
| 23 | Prompt injection? | Case text is marked as data, never instructions; passages addressed to an AI are fenced; no tool can act outside the room | [AI governance](ai-governance.md) |
| 24 | Which AI tools can connect? | Claude, Microsoft 365 Copilot and Harvey by default; the room owner can allow others. Each lawyer signs in as themselves | [AI governance](ai-governance.md) |
| 25 | Data retention and deletion? | Replaced files 30 days; research threads 90 days; sign-in records and the audit log on the room owner's schedule; the rest until close-out. A legal hold blocks every purge | [Data and network](data-and-network.md) |
| 26 | Data location guarantee? | A region hint by default; a jurisdiction can be set when the room's stores are created | [Data and network](data-and-network.md) |
| 27 | Malware scanning? | Uploads are limited to PDF, images, Office files, zip and plain text, each checked by its first bytes, 95 MB at most. PDF scripts, Office macros or ActiveX and programs in a zip are refused (`web/worker/active-content.ts`). No antivirus scan | [Data and network](data-and-network.md) |
| 28 | Insurance? | Not answered here. Ask the room owner | |

## Review

With the policies, every 12 months. An answer changes in the same pull request as its policy.
