// SPDX-License-Identifier: Apache-2.0
// From index parts to the keyword index's rows and SQL (migration 0009, scripts/fts-index.ts): page text cut out of
// the parts by their markers, long pages split into pieces, and the statements that rewrite or drop one document,
// packed into SQL files within D1's limits. Pure: no I/O.
//
// wrangler d1 execute --file binds no parameters, so every value is a literal: ids, fingerprints and times through
// worker/sql.ts sqlLiteral, page text through textLiteral (sqlLiteral refuses the newlines page text keeps).
import { DOC_ID } from '../worker/passages.ts';
import { sqlLiteral } from '../worker/sql.ts';
import { plainLetters } from './indexparts.ts';

/** Each document's rows live in [seq * ROWID_BLOCK, (seq + 1) * ROWID_BLOCK), seq from page_fts_docs (migration 0009). */
export const ROWID_BLOCK = 1_048_576;
/** D1's limit on one SQL statement. */
export const STATEMENT_MAX_BYTES = 100_000;
/** One text literal, quotes doubled: a page longer than this is split into pieces, each its own row. */
export const PIECE_MAX_BYTES = 40_000;
/** One SQL file, which D1 runs as one import: small enough to finish quickly and keep the room's queries moving. */
export const BATCH_BYTES = 1_000_000;
export const BATCH_STATEMENTS = 500;
/** The page marker exactly as scripts/indexparts.ts writes it, with the newline that follows it. */
const MARKER = /\[\[doc:([A-Za-z0-9_-]{1,64}) p:([0-9]{1,6})\]\]\n?/g;

export interface PageText {
  n: number;
  text: string;
}

/** Page text as stored: NFC with ligatures as plain letters, LF line ends, no control characters but tab and newline, and "[[" broken up as the index does. */
export function cleanText(text: string): string {
  return plainLetters(text.normalize('NFC'))
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .replace(/\[(?=\[)/g, '[ ')
    .trim();
}

/**
 * A document's pages from its parts, in part order: the text after each of its own markers belongs to that page, and
 * a page split across segments or parts is joined. Text before the first marker (a v2 part's header line) is not page
 * text, and a marker naming another document is left in the text, where cleanText breaks it up.
 */
export function pagesOf(docId: string, bodies: readonly string[]): PageText[] {
  const pages = new Map<number, string[]>();
  for (const body of bodies) {
    let page = 0;
    let from = 0;
    const flush = (to: number) => {
      if (page > 0) pages.set(page, [...(pages.get(page) ?? []), body.slice(from, to).trim()]);
    };
    for (const match of body.matchAll(MARKER)) {
      if (match[1] !== docId) continue;
      flush(match.index);
      page = Number(match[2]);
      from = match.index + match[0].length;
    }
    flush(body.length);
  }
  return [...pages.keys()]
    .sort((a, b) => a - b)
    .map((n) => ({ n, text: cleanText(pages.get(n)!.join('\n')) }))
    .filter((page) => page.text !== '');
}

/** Bytes `text` takes inside a SQL literal: UTF-8, with each quote doubled. */
function literalBytes(text: string): number {
  return Buffer.byteLength(text) + (text.match(/'/g)?.length ?? 0);
}

/** A run with no whitespace longer than a piece, cut between code points. */
function hardSplit(token: string, maxBytes: number): string[] {
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const char of token) {
    const bytes = literalBytes(char);
    if (current && size + bytes > maxBytes) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  if (current) out.push(current);
  return out;
}

/** `text` in pieces of at most maxBytes as literals, cut at whitespace (a word longer than a piece is cut too). */
export function pieces(text: string, maxBytes = PIECE_MAX_BYTES): string[] {
  if (literalBytes(text) <= maxBytes) return [text];
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const token of text.split(/(\s+)/).flatMap((t) => (literalBytes(t) > maxBytes ? hardSplit(t, maxBytes) : [t]))) {
    const bytes = literalBytes(token);
    if (size + bytes > maxBytes && current.trim()) {
      out.push(current.trim());
      current = '';
      size = 0;
    }
    current += token;
    size += bytes;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * Page text as a SQL literal for a wrangler SQL file: quotes doubled (SQLite gives backslashes no meaning), and the
 * phrase "BEGIN TRANSACTION" kept apart by a no-break space, because wrangler's file trimmer strips it, and "COMMIT;"
 * after it, anywhere in a file, string literals included. The tokenizer reads the space as a separator either way.
 */
export function textLiteral(text: string): string {
  return `'${text.replaceAll('BEGIN TRANSACTION', 'BEGIN\u00a0TRANSACTION').replaceAll("'", "''")}'`;
}

/** A document id as a literal, only in the shape a page marker can carry (worker/passages.ts DOC_ID). */
function docLiteral(docId: string): string {
  if (!DOC_ID.test(docId)) throw new Error('Refusing a document id a page marker could not carry');
  return sqlLiteral(docId);
}

function blockStart(id: string): string {
  return `(SELECT seq FROM page_fts_docs WHERE doc_id = ${id}) * ${ROWID_BLOCK}`;
}

function clearBlock(id: string): string {
  return `DELETE FROM page_fts WHERE rowid BETWEEN ${blockStart(id)} AND ${blockStart(id)} + ${ROWID_BLOCK - 1};`;
}

/** Statements that rewrite one document: pending, cleared, its rows, then its fingerprint. Returns the row count too. */
export function indexStatements(docId: string, fingerprint: string, pages: readonly PageText[], now: string): { statements: string[]; rows: number } {
  const id = docLiteral(docId);
  const rows = pages.flatMap((page) => pieces(page.text).map((text) => ({ page: page.n, text })));
  if (rows.length > ROWID_BLOCK) throw new Error(`Document ${docId} has more rows than its rowid block holds`);
  const statements = [
    `INSERT INTO page_fts_docs (doc_id, fingerprint, rows, indexed_at) VALUES (${id}, '', 0, ${sqlLiteral(now)}) ` +
      `ON CONFLICT (doc_id) DO UPDATE SET fingerprint = '', rows = 0, indexed_at = excluded.indexed_at;`,
    clearBlock(id),
    ...rows.map((row, i) => `INSERT INTO page_fts (rowid, text, doc_id, page) VALUES (${blockStart(id)} + ${i}, ${textLiteral(row.text)}, ${id}, ${row.page});`),
    `UPDATE page_fts_docs SET fingerprint = ${sqlLiteral(fingerprint)}, rows = ${rows.length}, indexed_at = ${sqlLiteral(now)} WHERE doc_id = ${id};`,
  ];
  return { statements, rows: rows.length };
}

export function dropStatements(docId: string): string[] {
  const id = docLiteral(docId);
  return [clearBlock(id), `DELETE FROM page_fts_docs WHERE doc_id = ${id};`];
}

/** Statements packed into SQL files, in order, each file under maxBytes and maxStatements. */
export function batches(statements: readonly string[], maxBytes = BATCH_BYTES, maxStatements = BATCH_STATEMENTS): string[] {
  const files: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const statement of statements) {
    const bytes = Buffer.byteLength(statement) + 1;
    if (bytes > STATEMENT_MAX_BYTES) throw new Error("A statement would pass D1's 100,000-byte limit");
    if (current.length > 0 && (size + bytes > maxBytes || current.length >= maxStatements)) {
      files.push(current.join('\n'));
      current = [];
      size = 0;
    }
    current.push(statement);
    size += bytes;
  }
  return current.length > 0 ? [...files, current.join('\n')] : files;
}
