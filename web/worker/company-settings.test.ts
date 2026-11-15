// SPDX-License-Identifier: Apache-2.0
// The company's facts as the room owner sets them on /checklist/: the check on what is sent, the append-only store, and
// the list worked out again from them. Invented facts (Harbor Labs). No npm imports, so it runs anywhere.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildChecklist, type ChecklistView } from './checklist.ts';
import { configuredCompany, parseCompanyInput, readCompany, saveCompany } from './company-settings.ts';
import type { Member } from './env.ts';
import { testDb } from './sqlite-d1.ts';

const OWNER = { email: 'founder@example.test', role: 'owner', name: 'Founder' } as Member;
const TODAY = '2026-11-01';
const AT = new Date('2026-11-01T12:00:00.000Z');

test('what is sent is checked: a known entity type, a real day no later than tomorrow, a month 1 to 12', () => {
  const parse = (raw: Record<string, unknown>) => parseCompanyInput(raw, TODAY);
  assert.deepEqual(parse({ entityType: 'colorado-llc', formationDate: '2026-11-02', reportMonth: '6' }), {
    ok: true,
    value: { entityType: 'colorado-llc', formationDate: '2026-11-02', reportMonth: 6 },
  });
  assert.deepEqual(parse({ reportMonth: 12 }), { ok: true, value: { reportMonth: 12 } }, 'a fact left out stays out');
  assert.deepEqual(parse({ entityType: '', formationDate: null, reportMonth: '' }), { ok: true, value: { entityType: null, formationDate: null, reportMonth: null } }, 'blank clears');
  const refused: [Record<string, unknown>, string][] = [
    [{ entityType: 'nevada-llc' }, 'entityType'],
    [{ entityType: 7 }, 'entityType'],
    [{ formationDate: '2026-02-30' }, 'formationDate'],
    [{ formationDate: '2026-11-03' }, 'formationDate'],
    [{ formationDate: '11/01/2026' }, 'formationDate'],
    [{ reportMonth: 13 }, 'reportMonth'],
    [{ reportMonth: '0' }, 'reportMonth'],
    [{ reportMonth: 6.5 }, 'reportMonth'],
    [{ reportMonth: 'June' }, 'reportMonth'],
  ];
  for (const [raw, field] of refused) assert.deepEqual(parse(raw), { ok: false, field }, JSON.stringify(raw));
});

test('before the owner saves, the room config stands; each change is a new row, and the same facts again add none', async () => {
  const { db, sqlite } = testDb();
  const rows = () => (sqlite.prepare('SELECT COUNT(*) AS n FROM company_settings').get() as { n: number }).n;
  assert.deepEqual(await readCompany(db), { ...configuredCompany(), setBy: null, setAt: null });
  const saved = await saveCompany(db, OWNER, { entityType: 'delaware-c-corporation', formationDate: '2026-02-10' }, AT);
  assert.deepEqual(saved, { entityType: 'delaware-c-corporation', formationDate: '2026-02-10', reportMonth: null, setBy: OWNER.email, setAt: AT.toISOString() });
  assert.deepEqual(await readCompany(db), saved);
  await saveCompany(db, OWNER, { formationDate: '2026-02-10' }, AT);
  assert.equal(rows(), 1, 'a second press of Save writes nothing');
  const later = new Date('2026-11-02T09:00:00.000Z');
  assert.deepEqual(
    await saveCompany(db, OWNER, { reportMonth: 4 }, later),
    { entityType: 'delaware-c-corporation', formationDate: '2026-02-10', reportMonth: 4, setBy: OWNER.email, setAt: later.toISOString() },
    'a fact left out keeps what is in force',
  );
  assert.equal((await saveCompany(db, OWNER, { entityType: null }, later)).entityType, null, 'one sent empty clears');
  assert.equal(rows(), 3);
  assert.throws(() => sqlite.exec('UPDATE company_settings SET report_month = 5'), /append-only/);
  assert.throws(() => sqlite.exec('DELETE FROM company_settings'), /append-only/);
  assert.throws(() => sqlite.exec("INSERT INTO company_settings (formation_date, set_by, set_at) VALUES ('2026-02-30', 'x', '2026-11-01T00:00:00.000Z')"), /CHECK/);
  // A saved value the list no longer knows counts as unset, as the room config's does.
  sqlite.exec("INSERT INTO company_settings (entity_type, set_by, set_at) VALUES ('retired-type', 'x', '2026-11-03T00:00:00.000Z')");
  assert.equal((await readCompany(db)).entityType, null);
});

test('the list follows the facts: the entity type picks the items, the formation date and report month move the dates', async () => {
  const { db } = testDb();
  const list = async () => buildChecklist(await readCompany(db), [], [], TODAY);
  const find = (view: ChecklistView, id: string) => view.items.find((item) => item.id === id);
  const report = (view: ChecklistView) => find(view, 'compliance-and-governance.colorado-periodic-report');
  const tax = (view: ChecklistView) => find(view, 'compliance-and-governance.delaware-franchise-tax');

  // Day one: nothing set, so every item shows and no date can be worked out.
  let view = await list();
  assert.ok(find(view, 'formation.bylaws') && find(view, 'formation.operating-agreement'));
  assert.match(tax(view)?.dateHint ?? '', /Set the formation date on the checklist page/);

  await saveCompany(db, OWNER, { entityType: 'colorado-llc', formationDate: '2026-02-10' }, AT);
  view = await list();
  assert.equal(find(view, 'formation.bylaws'), undefined, 'an LLC keeps no bylaws');
  assert.ok(find(view, 'formation.operating-agreement'));
  assert.deepEqual(report(view)?.dates.map((date) => [date.opens, date.date]), [['2026-12-01', '2027-04-30']], 'a Colorado company: around the formation month');

  await saveCompany(db, OWNER, { entityType: 'delaware-c-corporation' }, AT);
  view = await list();
  assert.ok(find(view, 'formation.bylaws'));
  assert.equal(find(view, 'formation.operating-agreement'), undefined);
  assert.deepEqual(tax(view)?.dates.map((date) => date.date), ['2027-03-01']);
  assert.equal(report(view)?.status, 'if_applies', 'a Delaware company files in Colorado only once it has authority there');
  assert.match(report(view)?.dateHint ?? '', /room owner can set it on the checklist page/);

  // The owner sets the month the state's record names: the report applies, and its window moves to that month.
  await saveCompany(db, OWNER, { reportMonth: 9 }, AT);
  view = await list();
  assert.equal(report(view)?.status, 'not_yet');
  assert.deepEqual(report(view)?.dates.map((date) => [date.opens, date.date]), [['2027-07-01', '2027-11-30']]);
  assert.match(report(view)?.dates[0]?.basis ?? '', /report month set for this room, September/);
  assert.equal(view.reportMonth, 9);

  // An earlier formation date: the first franchise tax date has passed.
  await saveCompany(db, OWNER, { formationDate: '2025-02-10' }, AT);
  view = await list();
  assert.deepEqual(tax(view)?.dates.map((date) => [date.date, date.state]), [['2026-03-01', 'passed']]);
  assert.equal(tax(view)?.status, 'missing');
});
