// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { putLocal } from './local.ts';
import type { BuiltChunk } from './types.ts';

const CHUNK = (id: string, track: BuiltChunk['track']): BuiltChunk => ({
  id,
  cite: `Cite of ${id}`,
  title: 't',
  url: 'https://www.ecfr.gov/current/title-17/section-230.506',
  retrieved: '2026-11-01',
  track,
  kind: 'statute',
  source: 'Fixture',
  text: `Text of ${id}`,
});

test('puts each part under its law key, then the catalog last, without the texts', async () => {
  const puts: { key: string; body: string; type: string }[] = [];
  const bucket = {
    async put(key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }) {
      puts.push({ key, body: new TextDecoder().decode(value), type: options.httpMetadata.contentType });
    },
  };
  await putLocal(bucket, [CHUNK('crs-7-90-501', 'civil'), CHUNK('usc-26-1202~1', 'both')], '2026-11-01');
  assert.deepEqual(
    puts.map((p) => p.key),
    ['law/civil/crs-7-90-501.md', 'law/both/usc-26-1202~1.md', 'catalog.json'],
  );
  assert.equal(puts[0]!.body, 'Text of crs-7-90-501');
  const catalog = JSON.parse(puts[2]!.body) as { version: number; built: string; chunks: Record<string, unknown>[] };
  assert.deepEqual([catalog.version, catalog.built, catalog.chunks.length], [1, '2026-11-01', 2]);
  assert.ok(catalog.chunks.every((chunk) => !('text' in chunk)));
  assert.equal(puts[2]!.type, 'application/json');
});
