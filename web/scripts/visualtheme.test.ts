// SPDX-License-Identifier: Apache-2.0
// Card F6 (binder theme): theming a whole page, on synthetic fixture pages only (never the real binder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAR_ATTRIBUTE, markPrivilegeBar } from './visualtheme-bar.ts';
import { THEME_MARKER, themeVisual, type ThemeFonts } from './visualtheme.ts';
import { planExport, themeReport } from './visuals.ts';

const TAGS = { sans: 'SANS', serif: 'SERIF', serifItalic: 'SERIFITALIC', mono400: 'MONO4', mono500: 'MONO5' } as const;
const FONTS: ThemeFonts = { load: async (request) => TAGS[request.face] };

const SCRIPT = `<script>const SIDE = { defendant: '#b91c1c', company: "#0d9488", client: '#1e3a5f' };
svg.append('rect').attr('fill', SIDE.client).attr('font-family', 'Georgia, serif');</script>`;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Doe v. Harbor Labs, Inc.: invoices</title>
<style>
body { font-family: Georgia, 'Times New Roman', serif; background: #ffffff; color: #1e293b; }
.wp-bar { background: #1e3a5f; color: #fff; text-transform: uppercase; letter-spacing: .1em; }
.legend .swatch.defendant { background: #b91c1c; } .callout { border-left: 4px solid #0d9488; }
.violet { color: #7c3aed; }
</style></head><body>
<div class="wp-bar"><strong>Attorney work product</strong> | Privileged and confidential</div>
<header><h1>Invoices to Harbor Labs, Inc.</h1><p>Prepared for counsel review.</p></header>
<p style='color:#b91c1c;font-family:"Segoe UI", sans-serif'>Harbor Labs paid <em>two</em> of the spring invoices.</p>
<svg viewBox="0 0 10 10"><rect fill="#0d9488" stroke="#e2e8f0"/><text fill="#1e3a5f">DOE-000412</text></svg>
${SCRIPT}
</body></html>`;

test('themeVisual injects tokens, faces and attribute rules once, at the end of the head', async () => {
  const { html, addedBytes } = await themeVisual(PAGE, FONTS);
  assert.equal(html.split(THEME_MARKER).length, 2);
  assert.ok(html.indexOf(THEME_MARKER) > html.indexOf('<meta charset'), 'the charset stays first');
  assert.ok(html.indexOf(THEME_MARKER) < html.indexOf('</head>'));
  // Light only (R67): one token block, no dark values.
  assert.match(html, /:root\{color-scheme:light;--legallas-paper:#FAF7F0;/);
  assert.doesNotMatch(html, /prefers-color-scheme|#0F1412/);
  // Inter always (it is the base face) and serif because the page uses it; no mono. The only italic text sits
  // in a sans paragraph, so the serif italic is left out.
  assert.match(html, /font-family:'Inter Variable'[^}]*base64,SANS\)/);
  assert.match(html, /font-family:'Binder Serif';font-style:normal[^}]*base64,SERIF\)/);
  assert.doesNotMatch(html, /SERIFITALIC|MONO4|MONO5/);
  assert.equal(addedBytes, Buffer.byteLength(html) - Buffer.byteLength(PAGE));
});

test('script bodies are byte-for-byte untouched; their colours are themed through attribute rules', async () => {
  const { html } = await themeVisual(PAGE, FONTS);
  assert.ok(html.includes(SCRIPT));
  // The script's colour table names the sides, so its colours take the --enc-* marks.
  assert.match(html, /:where\(\[fill="#1e3a5f" i\]\)\{fill:var\(--legallas-enc-client\)\}/);
  assert.match(html, /:where\(\[stroke="#b91c1c" i\]\)\{stroke:var\(--legallas-enc-defendant\)\}/);
  // Markup attributes: teal is the company mark, the pale grid line a rule, SVG text a text ink.
  assert.match(html, /:where\(\[fill="#0d9488" i\]\)\{fill:var\(--legallas-enc-company\)\}/);
  assert.match(html, /:where\(\[stroke="#e2e8f0" i\]\)\{stroke:var\(--legallas-rule\)\}/);
  assert.match(html, /:where\(text\[fill="#1e3a5f" i\],tspan\[fill="#1e3a5f" i\],textPath\[fill="#1e3a5f" i\]\)\{fill:var\(--legallas-forest\)\}/);
  // The markup itself keeps its attributes.
  assert.match(html, /<rect fill="#0d9488" stroke="#e2e8f0"\/>/);
});

test('style sheets and style attributes take tokens and the DESIGN.md stacks', async () => {
  const { html } = await themeVisual(PAGE, FONTS);
  assert.match(html, /body \{ font-family: 'Binder Serif'[^;]*; background: var\(--legallas-surface\); color: var\(--legallas-ink\); \}/);
  assert.match(html, /\.legend \.swatch\.defendant \{ background: var\(--legallas-enc-defendant\); \}/);
  assert.match(html, /\.callout \{ border-left: 4px solid var\(--legallas-slate\); \}/);
  assert.match(html, /<p style="color:var\(--legallas-oxblood\);font-family:'Inter Variable'[^"]*">/);
  assert.match(html, /\.violet \{ color: var\(--legallas-brass-text\); \}/);
});

test('the work-product bar becomes the quiet privilege bar, text unchanged', async () => {
  const { html } = await themeVisual(PAGE, FONTS);
  assert.match(html, new RegExp(`<div class="wp-bar" ${BAR_ATTRIBUTE}><strong>Attorney work product</strong> \\| Privileged and confidential</div>`));
  // The fixture's bar is navy, so its rule is deep; the bar takes the ordinary oxblood back.
  assert.match(html, /\.wp-bar \{ background: var\(--legallas-deep\);[^}]*--legallas-oxblood:#F0A9AD/);
  assert.match(html, /\[data-legallas-privilege\]\[data-legallas-privilege\]\{--legallas-paper:var\(--legallas-base-paper\)!important;[^}]*--legallas-oxblood:var\(--legallas-base-oxblood\)!important;[^}]*background:var\(--legallas-panel\)!important;color:var\(--legallas-oxblood\)!important/);
  assert.match(html, /font-variant-caps:all-small-caps!important;text-transform:none!important/);
  assert.equal(html.split(`${BAR_ATTRIBUTE}>`).length, 2, 'one bar only');
});

test('themeVisual reports the missing bar, canvas pages and low contrast', async () => {
  const { warnings } = await themeVisual(PAGE, FONTS);
  assert.deepEqual(warnings, [], 'every colour of the fixture is placed and reads in both themes');

  const bare = await themeVisual('<html><head></head><body><h1>Doe v. Roe</h1><canvas></canvas><script>c.getContext("2d")</script></body></html>', FONTS);
  assert.ok(bare.warnings.includes('no work-product bar found'));
  assert.ok(bare.warnings.includes('draws on a canvas, which keeps its own colours and fonts'));

  const styled = await themeVisual(`<body><div>Work product</div><script>el.style.color = '#b91c1c';</script></body>`, FONTS);
  assert.ok(styled.warnings.includes('a script sets inline style colours, which keep their original values'));
});

test('themeVisual is idempotent', async () => {
  const once = await themeVisual(PAGE, FONTS);
  const twice = await themeVisual(once.html, FONTS);
  assert.equal(twice.html, once.html);
  assert.equal(twice.addedBytes, 0);
});

test('the bar is the outermost short block, never a section with a heading or text in a script', async () => {
  const nested = '<body><header class="top"><div class="bar"><span>PRIVILEGED &amp; CONFIDENTIAL</span></div><h1>Title</h1></header></body>';
  assert.match(markPrivilegeBar(nested)!, new RegExp(`<div class="bar" ${BAR_ATTRIBUTE}><span>`));
  const long = `<body><p>${'Doe v. Harbor Labs, Inc. '.repeat(10)} is work product.</p></body>`;
  assert.equal(markPrivilegeBar(long), null);
  const masked = '<body><h1>Doe</h1>\u00011\u0001<p>Attorney-client</p></body>';
  assert.match(markPrivilegeBar(masked)!, new RegExp(`<p ${BAR_ATTRIBUTE}>Attorney-client</p>`));
  const selfClosing = '<body><div class="wp"><img src="data:," alt="">Work product<br/></div></body>';
  assert.equal(markPrivilegeBar(selfClosing), null, 'an image makes it more than a bar');
});

test('planExport themes each page when given the faces, and leaves pages alone without them', async () => {
  const raw = {
    version: 1,
    sections: [{ slug: 'start', label: 'Start', title: 'Overview' }],
    visuals: [{ slug: 'hub', section: 'start', title: 'Hub', overview: true, source: { artifact: 'Hub1', path: 'index.html' } }],
  };
  const read = async () => '<html><head><style>.n{color:rgba(255,255,255,.3)}</style></head><body><div>Work product</div><p class="n">Doe</p></body></html>';
  const themed = await planExport(raw, read, { theme: FONTS });
  assert.match(themed.files[0]!.html, new RegExp(THEME_MARKER));
  assert.ok(themed.warnings.some((w) => /^hub: contrast \d\.\d:1 for "\.n"$/.test(w)), themed.warnings.join('\n'));
  assert.ok(themed.themeBytes > 0);

  assert.equal(themed.themePages.length, 1);
  assert.match(themeReport(themed), /^theme {4}hub {2}\d+ KB\ntheme {4}added \d+ KB across 1 pages, fonts included \(average \d+ KB, largest \d+ KB\)\n$/);
  const flagged = { ...themed, themePages: [{ slug: 'hub', addedBytes: 130 * 1024, fullFaces: ['mono'] }] };
  assert.match(themeReport(flagged), /hub {2}130 KB, over the 120 KB target, full set for mono \(a script writes text there\)/);

  const plain = await planExport(raw, read);
  assert.doesNotMatch(plain.files[0]!.html, new RegExp(THEME_MARKER));
  assert.equal(plain.themeBytes, 0);
});
