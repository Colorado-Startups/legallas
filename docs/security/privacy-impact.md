# Privacy impact assessment

Part of the [security policies](README.md). Version 1.0, 2026-11-17. Supports [data and network](data-and-network.md).

Rated as in [governance](governance.md#risk-management). Covers the product as built; a room owner adds its own matter's
facts. Not reviewed by a lawyer.

## Processing

| Data | People | Purpose | Basis | Kept |
|---|---|---|---|---|
| Member identity: email, sign-in times, IP, browser, country | Counsel, the room owner | Sign-in, security alerts | Room owner's contract with each member | `RETAIN_SIGNINS_DAYS`, at least 30 |
| Audit metadata: who opened what, when, through which AI | Members | Accountability, incident response | Same | After close-out, `RETAIN_AUDIT_DAYS_AFTER_CLOSE` |
| Case documents and page text | Parties, witnesses, anyone named in the record | The legal matter | The client's engagement of counsel | Until close-out |
| Social Security numbers found by sync | Anyone in the record | Blocked from upload; a known number is kept only as a salted scrypt hash | Same | Until close-out |
| Questions and answers to Ask | Members | Answering from the record | Same | Not stored; research threads 90 days |

## Risks

| Risk | Likelihood | Impact | Controls | Residual |
|---|---|---|---|---|
| A person's data seen by someone not allowed | Low | High | Access with MFA, roles, privilege hiding, audit of every read | Low |
| An AI vendor keeps a person's data | Medium | High | Only zero-retention processors in the room; a member's own AI is under the member's agreement | Medium: the member's vendor |
| Data kept longer than the matter needs | Medium | Medium | Retention schedule, daily purge, close-out | Low |
| Data leaves its region | Low | Medium | Room owner picks region and jurisdiction at creation | Low where a jurisdiction is set |
| A person can't get their data or have it removed | Low | Medium | [Requests about personal data](data-and-network.md#requests-about-personal-data) | Low |
| A security notice is late | Low | High | [Incident response](incident-response.md) deadlines and authority contacts | Low |

## Outcome

No high residual risk. The medium one sits with each member's own AI vendor, under the member's or firm's own agreement
([AI governance](ai-governance.md)). The room owner limits which AI apps may connect ([data and network](data-and-network.md#network)).

## Review

Every 12 months, and before any new data class, processor or AI system is added.
