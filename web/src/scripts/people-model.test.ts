// SPDX-License-Identifier: Apache-2.0
// Card P3 (People). The page's pure model, run against the Doe v. Harbor Labs fixture matter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServedMatter } from './matter-api.ts';
import {
  clientSideLabel, controlledBy, countsPhrase, documentsOf, eventsOf, matchParties, partiesOf, profileOf, readUrlState,
  roman, roleText, summaryLine, tableRows, violationsOf, writeUrlState,
} from './people-model.ts';

/** The fixture as GET /api/matter would serve it: every document numbered in key order. */
function served(): ServedMatter {
  const raw = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', 'matter.example.json'), 'utf8'));
  const seq = new Map(Object.keys(raw.docs).map((id, i) => [id, i + 1]));
  return JSON.parse(JSON.stringify(raw), (_key, value) => {
    if (value && typeof value === 'object' && typeof value.doc === 'string' && 'page' in value) {
      return { ...value, control: seq.get(value.doc) ?? null };
    }
    return value;
  }) as ServedMatter & { docs: Record<string, { control: number | null }> };
}

function matter(): ServedMatter {
  const m = served();
  Object.keys(m.docs).forEach((id, i) => { m.docs[id] = { ...m.docs[id]!, control: i + 1 }; });
  return m;
}

test('partiesOf lists people and orgs together, by name, with role words', () => {
  const parties = partiesOf(matter());
  assert.equal(parties.length, 27);
  assert.deepEqual(parties.map((p) => p.name), [...parties.map((p) => p.name)].sort((a, b) => a.localeCompare(b)));
  const roe = parties.find((p) => p.id === 'per-roe')!;
  assert.equal(roe.kind, 'person');
  assert.equal(roe.role, 'Defendant');
  assert.deepEqual(roe.orgs, ['org-harbor']);
  const board = parties.find((p) => p.id === 'org-board')!;
  assert.equal(board.kind, 'org');
  assert.equal(board.role, 'Organization');
  assert.deepEqual(board.orgs, ['org-harbor'], "an org's parent is its group");
});

test('summaryLine counts people and organizations', () => {
  assert.equal(summaryLine(partiesOf(matter())), '12 people and 15 organizations, placed by side');
  assert.equal(summaryLine(partiesOf({ people: [], orgs: matter().orgs.slice(0, 1) })), '0 people and 1 organization, placed by side');
});

test('profileOf joins connections both ways, membership, counts, events and documents', () => {
  const m = matter();
  const parties = partiesOf(m);
  const profile = profileOf(m, parties, 'per-roe')!;
  assert.equal(profile.party.name, 'Richard Roe');
  assert.deepEqual(profile.orgs.map((o) => o.id), ['org-harbor']);
  assert.deepEqual(profile.counts, [2, 5]);
  const ties = profile.connections.map((c) => [c.other.id, c.label, c.direction]);
  assert.deepEqual(ties, [
    ['org-harbor', 'co-founder of', 'out'],
    ['per-moe', 'emailed', 'in'],
    ['per-doe', 'wrote to', 'out'],
    ['org-board', 'sits on', 'out'],
  ]);
  assert.equal(profile.connections[1]!.sentence, 'Mark Moe emailed Richard Roe');
  assert.ok(profile.events.length > 0 && profile.events.every((e) => e.actors.includes('per-roe')));
  assert.ok(profile.documents.length > 0);
  assert.equal(profileOf(m, parties, 'p-nobody'), null);
});

test('membership without a link becomes a connection, never a duplicate', () => {
  const m = matter();
  const parties = partiesOf(m);
  const nina = profileOf(m, parties, 'per-note')!;
  assert.deepEqual(nina.connections.map((c) => [c.other.id, c.label, c.direction]), [['org-board', 'member of', 'out']]);
  const board = profileOf(m, parties, 'org-board')!;
  const labels = board.connections.map((c) => `${c.direction} ${c.label} ${c.other.id}`);
  assert.ok(labels.includes('in governed by org-harbor'), 'the record link wins over the parent tie');
  assert.ok(!labels.includes('out part of org-harbor'));
  assert.ok(labels.includes('in member of per-note'));
});

test('documentsOf finds senders and recipients, oldest first', () => {
  const m = matter();
  const docs = documentsOf('per-doe', m.docs);
  assert.ok(docs.length > 1);
  for (const d of docs) {
    const facts = m.docs[d.id]!;
    const from = facts.from.includes('per-doe');
    const to = facts.to.includes('per-doe');
    assert.equal(d.role, from && to ? 'both' : from ? 'from' : 'to');
    assert.equal(d.control, facts.control);
  }
  const dates = docs.map((d) => d.date ?? '9999');
  assert.deepEqual(dates, [...dates].sort());
  assert.deepEqual(documentsOf('p-nobody', m.docs), []);
});

test('eventsOf sorts by partial date', () => {
  const events = eventsOf('a', [
    { id: 'e2', date: '2012-05', actors: ['a'] }, { id: 'e1', date: '2011', actors: ['a', 'b'] },
    { id: 'e3', date: '2012-05-02', actors: ['b'] },
  ] as never);
  assert.deepEqual(events.map((e) => e.id), ['e1', 'e2']);
});

test('tableRows order by side then name, with org names and counts', () => {
  const m = matter();
  const rows = tableRows(m, partiesOf(m));
  assert.equal(rows.length, 27);
  assert.deepEqual([...new Set(rows.map((r) => r.party.side))], ['client', 'defendant', 'nominal', 'court', 'third']);
  const roe = rows.find((r) => r.party.id === 'per-roe')!;
  assert.equal(roe.orgNames, 'Harbor Labs, Inc.');
  assert.equal(roe.events, m.events.filter((e) => e.actors.includes('per-roe')).length);
  assert.equal(roe.documents, documentsOf('per-roe', m.docs).length);
});

test('countsPhrase writes counts as the pleading numbers them', () => {
  assert.equal(countsPhrase([]), '');
  assert.equal(countsPhrase([2]), 'Count II');
  assert.equal(countsPhrase([2, 3]), 'Counts II and III');
  assert.equal(countsPhrase([1, 4, 9]), 'Counts I, IV and IX');
  assert.equal(roman(14), 'XIV');
  assert.equal(roman(0), '0');
});

test('matchParties folds case and accents and needs every word', () => {
  const parties = partiesOf(matter());
  assert.deepEqual(matchParties(parties, 'harbor lab').map((p) => p.id), ['org-harbor']);
  assert.equal(matchParties(parties, '  ').length, parties.length);
  assert.deepEqual(matchParties([{ ...parties[0]!, name: 'Tomás Ibarra' }], 'tomas').length, 1);
});

test('the URL carries the chosen party and the view, Structure by default, and refuses odd ids', () => {
  assert.deepEqual(readUrlState('?p=per-roe'), { party: 'per-roe', view: 'structure' });
  assert.deepEqual(readUrlState('?p=<script>&view=table'), { party: null, view: 'table' });
  assert.deepEqual(readUrlState('?view=graph'), { party: null, view: 'graph' });
  assert.deepEqual(readUrlState('?view=structure'), { party: null, view: 'structure' });
  assert.deepEqual(readUrlState('?view=other'), { party: null, view: 'structure' });
  assert.deepEqual(readUrlState(''), { party: null, view: 'structure' });
  assert.equal(writeUrlState('?x=1', { party: 'org-board', view: 'table' }), '?x=1&p=org-board&view=table');
  assert.equal(writeUrlState('?x=1', { party: null, view: 'graph' }), '?x=1&view=graph');
  assert.equal(writeUrlState('?p=a&view=table', { party: null, view: 'structure' }), '');
});

test('the By date view and its violation travel in the URL; ?v= means nothing on the other views', () => {
  assert.deepEqual(readUrlState('?view=dates'), { party: null, view: 'dates', violation: null });
  assert.deepEqual(readUrlState('?view=dates&v=viol-repurchase&p=org-alder-peak'), { party: 'org-alder-peak', view: 'dates', violation: 'viol-repurchase' });
  assert.deepEqual(readUrlState('?view=dates&v=<b>'), { party: null, view: 'dates', violation: null });
  assert.deepEqual(readUrlState('?view=graph&v=v-c'), { party: null, view: 'graph' });
  assert.equal(writeUrlState('', { party: null, view: 'dates', violation: 'v-a' }), '?view=dates&v=v-a');
  assert.equal(writeUrlState('?view=dates&v=v-a', { party: null, view: 'dates', violation: null }), '?view=dates');
  assert.equal(writeUrlState('?view=dates&v=v-a', { party: null, view: 'table', violation: 'v-a' }), '?view=table');
});

test('roleText never repeats the role inside the title', () => {
  assert.equal(roleText('Counsel for plaintiff', 'Counsel for plaintiff'), 'Counsel for plaintiff');
  assert.equal(roleText('Witness', 'Office manager'), 'Witness; Office manager');
  assert.equal(roleText('Company', null), 'Company');
});

test("clientSideLabel uses the plaintiff's defined term", () => {
  const m = matter();
  assert.equal(clientSideLabel(m), "Doe's side");
  assert.equal(clientSideLabel({ ...m, meta: { ...m.meta, definedTerms: [] } }), 'Client side');
  assert.equal(clientSideLabel({ ...m, people: [] }), 'Client side');
});

test('violations naming a party come by mark; a manifest without them has none', () => {
  const v = (id: string, mark: string, actors: string[], entities: string[] = []) => ({ id, mark, title: `Violation ${mark}`, actors, entities });
  const m = { violations: [v('viol-repurchase', 'C', ['per-roe'], ['org-board']), v('viol-notice', 'A', ['per-roe']), v('viol-bridge', 'B', ['per-moe'])] } as unknown as Pick<ServedMatter, 'violations'>;
  assert.deepEqual(violationsOf(m, 'per-roe').map((x) => x.mark), ['A', 'C']);
  assert.deepEqual(violationsOf(m, 'org-board').map((x) => x.id), ['viol-repurchase']);
  assert.deepEqual(violationsOf({} as Pick<ServedMatter, 'violations'>, 'per-roe'), []);
});

test('entities controlled come from the structure and the control links only', () => {
  const org = (id: string, parent: string | null) => ({ id, name: id, kind: 'company' as const, side: 'defendant' as const, parent, cites: [] });
  const link = (from: string, label: string, to: string) => ({ from, label, to, cites: [] });
  const m = {
    orgs: [org('hold', null), org('building', 'hold'), org('unit', 'building'), org('tenant', null)],
    links: [link('p-roe', 'manages', 'hold'), link('p-moe', 'officer of', 'hold'), link('p-doe', 'trustee of', 'tenant'), link('p-roe', 'emailed', 'p-doe')],
  } as unknown as Pick<ServedMatter, 'orgs' | 'links'>;
  assert.equal(controlledBy('hold', m), 2, 'everything under it, at any depth');
  assert.equal(controlledBy('unit', m), 0);
  assert.equal(controlledBy('p-roe', m), 3, 'manages the top company and so what sits under it');
  assert.equal(controlledBy('p-moe', m), 0, 'an officer is not counted as control');
  assert.equal(controlledBy('p-doe', m), 1, 'trustee of the tenant company');
});

test('the unit card counts violations, entities and the distinct documents the profile cites', () => {
  const base = matter() as ServedMatter & { violations?: unknown };
  // A partial violation: the profile reads only id, mark, title, actors and entities.
  const m = { ...base, violations: [{ id: 'viol-notice', mark: 'A', title: 'T', actors: ['per-roe'], entities: [] }] } as unknown as ServedMatter;
  const parties = partiesOf(m);
  const profile = profileOf(m, parties, 'per-roe')!;
  assert.deepEqual(profile.violations, [{ id: 'viol-notice', mark: 'A', title: 'T' }]);
  assert.equal(profile.unit.violations, 1);
  assert.equal(profile.unit.controlled, controlledBy('per-roe', m));
  const docs = new Set([
    ...profile.party.cites, ...profile.connections.flatMap((c) => c.cites), ...profile.events.flatMap((e) => e.cites),
  ].map((c) => c.doc));
  for (const d of profile.documents) docs.add(d.id);
  assert.equal(profile.unit.documents, docs.size);
  assert.ok(profile.unit.documents > 0);
  const { violations: _dropped, ...rest } = base;
  const older = rest as unknown as ServedMatter;
  assert.deepEqual(profileOf(older, partiesOf(older), 'per-roe')!.violations, [], 'none from a manifest without them');
});
