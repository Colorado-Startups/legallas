// SPDX-License-Identifier: Apache-2.0
// Card F6b (binder theme fixes): the embedded faces, trimmed to each page's weights and characters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fontNames } from './font-rename.ts';
import { FAMILY, loadThemeFonts, pageText, planFaces, readFace, weightOf, type FaceRequest } from './visualtheme-fonts.ts';
import { themeVisual } from './visualtheme.ts';

test('weightOf reads keywords, numbers and font shorthands', () => {
  assert.equal(weightOf('600'), 600);
  assert.equal(weightOf('bold !important'), 700);
  assert.equal(weightOf('normal'), 400);
  assert.equal(weightOf('italic 300 '), 300);
  assert.equal(weightOf('inherit'), null);
});

test('pageText keeps printable ASCII and adds the page characters, entities and escapes decoded', () => {
  const text = pageText(`<p>Doe&rsquo;s &#8212; caf\u00e9 &#x2192;</p><style>.a::before{content:'\\00a7 '}</style><script>s='\\u2022'</script>`);
  assert.ok(text.startsWith(' !"#$%&'), 'ASCII first');
  for (const c of ['\u2019', '\u2014', '\u00e9', '\u2192', '\u00a7', '\u2022']) assert.ok(text.includes(c), c);
  assert.equal(text.length, 95 + 6);
});

test('planFaces pins one weight, spans several, and adds serif, italic and mono only when used', () => {
  const base = { stacks: new Set<'sans' | 'serif' | 'mono'>(), italic: false, weights: new Set<number>(), text: 'a' };
  const plain = planFaces(base);
  assert.deepEqual(plain.map((f) => [f.request.face, f.weight]), [['sans', '400']]);
  const rich = planFaces({ ...base, stacks: new Set(['serif', 'mono']), italic: true, weights: new Set([600, 700, 950]) });
  assert.deepEqual(rich.map((f) => [f.request.face, f.weight, f.style]), [
    ['sans', '400 900', 'normal'],
    ['serif', '400 900', 'normal'],
    ['serifItalic', '400 900', 'italic'],
    ['mono400', '400', 'normal'],
    ['mono500', '500', 'normal'],
  ]);
  assert.deepEqual(rich[0]!.request.wght, { min: 400, max: 900 });
});

test('themeVisual asks for the weights the page uses', async () => {
  const seen: FaceRequest[] = [];
  const fonts = { load: async (request: FaceRequest) => (seen.push(request), 'X') };
  const page = '<html><head><style>h1{font:600 28px Georgia, serif}.k{font-weight:500}</style></head><body><h1>Doe</h1><p class="k">Roe</p></body></html>';
  const { html } = await themeVisual(page, fonts);
  assert.deepEqual(seen.map((r) => [r.face, r.wght]), [['sans', { min: 400, max: 700 }], ['serif', { min: 400, max: 700 }]]);
  assert.match(html, /font-family:'Inter Variable';font-style:normal;font-weight:400 700;/);
});

test('sans and serif carry the whole page; serif italic and mono carry only the text that renders in them', async () => {
  const seen = new Map<string, string>();
  const fonts = { load: async (request: FaceRequest) => (seen.set(request.face, request.text), 'X') };
  const page = `<html><head><style>h1{font-family:Georgia,serif}.n{font-family:Menlo,monospace}.c::after{content:'\u00a7'}</style></head>
<body><h1>Doe <em>v.</em> Roe</h1><p>Sans text only</p><span class="n">DOE-000412</span></body></html>`;
  await themeVisual(page, fonts);
  assert.equal(seen.get('serifItalic'), ' .0123456789v\u00a7');
  assert.equal(seen.get('serif'), seen.get('sans'));
  assert.equal(seen.get('mono400'), ' -0123456789DEO\u00a7');
  assert.ok(seen.get('sans')!.includes('y'), 'sans carries all of ASCII');
});

test('safeguard (R75): a script that writes into an italic or mono context gives that face the full page set', async () => {
  const seen = new Map<string, string>();
  const fonts = { load: async (request: FaceRequest) => (seen.set(request.face, request.text), 'X') };
  const head = '<style>h1{font-family:Georgia,serif}h1 em{font-style:italic}.ctl{font-family:Menlo,monospace}</style>';
  const body = '<h1>Doe <em>v.</em> Roe</h1><span class="ctl">DOE-1</span>';
  const writes = `<html><head>${head}</head><body>${body}<script>document.querySelector('.ctl').textContent = 'DOE-000412';</script></body></html>`;
  const guarded = await themeVisual(writes, fonts);
  assert.deepEqual(guarded.fullFaces, ['mono']);
  assert.equal(seen.get('mono400'), seen.get('sans'), 'mono carries the full page set');
  assert.notEqual(seen.get('serifItalic'), seen.get('sans'), 'italic stays trimmed');

  seen.clear();
  const italic = await themeVisual(writes.replace("'.ctl'", "'h1 em'"), fonts);
  assert.deepEqual(italic.fullFaces, ['serif italic']);
  assert.equal(seen.get('serifItalic'), seen.get('sans'));

  seen.clear();
  const reads = await themeVisual(writes.replace(".textContent = 'DOE-000412'", '.dataset.k = 1'), fonts);
  assert.deepEqual(reads.fullFaces, [], 'a script that writes no text does not trip the safeguard');
  assert.equal(seen.get('mono400'), ' -0123456789DEO');
});

test('the real faces are trimmed woff2, and every fixture page adds under 120 KB', async () => {
  const fonts = await loadThemeFonts();
  const one = Buffer.from(await fonts.load({ face: 'sans', wght: 400, text: pageText('Doe') }), 'base64');
  const span = Buffer.from(await fonts.load({ face: 'sans', wght: { min: 400, max: 700 }, text: pageText('Doe') }), 'base64');
  assert.equal(one.subarray(0, 4).toString('latin1'), 'wOF2');
  assert.ok(one.length < span.length && span.length < 48_256, `${one.length} < ${span.length} < whole file`);
  for (const name of ['dark-scheme', 'next-card', 'purple-legend', 'nested-grounds']) {
    const page = await readFile(path.resolve(import.meta.dirname, '..', 'fixtures', 'visuals', `${name}.html`), 'utf8');
    const { addedBytes } = await themeVisual(page, fonts);
    assert.ok(addedBytes < 120 * 1024, `${name} adds ${(addedBytes / 1024).toFixed(0)} KB`);
  }
});

test('the Plex and Source faces are renamed before subsetting, so no subset carries a Reserved Font Name (OFL-1.1)', async () => {
  for (const [face, family] of [['mono400', FAMILY.mono], ['mono500', FAMILY.mono], ['serif', FAMILY.serif], ['serifItalic', FAMILY.serif]] as const) {
    const names = fontNames(await readFace(face));
    assert.ok(names.find((r) => r.id === 1)?.text.startsWith(family), face);
    assert.ok(names.some((r) => r.id === 14 && /OFL|openfontlicense/.test(r.text)), `${face} keeps its licence record`);
    const named = names.filter((r) => ![0, 7, 13, 14].includes(r.id)).map((r) => r.text);
    assert.deepEqual(named.filter((text) => /Plex|Source/.test(text)), [], face);
  }
});

test('subset-font is imported only by the theme pass, and nothing in worker/ or src/ reaches the theme pass', () => {
  const web = path.resolve(import.meta.dirname, '..');
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.name === 'node_modules' || entry.name.startsWith('.') ? []
        : entry.isDirectory() ? walk(path.join(dir, entry.name))
          : /\.(?:ts|astro|mjs|js)$/.test(entry.name) ? [path.relative(web, path.join(dir, entry.name))] : []);
  const files = ['worker', 'src', 'scripts'].flatMap((root) => walk(path.join(web, root)));
  const importing = (pattern: RegExp) => files.filter((file) => pattern.test(readFileSync(path.join(web, file), 'utf8')));
  const subset = importing(/from\s+['"]subset-font['"]|import\(\s*['"]subset-font['"]|declare module ['"]subset-font['"]/);
  assert.deepEqual(subset.sort(), ['scripts/subset-font.d.ts', 'scripts/visualtheme-fonts.ts']);
  const theme = importing(/from\s+['"][^'"]*visualtheme[^'"]*['"]/).filter((file) => !file.startsWith('scripts/'));
  assert.deepEqual(theme, [], 'worker/ and src/ never import the theme pass');
});
