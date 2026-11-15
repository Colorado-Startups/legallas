// SPDX-License-Identifier: Apache-2.0
// Card F5b (Charts viz). Money series (R43): commitments and calls are promises; contributions, distributions,
// fees, payments and transfers are movements. A chart never adds one series to the other, and an entry with no
// kind, or no payer or payee, is listed in the table but never charted. Pure; tested in money.test.ts.

import type { MoneyFact, MoneyKind } from '../../../worker/matter-types.ts';
import { assertCents } from './core.ts';

/** The two kinds of money series: promises and movements. */
export type MoneySeries = 'promises' | 'movements';

/** The word shown for each money series. */
export const SERIES_WORDS: Record<MoneySeries, string> = { promises: 'Promises', movements: 'Movements' };

/** What a money chart's figures add up, for its caption: never a bare "sum". */
export const SERIES_SUM: Record<MoneySeries, string> = {
  promises: 'Sum of cited commitments and calls.',
  movements: 'Sum of cited payments.',
};

const PROMISES: ReadonlySet<MoneyKind> = new Set<MoneyKind>(['commitment', 'call']);

/** The series a kind belongs to; null when the entry has no kind (table only). */
export function seriesOf(kind: MoneyKind | null | undefined): MoneySeries | null {
  if (!kind) return null;
  return PROMISES.has(kind) ? 'promises' : 'movements';
}

/** Why an entry is listed but not charted, or null when it can be charted. */
export function unchartedReason(fact: MoneyFact): string | null {
  if (!fact.kind) return 'Kind not stated';
  if (fact.from === null || fact.to === null) return fact.from === null ? 'Payer not stated' : 'Payee not stated';
  return null;
}

/** Money entries split by kind into promises and movements. */
export interface MoneySplit {
  /** By kind alone; entries with a null payer or payee stay here and charts list them as not charted. */
  promises: MoneyFact[];
  movements: MoneyFact[];
  /** No kind: in no series, listed in tables only. Safe to pass beside either series. */
  kindless: MoneyFact[];
}

/** Sorts entries by series (kind alone). Throws on an amount that is not whole cents. */
export function splitMoney(money: MoneyFact[]): MoneySplit {
  const out: MoneySplit = { promises: [], movements: [], kindless: [] };
  for (const fact of money) {
    assertCents(fact.amountCents, fact.id);
    out[seriesOf(fact.kind) ?? 'kindless'].push(fact);
  }
  return out;
}

/** Refuses a set that holds entries of the other series: a chart of one series never absorbs the other. */
export function assertOneSeries(money: MoneyFact[], series: MoneySeries, what: string): void {
  const other = money.find((f) => {
    const s = seriesOf(f.kind);
    return s !== null && s !== series;
  });
  if (other) throw new Error(`${what}: ${other.id} is ${SERIES_WORDS[seriesOf(other.kind) as MoneySeries].toLowerCase()}, not ${series}`);
}

/** The sum of one series in cents. Refuses mixed sets; entries with no kind are not counted. */
export function sumSeries(money: MoneyFact[], series: MoneySeries): number {
  assertOneSeries(money, series, 'sumSeries');
  return money.reduce((total, f) => {
    assertCents(f.amountCents, f.id);
    return seriesOf(f.kind) === series ? total + f.amountCents : total;
  }, 0);
}
