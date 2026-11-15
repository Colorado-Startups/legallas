# The sample room lab

Brings the fictional room up on a GitHub-hosted Linux runner, drives it, and writes `report.json` for the Data room page. It
needs no key, no Mac and no Cloudflare account.

Every number is a **lab number**: a local copy of the room on a CI runner, searched by keyword, with Ask's model replaced by the
room's canned answer. It says how the product behaves, not what a customer feels. The live sample room measures that.

Browser journeys run under Lighthouse's mobile throttling, a CPU 4x slower and slow 4G, with a cold cache, because on localhost with
no limit almost nothing could miss a goal. `report.throttle` records it.

| Edge step (`lab/edge.ts`) | |
|---|---|
| Why | Members reach a room through Cloudflare, which compresses responses; `wrangler dev --local` sends them raw |
| Where | Browser → edge on 8789 → Worker on 8788 (`--local-upstream localhost:8789`, so the same-origin check holds) |
| Compresses | Cloudflare's default content types, gzip level 6. PDFs, images and file bytes stay raw |
| Never | Brotli: the edge sends Chrome brotli, so gzip keeps the lab's bytes at or above a member's |

## Run it

```bash
gh workflow run sample-room-lab.yml -R Colorado-Startups/legallas --ref <branch> -f only=doc-open
```

Or from a job that has checked out and set up Node 24 (a Quality and Speed lane), with `--install` to run `npm ci` first:

```bash
node quality-speed/pages/data-room/lab/run.ts --install --out "$RUNNER_TEMP/lab" --room "$RUNNER_TEMP/lab-room"
```

| Option | What it does |
|---|---|
| `--out <dir>` | Where `report.json`, `controls.json` (path to control number), `frames/<journey>.webp` and `logs/` go |
| `--room <dir>` | Scratch for the fixture's files and caches. Outside the checkout |
| `--record <room type>` | Seeds one room of the invented record (`../gold`: `forming`, `raising-angel`, `raising-vc` or `dispute`) with its question set, instead of the dev fixture. One room per run, so one per job |
| `--only <ids>` | Just these journeys, comma-separated. A throttled run is long, so a lane should pay only for what it reads. `citation-to-page` also runs `ask`, because the citation comes from an answer |
| `--samples <n>` | Samples per journey, 20 by default |
| `--questions <file>` | Without `--record`: the question set, in the shape of `smoke-questions.json`, which only proves the run works |
| `--install` | `npm ci --ignore-scripts` in `web/` first |

It refuses to run outside CI (`CI=true`), and beside a room's own settings in `web/`.

## What `report.json` holds

Numbers, ids and codes only, never a question, a document name or a passage. `report.ts` has the full shape.

| Field | Meaning |
|---|---|
| `stage`, `retrieval` | Always `lab` and `keyword` |
| `seed` | Documents, index and keyword counts, expected against found. Short means `status: "failed"` and no journeys. The fixture's blank image is read but has no text, so it isn't expected in the keyword index |
| `seconds` | Install, seed, keyword index, build, servers and journeys |
| `journeys[].series` | Timings by name, each with `n`, `p50`, `p75`, `p95`, `max` and `samples` |
| `journeys[].tallies` | `connector-search`: `asked`, `rightDocumentTop5`, `notKeyword` |
| `journeys[].frame` | The journey's last screen |
| `browser` | Requests, console errors, security-policy breaks, HTTP errors and requests off localhost, over every page opened |
| `connector` | The MCP smoke's pass, fail and skip counts |
| `failed` | True on a short seed, any request off localhost, no requests from a browser journey, a search off the keyword index, a journey with nothing finished, or a run that stopped partway |

| Journey | Series | What it times |
|---|---|---|
| `load-overview`, `load-documents`, `load-chronology` | `lcp_ms`, `cls`, `ttfb_ms`, `load_ms` | A cold load of the route. A sample that painted nothing or met a request answering with an error doesn't count. Chronology only where the room has a case picture: the dev fixture and `dispute` |
| `filter-documents` | `narrowed_ms`, `interaction_ms` | Typing in the filter until the table holds the wanted row; the slowest key press, as INP reads it |
| `doc-open`, `doc-open-deep` | `page_drawn_ms` | From the address to the page drawn with its text |
| `ask` | `first_text_ms`, `answer_done_ms` | Real keyword retrieval and the canned answer, so these say little about a real model. The canned answer cites whatever the prompt lists first, so it says nothing about whether the right document was found: use `connector-search` for that |
| `citation-to-page` | `page_drawn_ms` | From a click on a cite until its page is drawn |
| `connector-search`, `connector-read-page` | `round_trip_ms` | A tool call through `legallas-mcp`, as a member's AI makes it |

`ask` takes at most 3 samples, spaced under the room's limit of 6 questions a minute, because its model is canned and its timings
aren't scored. `citation-to-page` reopens the saved answer, so it takes every sample with no new question. Only the last answer asked
is saved, so if that one cites no page, `ask` asks an earlier question again, once, before it hands over. `connector-search` runs each
question once, spaced under the limit of 60 tool calls a minute.

## What a run takes

Measured on `ubuntu-latest` with 20 samples, 2026-11-02. Linux minutes cost about $0.006 each.

| Step | Forming (48 files) | Dispute (158 files) |
|---|---|---|
| Install and tests | under a minute | under a minute |
| Seed | 1.7 minutes | 6.6 minutes |
| Keyword index | 0.8 minutes | 3.4 minutes |
| Each load journey, or the filter | 2.5 minutes | 2.5 minutes |
| `doc-open`, or `doc-open-deep` | 4.4 minutes | 4.4 minutes |
| `citation-to-page`, with `ask` | | about 3 minutes |
| `connector-search` and `connector-read-page` | | 2.3 minutes |

So `--record forming --only load-overview,load-documents` takes 8.5 to 10 minutes, and `--record dispute --only
filter-documents,doc-open,citation-to-page,load-chronology` about 23.5, so the lanes run on `linux-hosted`, with its limit of 40.
Seeding is most of what could still come down, because each object is its own `wrangler r2 object put --local`, one at a time. So is
`doc-open`, at 12 seconds a sample (#203).

## The extract cache

`../extract-cache/` holds what the Swift extractor reads from each fictional PDF and image, one `<sha256>.json` per file. It is why
the room seeds with no Mac: `cachedExtractor` finds the text before it ever looks for the extractor.

| When | What happens |
|---|---|
| A fixture document is new or changed | `web/scripts/sample-room-cache.test.ts` fails in `checks`. Run the extract workflow below and commit its artifact |
| The extractor reads the files differently, or an entry was edited by hand | `swift-ocr` fails, on a Swift change or a change to this folder. A PDF's entry also fails `checks` on any OS, because its text is read back from the file. The same fix |
| `EXTRACTOR_VERSION` moves | The test fails. The same fix |

```bash
gh workflow run sample-room-extract.yml -R Colorado-Startups/legallas --ref <branch>
```

Only fictional files ever reach this folder: `everyRecordFile` in `extract-cache.ts` lists them, the dev fixture and every room of the invented record.

## What Linux can read

| Kind | On Linux |
|---|---|
| PDF, PNG and other images | From the extract cache |
| Markdown, CSV, text, Form D XML, email | Read directly |
| `.xlsx`, `.pptx` | From their OOXML parts, with `/usr/bin/unzip` |
| `.docx`, `.doc`, `.rtf`, `.odt` | With no outside tool (`web/scripts/office-read.ts`), and `textutil` on a Mac, so their text can differ a little between them |
| HTML visuals | Not read until they have been rendered, so a fixture with one fails the run as `index_short` |

## Why keyword search needs no change to the product

The room reaches keyword search in production when its month of AI Search runs out. The lab marks the local month spent, so Ask
takes that same path (`worker/routes/ask.ts`, `spendGate`). `legallas-mcp` gets there with `MCP_SEARCH_MOCK=keyword`, honoured on
localhost only, and each search result says `fallback: "keyword"`, which the lab checks.
