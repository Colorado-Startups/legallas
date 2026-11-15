// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ICON_FILES, OUTLINE_ICON, renderIcon } from './icons.ts';
import { decodeRgba, encodeRgba, readPngHeader } from './png.ts';

const read = (file: string) => readFileSync(join(import.meta.dirname, 'appPackage', file));

test('the committed icons are what icons.ts draws (rerun it after changing the seal)', () => {
  for (const { file, spec } of ICON_FILES) {
    const png = decodeRgba(read(file));
    assert.equal(png.width, spec.size, file);
    assert.equal(png.height, spec.size, file);
    assert.ok(Buffer.compare(png.rgba, renderIcon(spec)) === 0, `${file} differs from renderIcon; run node connect/copilot/icons.ts`);
  }
});

test('the outline icon is white on transparent and the color icon is opaque', () => {
  const outline = decodeRgba(read('outline.png')).rgba;
  let inked = 0;
  for (let i = 0; i < outline.length; i += 4) {
    assert.deepEqual([outline[i], outline[i + 1], outline[i + 2]], [255, 255, 255]);
    if (outline[i + 3]! > 0) inked++;
  }
  assert.ok(inked > OUTLINE_ICON.size * 4, 'the outline draws a mark');
  const color = decodeRgba(read('color.png')).rgba;
  for (let i = 3; i < color.length; i += 4) assert.equal(color[i], 255);
});

test('png round-trips pixels and reports its header', () => {
  const rgba = Uint8Array.from({ length: 3 * 2 * 4 }, (_, i) => (i * 37) % 256);
  const png = encodeRgba(3, 2, rgba);
  assert.deepEqual(readPngHeader(png), { width: 3, height: 2, colorType: 6 });
  assert.deepEqual([...decodeRgba(png).rgba], [...rgba]);
  assert.equal(readPngHeader(Buffer.from('not a png at all, just some text bytes')), null);
});
