// SPDX-License-Identifier: Apache-2.0
// The litigation journey's pass or fail check: continuous numbers, a gap only where something is withheld, and a
// privilege log in which every withheld range appears exactly once and every entry points to a real range. Pure.

export interface NumberRange {
  first: number;
  last: number;
}

export interface LogEntry extends NumberRange {
  id: string;
  date: string;
  author: string;
  recipients: string;
  type: string;
  basis: string;
  description: string;
}

export interface Production {
  volume: string;
  prefix: string;
  digits: number;
  date: string;
  last: number;
  produced: (NumberRange & { doc: string })[];
  withheld: (NumberRange & { logId: string; doc: string })[];
  privilegeLog: LogEntry[];
}

export type ProductionError =
  | { code: 'number-gap'; number: number }
  | { code: 'number-overlap'; number: number }
  | { code: 'withheld-not-logged'; logId: string }
  | { code: 'logged-twice'; logId: string }
  | { code: 'log-points-nowhere'; logId: string }
  | { code: 'log-range-differs'; logId: string };

/** The number as it appears in the record: prefix and padded digits, no dash, so it can't read as a room control number. */
export const bates = (p: Pick<Production, 'prefix' | 'digits'>, n: number) => `${p.prefix}${String(n).padStart(p.digits, '0')}`;

const sameRange = (a: NumberRange, b: NumberRange) => a.first === b.first && a.last === b.last;

/** The same volume broken on purpose for the monthly planted drill, so that each way the log can fail shows at once. */
export function plantedDrill(good: Production): Production {
  const drill = structuredClone(good);
  drill.produced.splice(1, 1); // A gap in the numbers.
  drill.privilegeLog[1]!.first += 1; // An entry whose range differs from what is withheld.
  drill.privilegeLog[2]!.id = 'PL-099'; // Points nowhere, and leaves its range unlogged.
  drill.privilegeLog.push(structuredClone(drill.privilegeLog[0]!)); // Logged twice.
  return drill;
}

/** Every way the volume breaks the rule; an empty list is a pass. */
export function checkProduction(p: Production): ProductionError[] {
  const errors: ProductionError[] = [];
  const seen = new Map<number, number>();
  for (const r of [...p.produced, ...p.withheld]) {
    for (let n = r.first; n <= r.last; n += 1) seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  for (let n = 1; n <= p.last; n += 1) {
    const count = seen.get(n) ?? 0;
    if (count === 0) errors.push({ code: 'number-gap', number: n });
    if (count > 1) errors.push({ code: 'number-overlap', number: n });
  }
  const withheldById = new Map(p.withheld.map((w) => [w.logId, w]));
  const logCount = new Map<string, number>();
  for (const entry of p.privilegeLog) logCount.set(entry.id, (logCount.get(entry.id) ?? 0) + 1);
  for (const w of p.withheld) if (!logCount.has(w.logId)) errors.push({ code: 'withheld-not-logged', logId: w.logId });
  for (const [logId, count] of logCount) if (count > 1) errors.push({ code: 'logged-twice', logId });
  for (const entry of p.privilegeLog) {
    const target = withheldById.get(entry.id);
    if (!target) errors.push({ code: 'log-points-nowhere', logId: entry.id });
    else if (!sameRange(entry, target)) errors.push({ code: 'log-range-differs', logId: entry.id });
  }
  return errors;
}
