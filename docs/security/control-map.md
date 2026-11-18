# Control map: SOC 2, ISO/IEC 27001, ISO/IEC 42001

Part of the [security policies](README.md). Version 1.2, 2026-11-17.

This maps each policy to the criteria an auditor would test. It is our own mapping, not an auditor's. No independent audit has run,
and nothing here is a certification. Its job is to make an audit shorter when one is bought.

| Area | Policy | SOC 2 Trust Services Criteria | ISO/IEC 27001:2022 Annex A | ISO/IEC 42001 Annex A |
|---|---|---|---|---|
| Policies and review | [README](README.md) | CC1, CC2, CC5.3 | 5.1, 5.37 | A.2 |
| Risk management and exceptions | [Governance](governance.md) | CC3.1 to CC3.4, CC5.1 | Clause 6.1, 5.1 | A.5 |
| Laws and contracts | [Governance](governance.md) | CC2.3, CC3.1 | 5.31, 5.32 | A.2 |
| Internal audit | [Governance](governance.md), [internal audit](internal-audit-2026-11.md) | CC4.1, CC4.2 | Clause 9.2 | |
| Suppliers | [Governance](governance.md) | CC9.2 | 5.19 to 5.22 | A.10 |
| Privacy | [Privacy impact assessment](privacy-impact.md), [data and network](data-and-network.md) | P1 to P8 | 5.34 | A.5 |
| Remote work and endpoints | [People and endpoints](people-and-endpoints.md) | CC6.8 | 6.7, 8.1 | |
| Equipment disposal | [People and endpoints](people-and-endpoints.md) | CC6.5 | 7.10, 7.14 | |
| AI governance | [AI governance](ai-governance.md) | CC3, CC9.2 | 5.19 to 5.23 (AI processors as suppliers) | A.2, A.6, A.9, A.10 |
| AI impact and risk | [AI risk assessment](ai-risk-assessment.md) | CC3.2 | Clause 6.1 (risk assessment) | A.5, A.7, A.8 |
| Identity and sign-in | [Access](access.md) | CC6.1, CC6.2 | 5.16, 5.17, 8.5 | |
| Roles and least privilege | [Access](access.md) | CC6.3 | 5.15, 5.18, 8.2, 8.3 | |
| Joining and leaving | [Access](access.md) | CC6.2, CC6.3 | 5.18 | |
| Encryption in transit | [Encryption](encryption.md) | CC6.7 | 8.20, 8.21, 8.24 | |
| Encryption at rest and keys | [Encryption](encryption.md) | CC6.1 | 8.24 | |
| Data classes and handling | [Data and network](data-and-network.md) | C1.1 | 5.12, 5.13, 8.12 | A.7 |
| Logging and monitoring | [Data and network](data-and-network.md) | CC7.2, CC7.3 | 8.15, 8.16 | A.6 (event logs) |
| Retention and disposal | [Data and network](data-and-network.md) | C1.2 | 5.33, 8.10 | |
| Network protection | [Data and network](data-and-network.md) | CC6.6 | 8.20, 8.22 | |
| Malicious content | [Data and network](data-and-network.md) | CC6.8 | 8.7 | |
| Backup and recovery | [BCP/DR](bcp-dr.md) | A1.2, A1.3, CC7.5, CC9.1 | 5.29, 5.30, 8.13, 8.14 | |
| Incidents | [Incident response](incident-response.md) | CC7.3, CC7.4, CC7.5 | 5.24 to 5.28, 6.8 | A.8 (incident communication) |
| Vulnerabilities | [Vulnerability management](vulnerability-management.md) | CC7.1 | 8.8 | |
| Secure development and change | [Vulnerability management](vulnerability-management.md) | CC8.1 | 8.25, 8.28, 8.29, 8.32 | A.6 (verification, deployment) |
| Cloud provider | [README](README.md), hosting row | CC9.2 | 5.23 | A.10 |
| Physical security | Inherited from Cloudflare, which runs the data centers: its SOC 2 Type II and ISO/IEC 27001 reports, in the Cloudflare dashboard ([Trust Hub](https://www.cloudflare.com/trust-hub/compliance-resources/), read 2026-11-17). No premises of the vendor's own | CC6.4 | 7.1 to 7.14 | |

## Not covered by any policy yet

| Criterion | What it asks | Why it's open |
|---|---|---|
| SOC 2 CC1.4, ISO 27001 Annex A 6.1 to 6.3 | People: screening, terms, awareness training | Colorado Startups has no staff yet. Remote work and endpoints: [people and endpoints](people-and-endpoints.md) |
| ISO 27001 clauses 4 to 10, in full | A management system: scope statement, objectives, management review | [Governance](governance.md) covers risk treatment and internal audit. The rest is needed only for certification |

## Sources

- AICPA, 2017 Trust Services Criteria (revised points of focus, 2022).
- ISO/IEC 27001:2022, Annex A.
- ISO/IEC 42001:2023, Annex A.
