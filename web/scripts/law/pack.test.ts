// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertAllowed, RawCache } from './fetch.ts';
import { allowedHosts, loadLawPacks, type LawPack } from './pack.ts';
import { ALLOWED_HOSTS, manifestUrls } from './sources.ts';

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'law-pack-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const DEMO = "export const lawPack = { name: 'Demo', hosts: ['law.example.gov'], urls: () => ['https://law.example.gov/a.pdf'], build: async () => [] };\n";

test('a room without packs.json builds the default pack, and a room that lists no packs builds none', async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, 'packs.json');
    assert.deepEqual((await loadLawPacks(file)).map((pack) => pack.name), ['Legallas default law pack']);
    await writeFile(file, '[]');
    assert.deepEqual(await loadLawPacks(file), []);
  });
});

test('a room with its own packs.json gets exactly those packs and not the default one', async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, 'packs.json');
    await writeFile(path.join(dir, 'demo.ts'), DEMO);
    await writeFile(file, '["demo.ts"]');
    assert.deepEqual((await loadLawPacks(file)).map((pack) => pack.name), ['Demo']);
  });
});

test('packs.json lists pack modules beside it, and each must export a law pack', async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, 'packs.json');
    await writeFile(path.join(dir, 'demo.ts'), DEMO);
    await writeFile(file, '["demo.ts"]');
    const [pack] = await loadLawPacks(file);
    assert.equal(pack?.name, 'Demo');
    for (const bad of ['{"demo.ts":1}', '["../demo.ts"]', '["/tmp/demo.ts"]', '["demo.js"]', '[1]']) {
      await writeFile(file, bad);
      await assert.rejects(loadLawPacks(file), /pack file names/, bad);
    }
    await writeFile(path.join(dir, 'empty.ts'), 'export const other = 1;\n');
    await writeFile(file, '["empty.ts"]');
    await assert.rejects(loadLawPacks(file), /does not export a law pack/);
  });
});

test('a pack\'s hosts are allowed only when the build is given the pack, and its URLs join the manifest', async () => {
  const pack: LawPack = { name: 'Demo', hosts: ['law.example.gov'], urls: () => ['https://law.example.gov/a.pdf'], build: async () => [] };
  const hosts = allowedHosts([pack]);
  assert.ok([...ALLOWED_HOSTS].every((host) => hosts.has(host)) && hosts.has('law.example.gov'));
  assert.throws(() => assertAllowed('https://law.example.gov/a.pdf'), /refusing to fetch from law\.example\.gov/);
  assert.equal(assertAllowed('https://law.example.gov/a.pdf', hosts).hostname, 'law.example.gov');
  assert.ok(manifestUrls([pack]).includes('https://law.example.gov/a.pdf') && !manifestUrls().includes('https://law.example.gov/a.pdf'));
  await withDir(async (dir) => {
    const cache = new RawCache(dir, (async () => new Response('%PDF body')) as never, () => '2026-10-31', hosts);
    assert.equal((await cache.get('https://law.example.gov/a.pdf'))?.retrieved, '2026-10-31');
    await assert.rejects(new RawCache(dir).get('https://law.example.gov/b.pdf'), /refusing to fetch/);
  });
});

test('a refused or busy answer is retried, a missing page is not, and the last failure still throws', async () => {
  const hosts = allowedHosts([{ name: 'Demo', hosts: ['law.example.gov'], urls: () => [], build: async () => [] }]);
  const answers = (statuses: number[]) => {
    const seen: number[] = [];
    const fetcher = (async () => {
      const status = statuses[seen.length] ?? statuses.at(-1) ?? 200;
      seen.push(status);
      return status === 200 ? new Response('%PDF body') : new Response('no', { status });
    }) as never;
    return { seen, fetcher };
  };
  await withDir(async (dir) => {
    const flaky = answers([403, 200]);
    const stored = await new RawCache(dir, flaky.fetcher, () => '2026-10-31', hosts, 0).get('https://law.example.gov/a.pdf');
    assert.equal(stored?.body.toString(), '%PDF body');
    assert.deepEqual(flaky.seen, [403, 200]);
    const missing = answers([404]);
    assert.equal(await new RawCache(dir, missing.fetcher, () => '2026-10-31', hosts, 0).get('https://law.example.gov/b.pdf'), null);
    assert.deepEqual(missing.seen, [404]);
    const down = answers([503]);
    await assert.rejects(new RawCache(dir, down.fetcher, () => '2026-10-31', hosts, 0).get('https://law.example.gov/c.pdf'), /fetch law\.example\.gov failed: HTTP 503/);
    assert.equal(down.seen.length, 4);
  });
});
