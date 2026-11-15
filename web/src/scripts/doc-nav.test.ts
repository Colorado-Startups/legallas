// SPDX-License-Identifier: Apache-2.0
// The document page's pure helpers (card P6): data-room index, folder neighbours, exhibit facts, "cited in".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  citedIn, controlIndex, crumbsFor, findCites, findFolder, folderName, fromTo, namesFor, placeIn, roman, violationsCiting,
} from './doc-nav.ts';
import type { FolderNode, ListedDocument } from './files-api.ts';
import type { ServedMatter } from './doc-facts.ts';

function file(id: string, name: string, control_seq: number | null = null): ListedDocument & { control_seq: number | null } {
  return { id, name, kind: 'pdf', size: 1, pages: 1, updated_at: '2026-10-01T00:00:00Z', source: 'mirror', control_seq };
}

function folder(path: string, files: ListedDocument[] = [], folders: FolderNode[] = []): FolderNode {
  return { path, name: path.split('/').pop() ?? '', guide: null, files, folders, count: files.length, size: files.length };
}

const tree = folder('', [], [
  folder('01-Contracts'),
  folder('04-Letters', [], [
    folder('04-Letters/Doe-drafts'),
    folder('04-Letters/Roe_sent', [file('a', 'A.pdf', 231), file('b', 'B.pdf', 232), file('c', 'C.pdf')]),
  ]),
  folder('from-counsel', [file('u', 'Upload.pdf', 900)]),
]);

test('folder names drop the index prefix and separators', () => {
  assert.equal(folderName('03-Kitchen-Records'), 'Kitchen Records');
  assert.equal(folderName('Roe_sent'), 'Roe sent');
  assert.equal(folderName('from-counsel'), 'From counsel');
  assert.equal(folderName('05'), '05');
});

test('the breadcrumb numbers and names folders as the Documents index does', () => {
  assert.deepEqual(crumbsFor(tree, '04-Letters/Roe_sent'), [
    { path: '04-Letters', index: '04', name: 'Letters' },
    { path: '04-Letters/Roe_sent', index: '04.2', name: 'Roe_sent' },
  ]);
  assert.deepEqual(crumbsFor(tree, 'from-counsel'), [{ path: 'from-counsel', index: '', name: 'From counsel' }]);
  assert.deepEqual(crumbsFor(tree, ''), []);
});

test('the breadcrumb still names folders the tree does not list, without an index', () => {
  assert.deepEqual(crumbsFor(null, '04-Letters/Gone'), [
    { path: '04-Letters', index: '04', name: 'Letters' },
    { path: '04-Letters/Gone', index: '', name: 'Gone' },
  ]);
});

test('Previous and Next stay inside the folder', () => {
  const roe = findFolder(tree, '04-Letters/Roe_sent');
  assert.equal(roe?.files.length, 3);
  assert.deepEqual(
    { ...placeIn(roe, 'a'), prev: placeIn(roe, 'a')?.prev?.id ?? null, next: placeIn(roe, 'a')?.next?.id },
    { position: 1, total: 3, prev: null, next: 'b' },
  );
  assert.equal(placeIn(roe, 'c')?.next, null);
  assert.equal(placeIn(roe, 'c')?.prev?.id, 'b');
  assert.equal(placeIn(roe, 'missing'), null);
  assert.equal(findFolder(tree, 'nowhere'), null);
  assert.equal(findFolder(tree, ''), tree);
});

test('control numbers map to document ids across the tree', () => {
  const map = controlIndex(tree);
  assert.equal(map.get(231), 'a');
  assert.equal(map.get(900), 'u');
  assert.equal(map.size, 3);
});

test('counts read as roman numerals', () => {
  assert.equal(roman(1), 'I');
  assert.equal(roman(4), 'IV');
  assert.equal(roman(9), 'IX');
  assert.equal(roman(14), 'XIV');
  assert.equal(roman(0), '0');
});

const cite = (doc: string) => ({ doc, page: 1, control: 1 });
const matter = {
  events: [{ id: 'e1', cites: [cite('a')] }, { id: 'e2', cites: [cite('a'), cite('b')] }, { id: 'e3', cites: [cite('b')] }],
  claims: [
    { count: 4, cites: [cite('a')], elements: [] },
    { count: 2, cites: [], elements: [{ proof: [{ cite: cite('a') }] }] },
    { count: 3, cites: [], elements: [{ proof: [{ cite: cite('a') }, { cite: cite('a') }] }] },
    { count: 5, cites: [cite('b')], elements: [] },
  ],
  violations: [],
  tracks: [],
} as unknown as Pick<ServedMatter, 'events' | 'claims' | 'violations' | 'tracks'>;

test('cited in counts events and lists the prior case counts once each, in order', () => {
  assert.equal(citedIn(matter, 'a'), '2 events; prior case Counts II, III and IV');
  assert.equal(citedIn(matter, 'b'), '2 events; prior case Count V');
  assert.equal(citedIn(matter, 'z'), '');
});

// The violations and tracks (worker/matter-types.ts); parseMatter fills [] for a manifest built before them.
const withViolations = {
  ...matter,
  events: [...matter.events, { id: 'e4', cites: [cite('d')] }],
  violations: [
    { id: 'v-c', mark: 'C', cites: [], events: [], steps: [{ cites: [cite('s')] }], figures: [] },
    { id: 'v-a', mark: 'A', cites: [cite('a')], events: [], steps: [], figures: [] },
    { id: 'v-b', mark: 'B', cites: [], events: ['e4'], steps: [], figures: [{ cites: [cite('f')] }] },
  ],
  tracks: [{ points: [{ violation: 'v-c', proof: [{ cite: cite('a') }] }] }],
} as unknown as Parameters<typeof citedIn>[0];

test('cited in lists the violations first, by mark, then events, then the prior case', () => {
  assert.equal(citedIn(withViolations, 'a'), 'Violations A and C; 2 events; prior case Counts II, III and IV');
  assert.equal(citedIn(withViolations, 's'), 'Violation C');
  assert.equal(citedIn(withViolations, 'f'), 'Violation B');
  assert.equal(citedIn(withViolations, 'd'), 'Violation B; 1 event');
  assert.deepEqual(violationsCiting(withViolations, 'z'), []);
});

test('from and to read as names, and one side alone says which', () => {
  const people = { people: [{ id: 'p-doe', name: 'Jane Doe' }], orgs: [{ id: 'o-co', name: 'Harbor Labs, Inc.' }] };
  const named = namesFor(people as unknown as Pick<ServedMatter, 'people' | 'orgs'>, ['p-doe', 'gone', 'o-co']);
  assert.deepEqual(named, ['Jane Doe', 'Harbor Labs, Inc.']);
  assert.deepEqual(fromTo(['Jane Doe'], ['Harbor Labs, Inc.']), { label: 'From → to', value: 'Jane Doe → Harbor Labs, Inc.' });
  assert.deepEqual(fromTo(['Jane Doe'], []), { label: 'From', value: 'Jane Doe' });
  assert.deepEqual(fromTo([], ['Roe']), { label: 'To', value: 'Roe' });
  assert.equal(fromTo([], []), null);
});

test('cites written in a comment are found with their pages', () => {
  assert.deepEqual(findCites('See DOE-000233 at 1 and DOE-000412.', 'DOE'), [
    { start: 4, end: 19, control: 233, page: 1 },
    { start: 24, end: 34, control: 412, page: null },
  ]);
  assert.deepEqual(findCites('XDOE-000233 and DOE-12345', 'DOE'), []);
});
