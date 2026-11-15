// SPDX-License-Identifier: Apache-2.0
// Scoring for the law eval (T21). Pure, so it is tested in node. The gates: the expected authority is retrieved
// and cited (an opinion only through the opinion of the court), the answer cites only law retrieved for the
// question, every cite resolves to a catalog entry with an official link, no case document stands behind a
// statement of law, no separate opinion is stated as the holding, and no line says what the item rules out.
import { baseCitation, caseIdFor, citedLaw, isOfficialLink, isSeparateOpinion, normalizeCitation, unitIdFor, unitOf, type LawChunk } from '../../worker/law-cite.ts';

/** One item of the law eval set: an id and a question, with the units it expects. */
export interface LawEvalItem {
  id: string;
  question: string;
  /** Canonical citations, any of which answers the question (pinpoints ignored). */
  expect: string[];
  track?: 'civil' | 'regulator';
  /**
   * Patterns (regular expressions, case-insensitive) that no line of the answer may match, unless the line says it
   * reports a dissent or concurrence: a separate opinion's view, or an inverted holding, stated as the court's.
   */
  mustNot?: string[];
}

/** The result of answering one eval item: the answer and the law passages retrieved. */
export interface LawEvalResult {
  answer: string;
  /** Chunk ids of the law passages retrieved, in rank order. */
  retrieved: string[];
  /** The server-side validated law citations (worker/law.ts validateLawCitations). */
  citations: LawChunk[];
  error?: string | null;
}

/** One pass-or-fail check on an eval result. */
export interface Check {
  name: string;
  ok: boolean;
}

/** Words that attribute a line to a separate writing: "the dissent argued", "a concurrence noted". */
export const SEPARATE_WORDS = /\bdissent|\bconcurr|separate opinion/i;

/** The unit id an expected citation names (statutes, rules and instructions by rule; cases by reporter cite). */
export function expectedUnit(cite: string): string | null {
  const canonical = normalizeCitation(cite) ?? cite;
  return unitIdFor(baseCitation(canonical)) ?? caseIdFor(canonical);
}

function patterns(raw: unknown, id: string): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || !raw.every((p) => typeof p === 'string')) throw new Error(`item ${id}: mustNot must be a list of patterns`);
  for (const p of raw) new RegExp(p, 'i');
  return raw;
}

/** Validates the raw law eval set and returns its items; throws when it is not a JSON array. */
export function parseLawEvalSet(raw: unknown): LawEvalItem[] {
  if (!Array.isArray(raw)) throw new Error('the law eval set must be a JSON array');
  return raw.map((entry, i) => {
    const e = entry as Partial<LawEvalItem>;
    if (typeof e.id !== 'string' || typeof e.question !== 'string' || !Array.isArray(e.expect) || e.expect.length === 0) throw new Error(`item ${i} is malformed`);
    for (const cite of e.expect) if (!expectedUnit(cite)) throw new Error(`item ${e.id}: ${cite} is not a citation the library reads`);
    const mustNot = patterns(e.mustNot, e.id);
    return { id: e.id, question: e.question, expect: e.expect, ...(e.track ? { track: e.track } : {}), ...(mustNot ? { mustNot } : {}) };
  });
}

/** Bullets that state law ("- LAW: ..."), for the record-cite check. */
function lawBullets(answer: string): string[] {
  return answer.split(/\r?\n/).filter((line) => /^\s*(?:[-*•]\s+)?(?:\*\*)?LAW(?:\*\*)?\s*[:.-]/.test(line));
}

/** True when every validated law cite in `line` is a separate opinion's part and the line does not say so. */
export function separateAsHolding(line: string, byId: ReadonlyMap<string, LawChunk>): boolean {
  const cited = citedLaw(line)
    .map((id) => byId.get(id))
    .filter((c): c is LawChunk => c !== undefined);
  return cited.length > 0 && cited.every((c) => isSeparateOpinion(c.opinion)) && !SEPARATE_WORDS.test(line);
}

/** Lines of the answer that match a must-not pattern, lines reporting a separate opinion left out. */
export function forbiddenLines(answer: string, mustNot: readonly string[]): string[] {
  const rules = mustNot.map((p) => new RegExp(p, 'i'));
  return answer.split(/\r?\n/).filter((line) => !SEPARATE_WORDS.test(line) && rules.some((rule) => rule.test(line)));
}

/** Builds the checks for one eval result from the units its item expects. */
export function lawChecks(item: LawEvalItem, result: LawEvalResult): Check[] {
  const wanted = new Set(item.expect.map(expectedUnit));
  const citedIds = citedLaw(result.answer);
  const validIds = new Set(result.citations.map((c) => c.id));
  const byId = new Map(result.citations.map((c) => [c.id, c]));
  return [
    { name: 'answered', ok: !result.error && result.answer.trim().length > 0 },
    { name: 'retrieved', ok: result.retrieved.some((id) => wanted.has(unitOf(id))) },
    // A dissent or concurrence is never the authority that answers: only the opinion of the court counts.
    { name: 'cites_expected', ok: result.citations.some((c) => wanted.has(unitOf(c.id)) && !isSeparateOpinion(c.opinion)) },
    { name: 'only_retrieved', ok: citedIds.every((id) => validIds.has(id)) },
    { name: 'resolves', ok: result.citations.every((c) => isOfficialLink(c.url) && c.cite.length > 0) },
    { name: 'no_record_in_law', ok: lawBullets(result.answer).every((line) => !/[[【]doc:/.test(line)) },
    { name: 'law_section', ok: lawBullets(result.answer).length > 0 },
    { name: 'no_separate_as_holding', ok: !lawBullets(result.answer).some((line) => separateAsHolding(line, byId)) },
    { name: 'no_forbidden', ok: forbiddenLines(result.answer, item.mustNot ?? []).length === 0 },
  ];
}

/** Every check must hold. */
export function lawVerdict(checks: readonly Check[]): 'pass' | 'fail' {
  return checks.every((check) => check.ok) ? 'pass' : 'fail';
}

/** Counts of each cite outcome across results, for the report: cited, valid, invalid. */
export function citeCounts(results: readonly LawEvalResult[]): { cited: number; valid: number; invalid: number } {
  let cited = 0;
  let valid = 0;
  for (const r of results) {
    const ids = [...new Set(citedLaw(r.answer))];
    const ok = new Set(r.citations.map((c) => c.id));
    cited += ids.length;
    valid += ids.filter((id) => ok.has(id)).length;
  }
  return { cited, valid, invalid: cited - valid };
}
