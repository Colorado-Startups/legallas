# Security policies

| | |
|---|---|
| Applies to | The Legallas product and every room built from it |
| Maintained by | Colorado Startups |
| Version | 1.2, 2026-11-17 |
| Reviewed | Every 12 months, and whenever a control a policy names changes |
| Status | Written from the code as it is. No outside auditor has reviewed these policies |

## How to read them

Legallas runs in each room owner's own Cloudflare account. Colorado Startups hosts no room and never sees a room's data
([`SECURITY.md`](../../SECURITY.md)). So every control below is one of three kinds:

| Kind | Meaning |
|---|---|
| Built in | The code enforces it in every room. The evidence is a file in this repository |
| Room owner | The room owner sets it in their own Cloudflare account. The policy says what to set |
| Gap | Not in place yet. Listed with what it would take |

## The policies

| Policy | Covers |
|---|---|
| [AI governance and guardrails](ai-governance.md) | Which AI may see case content, the MCP server's limits, evals, prompt injection, disclosure, AI in development |
| [Access management](access.md) | Sign-in, roles, AI connections, offboarding, admin actions |
| [Encryption](encryption.md) | In transit, at rest, secrets and keys |
| [Data and network security](data-and-network.md) | Classification, logging, retention, headers, rate limits, uploads |
| [Business continuity and disaster recovery](bcp-dr.md) | What can fail, how a room recovers, recovery point and time |
| [Incident response](incident-response.md) | Detection, severity, containment, notice to the room owner and members |
| [Vulnerability management](vulnerability-management.md) | Scans, dependency alerts, fix deadlines, change control |
| [Governance, risk and audit](governance.md) | The program, risk rating, exceptions, laws and contracts, internal audit, suppliers |
| [People and endpoints](people-and-endpoints.md) | Remote work, telling people about rules, device rules, disposal |

| Supporting record | For |
|---|---|
| [AI risk assessment and model card](ai-risk-assessment.md) | The AI systems, the model, risks and residual risk |
| [Threat model](threat-model.md) | Data flow across every trust boundary, STRIDE per boundary, OWASP Top 10 map |
| [Control map](control-map.md) | Each policy against SOC 2, ISO/IEC 27001 and ISO/IEC 42001, to shorten an audit |
| [Questionnaire answers](questionnaire.md) | Short answers to the questions vendor reviews ask most |
| [Tabletop exercise, November 2026](tabletop-2026-11.md) | The incident steps walked against the code |
| [Privacy impact assessment](privacy-impact.md) | Personal data processed, privacy risks and residual risk |
| [Internal audit, November 2026](internal-audit-2026-11.md) | Evidence and claims checked against `main`, findings |
| [Operator security records](operator/README.md) | Fill-in templates for a room owner's own policy, data map, vendors, risks, incidents, recovery drills, edge check and weekly watch |

## Attestations

| Attestation | State |
|---|---|
| SOC 2 Type I or Type II | None held |
| ISO/IEC 27001 | None held |
| ISO/IEC 42001 | None held |
| Third-party penetration test | None done |
| Automated scans | Yes. See [Vulnerability management](vulnerability-management.md) |
| Hosting platform | Cloudflare. Its own compliance reports are in the Cloudflare dashboard (Trust Hub) |

Never claim an attestation this table doesn't list.

## Changing a policy

A policy changes by pull request, like code. Change the policy in the same pull request as the control it describes. Bump
the version and date above when any policy changes.
