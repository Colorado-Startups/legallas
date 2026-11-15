// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { buildPack } from './counsel-pack-build.ts';
import { parseCounselPackArgs } from './counsel-pack.ts';
import { PACK_COMPANY_SQL, PACK_MATCHES_SQL, PACK_NOT_APPLICABLE_SQL, questionsText } from './counsel-pack-questions.ts';
import { fixture } from './counsel-pack-testkit.ts';
import { QUESTIONS_NAME, isReservedRel } from './counsel-pack-plan.ts';
import { listZip } from './counsel-pack-zip.ts';

const match = (over: Record<string, unknown> = {}) => ({
  id: 'm1', item_id: 'formation.bylaws', document_id: 'doc-1', name: 'Bylaws.pdf', path: 'Company/Bylaws.pdf', folder: 'Company', source: 'mirror',
  control_seq: 412, removed_at: null, signed: 'no', doc_date: null, next_date: null, parties: null, amount: null, matched_by: 'founder@example.test', ...over,
});

test('--questions is off unless asked for', () => {
  assert.equal(parseCounselPackArgs(['--out', '/tmp/p']).questions, false);
  assert.equal(parseCounselPackArgs(['--out', '/tmp/p', '--questions']).questions, true);
});

test('the text is the room download: notice, cites and control numbers; counsel sees a privileged path, as in the room', () => {
  const text = questionsText([match(), match({ id: 'm2', document_id: 'doc-2', path: 'Privileged/Memo.pdf', name: 'Memo.pdf', item_id: 'formation.incorporator-action' })], [], '2026-11-01', 'DOE');
  assert.match(text, /^# Questions for your lawyer/);
  assert.match(text, /In the room: DOE-000412, Company\/Bylaws\.pdf/);
  assert.match(text, /Sources: \[[^\]]+\]\(https:\/\//);
});

test('a malformed row is dropped, never guessed', () => {
  const text = questionsText([match({ name: 7, id: 'bad' }), match({ signed: 'maybe' })], [{ item_id: 3 }], '2026-11-01', 'DOE');
  assert.match(text, /DOE-000412, Company\/Bylaws\.pdf \(not known if signed\)/, 'an unknown signed value counts as not known');
  assert.equal(text.match(/In the room:/g)?.length, 1, 'the row with no name is dropped');
});

test('the company facts the owner saved in the room pick the items and say the report month, as on /checklist/', () => {
  const saved = (row: Record<string, unknown>) => questionsText([], [], '2026-11-01', 'DOE', [row]);
  const llc = saved({ entity_type: 'colorado-llc', formation_date: '2026-02-10', report_month: 9 });
  assert.match(llc, /- Company: [^\n]*, formed 2026-02-10, Colorado report month September/);
  assert.match(llc, /Operating agreement/i);
  assert.doesNotMatch(llc, /\*\*Bylaws/);
  assert.match(questionsText([], [], '2026-11-01', 'DOE'), /entity type not set in the room/, 'none saved: the room config, here unset');
  assert.match(saved({ entity_type: 'retired-type', formation_date: 'soon', report_month: 'June' }), /entity type not set in the room, formation date not set in the room\n/, 'a value the list cannot use counts as unset');
});

test('a run with --questions writes the file and puts it in the zip; without it, no file', async () => {
  const f = await fixture();
  try {
    const inner = f.deps.d1Query;
    f.deps.d1Query = async (sql: string) => {
      if (sql === PACK_MATCHES_SQL) return [match()];
      if (sql === PACK_NOT_APPLICABLE_SQL) return [];
      if (sql === PACK_COMPANY_SQL) return [];
      return inner(sql);
    };
    await buildPack(f.options(), f.deps);
    assert.equal(await stat(path.join(f.out, QUESTIONS_NAME)).catch(() => null), null);
    await buildPack(f.options({ questions: true, zip: true }), f.deps);
    assert.match(await readFile(path.join(f.out, QUESTIONS_NAME), 'utf8'), /DOE-000412/);
    assert.ok((await listZip(`${f.out}.zip`)).some((entry) => entry.name === QUESTIONS_NAME));
    assert.equal(isReservedRel(QUESTIONS_NAME.toLowerCase()), true, 'a document cannot take its name');
  } finally {
    await f.done();
  }
});

test('a dry run writes nothing', async () => {
  const f = await fixture();
  try {
    await buildPack(f.options({ questions: true, dryRun: true }), f.deps);
    assert.equal(await stat(f.out).catch(() => null), null);
  } finally {
    await f.done();
  }
});
