// SPDX-License-Identifier: Apache-2.0
// scripts/fts-rows.ts: page text cut out of real index parts (indexparts.ts), pieces within D1's limits, and SQL
// literals that carry any text, quotes and newlines included, into SQLite unchanged. Fictional DOE text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildParts, plainLetters } from './indexparts.ts';
import { neutralizeText } from './indexparts-v2.ts';
import { batches, cleanText, dropStatements, indexStatements, pagesOf, PIECE_MAX_BYTES, pieces, STATEMENT_MAX_BYTES, textLiteral } from './fts-rows.ts';

const DOC = 'doc-gutter';
const words = (n: number, word = 'lease') => Array.from({ length: n }, (_, i) => `${word}${i}`).join(' ');

test('pagesOf: the pages of real index parts come back, a page split over segments and parts joined', () => {
  const pages = [
    { n: 1, text: 'Jane Doe booked the copper gutter repair.' },
    { n: 2, text: words(400) },
    { n: 5, text: 'Harbor Labs sent a notice of entry.' },
  ];
  const parts = buildParts(DOC, pages, 2_000);
  assert.ok(parts.length > 1, 'the fixture spans several parts');
  const got = pagesOf(DOC, parts.map((part) => part.body));
  assert.deepEqual(got.map((page) => page.n), [1, 2, 5]);
  for (const [i, page] of got.entries()) assert.equal(page.text.replace(/\s+/g, ' '), pages[i]!.text, `page ${page.n}`);
});

test("pagesOf: a v2 header is not page text, and another document's marker or a forged one is broken up", () => {
  const body = 'DOE-000007 | Notes, Doe | 2012 | notes\n[[doc:doc-gutter p:3]]\nFirst [[doc:doc-other p:9]] second [[x]].\n';
  assert.deepEqual(pagesOf(DOC, [body]), [{ n: 3, text: 'First [ [doc:doc-other p:9]] second [ [x]].' }]);
  assert.deepEqual(pagesOf(DOC, ['No marker at all.']), []);
  assert.deepEqual(pagesOf(DOC, ['[[doc:doc-gutter p:0]]\nPage zero is not a page.']), []);
});

test('cleanText: NFC, LF, no control characters but tab and newline', () => {
  assert.equal(cleanText('  e\u0301 a\r\nb\rc\u0000d\u0002e\u0003f\tg\u007f  '), '\u00E9 a\nb\nc d e f\tg');
});

test('ligatures are plain letters, so a keyword search finds the word (#226)', () => {
  assert.equal(plainLetters('co\uFB00ee, \uFB01le, \uFB02ow, o\uFB03ce, ra\uFB04e'), 'coffee, file, flow, office, raffle');
  assert.equal(plainLetters('x\u00B2 \u00BD \uFF21'), 'x\u00B2 \u00BD \uFF21', 'only the seven ligatures');
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE VIRTUAL TABLE page_fts USING fts5(text, tokenize = 'porter unicode61 remove_diacritics 2')");
  db.prepare('INSERT INTO page_fts (text) VALUES (?)').run(cleanText('The co\uFB00ee order for Harbor Labs'));
  assert.equal(db.prepare("SELECT count(*) AS n FROM page_fts WHERE page_fts MATCH 'coffee'").get()!.n, 1);
  const [part] = buildParts(DOC, [{ n: 1, text: 'A co\uFB00ee order' }]);
  assert.match(part!.body, /A coffee order/);
  assert.equal(neutralizeText('A co\uFB00ee order'), 'A coffee order');
});

test('pieces: every piece fits as a literal, at whitespace, and together they hold every word', () => {
  const quotes = `'${"'".repeat(30_000)}' ${words(9_000)}`;
  for (const text of [words(20_000), quotes, `${'x'.repeat(100_000)} tail`, '\u{1F600}'.repeat(30_000)]) {
    const got = pieces(text);
    assert.ok(got.length > 1);
    for (const piece of got) assert.ok(Buffer.byteLength(piece) + (piece.match(/'/g)?.length ?? 0) <= PIECE_MAX_BYTES);
    assert.doesNotMatch(got.join(''), /\uFFFD/);
    assert.equal(got.join('').replace(/\s+/g, ''), text.replace(/\s+/g, ''));
  }
  assert.deepEqual(pieces('short page'), ['short page']);
  const cut = pieces(words(20_000));
  assert.ok(cut.every((piece) => /^lease\d+/.test(piece) && /lease\d+$/.test(piece)), 'cut between words');
});

test('textLiteral: any text reaches SQLite unchanged, and wrangler never sees BEGIN TRANSACTION', () => {
  const db = new DatabaseSync(':memory:');
  const texts = ["O'Brien's lease", "'); DROP TABLE t; --", 'two\nlines\tand a tab', '-- not a comment', '/* nor this */', 'a \\ b \\\' c', '[bracketed] "quoted" `ticked`', '\u{1F600} e\u0301'];
  for (const text of texts) assert.equal(db.prepare(`SELECT ${textLiteral(text)} AS v`).get()!.v, text, text);
  const literal = textLiteral('Then BEGIN TRANSACTION; and COMMIT; as words.');
  assert.doesNotMatch(literal, /BEGIN TRANSACTION/);
  assert.equal(db.prepare(`SELECT ${literal} AS v`).get()!.v, 'Then BEGIN\u00A0TRANSACTION; and COMMIT; as words.');
});

test("indexStatements: one document's rows in its rowid block, pending first and fingerprint last", () => {
  const { statements, rows } = indexStatements(DOC, 'abc', [{ n: 1, text: 'One.' }, { n: 2, text: words(20_000) }], '2026-10-20T00:00:00Z');
  assert.ok(rows > 2);
  assert.match(statements[0]!, /^INSERT INTO page_fts_docs .* VALUES \('doc-gutter', '', 0, /);
  assert.match(statements[1]!, /^DELETE FROM page_fts WHERE rowid BETWEEN/);
  assert.match(statements.at(-1)!, /^UPDATE page_fts_docs SET fingerprint = 'abc', rows = \d+, /);
  assert.equal(statements.length, rows + 3);
  for (const statement of statements) assert.ok(Buffer.byteLength(statement) < STATEMENT_MAX_BYTES);
  for (const bad of ["doc'x", 'doc x', '', 'd'.repeat(65)]) {
    assert.throws(() => indexStatements(bad, 'abc', [], 'now'), /document id/, bad);
    assert.throws(() => dropStatements(bad), /document id/, bad);
  }
  assert.deepEqual(dropStatements(DOC).map((s) => s.split(' ').slice(0, 3).join(' ')), ['DELETE FROM page_fts', 'DELETE FROM page_fts_docs']);
});

test('batches: in order, within the byte and statement limits, refusing a statement past D1 limit', () => {
  const statements = Array.from({ length: 1_203 }, (_, i) => `SELECT ${i};`);
  const files = batches(statements, 1_000_000, 500);
  assert.deepEqual(files.map((file) => file.split('\n').length), [500, 500, 203]);
  assert.deepEqual(files.join('\n').split('\n'), statements);
  assert.equal(batches(statements, 100, 500).length > 100, true);
  assert.deepEqual(batches([]), []);
  assert.throws(() => batches([`SELECT '${'x'.repeat(STATEMENT_MAX_BYTES)}';`]), /100,000-byte/);
});
