# Recovery plan and drill log

Template. Recovery steps and goals are in [business continuity and disaster recovery](../bcp-dr.md), which wins. Backup
setup: `web/README.md`, "Backup and restore".

| | |
|---|---|
| Room | `room.example.com` |
| Backup bucket | `legallas-backup`, location `<Location hint>` |
| Backup schedule | `<Daily at HH:MM UTC>` |
| Updated | `<YYYY-MM-DD>` |

## Plan

| Failure | Recovery | Goal | Who |
|---|---|---|---|
| Bad release | Roll back the Worker version | 15 minutes | `<Name>` |
| Bad migration or damaged database | `wrangler d1 time-travel restore` to the bookmark before the change | 1 hour | `<Name>` |
| Deleted or damaged original | Sync again from `<Folder>` | 1 hour | `<Name>` |
| Deleted file or damaged bucket | Restore from `legallas-backup` | `<1 hour for 1 GB>` | `<Name>` |
| Account lost or locked | Cloudflare account recovery; second administrator | Days | `<Name>` |
| Room down | Members use the counsel pack at `<Firm storage>` | | `<Name>` |

| Before each release | Value |
|---|---|
| D1 bookmark taken | `<Bookmark>` |
| Previous Worker version | `<Version id>` |

## Drill log

Run `npm run backup -- --drill` at least every quarter. It restores into a scratch bucket and database and prints counts
and hashes only.

| Date | Backup used | Objects | Rows | Minutes | Result | By |
|---|---|---|---|---|---|---|
| `<YYYY-MM-DD>` | `<Run id>` | `<Count>` | `<Count>` | `<Minutes>` | `<Pass, or fail and the Risks id>` | `<Name>` |
