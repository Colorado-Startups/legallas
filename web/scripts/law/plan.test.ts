// SPDX-License-Identifier: Apache-2.0
// The law build's output, upload plan and fetch guard (T21). Temp directories only; nothing reaches Cloudflare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseLawArgs } from './cli.ts';
import { assertAllowed, RawCache } from './fetch.ts';
import { applyPlan, assertLawObjectKey, builtDate, CATALOG_KEY, lawDeleteArgs, lawPutArgs, loadUploaded, planUpload, sha256, writeOutput } from './plan.ts';
import { buildAll, buildCase } from './build.ts';
import { allowedHosts, type LawPack } from './pack.ts';
import { suppliedSourceFor } from './seed.ts';
import { ALLOWED_HOSTS, manifestUrls } from './sources.ts';
import type { BuiltChunk } from './types.ts';

const CHUNK = (id: string, text: string, track: BuiltChunk['track'] = 'civil'): BuiltChunk => ({
  id,
  cite: id,
  title: 't',
  url: 'https://www.ecfr.gov/x',
  retrieved: '2026-10-03',
  track,
  kind: 'statute',
  source: 'Fixture',
  text,
});

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-law-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('the output holds one file per part and a catalog without the text', async () => {
  await withDir(async (dir) => {
    const built = await writeOutput(dir, [CHUNK('crs-9-80-101', 'one'), CHUNK('ccr-704-1-r1', 'two', 'regulator')], '2026-10-03T00:00:00Z');
    assert.deepEqual(Object.keys(built).sort(), [CATALOG_KEY, 'law/civil/crs-9-80-101.md', 'law/regulator/ccr-704-1-r1.md']);
    assert.equal(await readFile(path.join(dir, 'out', 'law/civil/crs-9-80-101.md'), 'utf8'), 'one');
    const catalog = JSON.parse(await readFile(path.join(dir, 'out', CATALOG_KEY), 'utf8'));
    assert.equal(catalog.version, 1);
    assert.equal(catalog.chunks.length, 2);
    assert.equal('text' in catalog.chunks[0], false);
  });
});

test('the plan names puts and deletes, and its fingerprint changes only with the plan', () => {
  const a = planUpload({ x: '1', y: '2' }, { y: '2', z: '3' });
  assert.deepEqual([a.put, a.remove, a.unchanged], [['x'], ['z'], 1]);
  assert.equal(planUpload({ y: '2', x: '1' }, { z: '3', y: '2' }).fingerprint, a.fingerprint);
  assert.notEqual(planUpload({ x: '9', y: '2' }, { y: '2', z: '3' }).fingerprint, a.fingerprint);
  assert.match(a.fingerprint, /^[0-9a-f]{12}$/);
});

test('apply writes only law keys to legallas-law, parts before the catalog before deletions, then one indexing job', async () => {
  await withDir(async (dir) => {
    const built = await writeOutput(dir, [CHUNK('crs-9-80-101', 'one')], 'now');
    const plan = planUpload(built, { 'law/civil/crs-9-80-999.md': 'old' });
    const calls: string[][] = [];
    await applyPlan(dir, plan, built, async (args) => (calls.push(args), ''), () => {});
    assert.deepEqual(calls.map((c) => c.slice(0, 4).join(' ')), [
      'r2 object put legallas-law/law/civil/crs-9-80-101.md',
      `r2 object put legallas-law/${CATALOG_KEY}`,
      'r2 object delete legallas-law/law/civil/crs-9-80-999.md',
      'ai-search jobs create legallas-law',
    ]);
    assert.ok(calls.slice(0, 3).every((c) => c.includes('--remote')));
    assert.deepEqual(await loadUploaded(dir), built);
  });
  for (const bad of ['text/abc.p1.md', 'meta/matter.json', 'law/civil/../x.md', 'law/record/a-b.md']) assert.throws(() => assertLawObjectKey(bad), bad);
  assert.throws(() => lawPutArgs('/tmp', 'meta/matter.json'));
  assert.throws(() => lawDeleteArgs('text/x.md'));
});

test('apply needs the fingerprint of a reviewed dry run', () => {
  assert.deepEqual(parseLawArgs([]), { refresh: false, apply: false, expect: null, list: false, only: null, local: false });
  assert.throws(() => parseLawArgs(['--apply']), /--expect/);
  assert.throws(() => parseLawArgs(['--expect', 'abcdefabcdef']), /only makes sense/);
  assert.deepEqual(parseLawArgs(['--apply', '--expect', 'abcdefabcdef']), { refresh: false, apply: true, expect: 'abcdefabcdef', list: false, only: null, local: false });
  assert.deepEqual(parseLawArgs(['--only', 'us-ica,us-sec-part-275']).only, ['us-ica', 'us-sec-part-275']);
  assert.equal(parseLawArgs(['--list']).list, true);
  assert.throws(() => parseLawArgs(['--only', 'us-ica', '--apply', '--expect', 'abcdefabcdef']), /--only proves a small fetch/);
  assert.throws(() => parseLawArgs(['--list', '--refresh']), /--list downloads/);
  assert.throws(() => parseLawArgs(['--only', '../etc']), /usage/);
  assert.equal(parseLawArgs(['--only', 'us-ica', '--local']).local, true);
  assert.throws(() => parseLawArgs(['--local']), /--local fills a local bucket/);
});

/** An invented room's law pack: one source of each kind, a slip opinion and a supplied text. */
const FIXTURE_PACK: LawPack = {
  name: 'Fixture',
  hosts: ['content.leg.colorado.gov'],
  urls: () => [],
  build: async () => [],
  sources: {
    crs: [{ kind: 'crs', title: 99, article: '1', track: 'civil' }],
    ecfr: [{ kind: 'ecfr', title: 17, section: '230.500', track: 'both' }],
    usc: [{ kind: 'usc', title: 15, section: '80a-2', track: 'both' }],
    cases: [
      { name: 'Doe v. Roe', court: 'Colo.', year: 1999, cite: '1 P.3d 1', text: 'https://static.case.law/p3d/1/html/0001-01.html', url: 'https://www.courtlistener.com/opinion/1/doe/', topics: ['duty'], track: 'civil' },
      { name: 'Roe v. Doe', court: 'Colo. App.', year: 2018, cite: '2018 COA 1', slip: true, text: 'https://storage.courtlistener.com/pdf/2018/12/13/roe_v._doe.pdf', url: 'https://www.courtlistener.com/opinion/2/roe/', topics: ['duty'], track: 'civil' },
      {
        name: 'Moe v. Roe', court: 'Colo. App.', year: 1973, cite: '2 P.2d 2', text: 'https://www.courtlistener.com/opinion/3/', url: 'https://www.courtlistener.com/opinion/3/moe/', topics: ['duty'], track: 'civil',
        supplied: { format: 'courtlistener-html', sha256: 'a'.repeat(64), retrieved: '2026-10-05', via: 'retrieved via CourtListener API, Free Law Project', why: 'no public copy the build may download' },
      },
    ],
    slipCases: new Set(['2018 COA 1']),
    suppliedTexts: new Set(['https://www.courtlistener.com/opinion/3/']),
  },
};

test('the build fetches only from official hosts, over https, from fixed URLs', () => {
  const hosts = allowedHosts([FIXTURE_PACK]);
  for (const url of manifestUrls([FIXTURE_PACK])) {
    const parsed = assertAllowed(url, hosts);
    assert.ok(hosts.has(parsed.hostname));
    // Queries carry only fixed API parameters: eCFR section numbers.
    const known = ['section'];
    for (const [key] of parsed.searchParams) assert.ok(known.includes(key), `${url} has ?${key}`);
  }
  for (const bad of ['http://www.ecfr.gov/x', 'https://evil.example/x', 'https://u:p@www.ecfr.gov/x']) assert.throws(() => assertAllowed(bad), bad);
});

test('the core fetch allowlist is pinned, and a state source\'s host comes only with its pack', () => {
  assert.deepEqual([...ALLOWED_HOSTS].sort(), ['static.case.law', 'storage.courtlistener.com', 'uscode.house.gov', 'www.courtlistener.com', 'www.ecfr.gov', 'www.govinfo.gov']);
  assert.throws(() => assertAllowed('https://content.leg.colorado.gov/x'));
  assert.equal(assertAllowed('https://content.leg.colorado.gov/x', allowedHosts([FIXTURE_PACK])).hostname, 'content.leg.colorado.gov');
});

test('a room with no packs builds an empty library and fetches nothing', async () => {
  await withDir(async (dir) => {
    const fetcher = async () => {
      throw new Error('fetched with no packs');
    };
    const log: string[] = [];
    assert.deepEqual(await buildAll(new RawCache(dir, fetcher as never), { log: (line) => log.push(line), packs: [] }), []);
    assert.ok(log.includes('Cases: 0 opinions'));
  });
});

test('a slip opinion or a supplied text needs its pack to allow it by name', async () => {
  const [, slip, supplied] = FIXTURE_PACK.sources!.cases!;
  const refused: LawPack = { ...FIXTURE_PACK, sources: { ...FIXTURE_PACK.sources, slipCases: new Set(), suppliedTexts: new Set() } };
  await withDir(async (dir) => {
    const cache = new RawCache(dir, (async () => new Response('x')) as never, () => '2026-10-31', allowedHosts([refused]));
    await assert.rejects(buildCase(cache, slip!, { packs: [refused] }), /not one of the slip opinions the build may read/);
    await assert.rejects(buildCase(cache, supplied!, { packs: [refused] }), /not one of the texts the build may take as supplied/);
  });
});

test('seed.ts finds a supplied text by the hash a pack pins, and only that', () => {
  const body = Buffer.from('<p>supplied</p>');
  const pinned: LawPack = { ...FIXTURE_PACK, sources: { cases: [{ ...FIXTURE_PACK.sources!.cases![2]!, supplied: { ...FIXTURE_PACK.sources!.cases![2]!.supplied!, sha256: sha256(body) } }] } };
  assert.equal(suppliedSourceFor(body, [pinned])?.name, 'Moe v. Roe');
  assert.equal(suppliedSourceFor(Buffer.from('other'), [pinned]), null);
  assert.equal(suppliedSourceFor(body, []), null);
});

test('supplied text is cache-only: never downloaded, --refresh included', async () => {
  await withDir(async (dir) => {
    const fetcher = async () => {
      throw new Error('a cache-only source was fetched');
    };
    const cache = new RawCache(dir, fetcher as never, () => '2026-10-09');
    const url = 'https://www.courtlistener.com/opinion/1/';
    await assert.rejects(cache.get(url, { cacheOnly: 'needs a token' }), /cache-only \(needs a token\).*seed it/);
    await cache.seed(url, Buffer.from('<p>supplied</p>'), { retrieved: '2026-10-05', via: 'retrieved via CourtListener API, Free Law Project' });
    for (const refresh of [false, true]) {
      const got = await cache.get(url, { cacheOnly: 'needs a token', refresh });
      assert.deepEqual([got?.body.toString(), got?.retrieved], ['<p>supplied</p>', '2026-10-05'], 'the seeded body and its date');
    }
    const index = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'));
    assert.equal(index[url].via, 'retrieved via CourtListener API, Free Law Project', 'the cache keeps the provenance');
    await assert.rejects(cache.seed('https://evil.example/x', Buffer.from('x'), { retrieved: '2026-10-05', via: 'x' }), /refusing/);
  });
});

test('the raw cache downloads once, keeps the first date, and refuses an HTML page served as a .docx', async () => {
  await withDir(async (dir) => {
    let calls = 0;
    const fetcher = async (url: string) => {
      calls++;
      const body = url.endsWith('.docx') ? '<html>Page not found</html>' : 'eCFR body';
      return new Response(body);
    };
    const cache = new RawCache(dir, fetcher as never, () => '2026-10-03', allowedHosts([FIXTURE_PACK]));
    const first = await cache.get('https://www.ecfr.gov/api/x.xml');
    const again = await cache.get('https://www.ecfr.gov/api/x.xml');
    assert.equal(calls, 1);
    assert.equal(again?.body.toString(), 'eCFR body');
    assert.equal(first?.retrieved, '2026-10-03');
    assert.equal(await cache.get('https://content.leg.colorado.gov/a.docx'), null);
    await assert.rejects(cache.get('https://evil.example/x'), /refusing/);
  });
});

test('a rebuild of the same text plans nothing: the catalog stamp comes from the content', async () => {
  await withDir(async (dir) => {
    const chunks = [CHUNK('crs-9-80-101', 'one'), { ...CHUNK('crs-9-80-102', 'two'), retrieved: '2026-10-04' }];
    assert.equal(builtDate(chunks), '2026-10-04');
    const first = await writeOutput(dir, chunks, builtDate(chunks));
    const again = await writeOutput(dir, chunks, builtDate(chunks));
    assert.deepEqual(again, first);
    const plan = planUpload(again, first);
    assert.deepEqual([plan.put, plan.remove], [[], []]);
    assert.equal(planUpload(first, {}).fingerprint, planUpload(again, {}).fingerprint);
  });
});

test('redirects are followed by hand, and a hop off the allowlist is refused before it is requested', async () => {
  await withDir(async (dir) => {
    const requested: string[] = [];
    const fetcher = async (url: string, init?: RequestInit) => {
      requested.push(url);
      assert.equal(init?.redirect, 'manual');
      if (url.endsWith('/media/1')) return new Response(null, { status: 302, headers: { location: '/files/chapter.docx' } });
      if (url.endsWith('/media/2')) return new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } });
      return new Response('PK fake docx body');
    };
    const cache = new RawCache(dir, fetcher as never, () => '2026-10-03');
    const got = await cache.get('https://www.govinfo.gov/media/1');
    assert.equal(got?.finalUrl, 'https://www.govinfo.gov/files/chapter.docx');
    await assert.rejects(cache.get('https://www.govinfo.gov/media/2'), /refusing to fetch from evil\.example/);
    assert.ok(!requested.some((url) => url.includes('evil.example')));
  });
});
