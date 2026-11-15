// SPDX-License-Identifier: Apache-2.0
// The register and the privilege log on the fictional room (Doe v. Harbor Labs, prefix DOE). Each test name is a
// Data room row's rule (quality-speed/pages/data-room/list.ts, dispute.counsel.complete.*).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { accountNumbers, OTHER_REASONS, type Decision, type NumberedDocument, type RegisterRow } from './register.ts';
import { exportLog, LOG_HEADER, logProblems, type LogEntry, type LogInput, type Player } from './privilege-log.ts';

// DOE-000001 to DOE-000012. 6 was removed before production; no document ever took 7.
const DOCS: NumberedDocument[] = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12].map((seq) => ({
  control_seq: seq,
  removed_at: seq === 6 ? '2026-02-11T09:00:00.000Z' : null,
}));
const DECISIONS = new Map<number, Decision>([
  [1, { state: 'produced' }],
  [2, { state: 'produced' }],
  [3, { state: 'withheld' }],
  [4, { state: 'withheld' }],
  [5, { state: 'redacted' }],
  [8, { state: 'other', reason: 'not_responsive' }],
  [9, { state: 'other', reason: 'duplicate_suppressed' }],
  [10, { state: 'produced' }],
  [11, { state: 'withheld' }],
  [12, { state: 'produced' }],
]);

const PLAYERS: Player[] = [
  { id: 'doe', name: 'Jane Doe', title: 'Co-founder', affiliation: 'Harbor Labs', lawyer: false },
  { id: 'roe', name: 'Richard Roe', title: 'CTO', affiliation: 'Harbor Labs', lawyer: false },
  { id: 'quill', name: 'Ada Quill', title: 'Partner', affiliation: 'Quill & Vale LLP', lawyer: true },
  { id: 'vale', name: 'Ben Vale', title: 'Associate', affiliation: 'Quill & Vale LLP', lawyer: true },
];

// A unique canary in each withheld or redacted passage.
const CANARIES = ['DOE-CANARY-7Q2X', 'DOE-CANARY-4M8K', 'HX-CANARY-55B1', 'DOE-CANARY-9T3W'];
const PROTECTED: Record<number, string> = {
  3: `Ada, the draft side letter is attached. Reference ${CANARIES[0]}. Does the repurchase clause survive the bridge note conversion next month?`,
  4: `Draft side letter, version 2. Reference ${CANARIES[1]}.`,
  5: `Counsel said the ${CANARIES[2]} repurchase could be challenged by the departing founder.`,
  11: `Litigation risk notes, file ${CANARIES[3]}, on the board vote of 2 to 1.`,
};

const ENTRIES: LogEntry[] = [
  {
    begin: 3, end: 4, date: '2026-03-02', docType: 'Email with attachment', authors: ['doe'], recipients: ['quill'],
    basis: ['attorney_client'], lawyers: ['quill'], noLawyerReason: '',
    description: 'Email from the client to outside counsel requesting legal advice on a draft agreement, with the draft attached',
  },
  {
    begin: 5, end: 5, date: '2026-03-09', docType: 'Board minutes', authors: ['roe'], recipients: ['doe'],
    basis: ['attorney_client'], lawyers: ['vale'], noLawyerReason: '',
    description: 'Redacted passage records legal advice counsel gave at the meeting',
  },
  {
    begin: 11, end: 11, date: '', docType: 'Memorandum', authors: ['vale'], recipients: ['quill'],
    basis: ['work_product', 'attorney_client'], lawyers: ['vale'], noLawyerReason: '',
    description: 'Notes prepared by counsel in anticipation of litigation',
  },
];

function register(decisions = DECISIONS): RegisterRow[] {
  const { rows, problems } = accountNumbers(DOCS, decisions);
  assert.deepEqual(problems, []);
  return rows;
}

function input(entries: LogEntry[] = ENTRIES, players: Player[] = PLAYERS): LogInput {
  return { prefix: 'DOE', register: register(), entries, players, protectedText: (seq) => PROTECTED[seq] ?? '' };
}

const edit = (i: number, change: Partial<LogEntry>) => ENTRIES.map((entry, j) => (j === i ? { ...entry, ...change } : entry));

/** RFC 4180 fields, for a file the room wrote. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (quoted && ch === '"' && next === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') quoted = !quoted;
    else if (quoted) cell += ch;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && next === '\n') {
      rows.push([...row, cell]);
      row = [];
      cell = '';
      i++;
    } else cell += ch;
  }
  assert.equal(cell + row.join(''), '', 'the file ends with CRLF');
  return rows;
}

/** Every entry of a stored zip, read from its central directory, each CRC checked. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  const files = new Map<string, string>();
  let at = view.getUint32(end + 16, true);
  for (let i = 0; i < view.getUint16(end + 10, true); i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const nameLength = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const local = view.getUint32(at + 42, true);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + view.getUint32(at + 20, true));
    assert.equal(crc32(data), view.getUint32(at + 16, true), name);
    files.set(name, new TextDecoder().decode(data));
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return files;
}

const unescapeXml = (text: string) =>
  text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** The sheet's rows as text, each cell checked to sit in its own row and column. */
function sheetRows(xml: string): string[][] {
  return [...xml.matchAll(/<row r="(\d+)">(.*?)<\/row>/g)].map(([, r, cells], i) => {
    assert.equal(Number(r), i + 1);
    return [...cells!.matchAll(/<c r="([A-Z]+)(\d+)" t="inlineStr"><is><t xml:space="preserve">(.*?)<\/t><\/is><\/c>/g)].map(([, col, rowNo, text], c) => {
      assert.deepEqual([col, Number(rowNo)], [String.fromCharCode(65 + c), i + 1]);
      return unescapeXml(text!);
    });
  });
}

function exported(log = input()) {
  const result = exportLog(log);
  assert.ok(result.ok, JSON.stringify(result));
  return result;
}

test('every number from first to last is produced, withheld or has a listed reason', () => {
  const rows = register();
  assert.deepEqual(rows.map((r) => r.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'one row per number, first to last');
  const produced = rows.filter((r) => r.state === 'produced' || r.state === 'redacted').map((r) => r.seq);
  const withheld = rows.filter((r) => r.state === 'withheld').map((r) => r.seq);
  const other = rows.filter((r) => r.state === 'other');
  assert.deepEqual(produced, [1, 2, 5, 10, 12]);
  assert.deepEqual(withheld, [3, 4, 11]);
  assert.deepEqual(other.map((r) => [r.seq, r.reason]), [[6, 'removed'], [7, 'never_assigned'], [8, 'not_responsive'], [9, 'duplicate_suppressed']]);
  assert.ok(other.every((r) => (OTHER_REASONS as readonly string[]).includes(r.reason ?? '')));
  assert.ok(rows.filter((r) => r.state !== 'other').every((r) => r.reason === null));

  const without = (seq: number) => new Map([...DECISIONS].filter(([n]) => n !== seq));
  assert.deepEqual(accountNumbers(DOCS, without(10)).problems, [{ problem: 'unaccounted', seq: 10 }]);
  assert.ok(!accountNumbers(DOCS, without(10)).rows.some((r) => r.seq === 10), 'an undecided number gets no row');
  const bad: [number, Decision][] = [
    [8, { state: 'other', reason: 'too old' as never }],
    [9, { state: 'other' }],
    [10, { state: 'produced', reason: 'reserved' }],
    [12, { state: 'lost' as never }],
  ];
  assert.deepEqual(
    accountNumbers(DOCS, new Map([...DECISIONS, ...bad])).problems,
    bad.map(([seq]) => ({ problem: 'bad_reason', seq })),
    'a free-text, missing or misplaced reason is refused',
  );
  assert.deepEqual(accountNumbers(DOCS, new Map([...DECISIONS, [13, { state: 'produced' }]])).problems, [{ problem: 'unknown_number', seq: 13 }]);
  assert.deepEqual(accountNumbers(DOCS, new Map([...DECISIONS, [6, { state: 'produced' }]])).rows[5], { seq: 6, state: 'produced', reason: null }, 'a removed document can still be produced');
});

test('every withheld range appears in the log exactly once', () => {
  const log = input();
  assert.deepEqual(logProblems(log), []);
  const logged = ENTRIES.flatMap((e) => Array.from({ length: e.end - e.begin + 1 }, (_, i) => e.begin + i));
  const withheld = log.register.filter((r) => r.state === 'withheld').map((r) => r.seq);
  assert.deepEqual(logged.filter((seq) => withheld.includes(seq)).sort((a, b) => a - b), withheld, 'no duplicate, no omission');

  assert.deepEqual(logProblems(input(ENTRIES.slice(0, 2))), [{ problem: 'not_logged', seq: 11 }]);
  const again = { ...ENTRIES[0]!, begin: 4, end: 4 };
  assert.deepEqual(logProblems(input([...ENTRIES, again])), [{ problem: 'logged_twice', seq: 4 }]);
  const redactedTwice = { ...ENTRIES[1]! };
  assert.deepEqual(logProblems(input([...ENTRIES, redactedTwice])), [{ problem: 'logged_twice', seq: 5 }]);
  assert.equal(exportLog(input(ENTRIES.slice(0, 2))).ok, false, 'a log missing a withheld number is not exported');
});

test('every log entry points to a real withheld or redacted range', () => {
  assert.deepEqual(logProblems(input(edit(0, { begin: 2, end: 4 }))), [{ problem: 'not_withheld', entry: 1, seq: 2 }], 'a produced number');
  assert.deepEqual(logProblems(input([...ENTRIES, { ...ENTRIES[2]!, begin: 7, end: 7 }])), [{ problem: 'not_withheld', entry: 4, seq: 7 }], 'a number no document took');
  assert.deepEqual(
    logProblems(input(edit(2, { begin: 11, end: 13 }))),
    [{ problem: 'not_withheld', entry: 3, seq: 12 }, { problem: 'not_withheld', entry: 3, seq: 13 }],
    'past the last number',
  );
  for (const range of [{ begin: 4, end: 3 }, { begin: 3.5, end: 4 }, { begin: 0, end: 4 }, { begin: 3, end: 3_000_000 }]) {
    const problems = logProblems(input([...ENTRIES, { ...ENTRIES[0]!, ...range }]));
    assert.deepEqual(problems, [{ problem: 'bad_range', entry: 4 }], JSON.stringify(range));
  }
  const { csv } = exported();
  const rows = parseCsv(csv.slice(1)).slice(1);
  const states = new Map(input().register.map((r) => [`DOE-${String(r.seq).padStart(6, '0')}`, r.state]));
  for (const [, begin, end, , , , , kind] of rows) {
    assert.ok(['withheld', 'redacted'].includes(states.get(begin!) ?? '') && ['withheld', 'redacted'].includes(states.get(end!) ?? ''));
    assert.match(kind!, /^(Withheld|Redacted)$/);
  }
});

test('no log entry has a blank privilege basis', () => {
  assert.deepEqual(logProblems(input(edit(1, { basis: [] }))), [{ problem: 'no_basis', entry: 2 }]);
  assert.deepEqual(logProblems(input(edit(1, { basis: ['relevance' as never] }))), [{ problem: 'no_basis', entry: 2 }]);
  const rows = parseCsv(exported().csv.slice(1));
  const basis = rows[0]!.indexOf('Basis');
  assert.deepEqual(rows.slice(1).map((r) => r[basis]), ['Attorney-client privilege', 'Attorney-client privilege', 'Work product; Attorney-client privilege']);
});

test('every entry names a lawyer or says why not, and every name resolves in a players list', () => {
  assert.deepEqual(logProblems(input(edit(0, { lawyers: [] }))), [{ problem: 'no_lawyer', entry: 1 }]);
  assert.deepEqual(logProblems(input(edit(0, { lawyers: [], noLawyerReason: '  ' }))), [{ problem: 'no_lawyer', entry: 1 }]);
  assert.deepEqual(logProblems(input(edit(0, { lawyers: ['doe'] }))), [{ problem: 'not_a_lawyer', entry: 1, player: 'doe' }]);
  assert.deepEqual(logProblems(input(edit(1, { recipients: ['doe', 'moe'] }))), [{ problem: 'unknown_player', entry: 2, player: 'moe' }]);
  assert.deepEqual(logProblems(input(ENTRIES, PLAYERS.filter((p) => p.id !== 'vale'))), [
    { problem: 'unknown_player', entry: 2, player: 'vale' },
    { problem: 'unknown_player', entry: 3, player: 'vale' },
  ]);

  const why = 'Prepared by the client at the direction of counsel, who is not on the document';
  const result = exported(input(edit(1, { lawyers: [], noLawyerReason: why })));
  assert.equal(result.withoutLawyer, 1, 'the export counts entries that say why instead');
  const rows = parseCsv(result.csv.slice(1));
  const col = (name: string) => rows[0]!.indexOf(name);
  const names = new Set(PLAYERS.map((p) => p.name));
  for (const r of rows.slice(1)) {
    assert.ok(r[col('Lawyer')] !== '' || r[col('Why no lawyer is named')] !== '');
    for (const name of ['Authors', 'Recipients', 'Lawyer'].flatMap((c) => r[col(c)]!.split('; ')).filter(Boolean)) assert.ok(names.has(name), name);
  }
  const lawyers = new Set(PLAYERS.filter((p) => p.lawyer).map((p) => p.name));
  assert.ok(rows.slice(1).flatMap((r) => r[col('Lawyer')]!.split('; ').filter(Boolean)).every((name) => lawyers.has(name)));
});

test('canary strings from withheld documents appear in no log field', () => {
  const cases: [Partial<LogEntry>, number, string][] = [
    [{ description: `Email about ${CANARIES[0]}` }, 1, 'Description'],
    [{ description: `Email about ${CANARIES[1]!.toLowerCase().replace(/-/g, '_')}` }, 1, 'Description'],
    [{ description: 'Email about canary 4M8K' }, 1, 'Description'],
    [{ docType: `Notes on ${CANARIES[2]}` }, 2, 'Document type'],
    [{ lawyers: [], noLawyerReason: 'Whether the repurchase could be challenged by the departing founder' }, 2, 'Why no lawyer is named'],
    [{ description: 'Asks: does the repurchase clause survive the bridge note conversion next month' }, 1, 'Description'],
  ];
  for (const [change, entry, column] of cases) {
    const problems = logProblems(input(edit(entry - 1, change)));
    assert.deepEqual(problems, [{ problem: 'leak', entry, column }], JSON.stringify(change));
    assert.ok(!CANARIES.some((c) => JSON.stringify(problems).toLowerCase().includes(c.toLowerCase())), 'a problem never quotes the text');
    assert.equal(exportLog(input(edit(entry - 1, change))).ok, false);
  }
  assert.deepEqual(logProblems(input(edit(2, { description: `Notes, see ${CANARIES[0]}` }))), [{ problem: 'leak', entry: 3, column: 'Description' }], "another document's canary counts too");
  assert.deepEqual(logProblems(input(edit(0, { description: 'A 2nd email on the 10th about the 2026 board vote of 2 to 1' }))), [], 'ordinary words, dates and numbers pass');

  const { csv, xlsx } = exported();
  const sheet = [...unzip(xlsx).values()].join('\n');
  for (const canary of CANARIES) {
    assert.ok(!csv.toLowerCase().includes(canary.toLowerCase()), canary);
    assert.ok(!sheet.toLowerCase().includes(canary.toLowerCase()), canary);
  }
});

test('the log exports as .xlsx and .csv with one header row', () => {
  const tricky = 'Email "re: =SUM(A1)" & <draft>, as sent';
  const { csv, xlsx, entries } = exported(input(edit(0, { description: tricky })));
  assert.equal(entries, ENTRIES.length);

  assert.ok(csv.startsWith('\uFEFF'), 'a byte order mark, so a spreadsheet reads the file as UTF-8');
  const csvRows = parseCsv(csv.slice(1));
  assert.deepEqual(csvRows[0], [...LOG_HEADER]);
  assert.equal(csvRows.length, ENTRIES.length + 1, 'one header row, then one row per entry');
  assert.ok(csvRows.every((r) => r.length === LOG_HEADER.length));
  assert.ok(!csvRows.slice(1).some((r) => LOG_HEADER.every((h, i) => r[i] === h)), 'the header appears once');
  assert.equal(csvRows[1]![LOG_HEADER.indexOf('Description')], tricky);
  assert.deepEqual(csvRows.slice(1).map((r) => [r[1], r[2]]), [['DOE-000003', 'DOE-000004'], ['DOE-000005', 'DOE-000005'], ['DOE-000011', 'DOE-000011']]);
  assert.equal(parseCsv(exported(input(edit(0, { description: '=HYPERLINK("x")' }))).csv.slice(1))[1]![11], `'=HYPERLINK("x")`, 'a formula is defused');

  assert.deepEqual(xlsx.subarray(0, 4), new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  const parts = unzip(xlsx);
  assert.deepEqual([...parts.keys()].sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
  assert.match(parts.get('xl/workbook.xml')!, /<sheet name="Privilege log" sheetId="1" r:id="rId1"\/>/);
  assert.match(parts.get('[Content_Types].xml')!, /PartName="\/xl\/worksheets\/sheet1.xml"/);
  const sheet = sheetRows(parts.get('xl/worksheets/sheet1.xml')!);
  assert.deepEqual(sheet, csvRows, 'the same cells as the .csv');
  assert.doesNotMatch(parts.get('xl/worksheets/sheet1.xml')!, /<f>|t="s"/, 'inline text only: no formulas, no shared strings');
  assert.deepEqual(exported().xlsx, exported().xlsx, 'the same log gives the same bytes');
});
