// SPDX-License-Identifier: Apache-2.0
// The companion art carries pixels only (plan PR-L1 and PR-L2, "Metadata"). Image tools, ComfyUI among them, write the
// prompt and the workflow into PNG text chunks, and cameras and editors add EXIF and XMP. The case-data guard
// (.github/scripts/guard-case-data.sh) skips binaries, so this test closes that gap for every image in the brand
// pack (scripts/config.ts brandAssetsDir: the default pack unless the room config names another): no PNG text
// or EXIF chunk, no EXIF or XMP block in any format, and no "prompt" or "workflow" anywhere in the file. Re-encode
// an image with sharp (metadata is dropped by default) to fix a failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { brandAssetsDir, LEGALLAS_BRAND_ASSETS } from '../../scripts/config.ts';

const ROOT = brandAssetsDir();
// The Rive file is checked too: it embeds the rig's images (WebP), which would carry their metadata inside it.
const RASTER = /\.(png|apng|jpe?g|webp|avif|gif|tiff?|heic|riv)$/i;
/** PNG chunks that hold text or EXIF. */
const PNG_META_CHUNKS = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf']);
/** Byte patterns that mean metadata in any container (PNG chunk names, the EXIF header, WebP's XMP chunk, XMP itself). */
const MARKERS = ['tEXt', 'iTXt', 'zTXt', 'eXIf', 'Exif\0\0', 'EXIF', 'XMP ', 'x:xmpmeta', 'ns.adobe.com/xap'];
/** Words ComfyUI writes as chunk keywords and JSON keys, matched in any case. */
const WORDS = ['prompt', 'workflow'];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function images(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'build' ? [] : images(path);
    return RASTER.test(entry.name) ? [path] : [];
  });
}

/** Chunk types of a PNG, in order. Throws on a truncated file. */
function pngChunks(bytes: Buffer): string[] {
  const types: string[] = [];
  let at = PNG_SIGNATURE.length;
  while (at < bytes.length) {
    if (at + 8 > bytes.length) throw new Error('truncated PNG chunk header');
    const length = bytes.readUInt32BE(at);
    types.push(bytes.toString('latin1', at + 4, at + 8));
    at += 12 + length;
  }
  if (at !== bytes.length) throw new Error('truncated PNG chunk');
  return types;
}

/** Every metadata problem in one image file, as short sentences. */
function metadataProblems(bytes: Buffer): string[] {
  const problems: string[] = [];
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    for (const type of pngChunks(bytes)) if (PNG_META_CHUNKS.has(type)) problems.push(`PNG ${type} chunk`);
  }
  const text = bytes.toString('latin1');
  for (const marker of MARKERS) if (text.includes(marker)) problems.push(`contains ${JSON.stringify(marker)}`);
  const lower = text.toLowerCase();
  for (const word of WORDS) if (lower.includes(word)) problems.push(`contains "${word}"`);
  return [...new Set(problems)];
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}

test('the checker catches a PNG text chunk, EXIF, XMP and a prompt', () => {
  const ihdr = chunk('IHDR', Buffer.alloc(13));
  const end = chunk('IEND', Buffer.alloc(0));
  const clean = Buffer.concat([PNG_SIGNATURE, ihdr, end]);
  assert.deepEqual(metadataProblems(clean), []);
  const withText = Buffer.concat([PNG_SIGNATURE, ihdr, chunk('tEXt', Buffer.from('prompt\0{"1":{}}')), end]);
  assert.ok(metadataProblems(withText).includes('PNG tEXt chunk'));
  assert.ok(metadataProblems(withText).includes('contains "prompt"'));
  assert.ok(metadataProblems(Buffer.concat([PNG_SIGNATURE, ihdr, chunk('zTXt', Buffer.alloc(4)), end])).includes('PNG zTXt chunk'));
  assert.ok(metadataProblems(Buffer.from('\xff\xd8\xff\xe1\0\0Exif\0\0MM', 'latin1')).length > 0, 'JPEG EXIF');
  assert.ok(metadataProblems(Buffer.from('RIFF....WEBPXMP <x:xmpmeta>', 'latin1')).length > 0, 'WebP XMP');
});

test('the art is there to check: the miniature, and with a companion a still per state and the rig', () => {
  const found = images(ROOT).map((path) => relative(ROOT, path));
  assert.ok(found.includes('miniature.webp'), `expected miniature.webp in ${ROOT}`);
  // A pack without a companion (the neutral one) has no stills and no rig.
  if (!found.some((file) => file.startsWith('states'))) return;
  const states = ['hello', 'idle', 'listening', 'reading', 'speaking', 'citing', 'unknown', 'error'];
  for (const file of [...states.map((s) => join('states', `${s}.webp`)), 'miniature.webp']) {
    assert.ok(found.includes(file), `expected ${file} in ${ROOT}`);
  }
  assert.equal(found.filter((file) => file.endsWith('.riv')).length, 1, 'the rig is checked with the images');
  // A brand pack keeps its rig's name, so its built URL stays the same.
  if (ROOT === LEGALLAS_BRAND_ASSETS) {
    assert.ok(found.includes('legallas-companion.riv'), 'the Legallas pack\'s rig is legallas-companion.riv');
  }
});

test('no image (or .riv) in the brand pack carries metadata, a prompt or a workflow', () => {
  for (const path of images(ROOT)) {
    const problems = metadataProblems(readFileSync(path));
    assert.deepEqual(problems, [], `${relative(ROOT, path)}: ${problems.join('; ')}; re-encode it with sharp`);
  }
});
