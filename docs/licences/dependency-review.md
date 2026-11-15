# Dependency licence review

> **Not legal advice. No lawyer reviews it.** A licence classification made by Claude from lockfile, registry and
> licence-file evidence. It's rerun before the public launch and before the first release bundle ships.

Status: review, 2026-10-31, of the code before it was copied here. It uses an earlier split: **core** and **pro** below are now the two
slots in this repository's code, both open under Apache-2.0 (see `CLAUDE.md`). "Pro bundle" means a release with the pro slot filled.
The installer, licensing, signing and sales are not in this repository. Where this page says "the source repo", read this repository.

## Bottom line

**Nothing blocks the first public push of the open-core source.** The public repo carries manifests, not third-party
code: no vendored libraries, fonts, icons, images or models, and every npm package is under a licence that an
Apache-2.0 project may depend on.

**Three things must be fixed before the first release bundle ships** (the built room that customers deploy):

1. pdf.js brings four **Liberation Sans 1.07.4** font files under **GPL-2.0 with a font exception**, and the core
   build copies them into every bundle. Stop copying them, or swap in the OFL-licensed 2.x files.
2. Release bundles need a **third-party notices file**, generated from the built output.
3. Pro's visual pipeline **subsets IBM Plex Mono and Source Serif 4** and keeps their names, which their Reserved Font
   Names may forbid. Rename the subsets.

| # | Status, 2026-11-02 | Where |
|---|---|---|
| 1 | ✅ Only the two Foxit fonts a browser fetches are copied (#284), checked against pdf.js by `doc-pdf-fonts.test.ts`. Same render in Chromium with a local Helvetica-class face | `web/integrations/pdfjs-assets.mjs` |
| 2 | ✅ Generated from the metafiles, fails on a package with no licence text | `web/scripts/notices.ts` ([how it runs](NOTICE-draft.md#how-the-generator-runs)) |
| 3 | ✅ Subsets renamed **Binder Serif** and **Binder Mono**, in the name table and the CSS | `web/scripts/font-rename.ts`, `web/scripts/visualtheme-fonts.ts` |
| 8 | ✅ Rive's MIT text, plus Yoga, HarfBuzz and SheenBidi, which `rive.wasm` 2.47.1 compiles in. Its miniaudio is public domain or MIT-0: no notice | `web/scripts/notices/` |
| 11 | ✅ `@ai-sdk/provider-utils` 5.0.68 ships no licence file: reviewed text carries Vercel's Apache-2.0 notice and the vendored ISC notice | `web/scripts/notices/` |
| 9 | ✅ Swapped for `createAI` from `agents/models/ai-sdk` (#868, 2026-11-06); `workers-ai-provider` left the lockfile | `web/worker/agent/model.ts` |
| | ✅ Rerun on the launch tree, 2026-11-15 ([below](#rerun-2026-11-15)) | This file |
| | ⏳ Rerun this review on the release commit | This file |

| What was reviewed | Count |
|---|---|
| npm entries in `web/package-lock.json` (lockfile version 3) | **565** (532 unique name and version). Reviewed 2026-10-31: 640 (605) |
| Direct dependencies | 21 runtime, 14 development |
| SwiftPM packages (`Package.swift`, Xcode project) | **0**: Apple SDKs only |
| Allowlisted files scanned for vendored code and assets | 1,072 (703 core, 369 pro) |
| Licences checked against the npm registry | 605 of 605 on 2026-10-31; 90 of 90 added or changed packages on 2026-11-15; none missing |

| Family | npm entries | Strong copyleft | Source-available (SSPL, BUSL, Elastic, Commons Clause) | Unknown |
|---|---|---|---|---|
| Permissive | 531 | **0** packages, but 4 font files inside `pdfjs-dist` (finding 1) | **0** | **0** |
| Public domain dedication (CC0-1.0) | 3 | | | |
| Weak copyleft (MPL-2.0, LGPL-3.0-or-later) | 26, all build tools | | | |
| Font (OFL-1.1) | 4 (adds `@expo-google-fonts/arimo`, MIT AND OFL-1.1) | | | |
| Data (CC-BY-4.0) | 1, build data | | | |

| Severity | Findings |
|---|---|
| 🔴 Critical | 0 |
| 🟠 High | 1 (finding 1) |
| 🟡 Medium | 2 (findings 2 and 3) |
| 🟢 Low | 8 (findings 4 to 11) |

## What ships, and which licences matter

```
 Public repo (Apache-2.0)        Room release bundle                 Pro bundle
 Colorado-Startups/legallas      built by CI, deployed by the        the pro slot, built on core
                                 customer to its own Cloudflare
 +---------------------------+   +-------------------------------+   +----------------------------+
 | our source, manifests,    |-->| Worker JS: OAuth, MCP, jose,  |-->| core bundle                |
 | lockfile                  |   |   zod                         |   | + Ask: ai, agents,         |
 | no node_modules           |   | Browser JS: pdf.js, d3,       |   |   ai-chat, AI SDK          |
 | no third-party files      |   |   markdown-it                 |   | + Rive runtime (companion) |
 +---------------------------+   | /pdfjs/: CMaps, two Foxit     |   | + visual pages with        |
   licences that matter:         |   fonts, decoders, licences   |   |   subset fonts             |
   only vendored files (none)    | fonts: Inter, Source Serif 4, |   +----------------------------+
                                 |   IBM Plex Mono               |     licences that matter: all
                                 +-------------------------------+     of core, plus pro's own
                                   licences that matter: every
                                   file in the bundle
```

| What ships | To whom | Model | What it triggers |
|---|---|---|---|
| Public source (`legallas`) | Anyone, on GitHub | Source distribution | Only files copied into the repo. None are third-party, so only our own `LICENSE` and `NOTICE` |
| Room release bundle (Worker plus static site) | Each customer, who deploys it to its own Cloudflare account | Distributed bundle (the customer's lawyers then use it over the network) | Every licence of code and assets in the bundle: notices for permissive code, copyleft terms for any copyleft file |
| Mac case tracker | Customers, later | Distributed binary | Apple SDKs only; Apple's SDK terms, no third-party notices |
| Pro bundle (a release with the pro slot filled) | Paying customers | Distributed bundle, closed terms | Everything the room bundle triggers, plus pro's own packages; the core's `LICENSE` and `NOTICE` travel with it |
| The helper (Tauri, Mac and Windows) | Customers, later | Distributed binary | **Not reviewed:** it is not in the allowlist yet. Review its Rust crates and npm packages when it is written |

No AGPL code exists anywhere in the tree, so the customer's lawyers using the room over the network adds no
obligation.

## Findings

| # | Severity | What | Where | Class | Blocks | Action |
|---|---|---|---|---|---|---|
| 1 | 🟠 High | Liberation Sans 1.07.4 (4 TTF files) inside `pdfjs-dist`, under Red Hat's licence: **GPL-2.0 with a font exception**, plus terms on warranty and the LIBERATION trademark | `web/integrations/pdfjs-assets.mjs` copies all of `standard_fonts/` into `dist/pdfjs/`; the viewer (`web/src/scripts/doc-pdf.ts`) loads them as `standardFontDataUrl` | core (and so pro) | Release bundles. Not the source push | Copy only the Foxit fonts (or swap in Liberation Sans 2.x, OFL-1.1), then check rendering of non-embedded Helvetica and Arial PDFs in cloud CI |
| 2 | 🟡 Medium | No third-party notices file yet. Bundles embed MIT, ISC, BSD and Apache-2.0 code and copy BSD-licensed assets whose licences require the notice in documentation that ships with binaries | Every release bundle | core and pro | Release bundles | Generate `THIRD-PARTY-NOTICES` at release time (see the NOTICE draft) |
| 3 | 🟡 Medium | IBM Plex Mono (Reserved Font Name "Plex", per IBM and Google Fonts) and Source Serif 4 (Reserved Font Name "Source" in Adobe's upstream) are subset with HarfBuzz and embedded under their own names. OFL counts a subset as a Modified Version, which may not use a Reserved Font Name [model knowledge, verify against the OFL FAQ]. Fontsource's bundled licence copies drop the Reserved Font Name lines | `web/scripts/visualtheme-fonts.ts` (visual binder) | pro | Pro releases that include visuals | Rename the subset family in the font's name table and the CSS, embed the unmodified files, or use a face with no Reserved Font Name |
| 4 | 🟢 Low | `sharp`'s libvips binaries, LGPL-3.0-or-later (14 optional platform packages) | Astro's image tooling, at build time | build only | Nothing | Keep out of bundles. If the helper ever ships `sharp`, keep libvips a separate replaceable library and ship the LGPL text |
| 5 | 🟢 Low | `lightningcss` and 11 platform binaries, MPL-2.0 | Vite's CSS tool, at build time, unmodified | build only | Nothing | None while it stays a build tool |
| 6 | 🟢 Low | `caniuse-lite` (CC-BY-4.0) and `mdn-data` (CC0-1.0) | Browser and CSS data read at build time | build only | Nothing | Credit `caniuse-lite` if its data is ever shipped |
| 7 | 🟢 Low | The MCP SDK is mid-relicensing: its licence file grants **Apache-2.0 for new code and MIT for older code**; npm metadata says only Apache-2.0 | `@modelcontextprotocol/server` and `core` 2.3.1, in the core MCP Worker | core | Nothing | Carry both texts in the notices |
| 8 | 🟢 Low | `@rive-app/canvas` 2.47.0 ships **no licence file**. MIT per the registry and its GitHub repo. `rive.wasm` compiles the Rive runtime and libraries it builds from source, such as HarfBuzz, libjpeg, libpng, libwebp, SheenBidi, Yoga and miniaudio [verify which reach the wasm] | `web/src/scripts/companion-rive.ts` (the companion) | pro | Nothing | If pro keeps the companion, add Rive's MIT text and those libraries' notices (libjpeg asks for an acknowledgement in documentation). The companion's character art is not ours |
| 9 | 🟢 Low | `workers-ai-provider` 4.0.1 is **deprecated** on npm in favour of `createAI` from `agents/models/ai-sdk` | Ask's model calls (`web/worker/agent/steps.ts`) | pro | Nothing | Maintenance: migrate when Ask is next touched. Licence is fine (MIT). Done in #868 |
| 10 | 🟢 Low | Choice and uncommon permissive licences: 3 `MIT OR Apache-2.0`; `json-schema` (`AFL-2.1 OR BSD-3-Clause`, pro); BlueOak-1.0.0 (3); 0BSD; MIT-0; `MIT AND Zlib`; Python-2.0 and PSF-2.0 (`argparse`, command-line use only) | Transitive | build, core, pro | Nothing | Elect MIT, Apache-2.0 or BSD-3-Clause where there is a choice; all are OSI-approved and compatible |
| 11 | 🟢 Low | Vendored code inside a package: `zod3-to-json-schema` (ISC, Stefan Terdell and Vercel) in `@ai-sdk/provider-utils` | Ask | pro | Nothing | Keep its ISC notice in the notices file |

### Finding 1 in detail: the Liberation fonts

**Status, 2026-11-04.** Resolved. #166 stopped copying pdf.js's four Liberation Sans 1.07.4 files. pdf.js still names
them as the last `url()` source for Helvetica and Arial, so a reader with none of the `local()` fonts (Android Chrome)
got a 404 there (#285). Those four paths now hold Arimo, the font Liberation Sans 2.x is drawn from: the same metrics,
OFL-1.1, with no Reserved Font Name, from `@expo-google-fonts/arimo` 0.4.3 (Google Fonts' files; the package's own
code is MIT and is not shipped). The font is not modified and names itself Arimo; only the file names, chosen by
pdf.js, say Liberation. `web/integrations/pdfjs-assets.mjs` copies them, with `LICENSE_ARIMO`, and
`web/src/scripts/doc-pdf-fonts.test.ts` checks the names against pdf.js. The text below is the original finding.

- **Evidence.** `pdfjs-dist@6.4.299` contains `standard_fonts/LiberationSans-{Regular,Bold,Italic,BoldItalic}.ttf`
  and `standard_fonts/LICENSE_LIBERATION`. The licence file is Red Hat's agreement granting GPL-2.0 with two
  exceptions, followed by the GPL-2.0 text [user provided: read from the package]. The font's own name table reads
  "Version 1.07.4" and "Licensed under the Liberation Fonts license". Liberation 2.x moved to OFL-1.1; this is the
  older line [model knowledge, verify].
- **Why the package's Apache-2.0 metadata misses it.** npm metadata describes pdf.js's own code. The font files
  carry their own licence, which only a read of the package's files shows. The first-pass table in the extraction
  doc lists `pdfjs-dist` as Apache-2.0 and does not mention it.
- **How far the copyleft reaches.** The fonts are separate files fetched by the viewer at run time as
  data, not compiled or linked into our code. That points to aggregation: GPL-2.0 then binds the four font files, not
  the room. Mozilla ships the same files beside Apache-2.0 code in `pdfjs-dist` and Firefox [model knowledge,
  verify]. Against that: the bundle is one deployable unit and the viewer depends on the files to render some PDFs.
  The font exception covers documents that embed the font, not software that bundles it.
- **What compliance would take** if the files stay: the GPL-2.0 text and Red Hat's agreement beside the files (the
  build already copies `LICENSE_LIBERATION` with them), the corresponding source or a written offer for it (for
  these fonts the TTF may be the preferred form for modification; counsel to confirm), and no use of the LIBERATION
  name for a changed version.
- **Recommendation.** Simpler to remove the obligation: copy `standard_fonts/Foxit*.pfb` and `LICENSE_FOXIT` only,
  or replace the four files with Liberation Sans 2.x (OFL-1.1, same metrics) under the same file names. pdf.js uses
  these files for PDFs that name Helvetica or Arial without embedding them; without them it falls back to other
  fonts [model knowledge, verify]. Test with fixture PDFs in cloud CI before the first release. The change is one
  line in `web/integrations/pdfjs-assets.mjs`, best made as a step 2 pull request in the source repo so the copy
  stays a copy.

### Finding 3 in detail: font names in pro's subsets

| Font | Upstream licence line | Fontsource copy | Core use | Pro use |
|---|---|---|---|---|
| Inter | "The Inter Project Authors", no Reserved Font Name | No Reserved Font Name | Served unmodified (front door and room) | Subset as "Inter Variable": fine |
| Source Serif 4 | Adobe: Reserved Font Name "Source". Google Fonts build: none | No Reserved Font Name; copyright shown as "Google Inc." | Served unmodified | Subset as "Source Serif 4 Variable": treat as restricted |
| IBM Plex Mono | IBM and Google Fonts: Reserved Font Name "Plex" | Drops the Reserved Font Name line | Served unmodified | Subset as "IBM Plex Mono": restricted |

Serving the fontsource files unmodified (Vite renames the file, not the font) is fine under OFL with the licence text
in the notices. The notices should use the upstream copyright lines, not fontsource's.

## Direct dependencies

Where each direct dependency reaches was found by reading imports in the 1,072 allowlisted files and walking the
lockfile's dependency graph.

| Package | Locked | Licence | Imported by | Reaches | Verdict |
|---|---|---|---|---|---|
| `@cloudflare/workers-oauth-provider` | 1.2.3 | MIT | core: MCP OAuth (13 files) | core runtime | OK |
| `@modelcontextprotocol/server` | 2.3.1 | Apache-2.0 and MIT | core: MCP tools (8); pro: Copilot and visuals tools (6) | core runtime | OK, finding 7 |
| `jose` | 6.2.13 | MIT | core: auth (7) | core runtime | OK |
| `zod` | 4.6.7 | MIT | core (11), pro (3) | core runtime | OK |
| `pdfjs-dist` | 6.4.299 | Apache-2.0, plus bundled assets (BSD-3-Clause, BSD-2-Clause, MIT, CC0-1.0, **GPL-2.0 with font exception**) | core: viewer, law PDF reader | core runtime | **Finding 1** |
| `markdown-it` | 15.0.3 | MIT (deps add BSD-2-Clause `entities`) | core: `web/src/scripts/markdown.ts` | core runtime | OK |
| `d3-array`, `d3-force`, `d3-scale`, `d3-shape`, `d3-time`, `d3-time-format` | 3.2.4, 3.0.0, 4.0.2, 3.2.0, 3.1.0, 4.1.0 | ISC | core: charts (`web/src/scripts/viz/`) | core runtime | OK |
| `@expo-google-fonts/arimo` | 0.4.3 | MIT (package), OFL-1.1 (font files) | core: the PDF viewer's sans fallback, `web/integrations/pdfjs-assets.mjs` (#285) | core runtime (font files only) | OK, OFL text ships as `LICENSE_ARIMO` and in notices |
| `@fontsource-variable/inter` | 5.3.0 | OFL-1.1 | core: tokens, front door | core runtime (font files) | OK, OFL text in notices |
| `@fontsource-variable/source-serif-4` | 5.3.1 | OFL-1.1 | core: tokens, front door; pro: subsets | core runtime (font files) | OK in core; **finding 3** in pro |
| `@fontsource/ibm-plex-mono` | 5.3.0 | OFL-1.1 | core: tokens; pro: subsets | core runtime (font files) | OK in core; **finding 3** in pro |
| `ai` | 7.0.152 | Apache-2.0 | pro: Ask (10) | pro runtime | OK |
| `agents` | 0.30.1 | MIT | pro: Ask agent (3) | pro runtime | OK |
| `@cloudflare/ai-chat` | 0.12.2 | MIT | pro: `web/worker/agent/research.ts` | pro runtime | OK |
| `workers-ai-provider` | 4.0.1 | MIT | pro: Ask (3) | pro runtime | OK, deprecated (finding 9) |
| `@rive-app/canvas` | 2.47.0 | MIT (no licence file in the package) | pro: companion | pro runtime | OK, finding 8 |
| `astro` | 7.4.2 | MIT | core: build config and integrations | build | OK; brings findings 4 to 6 |
| `wrangler` | 4.152.0 | MIT OR Apache-2.0 | scripts | build and deploy | OK |
| `typescript` | 6.0.3 | Apache-2.0 | core: `web/scripts/copy-text.ts` | build | OK |
| `subset-font` | 2.9.0 | BSD-3-Clause (uses `harfbuzzjs`, MIT) | pro: visual fonts | build | OK |
| `@astrojs/check`, `@types/*` (8) | various | MIT | type checks | build | OK |

What the bundles embed, from the lockfile graph (core is exact; pro is an upper bound, because `agents` lists build
tools such as esbuild and Babel as runtime dependencies, which the bundler drops):

| Reaches | Packages | Licences |
|---|---|---|
| **core runtime** | 30 | MIT 8, ISC 14, Apache-2.0 3, OFL-1.1 3, BSD-2-Clause 1, PSF-2.0 1 (`argparse`, used only by `markdown-it`'s command line, so never bundled) |
| **pro runtime** (adds) | 205 at most | MIT 180, ISC 10, Apache-2.0 8, BSD-3-Clause 3, BSD-2-Clause 1, MIT-0 1, `AFL-2.1 OR BSD-3-Clause` 1, CC-BY-4.0 1 (build data, finding 6) |
| **build and test only** | 405 | Includes all 26 weak-copyleft packages and every optional platform binary |

## Beyond npm and SwiftPM

| Area | What was found | Verdict |
|---|---|---|
| **Swift** | `Package.swift` declares no package dependencies; the Xcode project references only the local package; `Package.resolved` is not tracked. Code uses SwiftUI, SwiftData, PDFKit and Vision | OK: nothing to notice |
| **Swift data** | `Sources/LegallasCore/Resources/ColoradoCourtHolidays.json`: Colorado court holiday dates under C.R.S. 24-11-101 | OK: government facts, no licence needed |
| **OCR** | Apple Vision (`VNRecognizeTextRequest`) in `LegallasExtraction`; the planned Windows helper will use the Windows OCR API | OK: system frameworks, never redistributed |
| **Models** | No model weights in any file (no `.onnx`, `.gguf`, `.safetensors`, Core ML, Tesseract or transformers.js). Core names hosted Workers AI models only: `@cf/qwen/qwen3-embedding-0.6b` (Apache-2.0), `@cf/openai/gpt-oss-120b` (Apache-2.0, Ask's model since 2026-11-05), `@cf/zai-org/glm-4.7-flash`, `glm-5.3` and `glm-5.3-flash` (MIT; Workers AI retires `glm-5.3-flash` on 2026-11-15, so core keeps it only as a price, a retiring entry and a test id) [model knowledge, verify on each model card]. They run in the customer's own Cloudflare account under Cloudflare's terms. | OK: nothing distributed. Qwen and GLM are Chinese open-weight models served by Cloudflare, which the brief's model rule allows |
| **Fonts** | Inter, Source Serif 4, IBM Plex Mono (OFL-1.1); pdf.js's Foxit fonts (BSD-3-Clause, PDFium); Arimo (OFL-1.1) served under pdf.js's Liberation file names, so Liberation Sans 1.07.4 no longer ships | Findings 1 to 3, all closed |
| **Icons and images** | Core has **no** image, font or other binary file. Its inline icons are drawn in-house on 16 and 20 pixel grids (not a third-party set). Pro has two Copilot app icons, drawn by `web/connect/copilot/icons.ts` from the first customer's seal geometry | OK for licences; see "Noticed in passing" |
| **pdf.js data files** | `cmaps/` (Adobe, BSD-3-Clause), `iccs/` (CC0-1.0), `wasm/openjpeg.wasm` (BSD-2-Clause), `wasm/jbig2.wasm` (PDFium BSD-3-Clause and Apache-2.0), `wasm/qcms_bg.wasm` (MIT), plus Mozilla's wrappers (Apache-2.0, BSD-2-Clause, MIT). The PDF script sandbox (`quickjs-eval`) is deliberately not copied | OK with notices (finding 2) |
| **Vendored or copied code** | A marker scan of all 1,072 files (copyright, SPDX and licence headers, "adapted from", "ported from", Stack Overflow links, minified files, embedded base64 assets) found none | OK |
| **Apache-2.0 `NOTICE` files** | None of the Apache-2.0 packages in either runtime set ships a `NOTICE` file, so nothing must be copied into ours | OK |
| **Law data** | The law builder (core) fetches public domain opinions (Caselaw Access Project, read on CourtListener) when a customer builds a pack; no law text ships in core. CourtListener's own API terms apply to the fetch [verify] | OK |
| **CI tools** (never shipped) | `actions/checkout`, `setup-node`, `labeler`, `upload-artifact` (MIT); `anthropics/claude-code-action` (MIT); gitleaks CLI 8.30.1 (MIT, not `gitleaks-action`, which needs a paid licence on organization repos); SwiftLint 0.65.1 (MIT) | OK |

## Outbound check for the Apache-2.0 core

| Check | Result |
|---|---|
| Outbound licence compatible with everything embedded | **Yes.** Every embedded package is permissive or OFL. The GPL-2.0 fonts are separate data files (aggregation) and are removed by finding 1 |
| `LICENSE` | Apache-2.0 text, added in the first commit (the source repo's own `LICENSE` is "drop") |
| `NOTICE` | Draft in [NOTICE-draft.md](NOTICE-draft.md), with the copyright holder Colorado Startups, LTD. |
| Third-party licence texts | Not needed in the source repo (nothing vendored). Needed in every bundle: finding 2 |
| No case data, customer data or credentials | Covered by the extraction's first-commit checks and full human read, not by this review |
| Trademark | `TRADEMARKS.md`: Apache-2.0 section 6 grants no trademark rights; the name waits on counsel's search |
| Pro may bundle the core under closed terms | **Yes**, carrying the core's `LICENSE`, `NOTICE` and the third-party notices. Findings 1 and 2 apply to pro bundles too |

## Jurisdiction note

These licences are read under United States law. The aggregation question in finding 1 (GPL-2.0), OFL's Reserved
Font Name rule for subsets (finding 3), LGPL's replaceability terms and MPL's file scope have little case law. If
bundles are sold in the European Union, that reading needs its own check. Downstream terms (the licence
file customers accept) should name a governing law; this review does not draft them.

## When to check again

No lawyer signs off (the owner's decision). There's no list of pre-approved licences, so a session reruns this review:

1. **Before the public launch:** no blockers were found on 2026-10-31.
2. **Before the first release bundle:** findings 1 to 3 are closed, and the generated notices file is read.

## Actions

| # | Action | Where | When |
|---|---|---|---|
| 1 | Stop copying `LiberationSans-*.ttf` (or replace with 2.x, OFL-1.1); test rendering in cloud CI | `web/integrations/pdfjs-assets.mjs` | Before the first release bundle |
| 2 | Generate `THIRD-PARTY-NOTICES` from the bundler's metafile plus the copied asset folders; ship it in every bundle and in the app's About screen | Release workflow (core and pro) | Before the first release bundle |
| 3 | Rename subset font families (name table and CSS) in the visual pipeline | `web/scripts/visualtheme-fonts.ts` (pro) | Before a pro release with visuals |
| 4 | If the companion stays: Rive MIT text and its runtime libraries' notices | Pro notices | Before a pro release with the companion |
| 5 | ✅ Replace the deprecated `workers-ai-provider` | Pro Ask | Done in #868, 2026-11-06 |
| 6 | Re-run this review on the launch commit | This file | Public launch |
| 7 | Review the helper's dependencies when it exists (Tauri, Rust crates, its npm packages) | New section here | Before the first helper release |

## Rerun 2026-11-15

Launch tree, `origin/main` at `6749996` (#1022 merged). `web/package-lock.json` at `b67bdaf` holds the reviewed 640 entries; at `6749996` it holds the 565 counted now. Nothing was installed.

Rule: every key of `packages` in both lockfiles, nested ones included; added or changed means a key that is new or whose version differs, counted as unique name and version; removed means a key absent now.

| Check | Result |
|---|---|
| Lockfile, entries (unique) | 640 (605) before, 565 (532) now |
| Added or changed | 90 name and version pairs from 91 keys, 7 of them new keys. 4 new names (`@expo-google-fonts/arimo`, `@opentelemetry/api`, `@bruits/satteri-android-arm64`, `@bruits/satteri-freebsd-x64`), 3 new nested keys (`@napi-rs/wasm-runtime` under two Astro and satteri wasm bindings, `@modelcontextprotocol/core` under `client`), the rest new versions of existing names |
| Removed | 82 keys (78 package names): `workers-ai-provider` (#868), `@modelcontextprotocol/sdk` and its Express and Hono tree |
| Licence per package | Lockfile `license` field and `npm view <name>@<version> license`: 90 of 90 match |
| New licence families | None. Added or changed: MIT 67, Apache-2.0 14, ISC 7, MIT OR Apache-2.0 1 (`wrangler`), MIT AND OFL-1.1 1 (`arimo`) |
| Strong copyleft, source-available, unknown | 0 |
| Majors worth a read | `p-queue` 9.3.5 to 10.0.0, MIT. `agents` 0.30.1 to 0.33.0, MIT. `pdfjs-dist` 6.4.299 to 6.5.438: font assets re-read by `doc-pdf-fonts.test.ts` |
| Dropped | The `worker-configuration.d.ts` mention: #1022 builds Worker types in `check` and no longer commits the file |
| Verdict | Nothing blocks launch. Findings 1 to 3 stay closed |

### Inventory: templates, forms, fonts, law texts

| Kind | What | Source | Licence | Evidence |
|---|---|---|---|---|
| Templates | 77 templates: 38 founders, 21 investors, 17 raise, 1 held back (plus `README.md`, `bundled-forms.md` and `investors/README.md`) | Legallas's own drafting | CC0-1.0 | `templates/LICENSE`, `templates/README.md` |
| Bundled form | Series Seed term sheet, investment agreement, certificate | github.com/seriesseed/equity, commit `3789fa0` | CC0 | `templates/bundled-forms.md` |
| Bundled form | Y Combinator post-money SAFE, pro rata side letter | ycombinator.com/documents | CC BY-ND 4.0: ship unmodified only | `templates/bundled-forms.md` |
| Bundled form | Common Paper Mutual NDA 1.0 | commonpaper.com/standards/mutual-nda/1.0, commit `2a3068b` | CC BY 4.0 | `templates/bundled-forms.md` |
| Bundled form | IRS SS-4, 15620, 8832, 2553 | irs.gov | Federal work, 17 U.S.C. 105 | `templates/bundled-forms.md` |
| Forms in the tree | None: each is pinned by address and SHA-256, not copied | | | `templates/bundled-forms.md` |
| Fonts | Inter 5.3.0, Source Serif 4 5.3.1, IBM Plex Mono 5.3.0 | fontsource packages | OFL-1.1 | `web/scripts/notices/`, `docs/licences/NOTICE-draft.md` |
| Fonts | Arimo 0.4.3 as pdf.js's Liberation file names | `@expo-google-fonts/arimo` | OFL-1.1 | `web/integrations/pdfjs-assets.mjs`, lockfile |
| Fonts | Foxit fonts | `pdfjs-dist` | BSD-3-Clause | `web/integrations/pdfjs-assets.mjs` |
| Law texts | None shipped: each install downloads its own. 99 units in the plan: 29 bundle, 27 after-statement, 16 after-counsel, 27 cite-only | Official hosts: govinfo, uscode.house.gov, ecfr.gov, sec.gov, irs.gov, OLLS | Federal work or state terms per host | `docs/design/law-pack-plan.toml`, `web/scripts/law/` |
| Data | Colorado court holiday dates | C.R.S. 24-11-101 | Government facts | `Sources/LegallasCore/Resources/ColoradoCourtHolidays.json` |

## Noticed in passing

Not licence findings.

- `web/mcp/pages/html.ts` has a mark as an inline SVG (`SEAL`), and the Copilot app icons (`web/connect/copilot/appPackage/*.png`) use the
  same geometry. The launch gate confirms they're the product's neutral mark.
- Wrangler and Astro send usage telemetry by default. CI turns Wrangler's off in two workflows and Astro's off in one.
  If the helper's "Update room" runs Wrangler on the customer's machine, it needs `WRANGLER_SEND_METRICS=false` to
  keep the no-telemetry rule.

## How this review was made

- A read-only, depth-1 clone of the source repo at `1dd2093`, with only the 1,072 core and pro paths checked out
  (sparse checkout from the allowlist classifier). Nothing was installed and nothing ran on the Mac beyond seconds-long
  reads.
- Licences: the lockfile's `license` fields, checked against `registry.npmjs.org` for all 605 unique packages.
- Licence texts and package file lists: read from the published package files (jsDelivr) for every flagged, Apache-2.0
  or runtime package, and from upstream repos on GitHub for the fonts and the Rive runtime.
- Source tags: `[user provided]` is text read from the package or repo; `[model knowledge, verify]` is recalled and
  needs a primary source before anyone relies on it.

<details>
<summary>Every npm package and its verdict, as reviewed 2026-10-31 (640; changes since: see the rerun)</summary>

| Package | Version | Licence | Scope | Reaches | Verdict |
|---|---|---|---|---|---|
| `@ai-sdk/gateway` | 4.0.125 | Apache-2.0 | transitive | pro runtime | OK, licence text in notices |
| `@ai-sdk/provider` | 4.0.33 | Apache-2.0 | transitive | pro runtime | OK, licence text in notices |
| `@ai-sdk/provider-utils` | 5.0.67 | Apache-2.0 | transitive | pro runtime | OK, Apache-2.0; keep vendored ISC notice (finding 11) |
| `@astrojs/astro2tsx` | 0.1.3 | MIT | transitive | build and test only | OK, build only |
| `@astrojs/check` | 0.9.12 | MIT | direct dev | build and test only | OK, build only |
| `@astrojs/compiler-binding` | 0.5.1 | MIT | transitive | build and test only | OK, build only |
| `@astrojs/compiler-binding-android-arm64` | 0.5.1 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@astrojs/compiler-binding-darwin-arm64` | 0.5.1 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@astrojs/compiler-binding-darwin-x64` | 0.5.1 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@astrojs/compiler-binding-linux-arm64-gnu` | 0.5.1 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@astrojs/compiler-binding-linux-arm64-musl` | 0.5.1 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@astrojs/compiler-binding-linux-x64-gnu` | 0.5.1 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@astrojs/compiler-binding-linux-x64-musl` | 0.5.1 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@astrojs/compiler-binding-wasm32-wasi` | 0.5.1 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@astrojs/compiler-binding-win32-arm64-msvc` | 0.5.1 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@astrojs/compiler-binding-win32-x64-msvc` | 0.5.1 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@astrojs/compiler-rs` | 0.5.1 | MIT | transitive | build and test only | OK, build only |
| `@astrojs/internal-helpers` | 0.13.0 | MIT | transitive | build and test only | OK, build only |
| `@astrojs/language-server` | 2.17.3 | MIT | transitive | build and test only | OK, build only |
| `@astrojs/markdown-satteri` | 0.4.5 | MIT | transitive | build and test only | OK, build only |
| `@astrojs/prism` | 4.1.1 | MIT | transitive | build and test only | OK, build only |
| `@astrojs/telemetry` | 3.4.1 | MIT | transitive | build and test only | OK, build only |
| `@astrojs/yaml2ts` | 0.2.4 | MIT | transitive | build and test only | OK, build only |
| `@babel/code-frame` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/compat-data` | 8.0.5 | MIT | transitive | pro runtime | OK, notice |
| `@babel/core` | 8.0.7 | MIT | transitive | pro runtime | OK, notice |
| `@babel/generator` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-annotate-as-pure` | 8.0.0 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-compilation-targets` | 8.0.7 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-create-class-features-plugin` | 8.0.7 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-globals` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-member-expression-to-functions` | 8.0.5 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-optimise-call-expression` | 8.0.0 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-plugin-utils` | 8.0.1 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-replace-supers` | 8.0.1 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-skip-transparent-expression-wrappers` | 8.0.0 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-string-parser` | 7.29.7 | MIT | transitive | build and test only | OK, build only |
| `@babel/helper-string-parser (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-string-parser (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-string-parser (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-string-parser (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-string-parser (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-string-parser (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-string-parser (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-string-parser (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-string-parser (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-validator-identifier` | 7.29.7 | MIT | transitive | build and test only | OK, build only |
| `@babel/helper-validator-identifier (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-validator-identifier (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-validator-identifier (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-validator-identifier (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-validator-identifier (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-validator-identifier (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-validator-identifier (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-validator-identifier (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-validator-identifier (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-validator-identifier (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helper-validator-option` | 8.0.0 | MIT | transitive | pro runtime | OK, notice |
| `@babel/helpers` | 8.0.7 | MIT | transitive | pro runtime | OK, notice |
| `@babel/parser` | 7.29.9 | MIT | transitive | build and test only | OK, build only |
| `@babel/parser (nested)` | 8.0.7 | MIT | transitive | pro runtime | OK, notice |
| `@babel/parser (nested)` | 8.0.7 | MIT | transitive | pro runtime | OK, notice |
| `@babel/parser (nested)` | 8.0.7 | MIT | transitive | pro runtime | OK, notice |
| `@babel/parser (nested)` | 8.0.7 | MIT | transitive | pro runtime | OK, notice |
| `@babel/plugin-proposal-decorators` | 8.0.2 | MIT | transitive | pro runtime | OK, notice |
| `@babel/plugin-syntax-decorators` | 8.0.1 | MIT | transitive | pro runtime | OK, notice |
| `@babel/runtime` | 7.29.10 | MIT | transitive | pro runtime | OK, notice |
| `@babel/runtime-corejs3` | 7.29.10 | MIT | transitive | pro runtime | OK, notice |
| `@babel/template` | 8.0.0 | MIT | transitive | pro runtime | OK, notice |
| `@babel/traverse` | 8.0.7 | MIT | transitive | pro runtime | OK, notice |
| `@babel/types` | 7.29.8 | MIT | transitive | build and test only | OK, build only |
| `@babel/types (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/types (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/types (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/types (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/types (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/types (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/types (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/types (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@babel/types (nested)` | 8.0.6 | MIT | transitive | pro runtime | OK, notice |
| `@bruits/satteri-darwin-arm64` | 0.10.5 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@bruits/satteri-darwin-x64` | 0.10.5 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@bruits/satteri-linux-arm64-gnu` | 0.10.5 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@bruits/satteri-linux-arm64-musl` | 0.10.5 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@bruits/satteri-linux-x64-gnu` | 0.10.5 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@bruits/satteri-linux-x64-musl` | 0.10.5 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@bruits/satteri-wasm32-wasi` | 0.10.5 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@bruits/satteri-win32-arm64-msvc` | 0.10.5 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@bruits/satteri-win32-x64-msvc` | 0.10.5 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@capsizecss/unpack` | 4.0.1 | MIT | transitive | build and test only | OK, build only |
| `@cfworker/json-schema` | 4.1.1 | MIT | transitive | pro runtime | OK, notice |
| `@clack/core` | 1.5.1 | MIT | transitive | build and test only | OK, build only |
| `@clack/prompts` | 1.8.1 | MIT | transitive | build and test only | OK, build only |
| `@cloudflare/ai-chat` | 0.12.2 | MIT | direct | pro runtime | OK, notice |
| `@cloudflare/kv-asset-handler` | 0.5.0 | MIT OR Apache-2.0 | transitive | build and test only | OK, build only |
| `@cloudflare/unenv-preset` | 2.16.2 | MIT OR Apache-2.0 | transitive | build and test only | OK, build only |
| `@cloudflare/workerd-darwin-64` | 1.20261019.1 | Apache-2.0 | transitive, optional platform binary | build and test only | OK, build only |
| `@cloudflare/workerd-darwin-arm64` | 1.20261019.1 | Apache-2.0 | transitive, optional platform binary | build and test only | OK, build only |
| `@cloudflare/workerd-linux-64` | 1.20261019.1 | Apache-2.0 | transitive, optional platform binary | build and test only | OK, build only |
| `@cloudflare/workerd-linux-arm64` | 1.20261019.1 | Apache-2.0 | transitive, optional platform binary | build and test only | OK, build only |
| `@cloudflare/workerd-windows-64` | 1.20261019.1 | Apache-2.0 | transitive, optional platform binary | build and test only | OK, build only |
| `@cloudflare/workers-oauth-provider` | 1.2.3 | MIT | direct | core runtime | OK, notice |
| `@cspotcode/source-map-support` | 0.8.1 | MIT | transitive | build and test only | OK, build only |
| `@emmetio/abbreviation` | 2.3.3 | MIT | transitive | build and test only | OK, build only |
| `@emmetio/css-abbreviation` | 2.1.8 | MIT | transitive | build and test only | OK, build only |
| `@emmetio/css-parser` | 0.4.1 | MIT | transitive | build and test only | OK, build only |
| `@emmetio/html-matcher` | 1.3.0 | ISC | transitive | build and test only | OK, build only |
| `@emmetio/scanner` | 1.0.4 | MIT | transitive | build and test only | OK, build only |
| `@emmetio/stream-reader` | 2.2.0 | MIT | transitive | build and test only | OK, build only |
| `@emmetio/stream-reader-utils` | 0.1.0 | MIT | transitive | build and test only | OK, build only |
| `@emnapi/core` | 1.11.3 | MIT | transitive | build and test only | OK, build only |
| `@emnapi/core (nested)` | 1.11.1 | MIT | transitive | build and test only | OK, build only |
| `@emnapi/runtime` | 1.11.3 | MIT | transitive | build and test only | OK, build only |
| `@emnapi/runtime (nested)` | 1.11.1 | MIT | transitive | build and test only | OK, build only |
| `@emnapi/wasi-threads` | 1.2.3 | MIT | transitive | build and test only | OK, build only |
| `@emnapi/wasi-threads (nested)` | 1.2.2 | MIT | transitive | build and test only | OK, build only |
| `@esbuild/aix-ppc64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/android-arm` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/android-arm64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/android-x64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/darwin-arm64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/darwin-x64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/freebsd-arm64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/freebsd-x64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/linux-arm` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/linux-arm64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/linux-ia32` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/linux-loong64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/linux-mips64el` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/linux-ppc64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/linux-riscv64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/linux-s390x` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/linux-x64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/netbsd-arm64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/netbsd-x64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/openbsd-arm64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/openbsd-x64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/openharmony-arm64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/sunos-x64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/win32-arm64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/win32-ia32` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@esbuild/win32-x64` | 0.28.2 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@fontsource-variable/inter` | 5.3.0 | OFL-1.1 | direct | core runtime | OK, OFL notice |
| `@fontsource-variable/source-serif-4` | 5.3.1 | OFL-1.1 | direct | core runtime | OK, OFL; Flag for pro subsetting (finding 3) |
| `@fontsource/ibm-plex-mono` | 5.3.0 | OFL-1.1 | direct | core runtime | OK, OFL; Flag for pro subsetting (finding 3) |
| `@hono/node-server` | 2.1.5 | MIT | transitive | pro runtime | OK, notice |
| `@img/colour` | 1.1.0 | MIT | transitive | build and test only | OK, build only |
| `@img/sharp-darwin-arm64` | 0.35.5 | Apache-2.0 | transitive, optional platform binary | build and test only | OK, build only |
| `@img/sharp-darwin-x64` | 0.35.5 | Apache-2.0 | transitive, optional platform binary | build and test only | OK, build only |
| `@img/sharp-freebsd-wasm32` | 0.35.5 | Apache-2.0 | transitive, optional platform binary | build and test only | OK, build only |
| `@img/sharp-libvips-darwin-arm64` | 1.3.4 | LGPL-3.0-or-later | transitive, optional platform binary | build and test only | Build only (finding 4) |
| `@img/sharp-libvips-darwin-x64` | 1.3.4 | LGPL-3.0-or-later | transitive, optional platform binary | build and test only | Build only (finding 4) |
| `@img/sharp-libvips-linux-arm` | 1.3.4 | LGPL-3.0-or-later | transitive, optional platform binary | build and test only | Build only (finding 4) |
| `@img/sharp-libvips-linux-arm64` | 1.3.4 | LGPL-3.0-or-later | transitive, optional platform binary | build and test only | Build only (finding 4) |
| `@img/sharp-libvips-linux-ppc64` | 1.3.4 | LGPL-3.0-or-later | transitive, optional platform binary | build and test only | Build only (finding 4) |
| `@img/sharp-libvips-linux-riscv64` | 1.3.4 | LGPL-3.0-or-later | transitive, optional platform binary | build and test only | Build only (finding 4) |
| `@img/sharp-libvips-linux-s390x` | 1.3.4 | LGPL-3.0-or-later | transitive, optional platform binary | build and test only | Build only (finding 4) |
| `@img/sharp-libvips-linux-x64` | 1.3.4 | LGPL-3.0-or-later | transitive, optional platform binary | build and test only | Build only (finding 4) |
| `@img/sharp-libvips-linuxmusl-arm64` | 1.3.4 | LGPL-3.0-or-later | transitive, optional platform binary | build and test only | Build only (finding 4) |
| `@img/sharp-libvips-linuxmusl-x64` | 1.3.4 | LGPL-3.0-or-later | transitive, optional platform binary | build and test only | Build only (finding 4) |
| `@img/sharp-linux-arm` | 0.35.5 | Apache-2.0 | transitive, optional platform binary | build and test only | OK, build only |
| `@img/sharp-linux-arm64` | 0.35.5 | Apache-2.0 | transitive, optional platform binary | build and test only | OK, build only |
| `@img/sharp-linux-ppc64` | 0.35.5 | Apache-2.0 | transitive, optional platform binary | build and test only | OK, build only |
| `@img/sharp-linux-riscv64` | 0.35.5 | Apache-2.0 | transitive, optional platform binary | build and test only | OK, build only |
| `@img/sharp-linux-s390x` | 0.35.5 | Apache-2.0 | transitive, optional platform binary | build and test only | OK, build only |
| `@img/sharp-linux-x64` | 0.35.5 | Apache-2.0 | transitive, optional platform binary | build and test only | OK, build only |
| `@img/sharp-linuxmusl-arm64` | 0.35.5 | Apache-2.0 | transitive, optional platform binary | build and test only | OK, build only |
| `@img/sharp-linuxmusl-x64` | 0.35.5 | Apache-2.0 | transitive, optional platform binary | build and test only | OK, build only |
| `@img/sharp-wasm32` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | transitive | build and test only | Build only (finding 4) |
| `@img/sharp-webcontainers-wasm32` | 0.35.5 | Apache-2.0 | transitive, optional platform binary | build and test only | OK, build only |
| `@img/sharp-win32-arm64` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | transitive, optional platform binary | build and test only | Build only (finding 4) |
| `@img/sharp-win32-ia32` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | transitive, optional platform binary | build and test only | Build only (finding 4) |
| `@img/sharp-win32-x64` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | transitive, optional platform binary | build and test only | Build only (finding 4) |
| `@jridgewell/gen-mapping` | 0.4.0-beta.0 | MIT | transitive | pro runtime | OK, notice |
| `@jridgewell/resolve-uri` | 3.1.2 | MIT | transitive | pro runtime | OK, notice |
| `@jridgewell/sourcemap-codec` | 1.6.0 | MIT | transitive | pro runtime | OK, notice |
| `@jridgewell/trace-mapping` | 0.3.9 | MIT | transitive | build and test only | OK, build only |
| `@jridgewell/trace-mapping (nested)` | 0.3.31 | MIT | transitive | pro runtime | OK, notice |
| `@jridgewell/trace-mapping (nested)` | 0.3.31 | MIT | transitive | pro runtime | OK, notice |
| `@modelcontextprotocol/client` | 2.3.1 | Apache-2.0 | transitive | pro runtime | OK, Apache-2.0 and MIT (finding 7) |
| `@modelcontextprotocol/core` | 2.3.1 | Apache-2.0 | transitive | core runtime | OK, Apache-2.0 and MIT (finding 7) |
| `@modelcontextprotocol/sdk` | 1.32.1 | MIT | transitive | pro runtime | OK, notice |
| `@modelcontextprotocol/server` | 2.3.1 | Apache-2.0 | direct | core runtime | OK, Apache-2.0 and MIT (finding 7) |
| `@napi-rs/canvas` | 1.0.10 | MIT | transitive | build and test only | OK, build only |
| `@napi-rs/canvas-android-arm64` | 1.0.10 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@napi-rs/canvas-darwin-arm64` | 1.0.10 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@napi-rs/canvas-darwin-x64` | 1.0.10 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@napi-rs/canvas-linux-arm-gnueabihf` | 1.0.10 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@napi-rs/canvas-linux-arm64-gnu` | 1.0.10 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@napi-rs/canvas-linux-arm64-musl` | 1.0.10 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@napi-rs/canvas-linux-riscv64-gnu` | 1.0.10 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@napi-rs/canvas-linux-x64-gnu` | 1.0.10 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@napi-rs/canvas-linux-x64-musl` | 1.0.10 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@napi-rs/canvas-win32-arm64-msvc` | 1.0.10 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@napi-rs/canvas-win32-x64-msvc` | 1.0.10 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@napi-rs/wasm-runtime` | 1.2.4 | MIT | transitive | build and test only | OK, build only |
| `@oslojs/encoding` | 1.1.0 | MIT | transitive | build and test only | OK, build only |
| `@oxc-project/types` | 0.156.0 | MIT | transitive | pro runtime | OK, notice |
| `@poppinss/colors` | 4.1.6 | MIT | transitive | build and test only | OK, build only |
| `@poppinss/dumper` | 0.6.5 | MIT | transitive | build and test only | OK, build only |
| `@poppinss/exception` | 1.2.3 | MIT | transitive | build and test only | OK, build only |
| `@rive-app/canvas` | 2.47.0 | MIT | direct | pro runtime | OK, MIT; notices missing from package (finding 8) |
| `@rolldown/binding-android-arm-eabi` | 1.2.16 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@rolldown/binding-android-arm64` | 1.2.16 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@rolldown/binding-darwin-arm64` | 1.2.16 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@rolldown/binding-darwin-x64` | 1.2.16 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@rolldown/binding-freebsd-x64` | 1.2.16 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@rolldown/binding-linux-arm-gnueabihf` | 1.2.16 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@rolldown/binding-linux-arm64-gnu` | 1.2.16 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@rolldown/binding-linux-arm64-musl` | 1.2.16 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@rolldown/binding-linux-ppc64-gnu` | 1.2.16 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@rolldown/binding-linux-s390x-gnu` | 1.2.16 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@rolldown/binding-linux-x64-gnu` | 1.2.16 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@rolldown/binding-linux-x64-musl` | 1.2.16 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@rolldown/binding-openharmony-arm64` | 1.2.16 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@rolldown/binding-win32-arm64-msvc` | 1.2.16 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@rolldown/binding-win32-x64-msvc` | 1.2.16 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `@rolldown/plugin-babel` | 0.2.4 | MIT | transitive | pro runtime | OK, notice |
| `@rolldown/pluginutils` | 1.0.1 | MIT | transitive | pro runtime | OK, notice |
| `@shikijs/core` | 4.5.0 | MIT | transitive | build and test only | OK, build only |
| `@shikijs/engine-javascript` | 4.5.0 | MIT | transitive | build and test only | OK, build only |
| `@shikijs/engine-oniguruma` | 4.5.0 | MIT | transitive | build and test only | OK, build only |
| `@shikijs/langs` | 4.5.0 | MIT | transitive | build and test only | OK, build only |
| `@shikijs/primitive` | 4.5.0 | MIT | transitive | build and test only | OK, build only |
| `@shikijs/themes` | 4.5.0 | MIT | transitive | build and test only | OK, build only |
| `@shikijs/types` | 4.5.0 | MIT | transitive | build and test only | OK, build only |
| `@shikijs/vscode-textmate` | 10.1.0 | MIT | transitive | build and test only | OK, build only |
| `@sindresorhus/is` | 7.2.0 | MIT | transitive | build and test only | OK, build only |
| `@speed-highlight/core` | 1.2.24 | CC0-1.0 | transitive | build and test only | OK, build only |
| `@standard-schema/spec` | 1.1.0 | MIT | transitive | pro runtime | OK, notice |
| `@tybys/wasm-util` | 0.10.4 | MIT | transitive | build and test only | OK, build only |
| `@types/d3-array` | 3.2.2 | MIT | direct dev | build and test only | OK, build only |
| `@types/d3-force` | 3.0.10 | MIT | direct dev | build and test only | OK, build only |
| `@types/d3-path` | 3.1.1 | MIT | transitive | build and test only | OK, build only |
| `@types/d3-scale` | 4.0.9 | MIT | direct dev | build and test only | OK, build only |
| `@types/d3-shape` | 3.2.0 | MIT | direct dev | build and test only | OK, build only |
| `@types/d3-time` | 3.0.4 | MIT | direct dev | build and test only | OK, build only |
| `@types/d3-time-format` | 4.0.3 | MIT | direct dev | build and test only | OK, build only |
| `@types/estree` | 1.0.9 | MIT | transitive | build and test only | OK, build only |
| `@types/estree-jsx` | 1.0.5 | MIT | transitive | build and test only | OK, build only |
| `@types/gensync` | 1.0.5 | MIT | transitive | pro runtime | OK, notice |
| `@types/hast` | 3.0.5 | MIT | transitive | build and test only | OK, build only |
| `@types/jsesc` | 2.5.1 | MIT | transitive | pro runtime | OK, notice |
| `@types/linkify-it` | 5.0.0 | MIT | transitive | build and test only | OK, build only |
| `@types/markdown-it` | 14.2.0 | MIT | direct dev | build and test only | OK, build only |
| `@types/mdast` | 4.0.4 | MIT | transitive | build and test only | OK, build only |
| `@types/mdurl` | 2.0.0 | MIT | transitive | build and test only | OK, build only |
| `@types/nlcst` | 2.0.3 | MIT | transitive | build and test only | OK, build only |
| `@types/node` | 26.6.5 | MIT | direct dev | build and test only | OK, build only |
| `@types/unist` | 3.0.3 | MIT | transitive | build and test only | OK, build only |
| `@ungap/structured-clone` | 1.4.0 | ISC | transitive | build and test only | OK, build only |
| `@vercel/oidc` | 3.2.0 | Apache-2.0 | transitive | pro runtime | OK, licence text in notices |
| `@volar/kit` | 2.4.30 | MIT | transitive | build and test only | OK, build only |
| `@volar/language-core` | 2.4.30 | MIT | transitive | build and test only | OK, build only |
| `@volar/language-server` | 2.4.30 | MIT | transitive | build and test only | OK, build only |
| `@volar/language-service` | 2.4.30 | MIT | transitive | build and test only | OK, build only |
| `@volar/source-map` | 2.4.30 | MIT | transitive | build and test only | OK, build only |
| `@volar/typescript` | 2.4.30 | MIT | transitive | build and test only | OK, build only |
| `@vscode/emmet-helper` | 2.11.0 | MIT | transitive | build and test only | OK, build only |
| `@vscode/l10n` | 0.0.18 | MIT | transitive | build and test only | OK, build only |
| `@workflow/serde` | 4.1.0 | Apache-2.0 | transitive | pro runtime | OK, licence text in notices |
| `accepts` | 2.0.0 | MIT | transitive | pro runtime | OK, notice |
| `agents` | 0.30.1 | MIT | direct | pro runtime | OK, notice |
| `ai` | 7.0.152 | Apache-2.0 | direct | pro runtime | OK, licence text in notices |
| `ajv` | 8.20.0 | MIT | transitive | pro runtime | OK, notice |
| `ajv-draft-04` | 1.0.0 | MIT | transitive | build and test only | OK, build only |
| `ajv-formats` | 3.0.1 | MIT | transitive | pro runtime | OK, notice |
| `ajv-i18n` | 4.2.0 | MIT | transitive | build and test only | OK, build only |
| `am-i-vibing` | 0.5.0 | MIT | transitive | build and test only | OK, build only |
| `ansi-regex` | 6.4.0 | MIT | transitive | build and test only | OK, build only |
| `ansi-styles` | 6.2.3 | MIT | transitive | build and test only | OK, build only |
| `anymatch` | 3.1.3 | ISC | transitive | build and test only | OK, build only |
| `argparse` | 2.0.1 | Python-2.0 | transitive | build and test only | OK, build only |
| `argparse (nested)` | 3.0.3 | PSF-2.0 | transitive | core runtime | OK, used only by markdown-it's command line, never bundled (finding 10) |
| `aria-query` | 5.3.2 | Apache-2.0 | transitive | build and test only | OK, build only |
| `astro` | 7.4.2 | MIT | direct | build and test only | OK, build only |
| `axobject-query` | 4.1.0 | Apache-2.0 | transitive | build and test only | OK, build only |
| `bail` | 2.0.2 | MIT | transitive | build and test only | OK, build only |
| `baseline-browser-mapping` | 2.11.30 | Apache-2.0 | transitive | pro runtime | OK, licence text in notices |
| `blake3-wasm` | 2.1.5 | MIT | transitive | build and test only | OK, build only |
| `body-parser` | 2.3.0 | MIT | transitive | pro runtime | OK, notice |
| `boolbase` | 1.0.0 | ISC | transitive | build and test only | OK, build only |
| `browserslist` | 4.29.4 | MIT | transitive | pro runtime | OK, notice |
| `bytes` | 3.1.2 | MIT | transitive | pro runtime | OK, notice |
| `call-bind-apply-helpers` | 1.0.2 | MIT | transitive | pro runtime | OK, notice |
| `call-bound` | 1.0.4 | MIT | transitive | pro runtime | OK, notice |
| `caniuse-lite` | 1.0.30001817 | CC-BY-4.0 | transitive | pro runtime | Build only, data (finding 6) |
| `capnweb` | 0.12.0 | MIT | transitive | pro runtime | OK, notice |
| `ccount` | 2.0.1 | MIT | transitive | build and test only | OK, build only |
| `character-entities-html4` | 2.1.0 | MIT | transitive | build and test only | OK, build only |
| `character-entities-legacy` | 3.0.0 | MIT | transitive | build and test only | OK, build only |
| `chokidar` | 5.0.0 | MIT | transitive | build and test only | OK, build only |
| `ci-info` | 4.4.0 | MIT | transitive | build and test only | OK, build only |
| `cliui` | 9.0.1 | ISC | transitive | build and test only | OK, build only |
| `clsx` | 2.1.1 | MIT | transitive | build and test only | OK, build only |
| `comma-separated-tokens` | 2.0.3 | MIT | transitive | build and test only | OK, build only |
| `commander` | 11.1.0 | MIT | transitive | build and test only | OK, build only |
| `common-ancestor-path` | 2.0.0 | BlueOak-1.0.0 | transitive | build and test only | OK, build only |
| `content-disposition` | 2.0.1 | MIT | transitive | pro runtime | OK, notice |
| `content-type` | 1.0.5 | MIT | transitive | pro runtime | OK, notice |
| `content-type (nested)` | 2.1.0 | MIT | transitive | pro runtime | OK, notice |
| `content-type (nested)` | 2.1.0 | MIT | transitive | pro runtime | OK, notice |
| `content-type (nested)` | 2.1.0 | MIT | transitive | pro runtime | OK, notice |
| `content-type (nested)` | 2.1.0 | MIT | transitive | pro runtime | OK, notice |
| `convert-source-map` | 2.0.0 | MIT | transitive | pro runtime | OK, notice |
| `cookie` | 2.0.1 | MIT | transitive | build and test only | OK, build only |
| `cookie (nested)` | 0.7.2 | MIT | transitive | pro runtime | OK, notice |
| `cookie (nested)` | 1.1.1 | MIT | transitive | build and test only | OK, build only |
| `cookie-es` | 1.2.3 | MIT | transitive | build and test only | OK, build only |
| `cookie-signature` | 1.2.2 | MIT | transitive | pro runtime | OK, notice |
| `core-js-pure` | 3.51.0 | MIT | transitive | pro runtime | OK, notice |
| `cors` | 2.8.6 | MIT | transitive | pro runtime | OK, notice |
| `cron-schedule` | 6.0.0 | MIT | transitive | pro runtime | OK, notice |
| `cross-spawn` | 7.0.6 | MIT | transitive | pro runtime | OK, notice |
| `crossws` | 0.3.5 | MIT | transitive | build and test only | OK, build only |
| `css-select` | 6.0.0 | BSD-2-Clause | transitive | build and test only | OK, build only |
| `css-tree` | 3.2.1 | MIT | transitive | build and test only | OK, build only |
| `css-tree (nested)` | 2.2.1 | MIT | transitive | build and test only | OK, build only |
| `css-what` | 7.0.0 | BSD-2-Clause | transitive | build and test only | OK, build only |
| `csso` | 5.0.5 | MIT | transitive | build and test only | OK, build only |
| `d3-array` | 3.2.4 | ISC | direct | core runtime | OK, notice |
| `d3-color` | 3.1.0 | ISC | transitive | core runtime | OK, notice |
| `d3-dispatch` | 3.0.1 | ISC | transitive | core runtime | OK, notice |
| `d3-force` | 3.0.0 | ISC | direct | core runtime | OK, notice |
| `d3-format` | 3.1.2 | ISC | transitive | core runtime | OK, notice |
| `d3-interpolate` | 3.0.1 | ISC | transitive | core runtime | OK, notice |
| `d3-path` | 3.1.0 | ISC | transitive | core runtime | OK, notice |
| `d3-quadtree` | 3.0.1 | ISC | transitive | core runtime | OK, notice |
| `d3-scale` | 4.0.2 | ISC | direct | core runtime | OK, notice |
| `d3-shape` | 3.2.0 | ISC | direct | core runtime | OK, notice |
| `d3-time` | 3.1.0 | ISC | direct | core runtime | OK, notice |
| `d3-time-format` | 4.1.0 | ISC | direct | core runtime | OK, notice |
| `d3-timer` | 3.0.1 | ISC | transitive | core runtime | OK, notice |
| `debug` | 4.4.3 | MIT | transitive | pro runtime | OK, notice |
| `defu` | 6.1.7 | MIT | transitive | build and test only | OK, build only |
| `depd` | 2.0.0 | MIT | transitive | pro runtime | OK, notice |
| `dequal` | 2.0.3 | MIT | transitive | build and test only | OK, build only |
| `destr` | 2.0.5 | MIT | transitive | build and test only | OK, build only |
| `detect-libc` | 2.1.2 | Apache-2.0 | transitive | build and test only | OK, build only |
| `devalue` | 6.0.3 | MIT | transitive | build and test only | OK, build only |
| `devlop` | 1.1.0 | MIT | transitive | build and test only | OK, build only |
| `diff` | 9.0.0 | BSD-3-Clause | transitive | build and test only | OK, build only |
| `dom-serializer` | 2.0.0 | MIT | transitive | build and test only | OK, build only |
| `domelementtype` | 2.3.0 | BSD-2-Clause | transitive | build and test only | OK, build only |
| `domhandler` | 5.0.3 | BSD-2-Clause | transitive | build and test only | OK, build only |
| `domutils` | 3.2.2 | BSD-2-Clause | transitive | build and test only | OK, build only |
| `dset` | 3.1.4 | MIT | transitive | build and test only | OK, build only |
| `dunder-proto` | 1.0.1 | MIT | transitive | pro runtime | OK, notice |
| `ee-first` | 1.1.1 | MIT | transitive | pro runtime | OK, notice |
| `electron-to-chromium` | 1.5.461 | ISC | transitive | pro runtime | OK, notice |
| `emmet` | 2.4.11 | MIT | transitive | build and test only | OK, build only |
| `emoji-regex` | 10.6.0 | MIT | transitive | build and test only | OK, build only |
| `empathic` | 2.1.0 | MIT | transitive | pro runtime | OK, notice |
| `encodeurl` | 2.0.0 | MIT | transitive | pro runtime | OK, notice |
| `entities` | 4.5.0 | BSD-2-Clause | transitive | build and test only | OK, build only |
| `entities (nested)` | 8.1.0 | BSD-2-Clause | transitive | core runtime | OK, notice |
| `error-stack-parser-es` | 1.0.5 | MIT | transitive | build and test only | OK, build only |
| `es-define-property` | 1.0.1 | MIT | transitive | pro runtime | OK, notice |
| `es-errors` | 1.3.0 | MIT | transitive | pro runtime | OK, notice |
| `es-module-lexer` | 3.0.3 | MIT | transitive | build and test only | OK, build only |
| `es-object-atoms` | 1.1.2 | MIT | transitive | pro runtime | OK, notice |
| `esbuild` | 0.28.2 | MIT | transitive | pro runtime | OK, notice |
| `escalade` | 3.2.0 | MIT | transitive | pro runtime | OK, notice |
| `escape-html` | 1.0.3 | MIT | transitive | pro runtime | OK, notice |
| `etag` | 1.8.1 | MIT | transitive | pro runtime | OK, notice |
| `event-target-polyfill` | 0.0.4 | MIT | transitive | pro runtime | OK, notice |
| `eventemitter3` | 5.0.4 | MIT | transitive | build and test only | OK, build only |
| `eventsource` | 3.0.7 | MIT | transitive | pro runtime | OK, notice |
| `eventsource-parser` | 3.1.1 | MIT | transitive | pro runtime | OK, notice |
| `express` | 5.3.0 | MIT | transitive | pro runtime | OK, notice |
| `express-rate-limit` | 8.7.1 | MIT | transitive | pro runtime | OK, notice |
| `extend` | 3.0.2 | MIT | transitive | build and test only | OK, build only |
| `fast-deep-equal` | 3.1.3 | MIT | transitive | pro runtime | OK, notice |
| `fast-string-truncated-width` | 3.0.3 | MIT | transitive | build and test only | OK, build only |
| `fast-string-width` | 3.0.2 | MIT | transitive | build and test only | OK, build only |
| `fast-uri` | 3.1.8 | BSD-3-Clause | transitive | pro runtime | OK, notice |
| `fast-wrap-ansi` | 0.2.2 | MIT | transitive | build and test only | OK, build only |
| `fdir` | 6.5.0 | MIT | transitive | build and test only | OK, build only |
| `finalhandler` | 2.1.1 | MIT | transitive | pro runtime | OK, notice |
| `flattie` | 1.1.1 | MIT | transitive | build and test only | OK, build only |
| `flru` | 1.0.2 | MIT | transitive | pro runtime | OK, notice |
| `fnv1a-64` | 0.1.2 | MIT | transitive | build and test only | OK, build only |
| `fontace` | 0.4.1 | MIT | transitive | build and test only | OK, build only |
| `fontkitten` | 1.0.3 | MIT | transitive | build and test only | OK, build only |
| `fontverter` | 2.0.0 | BSD-3-Clause | transitive | build and test only | OK, build only |
| `forwarded` | 0.2.0 | MIT | transitive | pro runtime | OK, notice |
| `fresh` | 2.0.0 | MIT | transitive | pro runtime | OK, notice |
| `fsevents` | 2.3.3 | MIT | transitive, optional platform binary | build and test only | OK, build only |
| `function-bind` | 1.1.2 | MIT | transitive | pro runtime | OK, notice |
| `gensync` | 1.0.0-beta.2 | MIT | transitive | pro runtime | OK, notice |
| `get-caller-file` | 2.0.5 | ISC | transitive | build and test only | OK, build only |
| `get-east-asian-width` | 1.7.0 | MIT | transitive | build and test only | OK, build only |
| `get-intrinsic` | 1.3.0 | MIT | transitive | pro runtime | OK, notice |
| `get-proto` | 1.0.1 | MIT | transitive | pro runtime | OK, notice |
| `get-tsconfig` | 5.0.0-beta.6 | MIT | transitive | build and test only | OK, build only |
| `github-slugger` | 2.0.0 | ISC | transitive | build and test only | OK, build only |
| `gopd` | 1.2.0 | MIT | transitive | pro runtime | OK, notice |
| `h3` | 1.15.11 | MIT | transitive | build and test only | OK, build only |
| `harfbuzzjs` | 1.6.2 | MIT | transitive | build and test only | OK, build only |
| `has-symbols` | 1.1.0 | MIT | transitive | pro runtime | OK, notice |
| `hasown` | 2.0.4 | MIT | transitive | pro runtime | OK, notice |
| `hast-util-to-html` | 9.0.5 | MIT | transitive | build and test only | OK, build only |
| `hast-util-whitespace` | 3.0.0 | MIT | transitive | build and test only | OK, build only |
| `hono` | 4.13.13 | MIT | transitive | pro runtime | OK, notice |
| `html-escaper` | 3.0.3 | MIT | transitive | build and test only | OK, build only |
| `html-void-elements` | 3.0.0 | MIT | transitive | build and test only | OK, build only |
| `http-cache-semantics` | 4.3.0 | BSD-2-Clause | transitive | build and test only | OK, build only |
| `http-errors` | 2.0.1 | MIT | transitive | pro runtime | OK, notice |
| `iconv-lite` | 0.7.3 | MIT | transitive | pro runtime | OK, notice |
| `import-meta-resolve` | 4.2.0 | MIT | transitive | pro runtime | OK, notice |
| `inherits` | 2.0.4 | ISC | transitive | pro runtime | OK, notice |
| `internmap` | 2.0.3 | ISC | transitive | core runtime | OK, notice |
| `ip-address` | 10.7.4 | MIT | transitive | pro runtime | OK, notice |
| `ipaddr.js` | 1.9.1 | MIT | transitive | pro runtime | OK, notice |
| `iron-webcrypto` | 1.2.1 | MIT | transitive | build and test only | OK, build only |
| `is-docker` | 4.0.0 | MIT | transitive | build and test only | OK, build only |
| `is-plain-obj` | 4.1.0 | MIT | transitive | build and test only | OK, build only |
| `is-promise` | 4.0.0 | MIT | transitive | pro runtime | OK, notice |
| `isexe` | 2.0.0 | ISC | transitive | pro runtime | OK, notice |
| `jose` | 6.2.13 | MIT | direct | core runtime | OK, notice |
| `js-base64` | 3.9.4 | BSD-3-Clause | transitive | pro runtime | OK, notice |
| `js-tokens` | 10.0.0 | MIT | transitive | pro runtime | OK, notice |
| `jsesc` | 3.1.0 | MIT | transitive | pro runtime | OK, notice |
| `json-schema` | 0.4.0 | (AFL-2.1 OR BSD-3-Clause) | transitive | pro runtime | OK, elect BSD-3-Clause (finding 10) |
| `json-schema-traverse` | 1.0.0 | MIT | transitive | pro runtime | OK, notice |
| `json-schema-typed` | 8.0.2 | BSD-2-Clause | transitive | pro runtime | OK, notice |
| `json5` | 2.2.3 | MIT | transitive | pro runtime | OK, notice |
| `jsonc-parser` | 3.3.1 | MIT | transitive | build and test only | OK, build only |
| `jsonc-parser (nested)` | 2.3.1 | MIT | transitive | build and test only | OK, build only |
| `kleur` | 4.1.5 | MIT | transitive | build and test only | OK, build only |
| `lightningcss` | 1.33.0 | MPL-2.0 | transitive | build and test only | Build only (finding 5) |
| `lightningcss-android-arm64` | 1.33.0 | MPL-2.0 | transitive, optional platform binary | build and test only | Build only (finding 5) |
| `lightningcss-darwin-arm64` | 1.33.0 | MPL-2.0 | transitive, optional platform binary | build and test only | Build only (finding 5) |
| `lightningcss-darwin-x64` | 1.33.0 | MPL-2.0 | transitive, optional platform binary | build and test only | Build only (finding 5) |
| `lightningcss-freebsd-x64` | 1.33.0 | MPL-2.0 | transitive, optional platform binary | build and test only | Build only (finding 5) |
| `lightningcss-linux-arm-gnueabihf` | 1.33.0 | MPL-2.0 | transitive, optional platform binary | build and test only | Build only (finding 5) |
| `lightningcss-linux-arm64-gnu` | 1.33.0 | MPL-2.0 | transitive, optional platform binary | build and test only | Build only (finding 5) |
| `lightningcss-linux-arm64-musl` | 1.33.0 | MPL-2.0 | transitive, optional platform binary | build and test only | Build only (finding 5) |
| `lightningcss-linux-x64-gnu` | 1.33.0 | MPL-2.0 | transitive, optional platform binary | build and test only | Build only (finding 5) |
| `lightningcss-linux-x64-musl` | 1.33.0 | MPL-2.0 | transitive, optional platform binary | build and test only | Build only (finding 5) |
| `lightningcss-win32-arm64-msvc` | 1.33.0 | MPL-2.0 | transitive, optional platform binary | build and test only | Build only (finding 5) |
| `lightningcss-win32-x64-msvc` | 1.33.0 | MPL-2.0 | transitive, optional platform binary | build and test only | Build only (finding 5) |
| `linkify-it` | 6.1.0 | MIT | transitive | core runtime | OK, notice |
| `lru-cache` | 11.5.3 | BlueOak-1.0.0 | transitive | build and test only | OK, build only |
| `magic-string` | 1.4.3 | MIT | transitive | build and test only | OK, build only |
| `magicast` | 0.5.5 | MIT | transitive | build and test only | OK, build only |
| `markdown-it` | 15.0.3 | MIT | direct | core runtime | OK, notice |
| `math-intrinsics` | 1.1.0 | MIT | transitive | pro runtime | OK, notice |
| `mdast-util-to-hast` | 13.2.1 | MIT | transitive | build and test only | OK, build only |
| `mdn-data` | 2.27.1 | CC0-1.0 | transitive | build and test only | Build only, data (finding 6) |
| `mdn-data (nested)` | 2.0.28 | CC0-1.0 | transitive | build and test only | Build only, data (finding 6) |
| `mdurl` | 2.1.0 | MIT | transitive | core runtime | OK, notice |
| `media-typer` | 1.1.1 | MIT | transitive | pro runtime | OK, notice |
| `merge-descriptors` | 2.0.0 | MIT | transitive | pro runtime | OK, notice |
| `micromark-util-character` | 2.1.1 | MIT | transitive | build and test only | OK, build only |
| `micromark-util-encode` | 2.0.1 | MIT | transitive | build and test only | OK, build only |
| `micromark-util-sanitize-uri` | 2.0.1 | MIT | transitive | build and test only | OK, build only |
| `micromark-util-symbol` | 2.0.1 | MIT | transitive | build and test only | OK, build only |
| `micromark-util-types` | 2.0.3 | MIT | transitive | build and test only | OK, build only |
| `mime-db` | 1.54.0 | MIT | transitive | pro runtime | OK, notice |
| `mime-db (nested)` | 1.52.0 | MIT | transitive | pro runtime | OK, notice |
| `mime-types` | 3.0.2 | MIT | transitive | pro runtime | OK, notice |
| `mime-types (nested)` | 2.1.35 | MIT | transitive | pro runtime | OK, notice |
| `mimetext` | 3.0.28 | MIT | transitive | pro runtime | OK, notice |
| `miniflare` | 5.20261019.2-beta | MIT | transitive | build and test only | OK, build only |
| `mrmime` | 2.0.1 | MIT | transitive | build and test only | OK, build only |
| `ms` | 2.1.3 | MIT | transitive | pro runtime | OK, notice |
| `muggle-string` | 0.4.1 | MIT | transitive | build and test only | OK, build only |
| `nanoid` | 3.3.20 | MIT | transitive | build and test only | OK, build only |
| `nanoid (nested)` | 5.1.16 | MIT | transitive | pro runtime | OK, notice |
| `nanoid (nested)` | 5.1.16 | MIT | transitive | pro runtime | OK, notice |
| `negotiator` | 1.1.0 | MIT | transitive | pro runtime | OK, notice |
| `neotraverse` | 1.0.1 | MIT | transitive | build and test only | OK, build only |
| `nlcst-to-string` | 4.0.0 | MIT | transitive | build and test only | OK, build only |
| `node-fetch-native` | 1.6.7 | MIT | transitive | build and test only | OK, build only |
| `node-mock-http` | 1.0.5 | MIT | transitive | build and test only | OK, build only |
| `node-releases` | 2.0.59 | MIT | transitive | pro runtime | OK, notice |
| `normalize-path` | 3.0.0 | MIT | transitive | build and test only | OK, build only |
| `nth-check` | 2.1.1 | BSD-2-Clause | transitive | build and test only | OK, build only |
| `object-assign` | 4.1.1 | MIT | transitive | pro runtime | OK, notice |
| `object-inspect` | 1.13.4 | MIT | transitive | pro runtime | OK, notice |
| `obug` | 3.0.0 | MIT | transitive | pro runtime | OK, notice |
| `ofetch` | 1.5.1 | MIT | transitive | build and test only | OK, build only |
| `on-finished` | 2.4.1 | MIT | transitive | pro runtime | OK, notice |
| `once` | 1.4.0 | ISC | transitive | pro runtime | OK, notice |
| `oniguruma-parser` | 0.12.2 | MIT | transitive | build and test only | OK, build only |
| `oniguruma-to-es` | 4.3.6 | MIT | transitive | build and test only | OK, build only |
| `p-limit` | 7.3.3 | MIT | transitive | build and test only | OK, build only |
| `p-limit (nested)` | 3.1.0 | MIT | transitive | build and test only | OK, build only |
| `p-queue` | 9.3.5 | MIT | transitive | build and test only | OK, build only |
| `p-timeout` | 7.0.2 | MIT | transitive | build and test only | OK, build only |
| `package-manager-detector` | 1.9.0 | MIT | transitive | build and test only | OK, build only |
| `pako` | 1.0.11 | (MIT AND Zlib) | transitive | build and test only | OK, build only |
| `parseurl` | 1.3.3 | MIT | transitive | pro runtime | OK, notice |
| `partysocket` | 1.3.0 | MIT | transitive | pro runtime | OK, notice |
| `path-browserify` | 1.0.1 | MIT | transitive | build and test only | OK, build only |
| `path-key` | 3.1.1 | MIT | transitive | pro runtime | OK, notice |
| `path-to-regexp` | 6.3.0 | MIT | transitive | build and test only | OK, build only |
| `path-to-regexp (nested)` | 8.4.2 | MIT | transitive | pro runtime | OK, notice |
| `pathe` | 2.0.3 | MIT | transitive | build and test only | OK, build only |
| `pdfjs-dist` | 6.4.299 | Apache-2.0 | direct | core runtime | Flag: carries GPL-2.0 Liberation fonts (finding 1) |
| `piccolore` | 0.1.3 | ISC | transitive | build and test only | OK, build only |
| `picocolors` | 1.1.1 | ISC | transitive | pro runtime | OK, notice |
| `picomatch` | 4.0.7 | MIT | transitive | pro runtime | OK, notice |
| `picomatch (nested)` | 2.3.2 | MIT | transitive | build and test only | OK, build only |
| `pkce-challenge` | 5.0.1 | MIT | transitive | pro runtime | OK, notice |
| `postal-mime` | 2.7.6 | MIT-0 | transitive | pro runtime | OK, notice |
| `postcss` | 8.5.32 | MIT | transitive | build and test only | OK, build only |
| `prettier` | 3.9.10 | MIT | transitive | build and test only | OK, build only |
| `prismjs` | 1.30.0 | MIT | transitive | build and test only | OK, build only |
| `process-ancestry` | 0.1.0 | MIT | transitive | build and test only | OK, build only |
| `property-information` | 7.2.0 | MIT | transitive | build and test only | OK, build only |
| `proxy-addr` | 2.0.8 | MIT | transitive | pro runtime | OK, notice |
| `punycode.js` | 2.3.1 | MIT | transitive | core runtime | OK, notice |
| `qs` | 6.16.1 | BSD-3-Clause | transitive | pro runtime | OK, notice |
| `radix3` | 1.1.2 | MIT | transitive | build and test only | OK, build only |
| `range-parser` | 1.3.0 | MIT | transitive | pro runtime | OK, notice |
| `raw-body` | 3.0.2 | MIT | transitive | pro runtime | OK, notice |
| `readdirp` | 5.1.1 | MIT | transitive | build and test only | OK, build only |
| `regex` | 6.1.0 | MIT | transitive | build and test only | OK, build only |
| `regex-recursion` | 6.0.2 | MIT | transitive | build and test only | OK, build only |
| `regex-utilities` | 2.3.0 | MIT | transitive | build and test only | OK, build only |
| `request-light` | 0.7.0 | MIT | transitive | build and test only | OK, build only |
| `request-light (nested)` | 0.5.8 | MIT | transitive | build and test only | OK, build only |
| `require-from-string` | 2.0.2 | MIT | transitive | pro runtime | OK, notice |
| `resolve-pkg-maps` | 1.0.0 | MIT | transitive | build and test only | OK, build only |
| `retext-smartypants` | 6.2.0 | MIT | transitive | build and test only | OK, build only |
| `rolldown` | 1.2.16 | MIT | transitive | pro runtime | OK, notice |
| `router` | 2.2.0 | MIT | transitive | pro runtime | OK, notice |
| `safer-buffer` | 2.1.2 | MIT | transitive | pro runtime | OK, notice |
| `satteri` | 0.10.5 | MIT | transitive | build and test only | OK, build only |
| `sax` | 1.6.1 | BlueOak-1.0.0 | transitive | build and test only | OK, build only |
| `semver` | 7.8.5 | ISC | transitive | build and test only | OK, build only |
| `send` | 1.2.1 | MIT | transitive | pro runtime | OK, notice |
| `serve-static` | 2.2.1 | MIT | transitive | pro runtime | OK, notice |
| `setprototypeof` | 1.2.0 | ISC | transitive | pro runtime | OK, notice |
| `sharp` | 0.35.5 | Apache-2.0 | transitive | build and test only | OK, build only |
| `shebang-command` | 2.0.0 | MIT | transitive | pro runtime | OK, notice |
| `shebang-regex` | 3.0.0 | MIT | transitive | pro runtime | OK, notice |
| `shiki` | 4.5.0 | MIT | transitive | build and test only | OK, build only |
| `side-channel` | 1.1.1 | MIT | transitive | pro runtime | OK, notice |
| `side-channel-list` | 1.0.1 | MIT | transitive | pro runtime | OK, notice |
| `side-channel-map` | 1.0.1 | MIT | transitive | pro runtime | OK, notice |
| `side-channel-weakmap` | 1.0.2 | MIT | transitive | pro runtime | OK, notice |
| `sisteransi` | 1.0.5 | MIT | transitive | build and test only | OK, build only |
| `smol-toml` | 1.9.1 | BSD-3-Clause | transitive | build and test only | OK, build only |
| `source-map-js` | 1.2.2 | BSD-3-Clause | transitive | build and test only | OK, build only |
| `space-separated-tokens` | 2.0.2 | MIT | transitive | build and test only | OK, build only |
| `statuses` | 2.0.2 | MIT | transitive | pro runtime | OK, notice |
| `std-env` | 4.3.0 | MIT | transitive | build and test only | OK, build only |
| `string-width` | 8.3.0 | MIT | transitive | build and test only | OK, build only |
| `string-width (nested)` | 7.2.0 | MIT | transitive | build and test only | OK, build only |
| `string-width (nested)` | 7.2.0 | MIT | transitive | build and test only | OK, build only |
| `stringify-entities` | 4.0.4 | MIT | transitive | build and test only | OK, build only |
| `strip-ansi` | 7.2.0 | MIT | transitive | build and test only | OK, build only |
| `subset-font` | 2.9.0 | BSD-3-Clause | direct dev | build and test only | OK, build only |
| `supports-color` | 10.2.2 | MIT | transitive | build and test only | OK, build only |
| `svgo` | 4.1.0 | MIT | transitive | build and test only | OK, build only |
| `tiny-inflate` | 1.0.3 | MIT | transitive | build and test only | OK, build only |
| `tinyclip` | 1.0.3 | MIT | transitive | build and test only | OK, build only |
| `tinyexec` | 1.3.1 | MIT | transitive | build and test only | OK, build only |
| `tinyglobby` | 0.2.17 | MIT | transitive | build and test only | OK, build only |
| `tinyps` | 0.5.1 | MIT | transitive | build and test only | OK, build only |
| `toidentifier` | 1.0.1 | MIT | transitive | pro runtime | OK, notice |
| `trim-lines` | 3.0.1 | MIT | transitive | build and test only | OK, build only |
| `trough` | 2.2.0 | MIT | transitive | build and test only | OK, build only |
| `tslib` | 2.8.1 | 0BSD | transitive | build and test only | OK, build only |
| `type-is` | 2.1.0 | MIT | transitive | pro runtime | OK, notice |
| `typesafe-path` | 0.2.2 | MIT | transitive | build and test only | OK, build only |
| `typescript` | 6.0.3 | Apache-2.0 | direct dev | build and test only | OK, build only |
| `typescript-auto-import-cache` | 0.3.6 | MIT | transitive | build and test only | OK, build only |
| `uc.micro` | 3.0.0 | MIT | transitive | core runtime | OK, notice |
| `ufo` | 1.6.4 | MIT | transitive | build and test only | OK, build only |
| `ultrahtml` | 1.7.0 | MIT | transitive | build and test only | OK, build only |
| `uncrypto` | 0.1.3 | MIT | transitive | build and test only | OK, build only |
| `undici` | 8.12.3 | MIT | transitive | build and test only | OK, build only |
| `undici (nested)` | 7.29.1 | MIT | transitive | build and test only | OK, build only |
| `undici (nested)` | 7.30.1 | MIT | transitive | pro runtime | OK, notice |
| `undici-types` | 8.9.0 | MIT | transitive | build and test only | OK, build only |
| `unenv` | 2.0.0-rc.24 | MIT | transitive | build and test only | OK, build only |
| `unified` | 11.0.5 | MIT | transitive | build and test only | OK, build only |
| `unifont` | 1.0.3 | MIT | transitive | build and test only | OK, build only |
| `unist-util-is` | 6.0.1 | MIT | transitive | build and test only | OK, build only |
| `unist-util-position` | 5.0.0 | MIT | transitive | build and test only | OK, build only |
| `unist-util-stringify-position` | 4.0.0 | MIT | transitive | build and test only | OK, build only |
| `unist-util-visit` | 5.1.0 | MIT | transitive | build and test only | OK, build only |
| `unist-util-visit-parents` | 6.0.2 | MIT | transitive | build and test only | OK, build only |
| `unpipe` | 1.0.0 | MIT | transitive | pro runtime | OK, notice |
| `unstorage` | 1.17.5 | MIT | transitive | build and test only | OK, build only |
| `update-browserslist-db` | 1.3.4 | MIT | transitive | pro runtime | OK, notice |
| `vary` | 1.1.2 | MIT | transitive | pro runtime | OK, notice |
| `verkit` | 0.5.0 | MIT | transitive | pro runtime | OK, notice |
| `vfile` | 6.0.3 | MIT | transitive | build and test only | OK, build only |
| `vfile-message` | 4.0.3 | MIT | transitive | build and test only | OK, build only |
| `vite` | 8.3.5 | MIT | transitive | build and test only | OK, build only |
| `vitefu` | 1.1.3 | MIT | transitive | build and test only | OK, build only |
| `volar-service-css` | 0.0.71 | MIT | transitive | build and test only | OK, build only |
| `volar-service-emmet` | 0.0.71 | MIT | transitive | build and test only | OK, build only |
| `volar-service-html` | 0.0.71 | MIT | transitive | build and test only | OK, build only |
| `volar-service-prettier` | 0.0.71 | MIT | transitive | build and test only | OK, build only |
| `volar-service-typescript` | 0.0.71 | MIT | transitive | build and test only | OK, build only |
| `volar-service-typescript-twoslash-queries` | 0.0.71 | MIT | transitive | build and test only | OK, build only |
| `volar-service-yaml` | 0.0.71 | MIT | transitive | build and test only | OK, build only |
| `vscode-css-languageservice` | 6.3.10 | MIT | transitive | build and test only | OK, build only |
| `vscode-html-languageservice` | 5.6.2 | MIT | transitive | build and test only | OK, build only |
| `vscode-json-languageservice` | 4.1.8 | MIT | transitive | build and test only | OK, build only |
| `vscode-jsonrpc` | 10.0.0 | MIT | transitive | build and test only | OK, build only |
| `vscode-jsonrpc (nested)` | 8.2.0 | MIT | transitive | build and test only | OK, build only |
| `vscode-languageserver` | 9.0.1 | MIT | transitive | build and test only | OK, build only |
| `vscode-languageserver-protocol` | 3.18.5 | MIT | transitive | build and test only | OK, build only |
| `vscode-languageserver-protocol (nested)` | 3.17.5 | MIT | transitive | build and test only | OK, build only |
| `vscode-languageserver-textdocument` | 1.0.16 | MIT | transitive | build and test only | OK, build only |
| `vscode-languageserver-types` | 3.18.5 | MIT | transitive | build and test only | OK, build only |
| `vscode-languageserver-types (nested)` | 3.17.5 | MIT | transitive | build and test only | OK, build only |
| `vscode-languageserver-types (nested)` | 3.17.5 | MIT | transitive | build and test only | OK, build only |
| `vscode-nls` | 5.2.0 | MIT | transitive | build and test only | OK, build only |
| `vscode-uri` | 3.2.0 | MIT | transitive | build and test only | OK, build only |
| `wawoff2` | 2.0.1 | MIT | transitive | build and test only | OK, build only |
| `which` | 2.0.2 | ISC | transitive | pro runtime | OK, notice |
| `woff2sfnt-sfnt2woff` | 1.0.0 | MIT | transitive | build and test only | OK, build only |
| `workerd` | 1.20261019.1 | Apache-2.0 | transitive | build and test only | OK, build only |
| `workers-ai-provider` | 4.0.1 | MIT | direct | pro runtime | OK, MIT; deprecated (finding 9) |
| `wrangler` | 4.152.0 | MIT OR Apache-2.0 | direct dev | build and test only | OK, build only |
| `wrap-ansi` | 9.0.2 | MIT | transitive | build and test only | OK, build only |
| `wrappy` | 1.0.2 | ISC | transitive | pro runtime | OK, notice |
| `ws` | 8.21.0 | MIT | transitive | build and test only | OK, build only |
| `xxhash-wasm` | 1.1.0 | MIT | transitive | build and test only | OK, build only |
| `y18n` | 5.0.8 | ISC | transitive | build and test only | OK, build only |
| `yaml` | 2.9.1 | ISC | transitive | pro runtime | OK, notice |
| `yaml (nested)` | 2.8.3 | ISC | transitive | build and test only | OK, build only |
| `yaml-language-server` | 1.23.0 | MIT | transitive | build and test only | OK, build only |
| `yargs` | 18.2.0 | MIT | transitive | build and test only | OK, build only |
| `yargs-parser` | 22.0.0 | ISC | transitive | build and test only | OK, build only |
| `yocto-queue` | 1.2.2 | MIT | transitive | build and test only | OK, build only |
| `yocto-queue (nested)` | 0.1.0 | MIT | transitive | build and test only | OK, build only |
| `youch` | 4.1.0-beta.10 | MIT | transitive | build and test only | OK, build only |
| `youch-core` | 0.3.3 | MIT | transitive | build and test only | OK, build only |
| `zod` | 4.6.7 | MIT | direct | core runtime | OK, notice |
| `zod-to-json-schema` | 3.25.2 | ISC | transitive | pro runtime | OK, notice |
| `zwitch` | 2.0.4 | MIT | transitive | build and test only | OK, build only |

</details>
