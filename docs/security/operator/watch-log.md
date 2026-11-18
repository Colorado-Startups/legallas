# Weekly watch log

Template. The signals come from [incident response, detection](../incident-response.md#detection) and
[access management](../access.md), which win. An odd signal opens a row in [Incidents](incidents.md).

| | |
|---|---|
| Room | `room.example.com` |
| Watcher | `<Name>` |

| Week of | Sign-in alerts | Unexpected | New AI connections | Refused callbacks | Members added | Members removed | Backup runs | Last backup | Access review | Action | By |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `<YYYY-MM-DD>` | `<Count>` | `<Count, or 0>` | `<Count>` | `<Count>` | `<Count>` | `<Count>` | `<7 of 7>` | `<YYYY-MM-DD>` | `<Due YYYY-MM-DD, or done>` | `<None, or incident id>` | `<Name>` |

| Column | Read from |
|---|---|
| Sign-in alerts | The room's new-session emails |
| New AI connections, refused callbacks | The room's connection emails; `/admin/clients` |
| Members added, removed | `access_events` rows |
| Backup runs | `legallas-backup` run records |
| Access review | `npm run access-review`, every quarter |
