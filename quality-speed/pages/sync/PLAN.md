# Sync and file reading: plan

Slug `sync`. Owned by `qsc-product`. Only this folder.

## Sources

In this repository, and the owner:

| Source | What it settles |
|---|---|
| The owner, 2026-11-01 and 2026-11-02 (the master plan's "Sync" row and this page's brief) | The folder is home. Changes flow into the room, an approved agreement is saved back as a new file, nothing else changes. This definitely has to work. Measure the local folder |
| #28, closed by #80 and #94 | The engine walks, snapshots (copying only what a run reads, where a clone isn't free) and reads Word, Excel and PowerPoint off macOS. On Windows, PDFs are read with pdf.js and the Windows OCR API (`platformExtractor`) |
| #65, closed, not built | Save-back. Done-when defines the gate: every other file byte for byte the same, same modified time, nothing renamed, moved or deleted |
| #66, closed, on the board | iWork reading is not built. Since #99 the guard lists a Pages, Numbers or Keynote package in its report instead of stopping the run. A file that can't be read is listed as not scanned, never silently skipped, and doesn't stop the sync |
| `web/scripts/sync.ts`, `guard.ts`, `snapshot.ts`, `extract.ts`, `office.ts`, `pii-scan.ts`, `checkindex.ts` | The engine this page measures. `snapshot.ts` clones on macOS and, elsewhere, copies only the files a run reads. `extract.ts` leaves Pages, Numbers and Keynote download-only. `guard.ts` lists a package (a folder Finder shows as one document) in its report rather than stopping the run, since #99. `pii-scan.ts` names every file it could not read |
| #318 | The SSN guard's re-reads of unchanged documents are copied into the snapshot, and a link or letter case can't put the inbox in the folder: the two bugs this page found (#323, #324) |
| `web/scripts/dev-pdf.ts` | Writers for invented PDF and Excel files, reused for the test folder |
| `docs/checklist/baseline.toml` | 85 checklist items: the test folder holds one invented file per item, about a seed-stage company folder |

Public documents, each read in full on 2026-11-04: the sources in `ideal.json`, dated, and every `goal_source`.

| Document | Date | Read from | What it settles |
|---|---|---|---|
| [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) | 2026-10-30 | its source in `cloudflare/cloudflare-docs` | R2 bills each stored GB-month and each write as a Class A operation: the consumption line |
| [web.dev: Measure performance with the RAIL model](https://web.dev/articles/rail) | 2023-01-06 | its source in `GoogleChrome/web.dev` | Beyond 10 seconds, users are frustrated and likely to abandon the task: the `*_change_to_index_text_max` goal |
| [Microsoft Learn: Indexing process in Windows Search](https://learn.microsoft.com/en-us/windows/win32/search/-search-indexing-process-overview) | 2018-05-31 | its source in `MicrosoftDocs/win32` | With no filter for a file, Windows Search still indexes its name and system properties: a file is read or named, never left out. The `*_files_read` goal |
| [Microsoft Learn: Block cloning on ReFS](https://learn.microsoft.com/en-us/windows/win32/fileio/block-cloning) | 2024-09-23 | its source in `MicrosoftDocs/win32` | A clone shares the original's clusters, and a write to either allocates a new region, so the original is never changed: the `windows_folder_unchanged` goal |
| [Apple: About Apple File System](https://developer.apple.com/documentation/foundation/about-apple-file-system) | undated | developer.apple.com | A clone's changes are written elsewhere and the original's blocks stay shared and unchanged: the `mac_folder_unchanged` goal |

## Ideal state

`ideal.json`: every file in the company folder, on Mac or Windows, is read or named within ten seconds; agreements return as new
files; nothing else changes.

## Metrics

Two groups, Mac 50 and Windows 50: each runs on its own hosted machine, so no number mixes the two. Three per computer, six in all.
Mac reads seven types and Windows four, because Windows has no app that opens iWork files.

| Id | Lens | Measures | Unit | Floor, goal | Weight | Samples | `goal_source` |
|---|---|---|---|---|---|---|---|
| `<c>_files_read` | Q | Samples whose planted words all reach the index text, and planted files the engine can't read that are named, of all of them. A type with no samples yet (iWork until #66) counts as two files not read | percent | 0, 100 | 2 | Mac 17, Windows 11 | Microsoft, Indexing process in Windows Search |
| `<c>_folder_unchanged` | Q | Every run in the main folder finishes and leaves each file byte for byte the same, same modified time, nothing renamed, moved or deleted. Planned, not yet checked: nothing new but the saved-back file | pass | 0, 1 | 2 | 9 | Mac: Apple, About Apple File System. Windows: Microsoft, Block cloning on ReFS |
| `<c>_change_to_index_text_max` | S | Seconds from a new or edited file landing in the folder to its planted words in the index parts the dry run built, the slowest sample | seconds | 60, 10 | 1 | 4 | web.dev, RAIL |

`<c>` is `mac` or `windows`. All: stage `lab`; age limit 192 hours, one weekly run plus a day.

**Consumption, next** (once the lens is in the contract): `<c>_upload_bytes_per_changed_byte`, the bytes the dry run's plan would
put in R2 over the bytes of the files that changed, goal 1 (each changed file once, nothing unchanged), floor 2, `goal_source` R2
pricing, which bills every stored byte and every write.

**Cut from the 19 in the first draft:** the seven per-type reads and `*_unreadable_shown` are one `*_files_read` per computer,
since the owner's rule is one rule, read or named; the per-type heatmap went with them. Both `*_saved_back` always read missing until #65, so they wait under Board cards to file.

**Pass rules.**

- *Files read:* a sample counts when every planted word is in the index parts `buildParts` makes from the text the dry run
  read. A planted file the engine can't read counts when it is named in the dry run's not-scanned list, or the guard lists it as
  an iWork package, or its planted words reach the index. It fails when words go missing silently or the run stops.
- *Unchanged:* an independent plain walk, not the guard's, fingerprints the folder itself and every entry in it before and after each engine run: path, kind,
  mode, size, modified and changed times and SHA-256 (the changed time catches a chmod or an extended attribute written), dotfiles, Office lock files, `.icloud` stubs and package insides included, with one of each planted.
  `Drafts` holds a planted file already, so a save-back can only add, never overwrite. A run that stops proves nothing either way: it doesn't count, so the runs fall short of 9 and the gate scores 0 as too few
  samples; with no run finished, the gate reads missing. The gate reads fail only when a fingerprint changed. The package folder is fingerprinted too.

**How it's measured** (`collect.ts`, invented files only, written fresh each run):

1. A temp folder gets 85 invented one-page PDFs (one per checklist item), four 50 MB recordings so it weighs about what a real folder
   does (every run clones and hashes it all twice), the planted clutter, and the files it can't read. The engine's dry run reads it once
   (`guardWalk`, `createSnapshot`, `diffSync`, `scanForPii` with the room's own readers, `verifyOriginals`): the calls `sync.ts` makes
   before `--apply`. This run also builds the PDF extractor, so no timed sample pays for it.
2. Each type then gets two timed samples: a new file, then an edit of it into the richer variant, each followed by the dry run against
   the last run's files, as the room's rows would be. The clock stops when the planted words are in its index parts. Pages, Numbers and Keynote samples come from #66's invented files once they
   land, with their planted words in a plain-text file beside them.
3. The Keynote package goes in a second folder of its own, so a run it stopped could never hide the rest.
4. The machine decides the group: macOS writes the Mac four, Windows the Windows four. The engine failing is a reading of 0; the collector
   failing writes nothing, which reads as missing.

**Dropped, and why:** a real iCloud or OneDrive round trip (no iCloud or OneDrive sign-in on hosted runners; OneDrive waits on the owner's step 7);
dataless and on-demand files (need a signed-in provider); the room's own indexing time (live, after the owner's step 5, as a new `live`
metric then); photo formats such as HEIC (not in the owner's list); a scanned PDF (no reliable way to invent one here without a Mac to check it, and
`swift-ocr` in CI tests Vision OCR); iWork on Windows (no app there makes or opens them).

**Lanes:** `lanes.json`, weekly (Sundays, in the daily workflow), on `macos-26` (Vision OCR runs there, as `swift-ocr` in CI shows) and `windows-2025`. Mac minutes count
10x: about 6 minutes a week, mostly the extractor's build.

**Sign-off:** none yet on this list. The first draft's (#114) does not carry over: the list changed, and the sign-off is a new independent reviewer's comment on this pull request.

## Chart per metric

| Metrics | Chart |
|---|---|
| The infographic | "The folder is home": pass or fail by computer for Read or named, Found and Unchanged; a step not measured shows as missing |
| `*_files_read`, `*_folder_unchanged` | One tile row per computer, under its ring |
| `*_change_to_index_text_max` | Bullets against the 10 second goal |
| Page | Rings per computer and Road to 100 (the Windows run, the Mac run, #66), scored by `core/score.ts` |

This list's page is not yet checked in a browser; the publish guard passes on a synthetic build (2026-11-04).

## Board cards to file

| Card | Returns | Needs |
|---|---|---|
| Save-back measured (#65) | `mac_saved_back`, `windows_saved_back`: an approved agreement lands once as a new file in `Drafts`, a taken name kept, a repeat sync writes nothing; pass, goal 1 | #65 built; a run through `sync.ts --apply` with the room stubbed; a read `goal_source`; a new sign-off |
| Consumption lens | `<c>_upload_bytes_per_changed_byte`, goal 1, floor 2, `goal_source` R2 pricing | The lens in the contract |

## Baseline

Taken 2026-11-02 on the first draft's list, before any fix, on `main` after #94, #99, #313 and #318.

| | Result |
|---|---|
| Records | None yet: the lanes are weekly, so every metric reads missing until the first Sunday run, or a manual run. Quality 0, Speed 0, total 0 |
| Rehearsal, not a reading: the Windows lane's engine on this session's Linux VM, with the real PDF reader (pdf.js) and Windows' OCR call stood in by "no text" | Every sample read and every planted file named (files read 100); unchanged over 9 runs; slowest change 1.52 s in the 200 MB folder |
| Mac | Needs the lane. From the code: Word, Excel and PowerPoint through `textutil`, PDFs through the extractor, the Keynote package listed by the guard; no iWork reader and no iWork samples |

An earlier rehearsal, before #94, stopped at the first run ("cannot read PDFs and images"); #94 is the fix it pointed to.

## Fixes

Ranked by score gained, each from where the one before it leaves the page, scored by `core/score.ts`.

| # | Fix | Moves | Gain | Total after |
|---|---|---|---|---|
| 1 | The Windows lane runs (Sundays, or a manual run of the daily workflow) | Windows: files read, unchanged (gate), speed | +50 | 50 |
| 2 | The Mac lane runs | Mac: unchanged (gate), speed | +33 | 83 |
| 3 | iWork reading (#66), with its invented samples added to `samples.ts` | Mac: files read | +17 | 100 |

Each lane adds its own computer's metrics, so Road to 100 reaches 100 only with both on.

Found on the way and fixed: no Windows PDF reader (#322, fixed by #94); the SSN guard couldn't re-read unchanged documents off
macOS (#323) and a link or letter case could put the inbox in the folder (#324), both fixed by #318.

## Final

Not reached.
