# Security

## Report a vulnerability

| Way | Use it for |
|---|---|
| [Report a vulnerability](https://github.com/Colorado-Startups/legallas/security/advisories/new) (GitHub private reporting) | A vulnerability, or a suspected leak of case data, in anything in this repo |

Please do not open a public issue, pull request or commit. A person replies.

## Where the data lives

| | |
|---|---|
| Hosting | Colorado Startups hosts no customer's room |
| A room | Runs in its owner's own Cloudflare account, so its documents, members and settings stay there |
| Written policies | AI governance, access, encryption, data and network, continuity, incident response, vulnerability management: [`docs/security/`](docs/security/README.md) |

## What keeps case data out of this repository

| Control | How |
|---|---|
| `.gitignore` | Covers the SwiftData store (`*.store*`), `CaseData/`, `legallas-export.json`, `web/.dev.vars` and a room's settings (`web/wrangler.jsonc`, `web/wrangler.mcp.jsonc`, `web/legallas.config.json`) |
| CI's secret scan | gitleaks, `.github/scripts/secret-scan.sh`, on every change. It looks for credentials, not case words: this repository holds no customer's patterns |
| Case patterns | A contributor with access to a customer's case runs the local `pre-push` hook described in `CLAUDE.md` |
| Test data | Invented |
| Secrets | In GitHub secrets or Cloudflare, never in this repository |

## How a room protects its documents

| Protection | What it does | Code |
|---|---|---|
| Two locks on every request, static files included | Cloudflare Access proves who you are; the members table decides whether you are allowed in. A room with no Access team or audience refuses every request | `web/worker/auth.ts` |
| Deal rooms (off unless `ROOMS_ENABLED` is "1") | Someone invited to a deal room but not a member reaches only that room's guest routes: never a member route or the room's static pages. They see the room's folders minus anything privileged, and every request re-reads their invitation | `web/worker/rooms.ts`, `docs/design/rooms-and-grants.md` |
| An invited investor's AI, when the room enables it | With `ROOMS_ENABLED` on `legallas-mcp` too: read-only tools (`GUEST_TOOLS`), every query scoped to their rooms, never a privileged document | `web/worker/privilege.ts` |
| Privileged paths | A document with "privileged" in any segment of its path is only for a role allowed to see it, on every route and MCP tool. To anyone else it answers like a missing document | `web/worker/privilege.ts` |
| Content Security Policy | Set on every response. The build fails when a page breaks it | `web/worker/headers.ts`, `web/integrations/dist-audit.mjs` |
| The MCP server is read-only | It writes who read what to the audit log, never the query or page text. `web/connect/security-brief.md` is written for a firm's security team | `web/mcp/contract.ts`, `web/mcp/audit.ts` |
| Proposals (`PROPOSALS_ENABLED`, off by default) | For a connection its member allowed to propose, one tool stores a pending draft for that member to approve in the room. No tool approves, changes the record or changes access | `docs/design/propose-and-approve.md` |

## Case content and AI

Case content: documents, page text, retrieved passages, the case picture, eval questions, answers and eval item ids. The product's own Ask sends it only to processors that keep none of it once the request is served.

| Processor | When | Code |
|---|---|---|
| Cloudflare's Workers AI and AI Search | On the room owner's account, with no AI Gateway. The metered binding refuses a model outside Workers AI and any gateway option | `web/worker/spend.ts` |
| Groq | Only when the room's `ASK_GROQ` says `enabled` and `zdr_confirmed`: the owner's word that Zero Data Retention is on in console.groq.com > Settings > Data Controls. The code cannot read that setting, so the flag is the gate. The example config ships with it off | `web/worker/ask-provider.ts`, `web/scripts/ask-replica-groq.ts` |
| The room's own model host | An open-weight model behind an OpenAI-compatible API, such as OpenRouter. Only when `ASK_HOST` passes Groq's gate: `enabled`, `zdr_confirmed` (the owner's word, after reading the host's own data page, that it and its providers keep no inputs or outputs), passing replica eval runs on that host, an https URL, and the key as a Worker secret. On OpenRouter every request also asks for zero-data-retention endpoints only. `web/ASK-MODEL.md` tells the owner what this sends and how to check a host. The example config ships with it off | `web/worker/ask-gate.ts`, `web/worker/ask-host.ts` |

| Replica eval (`.github/workflows/replica-eval.yml`) | |
|---|---|
| Rule | The same as Ask's |
| Runs | Only when the repository sets `REPLICA_EVAL_ENABLED`, on GitHub's `ubuntu-slim`, whose container GitHub decommissions when the job finishes |
| Output | GitHub keeps logs and job summaries for 90 days, so output goes only to a temp folder the last step deletes. The log and summary get only `web/scripts/ask-eval-gate.ts`'s aggregates. No artifact or cache |

A member's own AI tool (Claude, Microsoft 365 Copilot or Harvey) reads the room through the MCP server, signed in as that member, under that member's own account. What it keeps is set by that tool and its vendor, not by this repository.

## How outside code is kept safe

| Control | Where |
|---|---|
| Every fork run waits for approval and gets no secrets | Repo settings; workflows use `pull_request`, never `pull_request_target` with a fork checkout |
| AI agents merge only allowlisted paths, at the reviewed head SHA, and never approve | [`tools/merge_policy.json`](tools/merge_policy.json), beside `tools/merge_policy.py` |
| Room code, migrations, build, CI, dependency and gate changes are rebuilt by a maintainer, never merged as sent | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Secret scanning and push protection on | Repo settings; CI's gitleaks scan below |

## CI

| Job | Runs on | Holds |
|---|---|---|
| `checks` | Blacksmith's runners while its free minutes last, then GitHub-hosted `ubuntu-latest`. Only this repository's own branches, never code from a fork | No secret or write scope. Blacksmith's runners see this repository's code and the read-only token `checks` checks it out with |
| `ci-ok` | GitHub-hosted `ubuntu-slim` | No scopes; it only reads the other jobs' results |
| `choose-runner` | GitHub-hosted `ubuntu-slim` | Read scopes only. Picks the runner for `checks` (`.github/scripts/build_minutes_guard.py`). Its Actions cache holds run numbers and minutes, nothing else. A `CI_RUNNER` repository variable overrides it, unless the variable names Blacksmith |
| `swift`, `swift-ocr`, `office-mac` | GitHub-hosted macOS | |
| `claude.yml` | GitHub-hosted `ubuntu-latest` | Confined to the checkout by `.github/scripts/claude-settings.sh`, taken from `main` |
| `sbom.yml` | GitHub-hosted `ubuntu-slim`, by hand and on each release tag | No secret. The software bill of materials (CycloneDX JSON): `.github/scripts/sbom.ts` reads `web/package-lock.json` (both Workers) and any tracked `Package.resolved` (the Mac app has no remote packages today). The run keeps the files as an artifact |
| Deploy | No deploy workflow in this repository. A room's owner deploys it | |

## If something leaks

| Step | Do |
|---|---|
| 1 | Rotate the exposed credential first |
| 2 | Remove it from the branch. If it reached `main`, rewrite history with `git filter-repo` and force-push with the ruleset disabled for that one push. If the leak is case data, recreate the repository instead: a force-push doesn't clear it, because pull request refs keep the old commits |
| 3 | Note what happened privately, without repeating the secret |
