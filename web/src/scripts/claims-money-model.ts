// SPDX-License-Identifier: Apache-2.0
// Card P4 (Claims & Proof). Money in the record, prepared for charting. The rule (R43): promises (a commitment or
// a call) and movements (a contribution, distribution, fee, payment or transfer) are separate series and
// are never added together; viz/money.ts splits them and every chart takes one series. An entry's own `kind`
// decides. When it has none, the label may supply one, but only when the reading is unambiguous; anything else
// stays in the ledger, uncharted. An entry without a payer or payee is never charted. No models, projections or
// settlement figures exist here: the matter build refuses them. Pure (claims-money-model.test.ts).

import type { RoomMoney, Side } from './matter-api.ts';
import type { MoneyKind } from '../../worker/matter-types.ts';
import { assertOneSeries, seriesOf, splitMoney, type MoneySeries } from './viz/money.ts';

/** The ledger's Kind column. */
export const KIND_WORDS: Record<MoneyKind, string> = {
  commitment: 'Commitment',
  call: 'Capital call',
  contribution: 'Contribution',
  distribution: 'Distribution',
  fee: 'Fee',
  payment: 'Payment',
  transfer: 'Transfer',
};

/** Words that make a label unsafe to read as money that moved or was promised: totals, reports, requests. */
const UNSURE = /\b(report\w*|value\w*|valuation|balance|admit\w*|total\w*|invoic\w*|approv\w*|estimat\w*|project\w*|model\w*|offer\w*|settle\w*|owed|due|claim\w*|demand\w*|allocat\w*)\b/i;

const LABEL_KINDS: ReadonlyArray<[MoneyKind, RegExp]> = [
  ['call', /\bcapital calls?\b/i],
  ['commitment', /\b(commitments?|committed|pledge[ds]?|subscription)\b/i],
  ['contribution', /\bcontributions?\b/i],
  ['distribution', /\bdistributions?\b/i],
  ['fee', /\bfees?\b.*\b(paid|drawn|charged|taken|collected)\b|\b(paid|drawn|charged|taken|collected)\b.*\bfees?\b/i],
  ['transfer', /\b(transfers?|transferred|wires?|wired)\b/i],
  ['payment', /\b(payments?|paid)\b/i],
];

/**
 * A kind read from the label, or null unless the reading is confident: a payer and a payee are named, no word
 * casts doubt on it, and exactly one kind matches (a paid fee is a fee, not also a payment).
 */
export function inferKind(fact: Pick<RoomMoney, 'from' | 'to' | 'label'>): MoneyKind | null {
  if (!fact.from || !fact.to || UNSURE.test(fact.label)) return null;
  const hits = LABEL_KINDS.filter(([, re]) => re.test(fact.label)).map(([kind]) => kind);
  const kinds = hits.includes('fee') ? hits.filter((k) => k !== 'payment') : hits;
  return kinds.length === 1 ? kinds[0] : null;
}

/** Money entries with kinds filled in, and the ids whose kind came from the label. */
export interface KindedMoney {
  /** Every entry; a kindless one carries the kind its label gave, when the reading was confident. */
  money: RoomMoney[];
  /** Ids whose kind came from the label rather than the record. */
  inferred: Set<string>;
}

/** Fills in confident kinds from labels. Entries that already have a kind are never touched. */
export function withKinds(money: readonly RoomMoney[]): KindedMoney {
  const inferred = new Set<string>();
  const out = money.map((fact) => {
    if (fact.kind) return fact;
    const kind = inferKind(fact);
    if (!kind) return fact;
    inferred.add(fact.id);
    return { ...fact, kind };
  });
  return { money: out, inferred };
}

/** "Transfer", "Transfer (from the label)" or "Not stated". */
export function kindWord(fact: Pick<RoomMoney, 'kind' | 'id'>, inferred: ReadonlySet<string> = new Set()): string {
  if (!fact.kind || !Object.hasOwn(KIND_WORDS, fact.kind)) return 'Not stated';
  return inferred.has(fact.id) ? `${KIND_WORDS[fact.kind]} (from the label)` : KIND_WORDS[fact.kind];
}

/** The series an entry is charted in, or null when it is listed only (no kind, or no payer or payee). */
export function chartSeries(fact: Pick<RoomMoney, 'kind' | 'from' | 'to'>): MoneySeries | null {
  return fact.from && fact.to ? seriesOf(fact.kind) : null;
}

/** viz/money.ts splitMoney, keeping the served cite type: it only sorts the entries it is given. */
export function splitRoomMoney(money: RoomMoney[]): { promises: RoomMoney[]; movements: RoomMoney[]; kindless: RoomMoney[] } {
  return splitMoney(money) as { promises: RoomMoney[]; movements: RoomMoney[]; kindless: RoomMoney[] };
}

/** Orders money entries by date, then by id. */
export function byDate(a: Pick<RoomMoney, 'date' | 'id'>, b: Pick<RoomMoney, 'date' | 'id'>): number {
  return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
}

/** A party's name and side. */
export interface PartyInfo {
  name: string;
  side: Side | null;
}

/** Money bars grouped by year, with one bar per payer. */
export interface YearBars {
  years: string[];
  /** One bar per payer, in side order then by total. */
  payers: Array<{ id: string; name: string; side: Side | null }>;
  /** values[year][payer], whole cents. */
  values: number[][];
}

const SIDE_ORDER: Array<Side | null> = ['client', 'nominal', 'third', 'defendant', 'court', null];

/**
 * One money series by year and payer, on one scale. Every year from the first to the last appears, so a quiet
 * year reads as a gap rather than vanishing. Refuses a set holding the other series; skips uncharted entries.
 */
export function yearBars(facts: readonly RoomMoney[], series: MoneySeries, parties: (id: string) => PartyInfo): YearBars {
  assertOneSeries([...facts], series, 'yearBars');
  const dated = facts.filter((f) => chartSeries(f) === series && /^\d{4}/.test(f.date)
    && Number.isSafeInteger(f.amountCents) && f.amountCents > 0);
  if (dated.length === 0) return { years: [], payers: [], values: [] };
  const yearsSeen = dated.map((f) => Number(f.date.slice(0, 4)));
  const first = Math.min(...yearsSeen);
  const years = Array.from({ length: Math.max(...yearsSeen) - first + 1 }, (_, i) => String(first + i));
  const totals = new Map<string, number>();
  for (const f of dated) totals.set(f.from as string, (totals.get(f.from as string) ?? 0) + f.amountCents);
  const payers = [...totals.keys()]
    .map((id) => ({ id, ...parties(id) }))
    .sort((a, b) => SIDE_ORDER.indexOf(a.side) - SIDE_ORDER.indexOf(b.side)
      || (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0) || a.id.localeCompare(b.id));
  const values = years.map(() => payers.map(() => 0));
  for (const f of dated) values[years.indexOf(f.date.slice(0, 4))][payers.findIndex((x) => x.id === f.from)] += f.amountCents;
  return { years, payers, values };
}
