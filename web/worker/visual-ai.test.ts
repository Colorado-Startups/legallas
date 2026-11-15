// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVisualAi } from './visual-ai.ts';
import { isVisualAiKey, pngSize, sidePngFits, visualAiKey, visualPath, VISUAL_PNG_MAX_BYTES } from './visuals.ts';

const SHA = 'ab'.repeat(32);

/** A tiny PNG header (signature and IHDR, 10 by 10 pixels): enough for the side-file checks. */
const PNG_10 = (() => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 10, 0, 0, 0, 10]);
  return bytes;
})();

function bucket(objects: Record<string, string | Uint8Array>) {
  const gets: string[] = [];
  return {
    gets,
    async get(key: string) {
      gets.push(key);
      const value = objects[key];
      if (value === undefined) return null;
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
      return { text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => bytes.slice().buffer };
    },
  };
}

test('side-file keys are meta/visual-ai/<sha256>.txt or .png and nothing else', () => {
  assert.equal(visualAiKey(SHA, 'txt'), `meta/visual-ai/${SHA}.txt`);
  assert.equal(isVisualAiKey(visualAiKey(SHA, 'png')), true);
  for (const key of ['meta/matter.json', `meta/visual-ai/${SHA}.json`, `meta/visual-ai/${SHA.toUpperCase()}.txt`, `text/${SHA}.p1.md`, `x/meta/visual-ai/${SHA}.txt`]) {
    assert.equal(isVisualAiKey(key), false, key);
  }
  assert.throws(() => visualAiKey('../x', 'txt'));
  assert.equal(visualPath('cooler map'), '/visual/?v=cooler%20map');
});

test('readVisualAi reads the text, the PNG only when asked and within the limit, and nothing without a sha256', async () => {
  const png = PNG_10;
  const files = bucket({ [visualAiKey(SHA, 'txt')]: 'Doe text', [visualAiKey(SHA, 'png')]: png });
  assert.deepEqual(await readVisualAi(files, SHA, { png: false }), { text: 'Doe text', png: null });
  assert.deepEqual(files.gets, [visualAiKey(SHA, 'txt')], 'no PNG read when not asked');
  assert.deepEqual(await readVisualAi(files, SHA, { png: true }), { text: 'Doe text', png });
  const big = bucket({ [visualAiKey(SHA, 'txt')]: 'Doe text', [visualAiKey(SHA, 'png')]: new Uint8Array(VISUAL_PNG_MAX_BYTES + 1) });
  assert.deepEqual(await readVisualAi(big, SHA, { png: true }), { text: 'Doe text', png: null });
  assert.equal(await readVisualAi(files, null, { png: true }), null);
  assert.equal(await readVisualAi(files, 'SHA-LEAK', { png: true }), null);
  assert.equal(await readVisualAi(bucket({}), SHA, { png: true }), null, 'not synced yet');
});

test('a side PNG must be a PNG within one megapixel and the embed size', () => {
  const header = (width: number, height: number, length = 33) => {
    const bytes = new Uint8Array(length);
    bytes.set(PNG_10.subarray(0, 16));
    new DataView(bytes.buffer).setUint32(16, width);
    new DataView(bytes.buffer).setUint32(20, height);
    return bytes;
  };
  assert.deepEqual(pngSize(header(640, 480)), { width: 640, height: 480 });
  assert.equal(sidePngFits(header(1000, 1000)), true);
  assert.equal(sidePngFits(header(1001, 1000)), false, 'over a megapixel');
  assert.equal(sidePngFits(header(10, 10, VISUAL_PNG_MAX_BYTES + 1)), false, 'over the embed size');
  assert.equal(sidePngFits(new TextEncoder().encode('<svg>not a png</svg>')), false);
  assert.equal(pngSize(new Uint8Array([1, 2, 3])), null);
});
