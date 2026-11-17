# Automated dynamic scan

An automated dynamic application security test (DAST) of the fictional sample room. OWASP ZAP attacks both Workers, the room
and `legallas-mcp`, inside a CI job, and writes a dated report with each finding's severity and remediation status.

It is **not a penetration test**: no person tries to break in. Never call it one. It answers a firm's request for "the latest
pen test and its remediation status" only until a third-party test is bought, which is the owner's decision. It stands beside
the static scans this page already runs (`../PLAN.md`: gitleaks, osv-scanner, Semgrep, OpenSSF Scorecard, Dependabot).

| | |
|---|---|
| Workflow | `.github/workflows/dynamic-scan.yml`: monthly, by hand, and on a pull request that changes this folder |
| Runner | GitHub-hosted `ubuntu-latest`: 28 minutes on 7 Nov, 55 at worst, inside a 60-minute job |
| Target | The fictional room (the Doe v. Harbor Labs fixture), seeded by the data room lab's harness and served on 127.0.0.1 inside the job. Never a customer room, never a deployed host |
| Latest report | `docs/security/scans/` |

```bash
gh workflow run dynamic-scan.yml -R Colorado-Startups/legallas --ref <branch>
```

## What it attacks

| Target | Server | Who | How ZAP finds the routes |
|---|---|---|---|
| Room | `localhost:8789` | Its owner (the dev identity, honoured only on localhost) | The room's own route table (`roomRoutes`) as OpenAPI, ids from the seeded room, then the spider |
| Room | `anon.test:8791` | A stranger | The same, plus a check that every route answers 403 |
| MCP server | `localhost:8790` | A member's AI, with a token from a real OAuth grant | ZAP's MCP add-on lists the tools and calls each one; the OAuth endpoints and pages as OpenAPI |
| MCP server | `anon.test:8792` | A stranger | The OAuth endpoints and pages as OpenAPI, then the spider |

Each target is its own `wrangler dev --local` server on 127.0.0.1. `--local-upstream` sets the host its Worker sees, because
wrangler replaces the request's own Host header. So the stranger servers run with the dev identity switched on, and refuse it
because their host is not localhost. They keep an empty, migrated store of their own. `anon.test` is reserved for testing
(RFC 2606) and maps to 127.0.0.1 only inside ZAP's container.

Each target gets ZAP's spider, its passive rules, and its default active scan policy within a time limit (`targets.ts`).
Writes carry the `Origin` and `Sec-Fetch-Site` a member's browser sends, or the room would refuse them before their handlers.

Before ZAP runs, `run.ts` checks that each target is who it should be, from inside ZAP's container, and that one owner's write
with ZAP's headers passes the same-origin check. Afterwards the run fails if ZAP's report names any site but the four targets.

## Tools

Licences read from each project's licence file on 2026-11-05. Neither ships with the product.

| Tool | Version | Licence | How it is pinned |
|---|---|---|---|
| OWASP ZAP, official image | 2.17.0 | Apache-2.0 | Image digest in `tools.ts` |
| ZAP MCP add-on (alpha, not in the stable image) | 0.4.0 | Apache-2.0 | Release URL and SHA-256 in `tools.ts`; the run refuses any other file |

Bump both by hand: Dependabot does not read `tools.ts`.

## Statuses

| Status | Means |
|---|---|
| open | Seen, not judged. **An open High or Medium fails the run** |
| accepted | Seen, and every place it was seen is covered by a judgment in `triage.json` with its reason |
| fixed | Judged fixed in `triage.json`, naming the pull request, and not seen this run. Seen again, it is open as a regression |

A judgment in `triage.json`:

| Field | |
|---|---|
| `alert` | ZAP's alert reference, as the report's Rule column shows it |
| `targets` | Optional: the target names it covers (`targets.ts`) |
| `paths` | Optional: a regular expression over the route (`/api/doc/:id`, `/_astro/*`) |
| `status` | `accepted` or `fixed` |
| `reason` | Why, in at least 30 characters |
| `decided` | YYYY-MM-DD |
| `fixedIn`, `name`, `risk` | For `fixed`: the pull request, and the finding's name and severity when found |

## After a run

1. Read `report.md` in the run's artifact.
2. Fix what is real, in the product. Judge the rest in `triage.json`.
3. Copy the report to `docs/security/scans/<date>-automated-dynamic-scan.md` when it changes, so the latest one is in the repository.

## What it does not cover

| Gap | Why |
|---|---|
| Cloudflare Access, TLS and the edge | The scan reaches the Workers directly over HTTP. In a real room Access refuses a stranger before the Worker runs |
| Deal-room guest routes, laptop sync endpoints | Each needs an identity the harness does not make |
| The Mac app | Not a web application |
| Access between members, business logic | A scanner cannot judge who should see what. That is what a penetration test adds |
