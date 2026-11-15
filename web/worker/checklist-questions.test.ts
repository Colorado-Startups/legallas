// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASELINE } from './checklist-baseline.ts';
import { questionsPack } from './checklist-questions.ts';
import { buildChecklist, type MatchRow } from './checklist.ts';

const COMPANY = { entityType: 'delaware-c-corporation', formationDate: '2026-09-28' };
const MATCH: MatchRow = { id: 'm1', item_id: 'formation.bylaws', document_id: 'doc-1', name: 'Bylaws.pdf', folder: 'Company', source: 'mirror', control_seq: 412, removed_at: null, signed: 'no', doc_date: null, next_date: null, parties: null, amount: null, matched_by: 'founder@example.test' };
const pack = (over: Partial<MatchRow> = {}, prefix: string | null = 'DOE') => questionsPack(buildChecklist(COMPANY, [{ ...MATCH, ...over }], [], '2026-11-01'), prefix);

test('every copy says it is not legal advice, and each point carries its cites', () => {
  const text = pack();
  assert.ok(text.includes(`> ${BASELINE.notice}`));
  assert.ok(text.trimEnd().endsWith(BASELINE.notice));
  assert.ok(text.includes(BASELINE.status));
  assert.ok(text.includes('In the room: DOE-000412, Company/Bylaws.pdf'), 'a room document by control number and place');
  assert.match(text, /Sources: \[[^\]]+\]\(https:\/\//);
  assert.equal(pack({}, null).includes('DOE-'), false, 'a room with no prefix prints no made-up one');
});

test('the pack lists every open date, with what it was worked out from', () => {
  const text = questionsPack(buildChecklist(COMPANY, [{ ...MATCH, item_id: 'founders.stock-purchase-agreement', doc_date: '2026-10-20' }], [], '2026-11-01'), 'DOE');
  assert.match(text, /## Dates/);
  assert.match(text, /Section 83\(b\) election with proof of timely filing: 2026-11-19\./);
  assert.match(text, /Worked out from: 30 days after 2026-10-20/);
});

test('what people typed reads as text: no link, image or tag can come through', () => {
  const text = pack({ parties: '[click](https://evil.example) ![x](https://evil.example/a.png) <img src=x>', name: 'a](https://evil.example).pdf' });
  assert.doesNotMatch(text, /(?<!\\)\]\(https:\/\/evil/);
  assert.doesNotMatch(text, /(?<!\\)<img/);
});
