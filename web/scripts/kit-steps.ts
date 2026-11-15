// SPDX-License-Identifier: Apache-2.0
// What scripts/kit-run.ts does for each room kit (mcp/kits.ts): its tool steps, in the order of its reference
// (connect/skill/legallas/references/), and the one-line note on its outcome with what in it fails.
import { readFile } from 'node:fs/promises';
import type { Kit } from '../mcp/kits.ts';
import { datedLawRow, daysBefore, factorCitations } from './kit-checks.ts';
import { type Calls, hitPages, listAll, readHits, rows, searchAll, type Value } from './kit-calls.ts';

/** A kit's own outcome in one line, and what in it fails (cite check: each record cite resolves to its page). */
export function kitNote(kit: Kit['prompt'], extra: Value): { note: string; failures: string[] } {
  if (kit === 'cite_check') {
    const verdicts = (extra.verdicts as Value[] | undefined) ?? [];
    const record = verdicts.filter((v) => !v.law);
    const real = record.filter((v) => (v.cite as { page: number }).page !== 999);
    const past = record.filter((v) => (v.cite as { page: number }).page === 999);
    const failures: string[] = real.length === 0 ? ['no record cite came back with a page to check'] : [];
    for (const v of real) if (v.verdict !== 'found' || v.link_opens_page !== true || v.control_matches !== true) failures.push(`record cite ${JSON.stringify(v.cite)} did not resolve to its page`);
    for (const v of past) if (v.verdict !== 'not found') failures.push('a cite past the last page was found');
    const law = verdicts.filter((v) => v.law).map((v) => v.verdict);
    return { note: `record ${real.filter((v) => v.verdict === 'found').length}/${real.length} found with page links; past-end cite ${past[0]?.verdict ?? 'none'}; ${law.length} law cites: ${[...new Set(law)].join(', ')}`, failures };
  }
  if (kit === 'entity_matrix') {
    // held: the library's unit count, or null when the list call gave no number. Null fails; a real 0 (law off, not built) only reports; above 0, every statute must be dated.
    const law = (extra.law as Value[] | undefined) ?? [];
    const held = typeof extra.held === 'number' ? extra.held : null;
    const failures = held === null ? ['legallas_search_law {list: true} gave no total'] : held > 0 ? law.filter((row) => row.dated !== true).map((row) => `${String(row.cite)}: no dated law row`) : [];
    return { note: `${extra.cited}/${extra.factors} statutes with a dated law row (library holds ${held ?? 'no count of'} units)`, failures };
  }
  if (kit === 'matter_chronology') {
    const failures = Number(extra.events) > 0 && Number(extra.cited) === 0 ? ['no event cites a document page'] : [];
    return { note: `${extra.events} events, ${extra.cited} cite a page, ${extra.read} pages read behind them`, failures };
  }
  if (kit === 'review_grid') return { note: `${extra.rows} rows`, failures: [] };
  if (kit === 'deviation_board') return { note: `${extra.deal} deal documents`, failures: [] };
  return { note: '', failures: [] };
}

/** Each kit's steps, in its reference's order. Returns kit-specific outcomes. */
export const STEPS: Record<Kit['prompt'], (calls: Calls, today: Date) => Promise<Value>> = {
  async matter_board(calls, today) {
    await calls.all('legallas_case_overview', { section: 'summary' }, 'nextCursor');
    await calls.all('legallas_case_overview', { section: 'tracks' }, 'nextCursor');
    await calls.call('legallas_list_documents', { since: daysBefore(today, 14) });
    const hits = await searchAll(calls, ['deadline', 'due date', 'closing', 'filing', 'next step']);
    await readHits(calls, hitPages(hits, 4));
    return {};
  },
  async review_grid(calls) {
    const docs = await listAll(calls);
    for (const doc of docs.slice(0, 3)) if (typeof doc.id === 'string') await calls.readWhole(doc.id);
    await searchAll(calls, ['parties', 'signed', 'vesting', 'governing law']);
    return { rows: docs.length };
  },
  async cite_check(calls) {
    // The draft: three record cites taken from the room, one cite to a page past the document's end, and two law cites.
    const docs = await listAll(calls);
    const hits = hitPages(await searchAll(calls, ['acceleration', 'board meeting', 'vesting'], 3), 3);
    const byId = new Map(docs.map((doc) => [doc.id, doc]));
    const record = hits.map((hit) => ({ control: byId.get(hit.id)?.control ?? null, page: hit.page }));
    const last = docs.find((doc) => typeof doc.control === 'string');
    if (last) record.push({ control: last.control as string, page: 999 });
    const law = ['C.R.S. 7-108-108', '8 Del. C. 141'];
    const verdicts: Value[] = [];
    for (const cite of record) {
      const doc = docs.find((d) => d.control === cite.control);
      if (!doc || typeof doc.id !== 'string') {
        verdicts.push({ cite, verdict: 'not found', why: 'no document has that control number' });
        continue;
      }
      const read = await calls.call('legallas_read_pages', { id: doc.id, from: cite.page, to: cite.page });
      const page = rows([read], 'pages').find((p) => p.page === cite.page);
      const link = typeof page?.link === 'string' ? page.link : null;
      verdicts.push({
        cite,
        verdict: page ? 'found' : 'not found',
        control_matches: read?.control === cite.control,
        link,
        link_opens_page: link?.endsWith(`#page=${cite.page}`) ?? false,
      });
    }
    for (const cite of law) {
      const value = await calls.call('legallas_search_law', { query: cite });
      verdicts.push({ cite, verdict: value ? (rows([value], 'results').length > 0 ? 'found' : 'not found') : 'law library off', law: true });
    }
    return { draft: { record, law }, verdicts };
  },
  async matter_chronology(calls) {
    await calls.all('legallas_case_overview', { section: 'summary' }, 'nextCursor');
    const events = rows(await calls.all('legallas_case_overview', { section: 'events' }, 'nextCursor'), 'entries');
    await listAll(calls);
    await searchAll(calls, ['meeting', 'notice', 'vesting']);
    // An event's id (evt-001) is not a document: its cite names the document (the link's ?id=) and the page.
    const behind = events.flatMap((e) => {
      const cite = e.cite as { page?: unknown; link?: unknown } | undefined;
      const id = typeof cite?.link === 'string' ? new URL(cite.link).searchParams.get('id') : null;
      return id && typeof cite?.page === 'number' ? [{ id, page: cite.page }] : [];
    });
    const read = behind.slice(0, 6);
    await readHits(calls, read);
    return { events: events.length, cited: behind.length, read: read.length };
  },
  async entity_matrix(calls) {
    const hits = await searchAll(calls, ['raising from funds', 'founders shares', 'paying out profits', 'line of business', 'where people work']);
    await readHits(calls, hitPages(hits, 4));
    const reference = await readFile(new URL('../connect/skill/legallas/references/entity-matrix.md', import.meta.url), 'utf8');
    const factors = factorCitations(reference);
    const total = (await calls.call('legallas_search_law', { list: true }))?.total;
    const held = typeof total === 'number' ? total : null;
    const law: Value[] = [];
    for (const cite of factors) {
      const results = rows([await calls.call('legallas_search_law', { query: cite })], 'results');
      law.push({ cite, rows: results.length, dated: datedLawRow(cite, results), code: calls.log.at(-1)?.code ?? null });
    }
    const cited = law.filter((row) => row.dated === true).length;
    return { factors: factors.length, cited, held, law };
  },
  async deviation_board(calls) {
    const docs = await listAll(calls);
    const deal = docs.filter((doc) => /term sheet|safe|note|stock purchase|charter|certificate|side letter|investor rights|investment/i.test(String(doc.title ?? '')));
    for (const doc of deal.slice(0, 4)) if (typeof doc.id === 'string') await calls.readWhole(doc.id);
    await searchAll(calls, ['valuation cap', 'discount', 'maturity', 'interest', 'pro rata', 'most favored nation', 'information rights', 'first refusal'], 3);
    return { deal: deal.length };
  },
};
