// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { BURST_RETRY_AFTER_SECONDS, datedLawRow, daysBefore, factorCitations, privilegedPaths, roomApiFailures, tallyCites, tallyFailures, type RoomApiResult } from './kit-checks.ts';
import { loadModule } from './load-module.ts';

const PRIV = 'ddd8ed42-903b-45d9-9960-874b64f7e1a2';
const privileged = new Set([PRIV]);
const link = (id: string, page?: number) => `http://localhost:8789/doc/?id=${id}${page ? `#page=${page}` : ''}`;

test('a cited search result with control and page link passes', () => {
  const value = { retrieved: '2026-11-06', results: [{ id: 'a', control: 'DOE-000012', page: 3, link: link('a', 3), text: 'x' }] };
  const tally = tallyCites(value, 'DOE', privileged);
  assert.deepEqual([tally.cited, tally.pageLinks, tally.badPageLinks], [1, 1, 0]);
  assert.deepEqual(tallyFailures(tally, true), []);
});

test('a missing control, a wrong prefix, a missing link and a link to the wrong page each fail', () => {
  const value = {
    documents: [
      { id: 'a', control: null, link: link('a'), title: 't', privileged: false },
      { id: 'b', control: 'XYZ-000001', link: link('b'), title: 't', privileged: false },
      { id: 'c', control: 'DOE-000003', title: 't', privileged: false },
    ],
    pages: [{ page: 2, link: link('d', 3), text: 'x' }],
  };
  const failures = tallyFailures(tallyCites(value, 'DOE', privileged), false);
  assert.equal(failures.length, 4);
});

test('a guest fails on a privileged row or a link naming a privileged id; a member does not', () => {
  const marked = tallyCites({ documents: [{ id: 'z', control: 'DOE-000009', link: link('z'), privileged: true }] }, 'DOE', privileged);
  const named = tallyCites({ results: [{ id: 'y', control: 'DOE-000010', link: link(PRIV, 1), page: 1, text: 'x' }] }, 'DOE', privileged);
  assert.deepEqual(marked.privileged, ['z']);
  assert.deepEqual(named.privileged, [PRIV]);
  assert.match(tallyFailures(named, true).join(), /privileged/);
  assert.deepEqual(tallyFailures(named, false), []);
});

test('law rows need their source and retrieved date', () => {
  const tally = tallyCites({ results: [{ citation: 'C.R.S. 7-80-108', source_url: 'https://x', retrieved: '2026-10-01', text: 't' }, { citation: '8 Del. C. 141', text: 't' }] }, 'DOE', privileged);
  assert.deepEqual([tally.lawRows, tally.badLawRows], [2, 1]);
});

test("the entity matrix's factor citations come from its reference", async () => {
  const markdown = await readFile(new URL('../connect/skill/legallas/references/entity-matrix.md', import.meta.url), 'utf8');
  const cites = factorCitations(markdown);
  assert.ok(cites.length >= 15, `only ${cites.length} citations`);
  assert.ok(cites.includes('26 U.S.C. § 1202'));
  assert.ok(cites.every((cite) => /\d/.test(cite) && !cite.includes('|')));
});

test("a factor's law row counts only when it is that statute, dated", () => {
  const row = (citation: string, retrieved: unknown = '2026-11-01') => ({ citation, retrieved, source_url: 'https://x' });
  assert.equal(datedLawRow('C.R.S. § 7-90-501', [row('C.R.S. § 7-90-501(1)')]), true);
  assert.equal(datedLawRow('C.R.S. 7-90-501', [row('C.R.S. § 7-90-501')]), true);
  assert.equal(datedLawRow('C.R.S. § 7-90-501', [row('C.R.S. § 7-90-502')]), false, 'another section');
  assert.equal(datedLawRow('C.R.S. § 7-90-501', [row('C.R.S. § 7-90-501', null)]), false, 'no date');
  assert.equal(datedLawRow('C.R.S. § 7-90-501', []), false);
  assert.equal(datedLawRow('not a cite', [row('C.R.S. § 7-90-501')]), false);
});

const closedRoom = (): RoomApiResult => ({
  rooms_status: 200,
  documents_status: 200,
  documents: 17,
  direct: [{ id: PRIV, file: 404, viewer: 404 }],
  privileged: [],
});

test('a guest room that lists documents and 404s each privileged route passes', () => {
  assert.deepEqual(roomApiFailures(closedRoom()), []);
});

test('a documents list that answered 404 checked nothing, so it fails', () => {
  const failures = roomApiFailures({ ...closedRoom(), documents_status: 404, documents: null });
  assert.equal(failures.length, 2);
  assert.match(failures.join(), /documents list answered 404/);
});

test('an empty documents list fails', () => {
  assert.deepEqual(roomApiFailures({ ...closedRoom(), documents: 0 }), ['documents list held 0']);
});

test('a privileged route that answered 401 fails: only exactly 404 passes', () => {
  const failures = roomApiFailures({ ...closedRoom(), direct: [{ id: PRIV, file: 401, viewer: 404 }] });
  assert.deepEqual(failures, [`privileged ${PRIV}: file 401, view 404, not 404`]);
});

test('a privileged id the list names fails', () => {
  assert.match(roomApiFailures({ ...closedRoom(), privileged: [PRIV] }).join(), /listed or opened 1 privileged/);
});

test("privilegedPaths finds the fixture matter's privileged work product by path", async () => {
  const read = async (name: string) => JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
  const paths = privilegedPaths(await read('doc-ids.json'), await read('matter.example.json'));
  assert.equal(paths.length, 3);
  assert.ok(paths.every((rel) => rel.startsWith('10-')));
  assert.deepEqual(privilegedPaths({ 'a.pdf': 'x', 'b.pdf': 'y' }, { docs: { x: { privileged: true }, y: { privileged: 'yes' } } }), ['a.pdf']);
});

test("kit-run's mirrors equal worker/burst.ts, mcp/prompts.ts and mcp/contract.ts", async () => {
  const burst = await loadModule<{ BURST_RETRY_AFTER_SECONDS: number }>('worker/burst.ts');
  assert.equal(BURST_RETRY_AFTER_SECONDS, burst.BURST_RETRY_AFTER_SECONDS);
  const prompts = await loadModule<{ daysBefore(now: Date, days: number): string }>('mcp/prompts.ts');
  const now = new Date('2026-03-01T05:00:00Z');
  for (const days of [0, 1, 14, 30, 366]) assert.equal(daysBefore(now, days), prompts.daysBefore(now, days), `daysBefore ${days}`);
  const contract = await loadModule<{ CONTROL_PREFIX_FALLBACK: string }>('mcp/contract.ts');
  const config = await import('./config.ts');
  assert.equal(config.CONTROL_PREFIX_FALLBACK, contract.CONTROL_PREFIX_FALLBACK);
});
