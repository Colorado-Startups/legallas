// SPDX-License-Identifier: Apache-2.0
// The checklist card the Worker draws: the summary the card's route serves, in time or not at all, as escaped markup in the
// rows the browser builds. HTMLRewriter only runs in the Workers runtime; fixture-room.yml with fixture=company runs the
// rewrite itself. Invented fixture (Harbor Labs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChecklistSummary, StageSummary } from './checklist.ts';
import type { Env } from './env.ts';
import { cardParts, checklistCard, htmlEl } from './overview-checklist.ts';
import { handle } from './room.ts';
import { testDb } from './sqlite-d1.ts';

const OWNER = 'founder@example.test';

function room(enabled = '1') {
  const { db, sqlite } = testDb();
  sqlite.exec(`INSERT INTO members (email, role, name) VALUES ('${OWNER}', 'owner', 'Founder');`);
  const env = {
    ASSETS: { fetch: async () => new Response('shell') },
    DB: db,
    TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    ALLOW_DEV_IDENTITY: '1',
    DEV_IDENTITY_EMAIL: OWNER,
    CHECKLIST_ENABLED: enabled,
  } as unknown as Env;
  return env;
}

test('the card is what /api/checklist/summary serves the same member', async () => {
  const env = room();
  const res = await handle(new Request('http://localhost:8789/api/checklist/summary'), env, {} as ExecutionContext);
  assert.equal(res.status, 200);
  assert.deepEqual(await checklistCard(env, { role: 'owner' }, 5000), await res.json());
});

test('a room that serves no checklist draws no card, and reads nothing', async () => {
  let reads = 0;
  const db = { prepare: () => ((reads += 1), { bind: () => ({}) }) } as unknown as D1Database;
  assert.equal(await checklistCard({ CHECKLIST_ENABLED: '0', DB: db }, { role: 'owner' }), null);
  assert.equal(await checklistCard({ DB: db }, { role: 'owner' }), null);
  assert.equal(await checklistCard({ CHECKLIST_ENABLED: '1' }, { role: 'owner' }), null, 'no database binding');
  assert.equal(reads, 0);
});

test('a lookup slower than its wait leaves the card to the script', async () => {
  const never = new Promise<never>(() => undefined);
  const statement = { bind: () => statement, all: () => never, first: () => never, raw: () => never, run: () => never };
  const db = { prepare: () => statement, batch: () => never } as unknown as D1Database;
  const started = Date.now();
  assert.equal(await checklistCard({ CHECKLIST_ENABLED: '1', DB: db }, { role: 'owner' }, 20), null);
  assert.ok(Date.now() - started < 1000);
});

test('htmlEl escapes every text and attribute value, and keeps the elements it built', () => {
  const link = htmlEl('a', { href: '/x?a=1&b="2"', title: undefined }, '<b>Bold</b> & co');
  assert.equal(link.html, '<a href="/x?a=1&amp;b=&quot;2&quot;">&lt;b&gt;Bold&lt;/b&gt; &amp; co</a>');
  assert.equal(htmlEl('li', {}, link, null, false, "it's").html, `<li>${link.html}it&#39;s</li>`);
});

const stage = (id: string, label: string, counts: Partial<StageSummary>): StageSummary => ({
  id, label, reached: true, missing: 0, check: 0, in_place: 0, if_applies: 0, not_applicable: 0, not_yet: 0, ...counts,
});

test('the parts are the lines and rows checklist-card.ts writes', () => {
  const summary: ChecklistSummary = {
    notice: 'Not legal advice.',
    status: 'Draft list.',
    entityLabel: null,
    formationDate: '2025-01-15',
    reportMonth: null,
    stages: [stage('pre-formation', 'Pre-formation', { in_place: 2, missing: 1 }), { ...stage('ongoing', 'Ongoing', {}), reached: false }],
    nextDates: [{ itemId: 'ongoing.report', title: 'Report <annual>', date: '2026-03-31', opens: null, state: 'soon', basis: 'formation date' }],
  };
  const parts = cardParts(summary);
  assert.equal(parts.title, 'Forming the company: 2 of 3 in place.');
  assert.equal(parts.company, 'No entity type set, so every item shows; formed 2025-01-15.');
  assert.equal(parts.notice, 'Not legal advice. Draft list.');
  assert.equal(
    parts.stages,
    '<li class="cl-stage"><span class="t-small">Pre-formation</span><progress value="2" max="3" aria-label="Pre-formation: 2 of 3"></progress><span class="t-small cl-mono">2 of 3</span></li>' +
      '<li class="cl-stage cl-stage--later"><span class="t-small">Ongoing</span><progress value="0" max="1" aria-label="Ongoing: Later"></progress><span class="t-small cl-mono">Later</span></li>',
  );
  assert.equal(
    parts.dates,
    '<li class="cl-date"><span class="cl-date__when"><span class="t-small cl-mono">2026-03-31</span><span class="c-chip">Soon</span></span>' +
      '<span class="t-small"><a href="/checklist/#ongoing.report">Report &lt;annual&gt;</a></span></li>',
  );
});
