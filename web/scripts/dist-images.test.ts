// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { auditDist } from './dist-audit.ts';
import { checkImages, MAX_PNG_WIDTH, pngWidth } from './dist-images.ts';

/** A minimal PNG header (signature and IHDR) of the given size; enough for pngWidth and hashing. */
function png(width: number, height: number, salt = 0): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 6;
  ihdr[24] = salt;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr]);
}

function tree(build: (root: string) => void): { root: string; dist: string; originals: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'legallas-dist-images-'));
  const dist = path.join(root, 'dist');
  const originals = path.join(root, 'originals');
  mkdirSync(path.join(dist, '_astro'), { recursive: true });
  mkdirSync(originals, { recursive: true });
  build(root);
  return { root, dist, originals };
}

test('pngWidth reads the IHDR width and ignores anything that is not a PNG', () => {
  assert.equal(pngWidth(png(384, 448)), 384);
  assert.equal(pngWidth(Buffer.from('RIFF....WEBPVP8 ', 'latin1')), null);
  assert.equal(pngWidth(Buffer.alloc(4)), null);
});

test('checkImages passes resized copies and fails a byte-identical original or an oversized PNG', () => {
  const { root, dist, originals } = tree((r) => {
    writeFileSync(path.join(r, 'originals', 'portrait.png'), png(960, 1120, 1));
    writeFileSync(path.join(r, 'dist', '_astro', 'portrait.abc_192.png'), png(192, 224));
    writeFileSync(path.join(r, 'dist', '_astro', 'portrait.abc_384.webp'), Buffer.from('RIFF....WEBP', 'latin1'));
  });
  try {
    assert.deepEqual(checkImages(dist, originals), []);
    writeFileSync(path.join(dist, '_astro', 'portrait.abc.png'), png(960, 1120, 1));
    writeFileSync(path.join(dist, '_astro', 'big.def.png'), png(MAX_PNG_WIDTH + 1, 100, 2));
    const found = checkImages(dist, originals).map((f) => `${f.file}: ${f.problem.split(';')[0]}`);
    assert.deepEqual(found, [
      `${path.join('_astro', 'big.def.png')}: PNG ${MAX_PNG_WIDTH + 1}px wide, over the ${MAX_PNG_WIDTH}px limit for built images`,
      `${path.join('_astro', 'portrait.abc.png')}: byte-identical copy of the original portrait.png`,
      `${path.join('_astro', 'portrait.abc.png')}: PNG 960px wide, over the ${MAX_PNG_WIDTH}px limit for built images`,
    ]);
    // Without originals only the width check runs.
    assert.equal(checkImages(dist, null).length, 2);
    // dist-audit runs the image checks with the build.
    assert.equal(auditDist(dist, originals).findings.length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
