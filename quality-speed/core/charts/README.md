# The chart kit

Pure functions that return HTML and inline SVG. Every chart is complete before any script runs, and a drill-down is a plain link. A little plain
JavaScript adds tooltips, table sort and filter, Road to 100 and the timeline. No packages, light and dark, phone width with no sideways scroll.

**Copy from [`examples/gallery.ts`](examples/gallery.ts).** It has one short, working call per component, and the tests render all of them.

```ts
import { ring, bullets, roadTo100 } from '../../core/charts/index.ts';
```

The page links two files, which the site build ships:

```html
<link rel="stylesheet" href="charts.css">
<script type="module" src="charts.js"></script>
```

## What to use

| You have | Use | Empty or broken state |
|---|---|---|
| A page's score | `ring` (`xl`, `lg`, `md`, `sm`) | No data: red, reads 0. 100: check |
| The home page's sections | `ringGrid`: a lead and labeled groups, which collapse | As `ring` |
| History behind the rings | `timeline`, with `historyRows` for the score history's lines. `src` loads a long history on the first drag | One run: nothing to drag. A ring with no score that day: red |
| A value against its goal | `bullets`, with `metricBullet` for a contract metric | Red bar and a word |
| One value and its change | `statTile`, `metricTile`, in a `tileRow` | `missingTile`, red |
| A value over time | `trend`, `sparkline` | Under 2 runs: red box |
| A grid of scores | `heatmap`, `heatLegend` | 0 or missing: empty red tile. Excluded: hatched |
| A journey's screens | `filmstrip` | `state: 'stop'`: red frame |
| The fixes left | `roadTo100` | Short of 100: a "No fix yet" row |
| Rows to compare | `dataTable` | |
| Counted things | `pictogram` | Missing ones: red outlines |
| Pass or fail, row by column | `dotMatrix` | Fail: red with an x |
| An amount against a limit | `meter` | Warn and over: icon and color |
| A run of days | `dayStrip` | Fail: short and red |

Pass a contract `Metric` to `metricBullet` or `metricTile`. The `reading` from `core/score.ts` is required: a record can say `ok` and still score
0, and a page must never show a number that scores 0.

For `roadTo100`, pass `now` from the page's score, with `exact_quality` and `exact_speed` as `q` and `s` and the real `total`.

**Errors never read as good news.** Null, `NaN`, a cell the list forgot and a step with no time all show red, never as a good number or "not applicable".
A missing day breaks a trend's line and marks the gap in red. The slider's newest position shows what the page was built with.
Only a listed exclusion (`excluded: true`, or `na` in a `dotMatrix`) is hatched.

If a page needs something that isn't here, ask whether a table or a tile already says it. The kit stays small on purpose.

## Rules that keep the pages one system

- **Quality is green and thick, Speed is blue and thin, Consumption is orange and innermost,** everywhere. `lens` sets it; a ring draws Consumption when given `c`. Don't recolor them.
- **Brass is for reference marks:** `◆` goal, `▽` baseline. `▼` now is ink. `markKey()` draws the key, once per page.
- **Red means scores 0.** Keep it for that, so a red tile always means the same thing.
- **Darker means closer to 100** on a heatmap, and only 100 gets the check.
- **Every number says when and how:** pass `time` and `stage`, and the chart shows the date and a lab or live icon.
- **Words:** the kit adds none beyond your labels and the state words. Keep labels to one or two words, and pass a `short` for narrow columns.
- **Colors come from tokens.** Use `var(--qs-*)` from `charts.css`, never a literal. A test holds this file to that.
- **No inline styles or handlers.** A strict security policy has to pass, so use classes and attributes. `qs-grid-2`, `qs-grid-3`, `qs-grid-4` and
  `qs-ring-row` lay things out.

## Accessibility

- Each chart has a `role="img"` label or is a real table, and every plot has a table behind its icon.
- Color is never alone: numbers in cells, words for states, thickness and position on rings.
- The keyboard reaches every control: links, native checkboxes and slider, and sort buttons.
- Motion stops under `prefers-reduced-motion`. Forced colors are handled.

## Drill-down

A heatmap cell links to `#<filmstrip id>`, and CSS shows the panel the link targets, with no script. `back` sets where the close link goes, and it must
be an id on the page. A panel with `open: true` hides once anything on the page is targeted, and without a `back` it has no close link. To keep the first
view under 100 KB, a page with many journeys can link to other pages instead.

## Palette

Quality with Speed passes `dataviz`'s `validate_palette.js` in both themes, as all pairs. Re-run it if either color changes: light on `#fffdf8`,
dark on `#171e1a`. `palette.test.ts` checks contrast, the heat ramp and that the two dark blocks match.

## Tests

One file at a time, in seconds, no install:

```bash
node --test quality-speed/core/charts/render.test.ts
```

```bash
node --test quality-speed/core/charts/logic.test.ts
```

```bash
node --test quality-speed/core/charts/palette.test.ts
```

A page's own test reuses the balanced-markup and strict-policy checks in `markup-checks.ts`.

Browser and screenshot checks run in CI, never on a laptop.
