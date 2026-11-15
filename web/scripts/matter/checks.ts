// SPDX-License-Identifier: Apache-2.0
// Card F4. The checks `matter check` and the report run on a built manifest: the R5 exclusions (deadline
// events, events dated after the build, money citing work product or analysis, entries with no cite) and the
// keyword flags the owner reviews at GATE 1. Findings carry locations (list, id, field), never the text itself.
import { earliestDay } from '../../worker/matter-fields.ts';
import { isWorkProductType } from '../../worker/matter.ts';
import type { Cite, DocFacts, Matter } from '../../worker/matter-types.ts';

/** The keywords the checks flag, each with its pattern. */
export const KEYWORDS: readonly { keyword: string; pattern: RegExp }[] = [
  { keyword: 'settlement', pattern: /\bsettle(?:ment|ments|d|s)?\b/i },
  { keyword: 'offer', pattern: /\boffer(?:s|ed|ing)?\b/i },
  { keyword: '408', pattern: /\b408\b/ },
  { keyword: 'due', pattern: /\bdue\b/i },
  { keyword: 'deadline', pattern: /\bdeadlines?\b/i },
  { keyword: 'damages model', pattern: /\bdamages?[\s-]+models?\b/i },
  { keyword: 'valuation', pattern: /\bvaluations?\b/i },
  { keyword: 'NPV', pattern: /\bNPV\b|\bnet present value\b/i },
];

/** A keyword found in the draft, with where it was found. */
export interface Flag {
  keyword: string;
  /** For example "events:ev-0003.summary" or "docs:<id>.summary". */
  where: string;
}

/** An entry left out of the manifest, with the rule that removed it and where it sat. */
export interface Exclusion {
  rule: 'deadline-event' | 'future-event' | 'money-cites-work-product' | 'no-cite';
  where: string;
}

/**
 * True when a cited document is work product or analysis: by folder, by a WP filename segment, or by a type
 * worker/matter.ts would refuse money from (isWorkProductType). Stricter than parseMatter, which refuses money
 * only when every cite is work product: the check flags money with any such cite.
 */
export function isWorkProduct(docPath: string | null, type: string | null): boolean {
  if (docPath) {
    const parts = docPath.split('/');
    if (parts.slice(0, -1).some((folder) => /analysis|work[\s_-]?product/i.test(folder))) return true;
    const base = (parts.at(-1) ?? '').replace(/\.[^.]*$/, '');
    if (base.split('__').some((segment) => /^(?:A?WP|AC-?WP)$/i.test(segment))) return true;
  }
  return isWorkProductType(type);
}

const LIST_NAMES = ['tracks', 'violations', 'events', 'people', 'orgs', 'links', 'claims', 'money'] as const;
/** Lists the no-cite loop skips: excludeMoney checks money, and a track's proof is cited point by point. */
const NO_CITE_SKIP: ReadonlySet<string> = new Set(['tracks', 'money']);

type Item = { id?: unknown; type?: unknown; date?: unknown; cites?: unknown };

function entryName(list: string, entry: Item, index: number): string {
  return `${list}:${typeof entry.id === 'string' ? entry.id : index}`;
}

const citesOf = (entry: Item): Cite[] => (Array.isArray(entry.cites) ? (entry.cites as Cite[]) : []);

/** Why an event is excluded, if it is: a deadline, or dated after the build day. */
function eventRule(event: Item, buildDay: string): Exclusion['rule'] | null {
  if (event.type === 'deadline') return 'deadline-event';
  if (typeof event.date === 'string' && /^\d{4}(?:-\d{2}){0,2}$/.test(event.date) && earliestDay(event.date) > buildDay) return 'future-event';
  return null;
}

/** Why a money entry is excluded, if it is: no live cite, or a cite to work product or analysis. */
function moneyRule(money: Item, docs: Readonly<Record<string, DocFacts>>, paths: ReadonlyMap<string, string>): Exclusion['rule'] | null {
  const cites = citesOf(money);
  if (cites.length === 0) return 'no-cite';
  return cites.some((c) => isWorkProduct(paths.get(c.doc) ?? null, docs[c.doc]?.type ?? null)) ? 'money-cites-work-product' : null;
}

/** The entries kept, and the exclusions that removed the rest. */
export interface Excluded<T> {
  kept: T[];
  out: Exclusion[];
}

/** Removes excluded events before validation, so one excluded entry never blocks the review. */
export function excludeEvents<T extends Item>(events: readonly T[], buildDay: string): Excluded<T> {
  const out: Exclusion[] = [];
  const kept = events.filter((event, index) => {
    const rule = eventRule(event, buildDay);
    if (rule) out.push({ rule, where: entryName('events', event, index) });
    return rule === null;
  });
  return { kept, out };
}

/** Removes excluded money entries before validation. */
export function excludeMoney<T extends Item>(money: readonly T[], docs: Readonly<Record<string, DocFacts>>, paths: ReadonlyMap<string, string>): Excluded<T> {
  const out: Exclusion[] = [];
  const kept = money.filter((entry, index) => {
    const rule = moneyRule(entry, docs, paths);
    if (rule) out.push({ rule, where: entryName('money', entry, index) });
    return rule === null;
  });
  return { kept, out };
}

/** Every R5 exclusion still present in a manifest: the publish gate re-runs this on the reviewed file. */
export function exclusions(matter: Matter, paths: ReadonlyMap<string, string>): Exclusion[] {
  const buildDay = matter.meta.builtAt.slice(0, 10);
  const out = [...excludeEvents(matter.events, buildDay).out, ...excludeMoney(matter.money, matter.docs, paths).out];
  for (const list of LIST_NAMES) {
    if (NO_CITE_SKIP.has(list)) continue;
    (matter[list] as Item[]).forEach((entry, index) => {
      if (citesOf(entry).length === 0) out.push({ rule: 'no-cite', where: entryName(list, entry, index) });
    });
  }
  return out;
}

const IDENTIFIER_KEYS = new Set(['id', 'doc', 'date', 'builtAt', 'since', 'until', 'asOf', 'basis']);

function walk(value: unknown, where: string, visit: (text: string, where: string) => void): void {
  if (typeof value === 'string') visit(value, where);
  else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const id = typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id : String(index);
      walk(item, `${where}[${id}]`, visit);
    });
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      // Ids, document ids, dates and a statement's source kind are identifiers, not prose (a statement whose basis
      // is "settlement" is deliberate; its note is still read).
      if (IDENTIFIER_KEYS.has(key)) continue;
      walk(child, `${where}.${key}`, visit);
    }
  }
}

/** Every keyword hit in every string field of the manifest (ids, doc ids and dates excepted). */
export function keywordFlags(matter: Matter): Flag[] {
  const flags: Flag[] = [];
  const visit = (text: string, where: string) => {
    for (const { keyword, pattern } of KEYWORDS) if (pattern.test(text)) flags.push({ keyword, where });
  };
  walk(matter.meta, 'meta', visit);
  for (const list of LIST_NAMES) walk(matter[list], list, visit);
  for (const [id, facts] of Object.entries(matter.docs)) walk(facts, `docs:${id}`, visit);
  return flags;
}

/** Counts by key, in first-seen order, for printing. */
export function tally<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}
