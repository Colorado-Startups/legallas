// SPDX-License-Identifier: Apache-2.0
// The Documents table's pure data layer (card P5a), on the fictional Doe v. Harbor Labs fixture.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildIndex, emptyFilter, facetCounts, filterRows, findFolder, flattenIndex, hasMark, joinRows, markedHref, marksFromSearch, NEWEST_FIRST_HREF, privilegedFolder,
  remarkFresh,
  sortFromSearch, sortRows,
  type DocRow, type ListedRow, type ListedTree,
} from './documents-table-data.ts';
import { matchesQuery } from './files-format.ts';
import type { ServedMatter } from './doc-facts.ts';

function file(id: string, name: string, extra: Partial<ListedRow> = {}): ListedRow {
  return { id, name, kind: 'pdf', size: 10, pages: 2, updated_at: '2026-09-30T00:00:00Z', source: 'mirror', ...extra };
}

function folder(path: string, files: ListedRow[] = [], folders: ListedTree[] = [], guide: ListedRow | null = null): ListedTree {
  return { path, name: path.split('/').pop() ?? '', guide, files, folders, count: 0, size: 0 };
}

const tree: ListedTree = folder('', [file('r1', 'README.pdf', { control_seq: 1 })], [
  folder('01-Contracts', [file('o1', 'Catalog.csv', { control_seq: 2, pages: null })], [], file('g0', 'CLAUDE.md')),
  folder('04-Letters', [], [
    folder('04-Letters/Drafts', [file('d1', 'Draft reply.pdf', { control_seq: 9 })]),
    folder('04-Letters/Sent', [
      file('p1', 'Cover-letter.pdf', { control_seq: 231, key_at: '2026-09-30T01:00:00Z' }),
      file('p2', 'Email.pdf', { control_seq: 232 }),
    ]),
  ]),
  folder('10-Lawyer-Analysis', [], [folder('10-Lawyer-Analysis/PRIVILEGED notes', [file('w1', 'Memo.pdf', { control_seq: 40 })])]),
  folder('from-counsel', [file('c1', 'Cover-note.pdf', { control_seq: 300, source: 'counsel' })]),
  folder('Loose', [file('l1', 'Note.txt', { control_seq: 301, kind: 'text' })]),
]);

const matter = {
  people: [{ id: 'pat-teller', name: 'P. Teller' }, { id: 'richard-roe', name: 'R. Roe' }],
  orgs: [{ id: 'tally-payroll', name: 'Tally Payroll' }, { id: 'copperline', name: 'Copperline' }],
  docs: {
    p1: { date: '2012-05-03', type: 'Letter', from: ['tally-payroll'], to: ['copperline'], summary: 'Cover letter for a part payment', privileged: false, control: 231 },
    p2: { date: '2012-05-02', type: 'Email', from: ['pat-teller'], to: ['richard-roe', 'gone'], summary: 'Asks to confirm the Friday drop', privileged: false, control: 232 },
    d1: { date: '2012-09', type: 'Draft', from: [], to: [], summary: null, privileged: true, control: 9 },
  },
} as unknown as ServedMatter;

const rows = joinRows({ root: tree, matter, discussed: new Set(['p2']), prefix: 'DOE' });
const byId = (id: string) => rows.find((r) => r.id === id)!;
const ids = (list: readonly DocRow[]) => list.map((r) => r.id);

test('the index numbers top folders by prefix and subfolders .1, .2 in name order', () => {
  const index = buildIndex(tree);
  const flat = flattenIndex(index).map(({ folder: f, depth }) => `${depth}:${f.number}:${f.label}:${f.count}`);
  assert.deepEqual(flat, [
    '0:01:Contracts:1',
    '0:04:Letters:3',
    '1:04.1:Drafts:1',
    '1:04.2:Sent:2',
    '0:10:Lawyer Analysis:1',
    '1:10.1:PRIVILEGED notes:1',
    '0::Loose:1',
    '0::From counsel:1',
  ]);
  assert.deepEqual(index.map((f) => f.number || f.label), ['01', '04', '10', 'Loose', 'From counsel']);
  assert.equal(findFolder(index, '04-Letters/Sent')?.number, '04.2');
  assert.equal(findFolder(index, '01-Contracts')?.guide?.id, 'g0');
  assert.equal(findFolder(index, 'nope'), null);
});

test('rows join control numbers, facts, party names, privilege, Key and discussion', () => {
  assert.equal(rows.length, 8);
  const letter = byId('p1');
  assert.equal(letter.control, 'DOE-000231');
  assert.equal(letter.date, '2012-05-03');
  assert.equal(letter.parties, 'Tally Payroll → Copperline');
  assert.equal(letter.key, true);
  assert.equal(letter.summary, 'Cover letter for a part payment');
  // An unknown party id is dropped; one side alone has no arrow.
  assert.equal(byId('p2').parties, 'P. Teller → R. Roe');
  assert.equal(byId('p2').discussion, true);
  // No facts: the type comes from the extension, the summary is the reading title (R64), the date stays blank.
  const loose = byId('l1');
  assert.deepEqual([loose.type, loose.summary, loose.date, loose.parties], ['Text', 'Note', '', '']);
  assert.equal(byId('d1').privileged, true, 'facts say privileged');
  assert.equal(byId('w1').privileged, true, 'a PRIVILEGED folder');
  assert.equal(byId('c1').counsel, true);
  assert.equal(byId('o1').pages, null);
});

test('without a matter (not built yet) every row still lists', () => {
  const bare = joinRows({ root: tree, matter: null, discussed: new Set(), prefix: 'DOE' });
  assert.equal(bare.length, 8);
  assert.equal(bare.find((r) => r.id === 'p1')!.summary, 'Cover letter');
  const unnumbered = joinRows({ root: folder('', [file('x', 'x.pdf')]), matter: null, discussed: new Set(), prefix: 'DOE' });
  assert.equal(unnumbered[0]!.control, '');
});

test('a filename DocType reads as a title in the Type column and the fallback summary (R64)', () => {
  const t1 = { date: '2013-09-24', type: 'Order Compel', from: [], to: [], summary: null, privileged: false, control: 44 };
  const titled = joinRows({
    root: folder('', [file('t1', 'Order-Compel__20130924__Court.pdf', { control_seq: 44 })]),
    matter: { ...matter, docs: { t1 } } as unknown as ServedMatter,
    discussed: new Set(),
    prefix: 'DOE',
  });
  assert.deepEqual([titled[0]!.type, titled[0]!.summary], ['Order compelling discovery', 'Order compelling discovery, Court']);
  assert.ok(matchesQuery(titled[0]!.haystack, 'Order-Compel__20130924'), 'the file name still finds the row');
});

test('the PRIVILEGED folder reading matches the matter build', () => {
  assert.ok(privilegedFolder('10/PRIVILEGED notes'));
  assert.ok(privilegedFolder('Privileged'));
  assert.ok(!privilegedFolder('10/Non-privileged'));
  assert.ok(!privilegedFolder('10/not privileged'));
  assert.ok(!privilegedFolder(''));
});

test('a folder includes its subfolders; words, month and counsel narrow', () => {
  assert.deepEqual(ids(filterRows(rows, emptyFilter('04-Letters'))), ['d1', 'p1', 'p2']);
  assert.deepEqual(ids(filterRows(rows, emptyFilter('04-Letters/Sent'))), ['p1', 'p2']);
  assert.deepEqual(ids(filterRows(rows, { ...emptyFilter(), query: 'teller' })), ['p2']);
  assert.deepEqual(ids(filterRows(rows, { ...emptyFilter(), query: 'DOE-000231' })), ['p1']);
  assert.deepEqual(ids(filterRows(rows, { ...emptyFilter(), month: '2012-05' })), ['p1', 'p2']);
  // The heatmap's rule: no matter date means the month the room last saw the file.
  assert.deepEqual(ids(filterRows(rows, { ...emptyFilter(), month: '2026-09' })), ['r1', 'o1', 'w1', 'c1', 'l1']);
  assert.equal(byId('d1').month, '2012-09');
  assert.deepEqual(ids(filterRows(rows, { ...emptyFilter(), counsel: true })), ['c1']);
  // The folder prefix is a path segment, not a string prefix.
  assert.deepEqual(ids(filterRows(rows, emptyFilter('04-Let'))), []);
});

test('facets: OR within a group, AND across groups, marks must all hold', () => {
  const f = emptyFilter();
  assert.deepEqual(ids(filterRows(rows, { ...f, types: new Set(['Email', 'Letter']) })), ['p1', 'p2']);
  assert.deepEqual(ids(filterRows(rows, { ...f, types: new Set(['Email', 'Draft']), privilege: new Set(['privileged']) })), ['d1']);
  assert.deepEqual(ids(filterRows(rows, { ...f, marks: new Set(['key']) })), ['p1']);
  assert.deepEqual(ids(filterRows(rows, { ...f, marks: new Set(['key', 'discussion']) })), []);
});

test('type facets: the label is the row type in words, and checking it finds every spelling of that type', () => {
  const spelled = folder('', [file('a', 'A.pdf'), file('b', 'B.pdf'), file('c', 'C.pdf'), file('k', 'K.pdf')]);
  const facts = (type: string) => ({ date: '2012-01-01', type, from: [], to: [], summary: null, privileged: false, control: null });
  const typed = {
    people: [], orgs: [],
    docs: { a: facts('Supply-Agreement'), b: facts('Supply Agreement'), c: facts('Invoice-INV'), k: facts('W-9') },
  } as unknown as ServedMatter;
  const typedRows = joinRows({ root: spelled, matter: typed, discussed: new Set(), prefix: 'DOE' });
  assert.deepEqual(typedRows.map((r) => r.type), ['Supply agreement', 'Supply agreement', 'Invoice INV', 'W-9']);
  // The facet values are the words the rows show, so two spellings of one type make one box.
  const counts = facetCounts(typedRows, emptyFilter()).type;
  assert.deepEqual([...counts.entries()], [['Supply agreement', 2], ['Invoice INV', 1], ['W-9', 1]]);
  // Round trip: checking a box by the label it shows finds exactly the rows that show it.
  for (const [label] of counts) {
    const found = filterRows(typedRows, { ...emptyFilter(), types: new Set([label]) });
    assert.deepEqual(ids(found), ids(typedRows.filter((r) => r.type === label)), label);
  }
  assert.deepEqual(ids(filterRows(typedRows, { ...emptyFilter(), types: new Set(['Supply agreement']) })), ['a', 'b']);
});

test('facet counts leave out their own group, so checking a box shows what it adds', () => {
  const counts = facetCounts(rows, { ...emptyFilter('04-Letters'), types: new Set(['Email']) });
  assert.equal(counts.type.get('Email'), 1);
  assert.equal(counts.type.get('Letter'), 1);
  assert.equal(counts.type.get('Draft'), 1);
  assert.equal(counts.privilege.get('none'), 1, 'only the Email passes the type filter');
  assert.equal(counts.privilege.get('privileged'), undefined);
  assert.equal(counts.marks.get('discussion'), 1);
  assert.equal(counts.marks.get('key'), undefined);
});

test('sorting by any column keeps blanks last in both directions and breaks ties by control number', () => {
  assert.deepEqual(ids(sortRows(rows, 'control', 'ascending')), ['r1', 'o1', 'd1', 'w1', 'p1', 'p2', 'c1', 'l1']);
  assert.deepEqual(ids(sortRows(rows, 'control', 'descending')).slice(0, 2), ['l1', 'c1']);
  const byDate = ids(sortRows(rows, 'date', 'ascending'));
  assert.deepEqual(byDate.slice(0, 3), ['p2', 'p1', 'd1']);
  assert.deepEqual(ids(sortRows(rows, 'date', 'descending')).slice(0, 3), ['d1', 'p1', 'p2']);
  assert.deepEqual(byDate.slice(3), ['r1', 'o1', 'w1', 'c1', 'l1'], 'undated rows last, in control order');
  assert.deepEqual(ids(sortRows(rows, 'pages', 'descending')).at(-1), 'o1');
  assert.deepEqual(ids(sortRows(rows, 'key', 'ascending'))[0], 'p1');
  assert.deepEqual(ids(sortRows(rows, 'privilege', 'ascending')).slice(0, 2), ['d1', 'w1']);
  assert.deepEqual(ids(sortRows(rows, 'parties', 'ascending')).slice(0, 2), ['p2', 'p1']);
  assert.equal(ids(sortRows(rows, 'summary', 'ascending'))[0], 'p2');
});

test('marksFromSearch presets the Marked boxes from ?mark= and ignores anything else (R60)', () => {
  assert.deepEqual([...marksFromSearch('?mark=key')], ['key']);
  assert.deepEqual([...marksFromSearch('?mark=discussion&q=invoice')], ['discussion']);
  assert.deepEqual([...marksFromSearch('?mark=discussion&mark=key')], ['key', 'discussion']);
  assert.deepEqual([...marksFromSearch('?mark=privileged&mark=')], []);
  assert.deepEqual([...marksFromSearch('')], []);
});

test('markedHref round-trips through marksFromSearch', () => {
  for (const mark of ['key', 'discussion'] as const) {
    const href = markedHref(mark);
    assert.ok(href.startsWith('/documents/?'));
    assert.deepEqual([...marksFromSearch(href.slice(href.indexOf('?')))], [mark]);
  }
});

test('sortFromSearch reads ?sort=key and ?sort=-key, and ignores unknown keys (R85)', () => {
  assert.deepEqual(sortFromSearch('?sort=-control'), { key: 'control', dir: 'descending' });
  assert.deepEqual(sortFromSearch('?mark=key&sort=date'), { key: 'date', dir: 'ascending' });
  assert.equal(sortFromSearch('?sort=-secret'), null);
  assert.equal(sortFromSearch(''), null);
  assert.deepEqual(sortFromSearch(NEWEST_FIRST_HREF.slice(NEWEST_FIRST_HREF.indexOf('?'))), { key: 'control', dir: 'descending' });
});

test('rows changed after the visit cutoff are new, counsel uploads included; with no cutoff none are (D17)', () => {
  const since = '2026-09-30T00:30:00.000Z';
  const later = folder('', [file('n1', 'New.pdf', { control_seq: 400, updated_at: '2026-10-01T00:00:00.000Z' })], [
    folder('from-counsel', [file('n2', 'Reply.pdf', { control_seq: 401, source: 'counsel', updated_at: '2026-10-06T00:00:00.000Z' })]),
    folder('Old', [file('n3', 'Old.pdf', { control_seq: 402, updated_at: '2026-09-30T00:00:00.000Z' })]),
  ]);
  const joined = joinRows({ root: later, matter: null, discussed: new Set(), prefix: 'DOE', since });
  assert.deepEqual(joined.filter((r) => r.fresh).map((r) => r.id), ['n1', 'n2']);
  assert.deepEqual(ids(filterRows(joined, { ...emptyFilter(), marks: new Set(['new'] as const) })), ['n1', 'n2']);
  assert.equal(facetCounts(joined, emptyFilter()).marks.get('new'), 2);
  assert.ok(rows.every((r) => !r.fresh), 'no cutoff, no new rows');
  assert.ok(hasMark({ key: false, discussion: false, fresh: true }, 'new'));
  assert.ok(!hasMark({ key: true, discussion: true, fresh: false }, 'new'));
});

test("the room's visit, arriving after the table is drawn, moves only the New marks that differ", () => {
  const root = folder('', [
    file('a', 'A.pdf', { control_seq: 1, updated_at: '2026-10-01T00:00:00.000Z' }),
    file('b', 'B.pdf', { control_seq: 2, updated_at: '2026-10-05T00:00:00.000Z' }),
    file('c', 'C.pdf', { control_seq: 3, updated_at: '2026-09-01T00:00:00.000Z' }),
  ]);
  // This browser last saw the room on Sept. 20; the member's visit on another browser ended Oct. 3.
  const drawn = joinRows({ root, matter: null, discussed: new Set(), prefix: 'DOE', since: '2026-09-20T00:00:00.000Z' });
  assert.deepEqual(drawn.filter((r) => r.fresh).map((r) => r.id), ['a', 'b']);
  assert.deepEqual(remarkFresh(drawn, '2026-10-03T00:00:00.000Z').map((r) => r.id), ['a'], 'only a changed');
  assert.deepEqual(drawn.filter((r) => r.fresh).map((r) => r.id), ['b']);
  assert.deepEqual(remarkFresh(drawn, '2026-10-03T00:00:00.000Z'), [], 'the same cutoff again changes nothing');
  assert.deepEqual(remarkFresh(drawn, null).map((r) => r.id), ['b'], 'no cutoff, nothing is new');
});

test('?mark=new presets the New box, and the Overview links there', () => {
  assert.deepEqual([...marksFromSearch('?mark=new')], ['new']);
  assert.deepEqual([...marksFromSearch('?mark=key&mark=new&mark=bogus')].sort(), ['key', 'new']);
  assert.equal(markedHref('new'), '/documents/?mark=new');
});

test('a privileged file name is designated privileged, as the room reads a privileged path', () => {
  const one = (name: string) => joinRows({ root: folder('', [file('m', name, { control_seq: 5 })]), matter: null, discussed: new Set(), prefix: 'DOE' })[0]!;
  assert.equal(one('memo-PRIVILEGED.pdf').privileged, true);
  assert.equal(one('Non-privileged log.pdf').privileged, false, 'the matter build reading: "non-privileged" is not a claim');
});
