// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withLocalBuckets, type LocalBucket } from './local-r2.ts';
import type { Wrangler } from './wrangler.ts';

const KEY = '00000000-0000-4000-8000-000000000000';

function memoryBucket(): LocalBucket & { objects: Map<string, { bytes: Uint8Array; contentType: string }> } {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    objects,
    put: async (key, value, options) => objects.set(key, { bytes: value, contentType: options.httpMetadata.contentType }),
    get: async (key) => {
      const found = objects.get(key);
      if (!found) return null;
      return { arrayBuffer: async () => Uint8Array.from(found.bytes).buffer };
    },
    delete: async (key) => {
      objects.delete(key);
    },
  };
}

const unused = async () => {
  throw new Error('The CLI should not have been called');
};
const cli = (calls: string[]): Wrangler => ({
  target: 'local',
  d1Query: unused,
  d1File: unused,
  r2Put: async (bucket) => { calls.push(`put ${bucket}`); },
  r2Get: async (bucket) => { calls.push(`get ${bucket}`); },
  r2Delete: async (bucket) => { calls.push(`delete ${bucket}`); },
  aiSearchJobsAvailable: unused,
  aiSearchJobCreate: unused,
});

test('a bound bucket answers from the one emulator, with the content type and the bytes intact', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'local-r2-'));
  try {
    const bucket = memoryBucket();
    const calls: string[] = [];
    const w = withLocalBuckets(cli(calls), { files: bucket }, async () => {});
    const from = path.join(dir, 'from.bin');
    const to = path.join(dir, 'to.bin');
    await writeFile(from, Buffer.from([0, 1, 2, 255]));
    await w.r2Put('files', KEY, from, 'application/pdf');
    assert.equal(bucket.objects.get(KEY)?.contentType, 'application/pdf');
    await w.r2Get('files', KEY, to);
    assert.deepEqual(await readFile(to), Buffer.from([0, 1, 2, 255]));
    await w.r2Delete('files', KEY);
    assert.equal(bucket.objects.size, 0);
    await assert.rejects(w.r2Get('files', KEY, to), /specified key does not exist/);
    assert.deepEqual(calls, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('any other bucket stays on the CLI, and close is the one given', async () => {
  const calls: string[] = [];
  let closed = false;
  const w = withLocalBuckets(cli(calls), {}, async () => { closed = true; });
  await w.r2Put('law', 'k', 'f', 'text/plain');
  await w.r2Get('law', 'k', 'f');
  await w.r2Delete('law', 'k');
  await w.close?.();
  assert.deepEqual(calls, ['put law', 'get law', 'delete law']);
  assert.equal(closed, true);
});

test('a bound bucket still refuses a key the CLI would', async () => {
  const w = withLocalBuckets(cli([]), { files: memoryBucket() }, async () => {});
  await assert.rejects(w.r2Put('files', '../up', '/nowhere', 'text/plain'));
  await assert.rejects(w.r2Delete('files', '../up'));
  await assert.rejects(w.r2Get('files', '../up', '/nowhere'));
});
