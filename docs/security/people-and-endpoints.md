# People and endpoints

Part of the [security policies](README.md). Version 1.0, 2026-11-17.

## Purpose

The people who build Legallas, and the devices they build it on, never hold case content and can't become a way into a
room.

| Applies to | |
|---|---|
| Maintainers | Colorado Startups people with write access to this repository |
| Contributors | Anyone opening a pull request: [`CONTRIBUTING.md`](../../CONTRIBUTING.md) and the repository's [`CLAUDE.md`](../../CLAUDE.md) |
| Not covered | Room owners' and members' own staff and devices: their firm's policy, and the room owner's Access settings |

Colorado Startups has no employees today. Screening, agreements and training (CAIQ HRS) start with the first hire.

## Remote work

| Rule | Evidence |
|---|---|
| All work is remote, on a device that meets the endpoint rules below | This policy |
| No case content on a maintainer's device, in this repository, in CI or in logs | [`CLAUDE.md`](../../CLAUDE.md), "No case data, ever"; `.github/scripts/secret-scan.sh` |
| Work happens in a git worktree off `origin/main`; every change goes through a pull request | [`CLAUDE.md`](../../CLAUDE.md), "Pull requests" |
| Public networks are fine: every service used is HTTPS, and pushes are signed | [Encryption](encryption.md) |

## Telling people about rules

| Rule | Evidence |
|---|---|
| Rules change only by pull request, so each change has a dated, public record | [README](README.md#changing-a-policy) |
| Every coding agent loads the repository rules on each session | [`CLAUDE.md`](../../CLAUDE.md), [`AGENTS.md`](../../AGENTS.md) |
| A maintainer reads each merged policy PR; a contributor reads `CONTRIBUTING.md` before the first PR | [`CONTRIBUTING.md`](../../CONTRIBUTING.md) |

## Endpoints

| Rule | Check |
|---|---|
| Full-disk encryption on (FileVault, BitLocker or LUKS) | `fdesetup status` |
| Screen locks within 5 minutes idle, and needs a password to unlock | `sysadminctl -screenLock status` |
| OS updates install automatically | macOS: `AutomaticallyInstallMacOSUpdates` in `com.apple.SoftwareUpdate` |
| Firewall on | `socketfilterfw --getglobalstate` |
| OS integrity protection on (System Integrity Protection, Gatekeeper) | `csrutil status`, `spctl --status` |
| Commit signing key and GitHub sign-in on the device only; a lost device means rotating both within 24 hours | [Incident response](incident-response.md) |
| Phones: GitHub and Cloudflare sign-in only, behind the phone's lock. No repository clone | This policy |

| Device check | Result |
|---|---|
| 2026-11-17, one maintainer Mac, by hand | FileVault on, firewall on, OS updates install automatically, screen lock immediate, SIP on, Gatekeeper on |

Checked by hand every 12 months and when a maintainer joins or changes device. No device management tool yet (CAIQ UEM-03
to UEM-14 stay No).

## Disposal

| What | Rule |
|---|---|
| A maintainer's device leaving service | Erase it with the OS's own erase (macOS "Erase All Content and Settings"), sign it out of every account, rotate any key it held. Log the date below |
| Removable media | Not used for this work |
| Room data | The room owner runs `npm run close-out` with `--revoke`, then `--delete --export <dir>`: it exports, then deletes every bucket, D1 database, the AI Search instance and the OAuth namespace (`web/scripts/close-out.ts`). Cloudflare destroys its own media |
| Case content that reached this repository | [`SECURITY.md`](../../SECURITY.md), "If something leaks": the repository is recreated |

| Disposal log | Device | Erased | Keys rotated |
|---|---|---|---|
| None, 2026-11-17 | | | |

## Review

Every 12 months, and when someone joins or leaves.
