// SPDX-License-Identifier: Apache-2.0
// The page's arithmetic, kept pure so its test runs in seconds with no install.

/** The nearest-rank percentile `p` (0 to 100) of `values`, or null with none. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

/** One test's outcome in one run. */
export interface Outcome {
  key: string;
  passed: boolean;
}

/** Tests that passed in one run and failed in another, on the same commit. */
export function flaky(runs: readonly (readonly Outcome[])[]): string[] {
  const seen = new Map<string, Set<boolean>>();
  for (const run of runs) for (const { key, passed } of run) seen.set(key, (seen.get(key) ?? new Set()).add(passed));
  return [...seen].filter(([, outcomes]) => outcomes.size === 2).map(([key]) => key).sort();
}

/** Share of `part` in `whole` as a percent, rounded to one decimal; null when there is nothing to divide. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

/**
 * CPU seconds a process's exited children used, their own children included, from its `/proc/<pid>/stat` line: proc(5)'s
 * cutime and cstime, fields 16 and 17, in clock ticks. Null when the line doesn't parse.
 */
export function childCpuSeconds(stat: string, ticksPerSecond: number): number | null {
  const close = stat.lastIndexOf(')');
  if (close < 0) return null;
  // The name in field 2 can hold spaces and parentheses, so count from its last closing one: fields[0] is field 3.
  const fields = stat.slice(close + 2).trim().split(' ');
  const seconds = (Number(fields[13]) + Number(fields[14])) / ticksPerSecond;
  return fields.length > 14 && Number.isFinite(seconds) ? seconds : null;
}

/**
 * Each file's time, slowest first, from reporter.ts's lines: its summary where it ran in a process of its own. Node gives a
 * file that shares a process (web/scripts/run-tests.ts) no summary, so its time is that of its top-level tests.
 */
export function fileTimes(lines: readonly { file: string; name?: string; passed?: boolean; ms?: number }[]): { file: string; ms: number }[] {
  const summaries = new Map(lines.filter((l) => !('passed' in l)).map((l) => [l.file, l.ms ?? 0]));
  const times = new Map(summaries);
  for (const l of lines) if ('passed' in l && l.name?.startsWith('0:') && !summaries.has(l.file)) times.set(l.file, (times.get(l.file) ?? 0) + (l.ms ?? 0));
  return [...times].map(([file, ms]) => ({ file, ms })).sort((a, b) => b.ms - a.ms);
}
