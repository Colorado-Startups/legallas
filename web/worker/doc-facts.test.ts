// SPDX-License-Identifier: Apache-2.0
// The core's document facts (doc-facts.ts, doc-facts-serve.ts): parsed from the manifest's fact sections alone,
// served for the live documents, and read from R2 once per etag. matter-serve.test.ts checks they match the
// litigation pack's whole-manifest parse and serve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDocFacts, resetDocFactsCache, serveDocFacts } from './doc-facts-serve.ts';
import { MatterError, parseDocFacts } from './doc-facts.ts';
import { MATTER_KEY } from './matter-types.ts';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const RAW = readFileSync(join(FIXTURES, 'matter.example.json'), 'utf8');
const NOW = new Date('2026-10-01T12:00:00Z');
const raw = () => JSON.parse(RAW) as Record<string, unknown>;
const facts = () => parseDocFacts(raw(), NOW);

test('the fixture parses to its documents, people and orgs, keyed by lowercase document id', () => {
  const parsed = facts();
  const source = raw() as { docs: Record<string, unknown>; people: unknown[]; orgs: unknown[] };
  assert.equal(Object.keys(parsed.docs).length, Object.keys(source.docs).length);
  assert.equal(parsed.people.length, source.people.length);
  assert.equal(parsed.orgs.length, source.orgs.length);
  assert.ok(Object.keys(parsed.docs).every((id) => id === id.toLowerCase()));
  const parties = new Set([...parsed.people, ...parsed.orgs].map((p) => p.id));
  assert.ok(Object.values(parsed.docs).every((d) => [...d.from, ...d.to].every((id) => parties.has(id))));
});

test('only the fact sections are read: a room without the litigation pack never parses tracks or violations', () => {
  const parsed = parseDocFacts({ ...raw(), tracks: 'not read', violations: 'not read', events: 'not read' }, NOW);
  assert.deepEqual(parsed, facts());
});

test('a bad version, a build stamped ahead of the clock, an unknown party or a repeated id is refused', () => {
  const refused = (change: (m: Record<string, unknown>) => void) => {
    const m = raw();
    change(m);
    assert.throws(() => parseDocFacts(m, NOW), MatterError);
  };
  refused((m) => (m.version = 2));
  refused((m) => ((m.meta as Record<string, unknown>).builtAt = '2026-10-01T13:00:00Z'));
  refused((m) => {
    const docs = m.docs as Record<string, { from: string[] }>;
    docs[Object.keys(docs)[0]!]!.from = ['p-nobody'];
  });
  refused((m) => {
    const orgs = m.orgs as { id: string }[];
    (m.people as { id: string }[])[0]!.id = orgs[0]!.id;
  });
});

test('serving keeps live documents with their control numbers and drops parties left with no live cite', () => {
  const parsed = facts();
  const ids = Object.keys(parsed.docs);
  const all = new Map(ids.map((id, i) => [id, i + 1]));
  const served = serveDocFacts(parsed, all);
  assert.deepEqual(Object.keys(served.docs), ids);
  assert.equal(served.docs[ids[0]!]!.control, 1);

  // A person cited by one document only, and a document naming them: removing the first drops the person.
  const person = parsed.people.find((p) => new Set(p.cites.map((c) => c.doc)).size === 1)!;
  const citing = person.cites[0]!.doc;
  const naming = ids.find((id) => id !== citing && [...parsed.docs[id]!.from, ...parsed.docs[id]!.to].includes(person.id))!;
  const live = new Map([...all].filter(([id]) => id !== citing));
  const without = serveDocFacts(parsed, live);
  assert.equal(citing in without.docs, false);
  assert.equal(without.people.some((p) => p.id === person.id), false);
  assert.equal([...without.docs[naming]!.from, ...without.docs[naming]!.to].includes(person.id), false);
});

/** An R2 bucket holding `body` at MATTER_KEY (or nothing), counting full reads; a matching etag returns no body. */
function bucket(body: string | null, etag = 'e1') {
  let reads = 0;
  const get = async (key: string, options?: { onlyIf?: { etagDoesNotMatch?: string } }) => {
    if (key !== MATTER_KEY || body === null) return null;
    if (options?.onlyIf?.etagDoesNotMatch === etag) return { key, etag };
    return { key, etag, body: new Response(body).body, text: async () => (reads++, body) };
  };
  return { files: { get } as unknown as R2Bucket, reads: () => reads };
}

test('the published facts are null before a publish, and parsed once per etag', async () => {
  resetDocFactsCache();
  assert.equal(await loadDocFacts(bucket(null).files, NOW), null);
  const r2 = bucket(RAW);
  const first = await loadDocFacts(r2.files, NOW);
  const second = await loadDocFacts(r2.files, NOW);
  assert.deepEqual(first, facts());
  assert.equal(second, first);
  assert.equal(r2.reads(), 1);
  resetDocFactsCache();
  await assert.rejects(loadDocFacts(bucket('{"version":0}').files, NOW), MatterError);
});
