// SPDX-License-Identifier: Apache-2.0
// Card F4. The catalog parser: CSV, the filename convention, dates, privilege and path spellings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clip, firstDate, INTERNAL_NOTES, internalNotes, isPrivileged, normalizeCatalogPath, parseCatalog, parseCsv, parseFilename } from './catalog.ts';

/** Any absolute sourceRoot: these catalogs give their paths relative to it. */
const ROOT = '/room/source';

test('parseCsv: quotes, doubled quotes, embedded commas and newlines, CRLF and a BOM', () => {
  const text = '﻿a,b,c\r\n1,"two, ""2""",3\r\n"multi\nline",,x\n';
  assert.deepEqual(parseCsv(text), [['a', 'b', 'c'], ['1', 'two, "2"', '3'], ['multi\nline', '', 'x']]);
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  assert.throws(() => parseCsv('a,"open\n'), /unterminated/);
});

test('firstDate: the earliest date in the text, in any supported spelling, validated', () => {
  assert.equal(firstDate('2012-05-07; 2012-05-09'), '2012-05-07');
  assert.equal(firstDate('Sent 5/8/2012, received 2012-05-10'), '2012-05-08');
  assert.equal(firstDate('around 2011-10'), '2011-10');
  assert.equal(firstDate('stamp 20120224'), '2012-02-24');
  assert.equal(firstDate('2012-02-30 is not a date'), null);
  assert.equal(firstDate('2101-01-01'), null);
  assert.equal(firstDate(''), null);
});

test('parseFilename: DocType_Abbr__YYYYMMDD__Party__Qualifier', () => {
  assert.deepEqual(parseFilename('01-Corporate-Records/Stock_Agreement_SA__20110607__Harbor-Labs__Countersigned.pdf'), { type: 'Stock Agreement', date: '2011-06-07' });
  assert.deepEqual(parseFilename('Email_EML__20120507__Mark-Moe__Meeting-Plan.pdf'), { type: 'Email', date: '2012-05-07' });
  // A work-product file puts its marker before the date.
  assert.deepEqual(parseFilename('Claim_Chart__WP__20130312.xlsx'), { type: 'Claim Chart (work product)', date: '2013-03-12' });
  assert.deepEqual(parseFilename('Letter_LTR.pdf'), { type: null, date: null });
  assert.deepEqual(parseFilename('Memo_MEM__20121399__X.pdf'), { type: 'Memo', date: null });
  // A range dates the file by its last day; both ends must be real dates.
  assert.deepEqual(parseFilename('Email_EML__20120203-20120326__Mark-Moe__Thread.pdf'), { type: 'Email', date: '2012-03-26' });
  assert.deepEqual(parseFilename('Share_Ledger_SL__20110711-20131231__Harbor-Labs.pdf'), { type: 'Share Ledger', date: '2013-12-31' });
  assert.deepEqual(parseFilename('Email_EML__20120203-20120231__Mark-Moe.pdf'), { type: 'Email', date: null });
  assert.deepEqual(parseFilename('Email_EML__20121302-20120302__Mark-Moe.pdf'), { type: 'Email', date: null });
});

test('isPrivileged: the column claims it, or a folder says PRIVILEGED; "not privileged" never counts', () => {
  assert.equal(isPrivileged('Attorney work product', 'a/b.pdf'), true);
  assert.equal(isPrivileged('AC/WP', 'a/b.pdf'), true);
  assert.equal(isPrivileged('Privileged', 'a/b.pdf'), true);
  assert.equal(isPrivileged('Not privileged', 'a/b.pdf'), false);
  assert.equal(isPrivileged('None', 'a/b.pdf'), false);
  assert.equal(isPrivileged('', 'a/b.pdf'), false);
  assert.equal(isPrivileged('', '07-Lawyer-Notes-PRIVILEGED/memo.pdf'), true);
  assert.equal(isPrivileged('', '04-Non-Privileged/memo.pdf'), false);
  // A file name is not a folder.
  assert.equal(isPrivileged('', 'a/PRIVILEGED.pdf'), false);
});

test('normalizeCatalogPath: relative, absolute under the root, or prefixed with the root folder name', () => {
  const root = '/cases/Shared-with-Counsel';
  assert.equal(normalizeCatalogPath('01-A/x.pdf', root), '01-A/x.pdf');
  assert.equal(normalizeCatalogPath('./01-A/x.pdf', root), '01-A/x.pdf');
  assert.equal(normalizeCatalogPath('/cases/Shared-with-Counsel/01-A/x.pdf', root), '01-A/x.pdf');
  assert.equal(normalizeCatalogPath('Shared-with-Counsel/01-A/x.pdf', root), '01-A/x.pdf');
  assert.equal(normalizeCatalogPath('01-A\\x.pdf', root), '01-A/x.pdf');
  assert.equal(normalizeCatalogPath('/elsewhere/x.pdf', root), null);
  assert.equal(normalizeCatalogPath('../x.pdf', root), null);
  assert.equal(normalizeCatalogPath('  ', root), null);
  // Decomposed accents become the NFC spelling documents.path uses.
  assert.equal(normalizeCatalogPath('Café/x.pdf', root), 'Café/x.pdf');
});

test('parseCatalog: refuses a catalog without its columns', () => {
  assert.throws(() => parseCatalog('path,filename\nx,y\n', ROOT), /missing column/);
});

test('internalNotes: the default is small, and the facts that share its words are not notes', () => {
  assert.deepEqual(INTERNAL_NOTES.map(({ note }) => note), ['not yet summarized', 'rename or move']);
  assert.deepEqual(internalNotes('Expense review, two pages; not yet summarized.'), ['not yet summarized']);
  assert.deepEqual(internalNotes('Not yet summarised, pending the bookkeeper.'), ['not yet summarized']);
  assert.deepEqual(internalNotes('Renamed for the folder scheme.'), ['rename or move']);
  assert.deepEqual(internalNotes('Receipt photo. Moved from the inbox.'), ['rename or move']);
  assert.deepEqual(internalNotes('Ledger copy: renamed by month; not yet summarized.'), ['not yet summarized', 'rename or move']);
  // The same words as facts: an office that moved, a log with a new name, a claim nobody has summed up.
  assert.deepEqual(internalNotes('The company moved from Example City, and the secretary renamed the notice log.'), []);
  assert.deepEqual(internalNotes('The bookkeeper has not summarized the claim.'), []);
  assert.deepEqual(internalNotes(''), []);
});

test('internalNotes: a room adds its own notes, which come first and match only when given', () => {
  const room = [
    { note: 'scanner batch', pattern: /\bscanner batch\b/i },
    { note: 'inbox stamp', pattern: /\binbox\s*\d+\b/i },
  ];
  assert.deepEqual(internalNotes('Scanner batch 7, from inbox 12; not yet summarized.', room), ['scanner batch', 'inbox stamp', 'not yet summarized']);
  assert.deepEqual(internalNotes('Scanner batch 7, from inbox 12.'), []);
  assert.deepEqual(internalNotes('Minutes of the July meeting.', room), []);
  assert.deepEqual(internalNotes('The inbox was full.', room), []);
});

test('parseCatalog: flags each internal note by row, keeps the summary as written, and skips nothing for it', () => {
  const text = [
    'path,bucket,filename,ext,size_bytes,md5,dup_status,privilege,content_summary,key_dates,key_parties,reviewed',
    '01-A/Minutes.md,01,Minutes.md,md,1,x,,,Not yet summarized. Renamed for the folder scheme.,2012-11-06,,yes',
    '01-A/Minutes.pdf,01,Minutes.pdf,pdf,1,x,,,"Minutes of the July meeting, 2 pages.",2012-11-06,,yes',
    '01-A/Email.pdf,01,Email.pdf,pdf,1,x,,,Scanner batch 7; moved from the inbox.,,,no',
  ].join('\n');
  const result = parseCatalog(text, ROOT);
  assert.deepEqual(result.notes, [
    { note: 'not yet summarized', path: '01-A/Minutes.md' },
    { note: 'rename or move', path: '01-A/Minutes.md' },
    { note: 'rename or move', path: '01-A/Email.pdf' },
  ]);
  assert.equal(result.docs.size, 3);
  assert.equal(result.docs.get('01-A/Minutes.md')?.summary, 'Not yet summarized. Renamed for the folder scheme.');
  const withRoom = parseCatalog(text, ROOT, [{ note: 'scanner batch', pattern: /\bscanner batch\b/i }]);
  assert.deepEqual(withRoom.notes.filter(({ path }) => path === '01-A/Email.pdf').map(({ note }) => note), ['scanner batch', 'rename or move']);
});

test('clip: summaries fit what parseMatter accepts, cut at a word', () => {
  assert.equal(clip('  short  '), 'short');
  assert.equal(clip(''), null);
  const long = 'word '.repeat(400);
  const cut = clip(long) ?? '';
  assert.ok(cut.length <= 1200);
  assert.match(cut, /word\u2026$/);
  assert.equal(clip('abcdefghij', 5), 'abcd\u2026');
});
