// SPDX-License-Identifier: Apache-2.0
// Turns evidence into the page's records. Pure, so a test can prove that no evidence means no good number. Numbers and
// ids only. A metric with no evidence gets a `missing` record, which scores 0 and shows as a red tile.
import type { Evidence, ListRow } from './list.ts';

export interface Series {
  n: number;
  p75: number | null;
  p95: number | null;
}

/** The parts of the lab's report.json this page reads. */
export interface LabReport {
  journeys: { id: string; series: Record<string, Series>; tallies?: Record<string, number> }[];
  browser: { requests: number; csp: number; external: number };
  seed: { status: string; documents: number; documentsExpected: number; indexed: number; indexedExpected: number };
  /** The lab couldn't finish, so what it read may come from half a room. */
  failed: boolean;
}

export interface Evidences {
  report: LabReport | null;
  /** Node's test results: file, then each test's name and whether it passed. */
  tests: ReadonlyMap<string, readonly { name: string; ok: boolean }[]>;
  /** Counts of banned words and missing lines on built pages, or null when there were no pages to read. */
  wordingBreaks: number | null;
  /** Scored answers from the live room: target to its value and sample. */
  answers: Readonly<Record<string, { value: number; n: number }>>;
  /** This lane's run time in minutes, when it ran. */
  laneMinutes?: number;
}

export interface Reading {
  value: number;
  n: number;
}

/** A name matches a test by its start, so R1 finds "R1: ..." and never "R10: ...". */
export const namesTest = (test: string, name: string): boolean => test.startsWith(name) && !/\d/.test(test[name.length] ?? '');

/** Every name must find a test, and all must pass. */
function testsPass(results: readonly { name: string; ok: boolean }[], names: readonly string[]): boolean {
  return names.every((name) => {
    const matches = results.filter((t) => namesTest(t.name, name));
    return matches.length > 0 && matches.every((t) => t.ok);
  });
}

/** One metric's reading, or null when there's no evidence yet. A failed safety test reads 0 on a pass metric. */
export function readingOf(evidence: Evidence, from: Evidences): Reading | null {
  if ('journey' in evidence) {
    if (from.report?.failed) return null;
    const found = from.report?.journeys.find((j) => j.id === evidence.journey)?.series[evidence.series];
    const value = found?.[evidence.stat];
    return found && typeof value === 'number' && found.n > 0 ? { value, n: found.n } : null;
  }
  if ('browser' in evidence) {
    if (!from.report) return null;
    const { browser, failed } = from.report;
    const count = browser[evidence.browser];
    // A count the report doesn't have is no evidence, so a renamed field can't read as clean.
    if (typeof count !== 'number' || typeof browser.requests !== 'number') return null;
    // A break counts from any run, and an off-site request is itself what fails a run. A clean count only counts from a
    // run that finished: a failed seed or a dead browser loads too little to report anything else.
    if (count !== 0) return { value: 0, n: browser.requests };
    return failed || browser.requests === 0 ? null : { value: 1, n: browser.requests };
  }
  if ('test' in evidence) {
    const results = from.tests.get(evidence.test);
    return results && results.length > 0 ? { value: testsPass(results, evidence.names) ? 1 : 0, n: results.length } : null;
  }
  if ('tally' in evidence) {
    const tallies = from.report?.journeys.find((j) => j.id === evidence.tally)?.tallies;
    const of = tallies?.[evidence.of];
    const part = tallies?.['ok' in evidence ? evidence.ok : evidence.count];
    if (typeof of !== 'number' || typeof part !== 'number' || of === 0) return null;
    if ('count' in evidence) {
      // As with a browser break, a found one counts from any run, and none only from a run that finished.
      if (part > 0) return { value: part, n: of };
      return from.report?.failed ? null : { value: 0, n: of };
    }
    return from.report?.failed ? null : { value: (100 * part) / of, n: of };
  }
  if ('lab' in evidence) {
    if (evidence.lab === 'wording') return from.wordingBreaks === null ? null : { value: from.wordingBreaks, n: 1 };
    const seed = from.report?.seed;
    if (!seed) return null;
    const read = seed.status === 'ok' && seed.documents === seed.documentsExpected && seed.indexed === seed.indexedExpected;
    return { value: read ? 1 : 0, n: 1 };
  }
  if ('answers' in evidence) return from.answers[evidence.answers] ?? null;
  if ('lane' in evidence) return from.laneMinutes === undefined ? null : { value: from.laneMinutes, n: 1 };
  return null;
}

export interface Run {
  sourceUrl: string;
  measuredAt: string;
  /** Where journeys, browser checks and answers ran. Gate tests and wording always run in the lab. */
  stage: 'lab' | 'live';
}

/** A record for every row on the list, so none can go unreported. */
export function recordsOf(rows: readonly ListRow[], from: Evidences, run: Run) {
  return rows.map(({ id, evidence }) => {
    const reading = readingOf(evidence, from);
    return {
      id,
      page: 'data-room',
      value: reading?.value ?? null,
      status: reading ? 'ok' : 'missing',
      stage: 'test' in evidence || 'lab' in evidence ? ('lab' as const) : run.stage,
      measured_at: reading ? run.measuredAt : null,
      source_url: reading ? run.sourceUrl : null,
      sample_size: reading?.n ?? null,
    };
  });
}

/** Test results from Node's TAP output. Only the top level counts, so a subtest can't hide a failed parent, and a skipped test hasn't passed. */
export function parseTap(tap: string): { name: string; ok: boolean }[] {
  return tap.split('\n').flatMap((line) => {
    const match = /^(not )?ok \d+ - (.*)$/.exec(line);
    if (!match) return [];
    const [, failed, title] = match;
    const skipped = /\s#\s*(SKIP|TODO)\b/i.test(title!); // safe: group 2 always takes part in a match
    return [{ name: title!.replace(/\s#\s*(SKIP|TODO)\b.*$/i, ''), ok: !failed && !skipped }]; // safe: as above
  });
}

/**
 * A built page under /welcome/: the front door, before sign-in, where no agent speaks. The short line goes where one does
 * (product notices A2: Ask, the connector, the room's footer), so it isn't owed there. Banned words count on every page.
 */
export const frontDoor = (page: string): boolean => /^welcome[\\/]/.test(page);

/** Banned words on every built page, and required lines missing from a page past the front door. */
export function wordingBreaks(pages: readonly { page: string; text: string }[], required: readonly string[], banned: readonly RegExp[]): number {
  return pages.reduce(
    (total, { page, text }) => total + (frontDoor(page) ? 0 : required.filter((line) => !text.includes(line)).length) + banned.filter((pattern) => pattern.test(text)).length,
    0,
  );
}
