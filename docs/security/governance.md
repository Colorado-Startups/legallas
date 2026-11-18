# Governance, risk and audit

Part of the [security policies](README.md). Version 1.0, 2026-11-17.

## Purpose

One program runs every policy: what it covers, how risk is rated, how an exception is granted, which laws and contracts
apply, how the program audits itself and how suppliers are checked.

## Program

| Area | Policy |
|---|---|
| Product controls | [Access](access.md), [encryption](encryption.md), [data and network](data-and-network.md), [AI governance](ai-governance.md) |
| Operations | [Business continuity](bcp-dr.md), [incident response](incident-response.md), [vulnerability management](vulnerability-management.md) |
| People and endpoints | [People and endpoints](people-and-endpoints.md) |
| Management system | This policy: risk, exceptions, register, internal audit, suppliers |

| Rule | |
|---|---|
| Approval | A policy is approved when its pull request merges to `main` |
| Owner | The Colorado Startups maintainers |
| Review | Every 12 months, and in the same PR as any control a policy names ([README](README.md#changing-a-policy)) |

## Risk management

| Step | Rule |
|---|---|
| Find | Each policy's Gaps table, the [threat model](threat-model.md)'s open threats, the [AI risk assessment](ai-risk-assessment.md), audit findings |
| Rate | Likelihood (low, medium, high) times impact on case content (low, medium, high). The higher of the two sets the rating when unsure |
| Treat | Fix (an issue with the deadline [vulnerability management](vulnerability-management.md) sets for that rating), accept as an exception (below), or assign to the room owner (`Room owner:` rows) |
| Record | The rating sits next to the risk in the doc that lists it. No separate register to drift |
| Review | Every 12 months and when a trust boundary, store, outside service or MCP tool is added |

## Exceptions

A control that can't be met for a time is an exception, never a silent skip.

| Field | Rule |
|---|---|
| Request | A pull request adding a row to the register below. Security-sensitive detail goes in a private security advisory instead |
| Must state | Control, reason, compensating control, risk rating, expiry |
| Expiry | 90 days at most for a high rating, 12 months otherwise. Renewal is a new request |
| Approval | A maintainer other than the requester where one exists. The merge is the approval |
| Emergency change | [`SECURITY.md`](../../SECURITY.md), "If something leaks", first. The pull request follows within 24 hours |

| Register | Control | Compensating control | Rating | Expires |
|---|---|---|---|---|
| None open, 2026-11-17 | | | | |

## Laws and contracts register

Sources the program tracks. Each room owner adds its own (client engagement terms, court orders, firm policy).

| Source | Kind | Applies to | Where it shows |
|---|---|---|---|
| C.R.S. 6-1-713, 6-1-713.5, 6-1-716 (Colorado disposal, security and breach notice of personal information) | Law | Room owners holding Colorado residents' data | [Data and network](data-and-network.md), [incident response](incident-response.md) |
| Colorado Rules of Professional Conduct 1.1 and 1.6(c) (competence; reasonable efforts to protect client information) | Professional rule | Lawyers using a room | [AI governance](ai-governance.md), [access](access.md) |
| ABA Formal Opinion 512 (2024), generative AI tools | Guidance | Lawyers using a room's AI tools | [AI governance](ai-governance.md) |
| Apache License 2.0 | Licence | This repository | [`LICENSE`](../../LICENSE) |
| Cloudflare Self-Serve Subscription Agreement, Data Processing Addendum, sub-processor list | Contract | Each room owner's Cloudflare account | [Suppliers](#suppliers) |
| CSA CCM and CAIQ v4.1, SOC 2, ISO/IEC 27001 and 42001 | Frameworks (mapped, not certified) | The policies | [CAIQ](caiq.md), [control map](control-map.md) |

## Internal audit

| Rule | |
|---|---|
| Cadence | Every 12 months, and after a level 1 or 2 incident |
| Scope | Risk-based: every CAIQ evidence path, each policy claim that names a measurement, the crypto and key rules, open exceptions |
| Auditor | A maintainer or a Claude Code session that didn't write the controls under audit. Not independent of Colorado Startups: CAIQ A&A-02 and A&A-03 stay No |
| Method | Read the cited file on `main`, check the CI run or reading the claim names, compare the [CAIQ](caiq.md) answer |
| Findings | Each one fixed in the audit's pull request, or filed as an issue with the deadline its rating sets |
| Report | A dated record in this folder, linked below. The next audit starts by checking every earlier finding is closed |

| Audit | Findings | Open |
|---|---|---|
| [November 2026](internal-audit-2026-11.md) | 1 | 1: the key age reading is paused |

## Suppliers

| Requirement | For |
|---|---|
| A data processing agreement and a published sub-processor list | Any supplier on the case-content path |
| Zero data retention, confirmed from an official source | Any AI processor other than the room's Cloudflare account ([AI governance](ai-governance.md)) |
| A current SOC 2 Type II or ISO/IEC 27001 report | The hosting platform |
| No case content | CI, logs, GitHub, and every supplier not listed above |

| Supplier document | Version read | Read |
|---|---|---|
| [Cloudflare Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/) | Last updated 2025-09-12 | 2026-11-17 |
| [Cloudflare Data Processing Addendum](https://www.cloudflare.com/cloudflare-customer-dpa/) | Version 6.4, effective 2026-04-03 | 2026-11-17 |
| [Cloudflare sub-processors](https://www.cloudflare.com/gdpr/subprocessors/cloudflare-services/) | Last updated 2025-10-01 | 2026-11-17 |
| Cloudflare compliance reports | In the dashboard only ([Trust Hub](https://www.cloudflare.com/trust-hub/compliance-resources/)): needs the room owner's sign-in. Not yet read | |

Terms are re-read every 12 months and when a supplier announces a change. A change that weakens a requirement above is a
risk, rated and treated as above.

## Review

Every 12 months, and when a policy is added or removed.
