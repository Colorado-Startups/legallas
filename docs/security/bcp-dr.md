# Business continuity and disaster recovery

Part of the [security policies](README.md). Version 1.0, 2026-11-05.

## Purpose

A room can be rebuilt from its sources after any single failure, and its members know what to do while it is down.

## What a room is made of

| Part | Source of truth | If lost |
|---|---|---|
| Code | This repository, at the version the room pins | Redeploy that version |
| Settings and secrets | The room owner's config files and Cloudflare secrets | The room owner sets them again |
| Original documents the room owner syncs | The room owner's own folder, mirrored by `npm run sync` | Sync again from the folder |
| Uploads by counsel, comments, members, audit log | D1 and R2, plus the backup copy | D1 Time Travel, or the backup |
| Page-text index and search | Rebuilt from the originals | Re-index |
| Public law library | Rebuilt by its builder from official sources | Rebuild |

## Recovery

| Failure | Recovery | Recovery point | Recovery time, goal | Kind |
|---|---|---|---|---|
| A bad release | Roll back to the previous Worker version (`npx wrangler deployments list`, then rollback) | None lost | 15 minutes | Room owner |
| A bad migration or a damaged database | `wrangler d1 time-travel restore` to the bookmark taken before the change, or any minute in the last 30 days on Workers Paid (7 on Free). The restore prints a bookmark to undo it | 1 minute | 1 hour | Room owner |
| A deleted or damaged original | Sync again from the room owner's folder | The folder's state | 1 hour | Room owner |
| A deleted file or a damaged bucket | Restore from the backup in another location (`npm run backup`, daily when scheduled) | The last finished backup: 24 hours | Goal 1 hour for a 1 GB room; each drill measures it | Built in, room owner sets up |
| A deleted database, within 7 days | D1 undelete | None lost | One API call | Platform |
| A Cloudflare region or service outage | Wait for Cloudflare. Members work from the counsel pack meanwhile | None lost | Cloudflare's | Platform |
| The room owner's account is lost or locked | Cloudflare account recovery; the room owner's second factor | None lost | Days | Room owner |

The recovery times are goals. The restore drill (`npm run backup -- --drill`) measures the backup's; see `web/README.md`, "Backup and restore", and `web/worker/backup/`.

## Before every release

From `web/README.md`, "Production releases":

- [ ] A reviewed commit whose CI passed
- [ ] `npx wrangler deployments list` first, so the rollback target is known
- [ ] A D1 Time Travel bookmark before applying a migration
- [ ] The replica eval passed when Ask, retrieval or the prompt changed

Migrations only add. A migration that has run is never changed (`web/migrations/`).

## Continuity for members

| Need | How |
|---|---|
| Members keep working while the room is down | The counsel pack: a copy of the originals with an index, delivered to the firm's own storage (`npm run counsel-pack`) |
| Members learn of an outage | The room owner emails them |
| The product's maintainer is unavailable | Each room runs on its own from the pinned version. Nothing in a room calls Colorado Startups |

## Platform durability

R2 stores each object encrypted and replicated within its region ([How R2 works](https://developers.cloudflare.com/r2/how-r2-works/)).
D1 keeps 30 days of point-in-time history on Workers Paid ([Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)).
Neither replaces the backup copy in another location, above.

## Gaps

| Gap | What it would take |
|---|---|
| Each room must set up its backup once (buckets, schedule) | The steps in `web/README.md`, "Backup and restore" |
| No drill result yet in a live room | Run the drill after setup, then at least every quarter |
| No failover to a second provider | Not planned. A room is one Cloudflare account by design |
| Recovery leans on one person, the room owner | A second administrator on the room's Cloudflare account, with multi-factor sign-in |

## Review

Every 12 months, after every drill, and after any real recovery.
