# Legallas Chambers: the counsel room design system

This file is the binding design spec for `web/`. Build from it; when it and a mockup disagree, this file wins
and the mockup gets fixed. Token and class names here are final.

- **Mockups:** `web/design/<page>/*-light.png` (card D4). A page's mockup is that page card's spec. The dark
  renders were deleted with the dark theme (git history keeps them). The mockups predate the three-track refocus
  (2026-10-02): the track pages, the campaign map, the guide band and the Structure view have none, and where an
  older mockup and this file disagree on them, this file is the spec.
- **Examples** use the fictional matter *Doe v. Harbor Labs, Inc.* and the control prefix `DOE-`. Never a real
  matter name, party or fact.

## 1. Where things live

| File | Owner | Holds |
|---|---|---|
| `src/styles/tokens.css` | F1 | Every custom property in sections 2 to 5 and the font imports |
| `src/styles/components.css` | F1 | Every `c-*` block in section 7, the `u-*` utilities and `t-*` type classes |
| `src/styles/room.css` | F1 | Base element styles and the page frame |
| `src/styles/print.css` | F1 | Print: light values, no nav, cites printed as text |
| Page CSS (`documents.css`, `chat.css`, ...) | each P card | Page-scoped classes only, built from tokens; never a literal color |

Rules for every stylesheet: no literal colors outside `tokens.css`; no `style=` attributes (CSP); dynamic sizes go
through `el.style.setProperty('--x', value)`; SVG takes classes and presentation attributes.

## 2. Color tokens

**Light only (the owner, 2026-10-02, ruling R67).** The room has no dark theme: values are declared once on `:root`,
`color-scheme` is `light`, there is one `theme-color`, and `scripts/light-only.test.ts` fails on any file that opts
into a dark scheme. The dark values this table once carried are retired; never add a dark variant, a
`prefers-color-scheme: dark` rule or a theme switch. Screenshots and mockup reviews are light only.

Every text pair below meets 4.5:1 and every non-text mark 3:1 on `--paper`, `--panel` and `--surface` (checked
2026-10-01). Tightest pairs: `--ink-3` on `--panel` 4.55:1, `--graphite` on `--panel` 4.56:1, `--brass-text` on
`--forest-tint` 4.77:1.

| Property | Value | Use |
|---|---|---|
| `--paper` | `#FAF7F0` | Page ground (`body` background) |
| `--panel` | `#F2EDE2` | Recessed: table header row, sidebars, pane frame, drawer foot |
| `--surface` | `#FFFDF8` | Raised: tables, tiles, header bar, drawer and pane bodies |
| `--ink` | `#1A1F1C` | Primary text and headings |
| `--ink-2` | `#4A524D` | Secondary text: metadata, table cells after the first, actors |
| `--ink-3` | `#666D68` | Captions, timestamps, the provenance line; never under 12px |
| `--forest` | `#1F3A2E` | Brand ink: links, active nav, primary button, cite chips, proof rings |
| `--forest-hover` | `#2E5A45` | Hover and pressed state of anything in forest |
| `--forest-tint` | `#E3EBE5` | Selected row, active nav ground, cite chip ground, passage highlight |
| `--on-forest` | `var(--paper)` | Text and icons on a forest fill (11.5:1) |
| `--brass-rule` | `#A98B4F` | Decorative hairlines only (case header rule). Never a control border |
| `--brass-mark` | `#8C7140` | Non-text marks: the seal, the Key badge |
| `--brass-text` | `#7A6232` | Key chip label, data-room index numbers |
| `--oxblood` | `#6B1E23` | Privileged and adverse only: privilege chip, "Not in the record" |
| `--oxblood-tint` | `#F3E4E2` | Ground of the privilege chip and the "Not in the record" callout |
| `--rule` | `#D9CFBB` | Decorative 1px separators. Never the only edge of a control |
| `--border` | `#8A8272` | Control borders: inputs, buttons, chips, the drawer edge |
| `--focus` | `#1F5FA8` | Focus ring: `outline: 2px solid var(--focus); outline-offset: 2px` |
| `--slate` | `#4B5D6B` | Company and nominal-party text labels |
| `--graphite` | `#6B6B6B` | Court text labels |

`<meta name="theme-color">`: `#1F3A2E`, one value with no `media` query.

**Game-layer grounds** (section 7; 2026-10-02):

| Property | Value | Use |
|---|---|---|
| `--hex-texture` | a 28 by 48px honeycomb as an SVG data URI, `--rule` lines at 45% opacity (about 4% visual weight) | The Overview header (campaign map) only, as `background-image` |
| `--fog-haze` | `--panel` fading to a `--panel`/`--surface` mix | Gap rows in the proof checklist (`c-fog`); never darker than `--panel`, so text pairs that pass there pass here |

A data URI cannot read a custom property, so `--hex-texture` repeats the `--rule` literal: change both together. In
forced colors `--hex-texture` is `none`.

**Oxblood is reserved.** It marks privileged documents, adverse items and the "Not in the record" callout. Form
errors use `--ink` text with a `--oxblood` 1px edge and an icon, never an oxblood fill.

## 3. Encoding: parties, events, proof

Shape always backs color, everywhere: chronology lanes, the people graph, chips, the claims grid and the
re-themed binder. Text beside a mark stays in `--ink`; text never wears an `--enc-*` color.
`data-side` values are exactly the `SIDES` in `worker/matter-types.ts`: client, defendant, nominal, court, third.

| Party or event | `data-side` | Mark color | Text label color | Shape |
|---|---|---|---|---|
| Client side | `client` | `--enc-client` | `--forest` | circle |
| Defendants | `defendant` | `--enc-defendant` | `--oxblood` | diamond |
| Company and nominal parties | `nominal` | `--enc-company` | `--slate` | hexagon |
| Court | `court` | `--enc-court` | `--graphite` | square |
| Third parties | `third` | `--enc-third` | `--brass-text` | triangle |
| Filing or order (an event) | `filing` | `--enc-filing` stroke, no fill | none | square outline |

| Property | Value |
|---|---|
| `--enc-client` | `#3B9874` |
| `--enc-defendant` | `#813537` |
| `--enc-company` | `#045B8A` |
| `--enc-third` | `#8D6813` |
| `--enc-court` | `var(--graphite)` |
| `--enc-filing` | `var(--ink-2)` |

**Why marks have their own tokens.** The interface inks (`--forest`, `--oxblood`, `--slate`, `--brass-mark`) fail
the dataviz palette validator as chart fills: forest and oxblood collapse under protanopia (Delta E 2.9) and
three of them read as gray (OKLCH chroma under 0.10). The `--enc-*` steps keep the same hue families and pass
every check, all pairs, on all three grounds: lightness band, chroma 0.10 or more, CVD Delta E 10.6 (target 8),
normal-vision Delta E 15.1 (floor 15), contrast 3.03:1 or more.
Court is a neutral outside the palette; the square carries it.

**Canonical shapes** (16 by 16 viewBox; scale the viewBox, never the path):

| Side | SVG |
|---|---|
| client | `<circle cx="8" cy="8" r="6"/>` |
| defendant | `<path d="M8 1.5 14.5 8 8 14.5 1.5 8Z"/>` |
| company | `<path d="M8 1.5 13.6 4.75v6.5L8 14.5 2.4 11.25v-6.5Z"/>` |
| court | `<rect x="2.5" y="2.5" width="11" height="11"/>` |
| third | `<path d="M8 2 14.5 13.5h-13Z"/>` |
| filing | `<rect x="2.75" y="2.75" width="10.5" height="10.5"/>` (stroke 1.5, no fill) |

Give each `class="c-shape" data-side="<side>"`. In graphs, overlapping marks get a 2px `--paper` ring
(`stroke: var(--paper); stroke-width: 2; paint-order: stroke`).

**Proof strength** (24 by 24 viewBox, rings 1.5px stroke in `--forest`, `data-strength` on the cell):

| `data-strength` | Mark | SVG |
|---|---|---|
| `direct` | bullseye | rings `r="10"` and `r="6"`, filled core `r="2.5"` |
| `corroborating` | two rings | rings `r="10"` and `r="6"` |
| `circumstantial` | one ring | ring `r="10"` |
| `gap` | dashed ring, `--ink-3` | ring `r="10"`, `stroke-dasharray: 2.5 2.5` |

Never encode strength as red to green or as a number. Grids repeat the strongest strength as a word.

**Violation marks** (`c-mark[data-mark]`, 2026-10-02). Each violation in the manifest carries a `mark`, one capital
letter. The badge is that letter plus a shape, never color alone: every mark has the same `--forest` ground and
`--on-forest` letter, so the letter and the outline do all the telling. The letter is the element's text (it reads
aloud and prints); the shape is a `clip-path`.

| `data-mark` | Shape |
|---|---|
| `A` | shield (point down) |
| `B` | octagon |
| `C` | pennant (notched on the right) |
| any other letter | tab (top left corner cut) |

The shapes are kept clear of the party shapes above (circle, diamond, hexagon, square, triangle), so a mark is
never read as a side. Sizes: 24px, or 36px with `c-mark--large` (objective cards). In forced colors the ground is
`CanvasText` and the letter `Canvas`.

## 4. Type

Self-hosted with `@fontsource` (no remote fonts; CSP `font-src 'self'`):

```css
@import '@fontsource-variable/source-serif-4/wght.css';
@import '@fontsource-variable/inter/wght.css';
@import '@fontsource/ibm-plex-mono/400.css';
@import '@fontsource/ibm-plex-mono/500.css';
```

| Serif file | Latin woff2 | |
|---|---|---|
| `wght` | 50,936 bytes | Used: every page loads it before its first paint |
| `opsz` (weight and optical size) | 122,360 bytes | Not used: 71 KB more for optical sizing |

| Property | Value |
|---|---|
| `--font-serif` | `'Source Serif 4 Variable', 'Source Serif 4', Georgia, 'Times New Roman', serif` |
| `--font-sans` | `'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif` |
| `--font-mono` | `'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace` |

Serif: headings, the case caption, prose and Ask answers. Sans: the interface. Mono: control numbers, ISO dates in
tables and axes, page counts, cite chips.

**Scale** (only these sizes): `--text-12` 0.75rem, `--text-13` 0.8125rem, `--text-14` 0.875rem, `--text-16` 1rem,
`--text-18` 1.125rem, `--text-21` 1.3125rem, `--text-26` 1.625rem, `--text-34` 2.125rem, `--text-44` 2.75rem.

**Roles** (classes in `components.css`; elements may take the same values directly):

| Class | Family | Size / line height | Weight | Use |
|---|---|---|---|---|
| `.t-display` | serif | 44 / 48 | 600 | The case caption on the Overview only |
| `.t-h1` | serif | 34 / 40 | 600 | Page title (`h1`) |
| `.t-h2` | serif | 26 / 32 | 600 | Section heading |
| `.t-h3` | serif | 21 / 28 | 600 | Subsection; drawer, pane and profile titles |
| `.t-lead` | serif | 18 / 28 | 400 | Lead paragraph, Ask answers |
| `.t-prose` | serif | 16 / 26 | 400 | Running prose, max `--measure` |
| `.t-ui` | sans | 14 / 20 | 400 | Default interface text (the `body` default) |
| `.t-ui-strong` | sans | 14 / 20 | 600 | Column headers, active nav, primary button |
| `.t-small` | sans | 13 / 18 | 400 | Secondary interface text, chip labels |
| `.t-caption` | sans | 12 / 16 | 400 | Captions, footnotes, provenance |
| `.t-label` | sans | 13 / 18 | 600 | Section labels: `font-variant-caps: all-small-caps; letter-spacing: 0.04em` |
| `.t-stat` | sans | 34 / 36 | 600 | Stat tile figure |
| `.t-mono` | mono | 13 / 18 | 400 | Control numbers, ISO dates, page counts |
| `.t-cite` | mono | 12 / 16 | 500 | Cite chips |

Headings use `text-wrap: balance`. Digits in columns use `font-variant-numeric: tabular-nums`. Labels are written
in sentence case; the small caps do the rest (never `text-transform: uppercase`).

## 5. Space, shape, layout, motion

| Property | Value | Use |
|---|---|---|
| `--space-1` .. `--space-8` | 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4rem | 4, 8, 12, 16, 24, 32, 48, 64px |
| `--radius` | 4px | Buttons, inputs, tiles, the pane, the drawer |
| `--radius-chip` | 2px | Chips and cite chips |
| `--hairline` | 1px | Every rule and border |
| `--shadow-overlay` | `0 1px 2px rgb(26 31 28 / 0.08), 0 8px 24px rgb(26 31 28 / 0.14)` | Drawer, menus, the exhibit sheet. Nothing else casts a shadow |
| `--page-max` | 80rem | 12-column grid max width |
| `--gutter` | `--space-5` (24px); `--space-4` below 48rem | Grid gutter and page side padding |
| `--measure` | 66ch | Prose line length |
| `--row-h` | 36px | Table row height |
| `--target-min` | 24px | Minimum hit target, both dimensions |
| `--ease` | `cubic-bezier(0.2, 0, 0, 1)` | All transitions |
| `--dur-1` / `--dur-2` | 120ms / 200ms | Hover and state / panels opening |
| `--z-header` / `--z-pane` / `--z-drawer` / `--z-toast` | 10 / 30 / 40 / 50 | Stacking; the header lifts to `--z-pane` + 1 while its Account menu is open, except under the exhibit sheet |

**Breakpoints** (media queries cannot read custom properties; use these literals): `48rem` (nav wraps, gutter
drops to 16px), `64rem` (split view and the drawer become a full-screen sheet below it), `68rem` (the header is one
line above it; from 48rem to 68rem its tools take their own line), `80rem` (page max).

Motion runs only under `@media (prefers-reduced-motion: no-preference)` and only answers a person's action or real
state. No entrance animations.

## 6. Class naming (`components.css` and page CSS)

- **Blocks** are `c-<name>` (`c-chip`), **elements** `c-<name>__<part>` (`c-pane__head`), **modifiers**
  `c-<name>--<variant>` (`c-chip--privileged`). One block per component; no nesting beyond one `__` level.
- **State** lives in ARIA and data attributes, never in classes: `[aria-current="page"]`, `[aria-selected]`,
  `[aria-checked]`, `[aria-pressed]`, `[aria-expanded]`, `[aria-disabled]`, `[data-side]`, `[data-strength]`,
  `[data-kind]`, `[data-state]`.
- **Utilities** are `u-<name>`: `u-mono`, `u-label`, `u-vh` (visually hidden), `u-num` (tabular numerals).
- **Type roles** are `t-<role>` (section 4).
- **Page CSS** prefixes its own classes with the page: `docs-`, `chron-`, `people-`, `claims-`, `ask-`, `ov-`,
  `binder-`, `doc-`, `act-`, `track-` (Complaint and {regulatorLabel}), `brief-` (the Complaint brief), `guide-` (the
  guide band's script and page styles). Page CSS never restyles a `c-` block; it composes them.
- **Script hooks** are `data-*` attributes (`data-ask-drawer`, `data-docs-table`). Never select on a `c-` class
  from script, and never style a `data-` hook.
- No IDs in selectors. Specificity stays at one class plus one attribute.

## 7. Components

Every component works at 390px and in forced colors.

**Header** (`c-header`, `c-header__bar`, `c-header__brand`, `c-header__portrait`, `c-nav`, `c-nav__item`). Surface
bar, `--rule` underline. The brand is Legallas's portrait, the small Legallas at 32px (the owner, 2026-10-03; it replaced the
seal there), plus the word "Legallas" in serif 600 16px. The portrait is static: nothing sets its state. Nav, the six sections in this order (2026-10-03):
Overview, Complaint, {regulatorLabel}, Chronology, Entities & People, Documents. `{regulatorLabel}` comes from
`regulatorLabel` in the gitignored `legallas.config.json` (default "Regulator"). The Binder is a tab of Documents, so
`/binder/` and `/visual/` mark Documents current; the prior claims page (`/claims/`, "Prior case") is
reached from the foot of each track page, not the nav. The current item is `aria-current="page"` (forest on
`--forest-tint`, 600). Ask is not a nav item (the owner, 2026-10-03): the Ask button opens the drawer, whose "Open as page"
reaches `/ask`. The tools are two buttons at the far end. The Ask button (`c-button c-button--primary`) shows a
`c-kbd` hint, `⌘K` on Apple platforms and `Ctrl K` elsewhere, and holds the small Legallas at 20px
(`[data-glyph-slot]`), which shows working while an Ask request is in flight. Beside it, at every width, an "Account"
disclosure (the owner, 2026-10-03): a native `<details>` (`c-header__menu`; summary `c-header__more`, quiet with a caret)
whose panel (`c-header__account`) is a right-aligned sheet with `--shadow-overlay`, one 40px row each for who is
signed in, Connect AI, Activity (the owner only) and Sign out. It is closed from the first paint, so the bar does not
change when `/api/me` answers; Escape, a click or focus outside it close it. A disclosure, not an ARIA menu. The bar
is one line above 68rem; from 48rem to 68rem the tools take their own right-aligned line from the first paint
(R89), so the hint and the fonts arriving never change the header's height. The hint's chip holds the width of
"Ctrl K" on every platform, so the swap to `⌘K` never narrows the tools and slides the centered nav, and the two
latin text faces are preloaded so the header is usually drawn in them from the first paint. Below 48rem the nav wraps onto its own
line; it never hides behind a menu. The keyboard hint hides there, so the first line (brand, Ask, Account) fits at
320px.

**Case header** (`c-case`, `c-case__caption`, `c-case__court`), Overview only: caption in `.t-display` (`.t-h1`
below 48rem), closed by a 1px `--brass-rule`. With a complaint track the caption is that track's title (the owner
2026-10-02) and the line above it, in `--ink-2`, names the deliverables ("Current complaint", "Two regulator
filings"); with no tracks it falls back to the matter caption with court and number. It heads the campaign map: the header
and its objective cards sit on `--hex-texture`, which replaces the treeline engraving and appears nowhere else. The
operative-pleading line is retired.

**Button** (`c-button`, `--primary`, `--quiet`) 32px tall, `--radius`, 1px `--border`. Primary: `--forest` fill,
`--on-forest` text. Quiet: no border, forest text. Labels are plain verbs or nouns: "Send to client", "Download".
**Kbd** (`c-kbd`): mono 11px, 1px `--border`, `--radius-chip`.

**Document table** (`c-table-wrap`, `c-table`, `c-table__num`, `c-table__summary`). Columns in order: Control no.,
Date (ISO), Type, From → to, Pages, Privilege, Key, Summary, Bates. Rows `--row-h`; header on `--panel` with a
`--border` underline, sticky; body rows divided by `--rule`. Number and date cells `c-table__num` (mono 13).
Hover and `aria-selected="true"` wash `--forest-tint`; selected adds `box-shadow: inset 2px 0 0 var(--forest)`.
Sort shows through `aria-sort`. An empty Bates cell is blank (no dash). `c-table-wrap` scrolls sideways itself.
A company room (no matter) leaves out Control no., Privilege, Bates and any column blank in every row. There, From → to
reads Parties and the summary is the row's link. Its Download index CSV follows: no Control no., and a Parties column.

**Chip** (`c-chip`, `--privileged`, `--key`, `--counsel`): 22px tall, `--radius-chip`, `.t-small`. Neutral: 1px
`--border`, `--ink-2`. Privileged: `--oxblood` text and edge on `--oxblood-tint` ("Marked privileged by you", never a
status: `src/scripts/mark-words.ts`). Key: `--brass-text` label, `--brass-mark` edge and target badge. From counsel: forest edge and text. A party chip
is a neutral chip with a 12px `c-shape`. Chips are not buttons; the Key toggle is `c-button[aria-pressed]`.

**Cite chip** (`c-cite`, `--dead`): an `<a href="/doc/?id=<id>#page=<n>">` reading `DOE-000412 at 3`, mono 12 /
500, forest on `--forest-tint`, `--radius-chip`, min height `--target-min`. Script opens the exhibit pane instead
of navigating; while its pane is open it is `aria-expanded="true"` (forest fill, `--on-forest` text). A cite to a
removed document is `c-cite--dead`: `aria-disabled="true"`, struck through, `--ink-3`. Cites follow the sentence
they support, inline.

**Stat tile** (`c-stat`, `__value`, `__label`, `__note`): `--surface`, 1px `--rule`, `--radius`, `--space-4`
padding. Value `.t-stat` tabular; label `--ink-2`; note `.t-caption` `--ink-3`, holding a date or a cite. Money
always carries its cite. No trend arrows, no colored figures, at most four in a row.

**Timeline event** (`c-event`, `__date`, `__mark`, `__body`, `__title`, `__actors`, `__cites`): grid of 6.5rem
date (mono, ISO), 16px mark (`c-shape` of the lead actor's side, or `filing`), body. Title in serif 600 16/22 states
the fact ("Harbor Labs serves the repurchase notice at cost"). Actors `--ink-2` 13px. Cites in a wrapping row.

**Person node** (`c-person`, `__name`, `__role`): a button with a 20px `c-shape`, name 600, role `--ink-2` 13px.
`aria-pressed="true"` while its profile drawer is open. In the force graph the node is the bare shape at 12 to
20px with the name beside it in `--ink`.

**Proof cell** (`c-proof[data-strength]`): `--row-h` square link to the cited page, `aria-label` with strength and
cite ("Direct proof, DOE-000412 at 3"). A gap is a `span role="img"`.

**Exhibit pane** (`c-pane`, `__head`, `__row`, `__control`, `__meta`, `__actions`, `__body`; `c-hit`): header on
`--surface` with the control number (mono 15 / 600), Key and privilege chips, actions Open, Download, Close; a meta
line with ISO date, type, from → to, "Page 3 of 14", privilege. Body on `--panel`. The quoted passage is
`mark.c-hit`: `--forest-tint` ground with a 2px forest underline, never yellow. At 64rem and wider it is the right
half of a split view; below, a full-screen sheet with `--shadow-overlay`. Esc closes and returns focus to the
cite. Nothing decorative inside the pane.

**Drawer** (`c-drawer`, `__head`, `__title`, `__body`, `__foot`; `c-input`): `role="dialog"`, `aria-modal`,
`--surface`, 1px `--border`, `--shadow-overlay`, max 36rem wide, full-screen below 64rem. Head: "Ask", an Esc
hint, "Open as page". Foot on `--panel` with the input and the primary Ask button. Opens with focus in the input,
traps Tab, Esc closes. The head carries the small Legallas at 24px, never the companion.

**Answer blocks** (Ask page and drawer): `p.c-claim[data-kind]` with `span.c-claim__tag`: `fact` (cited statement),
`read` (a reading of a cited page), `inference` (uncited; italic, `--ink-2`). Answers are serif. "Not in the
record" is `c-callout c-callout--absent` (`--oxblood` edge on `--oxblood-tint`), drawn from the `dontKnow` flag.
General legal background is `c-callout c-callout--background` (dashed `--rule`, `--ink-2`), always last.
An answer the model stopped at max_tokens (`truncated` on `done`) closes, after everything else, with `p.ask-cut`
(`role="note"`, small, `--ink-2`, the failed turn's 2px dashed `--border` edge): "This answer was cut off; ask a
narrower question."
With the law library on (T21), `law` claims carry a `§` mark in `--brass-text` and sit in the Law group
(`c-callout ask-law`: solid `--brass-rule` edge on `--surface`) after the record and before the background, led by
"Law" and the notice "Research support; have your own lawyer review how it applies. Case law here runs through 2019;
check newer authority." (the year is `CASE_LAW_THROUGH`) Law cites are `c-cite ask-law-cite`
links to the official source (new tab, an arrow after the cite). Under every answer that cites anything, `ask-sources`
lists each source once, each marked (card 11.5, product notices A1 and A4): Record (control number and page, then
"Checked against [document], p. [n] on [the answer's day]"), Law (cite, title, "Regulator filings only" in `--slate` for
regulator material, then "Checked against [the library's source] on [the day it was read]") and Not checked (a law
citation written as plain text that no validated tag names; in the answer it carries `[not checked]`).
An answer naming a deadline shows `c-callout ask-deadline` after "Not in the record" and before the body (`role="note"`, solid `--brass-rule` edge, 3px on the
left, on `--surface`), led by "Deadline": the 83(b) and Form D lines from product notices A6, or one general line.

**Empty state** (`c-empty`, `__glyph`, `__text`): dashed `--border`, `--surface`, one serif sentence, at most one
button. The mark is the seal in `--ink-3` (`LegallasEmpty`), never the small Legallas.

**Small Legallas** (`c-glyph`, `LegallasGlyph.astro`; the miniature `@brand/miniature.webp` from the room's brand pack, state in
`src/scripts/glyph.ts`): the rig's round head-and-shoulders miniature, the same character at every size (section 8),
resized by `astro:assets` to 1x and 2x. A round window with a `--paper` ground and a ring drawn over the image.
Sizes 16, 20, 24, 32 and 40px only. One drawing at every size, so the state shows on the ring; `data-state` mirrors
real work only, through `setGlyph` and `glyphWhile`:

| `data-state` | Ring | When |
|---|---|---|
| `idle` | 1px `--forest` | at rest |
| `working` | 2px `--brass-rule`, breathing to 1px only under `prefers-reduced-motion: no-preference` | a request is in flight |
| `done` | 2px `--forest` | the request landed; settles to idle after 2.4s |
| `error` | 1px `--oxblood` | the request failed; holds until the next one |

Used in four places: the header's Ask button (20), the Ask drawer head (24), the Ask avatar on a phone (32) and the
guide band below 48rem (40). The drawer clones its 24px glyph from a `<template data-glyph-template>` in
`Room.astro`, so every copy comes from `astro:assets`.
It is decorative (`aria-hidden`, `alt=""`); the work it mirrors announces itself in text. In forced colors the
window keeps a `CanvasText` outline and the image keeps its colors.

**Provenance** (`c-provenance`): `.t-caption` `--ink-3`, once per summary page, at the foot of the summary.

**Defined term** (`c-term`, `__word`, `__pop`; `components/terms.css`): the first use on a page of a term from
`meta.definedTerms` (section 9). The word keeps the line's type with a 1px dotted `--ink-3` underline, and a hit area
of at least `--target-min` that never moves the line. Hover, focus or a tap opens `__pop` (`role="tooltip"`, the
word's description): `--surface`, 1px `--border`, `--radius`, `--shadow-overlay`, sans 13 / 18, at most 20rem,
kept inside the viewport. Escape, blur or a tap elsewhere closes it. Later uses on the page stay plain; never inside
a link or a cite chip. Text goes through `termify` (`src/scripts/terms.ts`).

### The game layer (2026-10-02)

A calm strategy-game feel for new counsel: an advisor, a campaign map, objectives, proof meters and fog on what is
still missing. It is visual only. There are no scores, levels, timers or entrance motion, and every number is a
count of record facts. The blocks live in `src/styles/components/game.css`.

**Violation mark** (`c-mark[data-mark]`, `c-mark--large`): section 3.

**Objective card** (`c-objective`, `__mark`, `__title`, `__summary`, `__meta`): one track or one violation.
`--surface`, 1px `--rule`, `--radius`, `--space-4` padding. A `c-mark--large` in `__mark` beside the title (serif 600
18 / 24), a one-sentence summary in `--ink-2` 14, then `__meta` under a `--rule` hairline holding party chips and a
proof meter. As a link or button its hover edge is `--forest`; selection composes `c-select`. Below 48rem the
padding drops to `--space-3` and the summary runs under the mark.

```html
<button class="c-objective c-select" type="button" aria-pressed="true">
  <span class="c-objective__mark c-mark c-mark--large" data-mark="C">C</span>
  <span class="c-objective__title">Moe and Roe removed Doe on two days of notice</span>
  <span class="c-objective__summary">The June 2012 letter gave 9 days' notice; the agreement requires 30.</span>
  <span class="c-objective__meta">...party chips, then a c-meter...</span>
</button>
```

Inside a button or link every part is a `span` (grid items, so they lay out as blocks); a static card may use
`h3` and `p`.

**Proof meter** (`c-meter`, `__pips`, `__pip`, `__label`): one pip per point to prove, in proof order, with
`data-total` on the block and `data-strength` on each pip (`direct`, `corroborating`, `circumstantial`, `gap`).
Direct and corroborating pips are filled `--forest`; circumstantial is hollow forest; a gap is a dashed `--ink-3`
pip. Never red to green, never a percentage. The pips are `aria-hidden`; the label says it in words: "Proof secured
9 of 12" (direct plus corroborating, of the total). Pips flex to share at most 16rem and wrap with the label at
390px. In forced colors pips take `CanvasText` and a gap `GrayText`.

**Selection** (`c-select`): brass corner brackets (`--brass-mark`, 10px arms, 2px thick, 4px outside the box) on
`[aria-selected="true"]`, `[aria-checked="true"]` or `[aria-pressed="true"]`, drawn by the block's `::after`, so it
composes only onto elements that do not use `::after` themselves. Under `prefers-reduced-motion: no-preference` the
selected box lifts 2px over `--dur-1`; otherwise it does not move. For HTML boxes only; an SVG mark draws its own
selected state. In forced colors the brackets give way to a 2px `Highlight` outline.

A set of chips where exactly one is chosen, like the Chronology violation chips (All, A, B, C), is a radio group:
`role="radiogroup"` with an `aria-label`, each chip a `c-button[role="radio"][aria-checked]`, and one tab stop
(the checked chip; the rest `tabindex="-1"`). Arrow keys move the choice and wrap, Home and End go to the ends, and
Space or a click chooses. `aria-pressed` is for a chip that turns on and off by itself (the Litigation chip, the
kind toggles, Key).

**Fog** (`c-fog[data-state="gap"]`): a gap row in the proof checklist and a gap cell in the Complaint brief's claims
map, and nowhere else. `--fog-haze` ground and a
1px dashed `--ink-3` edge; the row's text stays plain `--ink` and `--ink-2`, and its cells hold "Not yet in the
record" as text. Focus replaces the dashed edge with the focus ring. In forced colors the edge is `CanvasText`.

**Dossier** (`c-dossier`, `__head`, `__name`, `__role`, `__counts`, `__count`, `__value`, `__label`): a compact card
for one person or entity that leads with counts (entities controlled, violations, documents cited). The head is a
20px `c-shape`, the name (serif 600 18) and role (`--ink-2` 13). Counts are a `dl`: `__count` wraps a `dt.__label`
(12, `--ink-2`) and a `dd.__value` (21 / 600, tabular), auto-fit columns of at least 6rem, so three counts sit in a
row at 390px.

**Guide band** (`c-guide`, `__art`, `__brief`, `__orders`, `__order`): Legallas as the page guide, a band under the
header on every page but Ask (section 8). `__art` holds the companion in its arched window, 88px wide at 240 / 280
(below 48rem, the small Legallas at 40px in a square slot); `__brief` is one serif sentence (16 / 24) about the page;
`__orders` is a list of two or three `c-button c-guide__order` questions that open Ask with the question filled in.
Orders may wrap to two lines; below 48rem they run the full width under the art and the briefing. The art is
`aria-hidden`. The band is drawn with the generic briefing and filled from the matter after the page has drawn, so
the filled sentence is kept only when it takes as many lines as the generic one (R89); otherwise the generic one
stays, as it does when no matter is published. On a phone that is often the generic sentence.

### The Complaint brief (2026-10-03)

`/complaint/` is one page a lawyer new to the matter reads in five minutes (`src/scripts/brief/`, `brief.css`), top
to bottom: the head (a line naming the page, the caption in `.t-h1`, the forum, the theory in one serif line at 21px,
Download draft and Print brief, closed by the `--brass-rule`); per violation its title as the heading, its summary
and the told vs filed pair; who's who (cards grouped by the pleaded role each role opens with: Plaintiff side,
Defendants, Relief defendants, Nominal defendants, Others named, where "Not a defendant" goes; by side when no role
pleads a defendant; a 16px side shape, the plain role, "Through" the org);
who held what (a two-tab switch, as told and as filed, over the control panels); the dated steps (a horizontal
timeline: a numbered 24px ring on a 2px `--forest` rule, the ISO date, the step in serif 600, its note and one cite;
three to a row below 64rem, a vertical rule below 48rem); money (an HTML bar per dollar figure in `--enc-company`,
grouped under each figure's `group`, one scale, each bar labelled with its amount and cite; count figures as stat
tiles); the claims map (a row per count, its elements across, each cell the strongest proof's ring and word, a gap
cell in `c-fog`; a click opens the cite); hurdle and key exhibit cards (four to a row); dates to confirm; drafts.
Every chart has the frame's Table toggle. The seven-part outline prints after the brief as "Full outline" and is not
shown on screen. A section whose data is absent is left out.

## 8. Motifs and assets

A room's brand pack (`scripts/config.ts`) supplies its mark and, if it has one, its companion and the companion's states. The product ships the neutral pack, which has neither.

Other assets are card D2's, in the brand pack's `brand/` folder (`src/assets/neutral/brand/` in the neutral pack):
the fletched arrows (Previous and Next) and one target badge (`target-direct.svg`, the key-document mark). The treeline engraving is retired from
the case header; `--hex-texture` (section 2) takes its place, in the Overview header only. Single-ink SVGs use
`currentColor` when inline; as `<img>` they are drawn in `--forest`.
Icons are line icons, 1.5px stroke on a 16 or 20px grid, `fill="none"`, `stroke="currentColor"`. No emoji, no icon
fonts. Nothing decorative inside evidence views (tables, pane, chronology, proof grid, proof checklist). State
encodings are not decoration and are allowed there: the selection brackets (`c-select`) and the gap haze
(`c-fog`). The hex texture stays in the Overview header only.

## 9. Voice

- **Defined terms** come from the manifest (`meta.definedTerms`), brief style: Jane Doe ("Doe"), Richard Roe
  ("Roe"), Harbor Labs, Inc. ("Harbor Labs"). After first use, the defined term only.
- **Content headings state conclusions** ("Harbor Labs left her final wages unpaid"). **Interface labels are nouns
  or plain verbs** ("Documents", "Key", "Send to client"). Sentence case everywhere.
- **Dates:** prose "Sept. 7, 2012" (Jan., Feb., Mar., Apr., May, June, July, Aug., Sept., Oct., Nov., Dec.);
  tables, axes and metadata ISO `2012-09-07` in mono. No relative dates in the record views.
- **Cites:** `<prefix>-<6 digits> at <page>`, e.g. `DOE-000412 at 3`; ranges `at 3-4`.
- **Empty states and errors are one sentence**, a plain statement ending in a period: "No open discussions."
  Errors say what happened and what to do: "That file is larger than 95 MB."
- **Provenance line**, verbatim, on every summary page: "Prepared by the client from the record with AI
  assistance. Every entry cites its source; verify before relying on it."
- **The guide speaks one plain sentence per page:** a briefing that says what the page holds ("Each point to prove,
  with the strongest proof the record has for it."), then two or three orders worded as questions for Ask. Generic
  copy in source; names fill in from the manifest. No greetings in copy, no game talk, no character voice.
- **Record facts only:** no deadlines, countdowns, scores, damages models, settlement offers or tasks in any copy.
  The game layer is visual: a meter counts proof in the record, it never grades the case. The company checklist
  (`/checklist/`) is the one exception: dates and gaps are what it's for. It states a date and what it was worked out
  from, and never counts down.

**Banned in copy:** scroll, scrolls, shelves, well met, elf, quest, magic, XP, level up, achievement, "Legallas is...",
exclamation marks, em dashes (`scripts/copy-voice.test.ts`). Identifiers (icon ids such as `scroll`, `ElfState`) are
not copy and stay.

## 10. Old token names (removed)

The legacy alias block that kept pre-overhaul page CSS working was deleted in card Q3: every stylesheet now uses
the names in sections 2 to 5, and `scripts/tokens-defined.test.ts` fails if an old name (`--card`, `--muted`,
`--accent`, `--parchment`, `--font-display`, `--shadow`, ...) is declared or read again, or if any `var()` without
a fallback reads a property nobody declares. The mapping, for reading old commits:

| Old | New |
|---|---|
| `--parchment`, `--bg` | `--paper` |
| `--parchment-deep` | `--panel` |
| `--card`, `--header-bg` | `--surface` |
| `--text` | `--ink` |
| `--ink-soft`, `--muted` | `--ink-2` |
| `--accent` | `--forest` |
| `--forest-deep`, `--accent-hover` | `--forest-hover` |
| `--gold` | `--brass-mark` |
| `--gold-text` | `--brass-text` |
| `--frame` | `--brass-rule` |
| `--card-border` | `--rule` |
| `--font-display` | `--font-serif` |
| `--font-body` | `--font-sans` |
| `--radius-small` | `--radius-chip` |
| `--page-width` | `--page-max` |
| `--shadow` | none (shadows are for overlays only) |
| `--elf-backdrop`, `--banner-bg`, `--banner-text` | retired with the stage |

## 11. Accessibility floor

- Text 4.5:1, marks and control borders 3:1 (section 2). Never color alone: shape, word or icon.
- Focus: 2px solid `--focus`, 2px offset, on every focusable element; never removed.
- Targets at least `--target-min`. Keyboard: `/` filter, `j`/`k` rows, Enter open, Esc close, ⌘K / Ctrl+K Ask.
- Single-key shortcuts work only while focus is in their region; shortcuts with a modifier are global.
- `prefers-reduced-motion: reduce`: no transitions; the companion and the guide show the rig's raster still for
  the current state (the Rive runtime, its wasm and the `.riv` are never fetched), and the small Legallas's working
  ring holds steady instead of breathing.
- `forced-colors: active`: borders and shapes take `CanvasText`; chips and cites keep a visible border.
- Every chart has a table fallback. Print hides the nav and prints cites as text.
