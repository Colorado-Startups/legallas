// SPDX-License-Identifier: Apache-2.0
// Test fixtures for keyword search (imported only by *.test.ts): a room of fictional DOE documents on real SQLite
// with every migration applied (sqlite-d1.ts), their pages written by the indexer's own statements
// (scripts/fts-rows.ts), and AI Search fakes that are spent or answer one hybrid passage.
import { indexStatements } from '../scripts/fts-rows.ts';
import { ftsSearch, type FtsSearch } from './fts.ts';
import type { KeywordSearch } from './retrieval.ts';
import { BudgetExhausted } from './spend.ts';
import { testDb, type TestDb } from './sqlite-d1.ts';

export const REPAIR = 'Mark Moe patched the copper gutter for Harbor Labs on June 5, 2012.';
export const NOTICE = 'Harbor Labs sent a notice of entry to Mark Moe before the second roof visit.';
const MINUTES = 'The crew met and checked the budget. No gutter was discussed.';

/** The seam's type: ftsSearch is what retrieve() falls back to, with no adapter, and it takes FtsOptions too. */
export const SEAM: KeywordSearch = ftsSearch;
export const TYPED: FtsSearch = ftsSearch;

export function addDoc(t: TestDb, id: string, path: string, kind = 'pdf', removed = false): void {
  const name = path.split('/').pop()!;
  t.sqlite
    .prepare(
      'INSERT INTO documents (id, path, folder, name, kind, content_type, size, pages, r2_key, source, updated_at, control_seq, removed_at) ' +
        "VALUES (?1, ?2, ?3, ?4, ?5, 'application/pdf', 1, 9, ?6, 'mirror', 'now', (SELECT COALESCE(MAX(control_seq), 0) + 1 FROM documents), ?7)",
    )
    .run(id, path, path.slice(0, Math.max(0, path.length - name.length - 1)), name, kind, `k-${id}`, removed ? 'then' : null);
}

/** Writes a document's pages exactly as scripts/fts-index.ts would. */
export function index(t: TestDb, docId: string, pages: readonly string[]): void {
  const { statements } = indexStatements(docId, `fp-${docId}`, pages.map((text, i) => ({ n: i + 1, text })), '2026-10-20T00:00:00Z');
  t.sqlite.exec(statements.join('\n'));
}

export function room(): TestDb {
  const t = testDb();
  addDoc(t, 'doc-gutter', '01-Contracts/Gutter.pdf');
  addDoc(t, 'doc-notice', '04-Letters/Notice.pdf');
  addDoc(t, 'doc-minutes', '03-Kitchen-Records/Minutes.pdf');
  index(t, 'doc-gutter', ['Cover page.', REPAIR]);
  index(t, 'doc-notice', [NOTICE]);
  index(t, 'doc-minutes', [MINUTES]);
  return t;
}

export const ids = (chunks: readonly { docId: string }[]) => chunks.map((chunk) => chunk.docId);

/** AI Search with the month's queries spent: retrieve() must fall back. */
export const spent = { search: async (): Promise<AiSearchSearchResponse> => Promise.reject(new BudgetExhausted('search_semantic')) };

/** AI Search answering one hybrid passage. */
export function answering(docId: string, page: number, text: string) {
  const chunk = { id: 'c0', type: 'text', score: 0.9, text: `[[doc:${docId} p:${page}]]\n${text}`, item: { key: `text/${docId}.p1.md` } };
  return { search: async () => ({ search_query: '', chunks: [{ ...chunk, scoring_details: { keyword_score: 1, vector_score: 0.7 } }] }) as unknown as AiSearchSearchResponse };
}

export function roomWithEdgeCases(): TestDb {
  const t = room();
  addDoc(t, 'doc-priv', '07-Lawyer-Notes-PRIVILEGED/Gutter-strategy.pdf');
  addDoc(t, 'doc-priv-name', '04-Letters/privileged-gutter-note.pdf');
  addDoc(t, 'doc-gone', '01-Contracts/Old-gutter.pdf', 'pdf', true);
  addDoc(t, 'doc-data', 'legallas-visuals.json', 'file');
  addDoc(t, 'doc-visual', '06-Photos/gutter-map.html', 'visual');
  for (const id of ['doc-priv', 'doc-priv-name', 'doc-gone', 'doc-data', 'doc-visual']) index(t, id, [`Copper gutter escalation ${id}.`]);
  index(t, 'doc-orphan', ['Copper gutter with no documents row.']);
  return t;
}
