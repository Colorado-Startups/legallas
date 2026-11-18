# Internal audit, November 2026

Part of the [security policies](README.md). Run 2026-11-17 under [governance](governance.md#internal-audit), against
`main` at `c6a729ad`. By a Claude Code session that didn't write the audited controls. Not independent of Colorado
Startups.

## Scope and result

| Check | How | Result |
|---|---|---|
| Every evidence path in [`caiq.csv`](caiq.csv) exists | Script over all 283 rows: 67 distinct paths | 0 missing |
| Every file path a policy names exists | Each `` `path` `` in `docs/security/*.md` | 0 missing. One is a glob (`web/worker/*.ts` in the threat model), not a file |
| Claims that name a measurement have a reading | The job that makes each reading, in the last 10 runs of `quality-speed.yml` that included it | 1 finding |
| Crypto and key rules match the code | Read `web/mcp/consent-repeat.ts`, `web/mcp/admin-clients.ts`, the Wrangler examples | Match. Life cycle now written down ([encryption](encryption.md#key-life-cycle)) |
| Product incidents recorded | Private security advisories on this repository | 0 |
| Open exceptions | [Register](governance.md#exceptions) | 0 |

## Findings

| # | Finding | Rating | Fix | State |
|---|---|---|---|---|
| 1 | [Encryption](encryption.md) said key age was "measured nightly". The `admin-read` job that feeds it ran through 2026-11-17 04:17 UTC and has been skipped in every run since (its comment: no lane takes the read-out) | Medium: a claim to a reviewer that the record doesn't back | Claim rewritten as built, not running. CAIQ AIS-03.1, CEK-09.2, CEK-12.1 and CEK-21.1 no longer lean on it; LOG-11.1, which rested on it alone, is now No. Restarting the reading is a separate change | Doc closed in this audit's PR; reading open |

## Next

The next audit, by 2027-11, starts by confirming finding 1 stays closed.
