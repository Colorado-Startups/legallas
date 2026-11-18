# Risk register

Template. Uses the rating in [governance, risk management](../governance.md#risk-management), which wins. Product risks
stay in each policy's Gaps table; this register holds the operator's room.

| | |
|---|---|
| Room | `room.example.com` |
| Updated | `<YYYY-MM-DD>` |

| Rating | Likelihood low | Likelihood medium | Likelihood high |
|---|---|---|---|
| Impact high | Medium | High | High |
| Impact medium | Low | Medium | High |
| Impact low | Low | Low | Medium |

Treatment: fix, accept, transfer or avoid.

## Risks

| Id | Risk | Likelihood | Impact | Rating | Owner | Treatment | Due | Status |
|---|---|---|---|---|---|---|---|---|
| R1 | Recovery leans on one Cloudflare administrator | `<Medium>` | `<High>` | `<High>` | `<Name>` | Fix: second administrator with MFA | `<YYYY-MM-DD>` | `<Open>` |
| R2 | Members sign in with an emailed code alone | `<Medium>` | `<High>` | `<High>` | `<Name>` | Fix: `REQUIRE_MFA` = `"1"` | | |
| R3 | No restore drill yet | `<Medium>` | `<High>` | `<High>` | `<Name>` | Fix: drill in [Recovery](recovery.md) | | |
| R4 | A member's AI vendor keeps inputs | `<Medium>` | `<Medium>` | `<Medium>` | `<Name>` | `<Accept, or AI_POLICY=zdr>` | | |
| R5 | Uploads aren't scanned for malware | `<Low>` | `<Medium>` | `<Low>` | `<Name>` | `<Accept>` | | |
| R6 | Lost device with the synced originals | `<Low>` | `<High>` | `<Medium>` | `<Name>` | Fix: disk encryption, [Policy](policy.md) | | |
| `<R7>` | `<Risk>` | | | | | | | |

## Accepted risks

| Id | Accepted by | On | Until | Reason |
|---|---|---|---|---|
| `<R5>` | `<Name>` | `<YYYY-MM-DD>` | `<YYYY-MM-DD>` | `<Reason>` |
