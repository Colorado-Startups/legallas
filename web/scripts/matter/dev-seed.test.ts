// SPDX-License-Identifier: Apache-2.0
// dev:seed's matter step: the fixture manifest as a fragment, built through F4 against fresh ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fixtureFiles, loadFixtureInputs, WEB_DIR } from '../dev-fixture.ts';
import { pathById } from '../dev-fixture-text.ts';
import { MATTER_STEP } from '../dev-seed.ts';
import { assemble, countsOf } from './build.ts';
import { CATALOG_REL, parseCatalog } from './catalog.ts';
import { matterToFragment, seedMatter } from './dev-seed.ts';

test('dev:seed looks for this step where it is, so the local room still gets the fixture manifest', () => {
  assert.equal(path.join(WEB_DIR, MATTER_STEP), path.join(import.meta.dirname, 'dev-seed.ts'));
  assert.equal(typeof seedMatter, 'function');
});

test('matterToFragment swaps every fixture id for its path and drops builtAt', async () => {
  const { matter, docIds } = await loadFixtureInputs();
  const fragment = matterToFragment(matter, pathById(docIds));
  const text = JSON.stringify(fragment);
  assert.doesNotMatch(text, /"doc":/);
  assert.doesNotMatch(text, /builtAt/);
  for (const id of Object.values(docIds)) assert.ok(!text.includes(id), `fixture id ${id} left in the fragment`);
  const paths = new Set(Object.keys(docIds));
  for (const m of text.matchAll(/"path":"([^"]+)"/g)) assert.ok(paths.has(m[1]), m[1]);
  assert.ok(Object.keys(fragment.docs ?? {}).every((p) => paths.has(p)));
  assert.throws(() => matterToFragment(matter, new Map()), /has no path/);
  const [first] = Object.entries(docIds);
  const withTermCite = { ...matter, meta: { ...matter.meta, definedTerms: [{ term: 'Doe', means: 'Plaintiff', cite: { doc: first[1], page: 2 } }] } };
  assert.deepEqual(matterToFragment(withTermCite, pathById(docIds)).meta?.definedTerms, [{ term: 'Doe', means: 'Plaintiff', cite: { path: first[0], page: 2 } }]);
});

test('the fragment builds through F4 against fresh ids: nothing unresolved, excluded or refused', async () => {
  const inputs = await loadFixtureInputs();
  const ids = new Map<string, string>(Object.keys(inputs.docIds).map((p) => [p, randomUUID()]));
  const resolver = { ids, paths: new Map([...ids].map(([p, id]) => [id, p])), sourceRoot: '/fixture' };
  const csv = fixtureFiles(inputs).find((f) => f.rel === CATALOG_REL)?.bytes.toString('utf8') ?? '';
  const fragment = matterToFragment(inputs.matter, pathById(inputs.docIds));
  const { matter, info } = assemble(parseCatalog(csv, '/fixture'), [{ name: 'dev-seed', fragment }], resolver, new Date('2026-10-01T12:00:00Z'));
  assert.equal(info.validation, null);
  assert.deepEqual([info.unresolved, info.unresolvedDocs, info.problems, info.exclusions], [[], [], [], []]);
  assert.ok(matter);
  assert.deepEqual(countsOf(matter), countsOf(inputs.matter));
  const fresh = new Set(ids.values());
  assert.ok(matter.events.every((e) => e.cites.every((c) => fresh.has(c.doc))));
  // Tracks and violations come through whole, nested cites included.
  assert.deepEqual(matter.violations.map((v) => [v.mark, v.steps.length, v.figures.length]), inputs.matter.violations.map((v) => [v.mark, v.steps.length, v.figures.length]));
  assert.ok(matter.violations.every((v) => [...v.cites, ...v.steps.flatMap((s) => s.cites), ...v.figures.flatMap((f) => f.cites)].every((c) => fresh.has(c.doc))));
  assert.ok(matter.tracks.every((t) => t.points.every((p) => p.proof.every((x) => fresh.has(x.cite.doc)))));
  // The complaint brief comes through whole on fresh ids, its draft included; the counts come through as written.
  const [built, source] = [matter, inputs.matter].map((m) => m.tracks.find((t) => t.id === 'track-complaint')!);
  const brief = built!.brief!;
  assert.deepEqual([brief.cast.length, brief.hurdles.length, brief.dates.length, brief.exhibits.length, brief.drafts.length], [6, 4, 3, 6, 1]);
  assert.ok([...brief.hurdles, ...brief.dates].every((x) => x.cites.every((c) => fresh.has(c.doc))) && brief.exhibits.every((x) => fresh.has(x.cite.doc)));
  assert.deepEqual(brief.drafts, [{ label: 'Draft complaint', doc: ids.get(pathById(inputs.docIds).get(source!.brief!.drafts[0]!.doc)!) }]);
  assert.deepEqual(built!.counts, source!.counts);
  assert.deepEqual(matter.orgs.map((o) => o.formed), [...inputs.matter.orgs].sort((a, b) => (a.id < b.id ? -1 : 1)).map((o) => o.formed ?? null));
});
