// SPDX-License-Identifier: Apache-2.0
// The renderer in real headless Chrome, over the DOE fixture page web/fixtures/visual-ai/doe-seats.html, whose chart
// and table are drawn by its own script and which asks for a remote stylesheet, image and fetch. Skipped unless
// LEGALLAS_CDP_TEST=1: it starts Chrome, so on the Mac it runs only with a dev slot, and CI does not run it.
//
//   LEGALLAS_CDP_TEST=1 node --test scripts/visual-render-chrome.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pngSize, VISUAL_PNG_MAX_BYTES, VISUAL_PNG_MAX_PIXELS } from '../worker/visuals.ts';
import { formatVisualText } from './visual-dom.ts';
import { openRenderer, RENDER_ORIGIN } from './visual-render.ts';

const FIXTURE = path.resolve(import.meta.dirname, '..', 'fixtures', 'visual-ai', 'doe-seats.html');
const skip = process.env.LEGALLAS_CDP_TEST === '1' ? false : 'needs headless Chrome: set LEGALLAS_CDP_TEST=1 (a dev slot on the Mac)';

test('a page renders offline: its script-drawn chart and table are read, every remote request is refused', { skip, timeout: 60_000 }, async () => {
  const requests: { url: string; served: boolean }[] = [];
  const renderer = await openRenderer(undefined, (url, served) => requests.push({ url, served }));
  try {
    const rendered = await renderer.render(new Uint8Array(await readFile(FIXTURE)), { png: true });
    const text = formatVisualText(rendered.walked);
    for (const expected of [
      '# Scheduling seats sold by Harbor Labs',
      'see the board packet [cite: DOE-000412 at 3]',
      'Figure: Seats sold by quarter',
      'Restaurant seats: 193 seats; Q4 2011; Hotel seats: 268 seats; Q1 2012',
      '| Q1 2012 | Hotel seats | 268 seats |',
      '[Chart drawn on a canvas; its values are not in the page text]',
      'Next: the timeline [visual: doe-timeline]',
    ]) {
      assert.ok(text.includes(expected), `missing: ${expected}\n---\n${text}`);
    }
    assert.ok(!text.includes('createElementNS'), 'script source is never read as text');

    const served = requests.filter((request) => request.served).map((request) => new URL(request.url).origin);
    assert.deepEqual(served, [RENDER_ORIGIN]);
    assert.ok(requests.some((request) => !request.served && request.url.startsWith('https://example.com/')), JSON.stringify(requests));

    assert.ok(rendered.png, 'a PNG within the limits');
    const size = pngSize(rendered.png);
    assert.ok(size && size.width * size.height <= VISUAL_PNG_MAX_PIXELS && rendered.png.byteLength <= VISUAL_PNG_MAX_BYTES);

    // A second page on the same browser is served fresh.
    const again = await renderer.render(new TextEncoder().encode('<h1>Doe second page</h1>'), { png: false });
    assert.equal(formatVisualText(again.walked), '# Doe second page');
  } finally {
    await renderer.close();
  }
});
