# Control map: SOC 2, ISO/IEC 27001, ISO/IEC 42001

Part of the [security policies](README.md). Version 1.0, 2026-11-05.

This maps each policy to the criteria an auditor would test. It is our own mapping, not an auditor's. No audit has run,
and nothing here is a certification. Its job is to make an audit shorter when one is bought.

| Area | Policy | SOC 2 Trust Services Criteria | ISO/IEC 27001:2022 Annex A | ISO/IEC 42001 Annex A |
|---|---|---|---|---|
| Policies and review | [README](README.md) | CC1, CC2, CC5.3 | 5.1, 5.37 | A.2 |
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

## Not covered by any policy yet

| Criterion | What it asks | Why it's open |
|---|---|---|
| SOC 2 CC1.4, ISO 27001 Annex A 6.1 to 6.3 | People: screening, terms, awareness training | Colorado Startups has no staff programme to write down yet |
| ISO 27001 clauses 4 to 10 | A management system: scope, risk treatment, internal audit, management review | Needed only for certification |
| ISO 27001 Annex A 7 | Physical security | No premises; every system is a cloud service |

## Sources

- AICPA, 2017 Trust Services Criteria (revised points of focus, 2022).
- ISO/IEC 27001:2022, Annex A.
- ISO/IEC 42001:2023, Annex A.
