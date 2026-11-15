// SPDX-License-Identifier: Apache-2.0
// report.json: what a lab run hands to the Data room page (quality-speed/pages/data-room). Numbers, ids and codes only:
// no question, document name or passage ever goes in, so the metric validator has nothing to refuse. Every number here is a
// lab number: a local copy of the fictional room on a CI runner, searched by keyword, with Ask's model replaced by the room's
// canned answer. It is not what a customer feels; the live sample room measures that.
export const REPORT_SCHEMA = 1;

export interface Summary {
  /** Samples that finished. */
  n: number;
  /** Nearest rank, so p95 of a small sample is its largest value. */
  p50: number | null;
  p75: number | null;
  p95: number | null;
  max: number | null;
  samples: number[];
}

/** The nearest-rank percentile of `values`; null with none. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!; // safe: index clamped into a non-empty array
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function summarize(values: readonly number[]): Summary {
  const samples = values.map(round);
  return { n: samples.length, p50: percentile(samples, 50), p75: percentile(samples, 75), p95: percentile(samples, 95), max: percentile(samples, 100), samples };
}

export interface JourneyResult {
  id: string;
  /** Series by name: a name ending in _ms is milliseconds; cls is the unitless layout shift score. */
  series: Record<string, Summary>;
  /** Samples that did not finish. A journey with no finished sample fails the run. */
  failures: number;
  /** Counts a journey scores: questions asked, and how many found the right document. */
  tallies?: Record<string, number>;
  /** The journey's last screen, relative to the report (frames/<id>.webp). */
  frame?: string;
}

export interface SeedResult {
  status: 'ok' | 'failed';
  /** Live documents a sync of the fixture should leave, and how many it did. */
  documentsExpected: number;
  documents: number;
  /** Documents the sync should have read for the index, and how many it did, per the local index manifest. */
  indexedExpected: number;
  indexed: number;
  /** Documents in the keyword index, expected and found. A document the cache shows has no text at all has no rows. */
  keywordExpected: number;
  keywordDocuments: number;
  /** Why it failed, as codes. */
  problems: string[];
}

export interface LabReport {
  schema: number;
  stage: 'lab';
  retrieval: 'keyword';
  commit: string | null;
  runId: string | null;
  measuredAt: string;
  runner: { os: string; arch: string; node: string };
  /** What every browser journey ran under: a CPU this many times slower, and the network profile. */
  throttle: { cpu: number; network: string };
  seconds: Record<string, number>;
  seed: SeedResult;
  journeys: JourneyResult[];
  /**
   * Over every page the journeys opened. Any request off localhost fails the run, and so do no requests at all from a browser
   * journey, because zero of anything counted here means nothing unless the browser really loaded something.
   */
  browser: { requests: number; console: number; csp: number; httpErrors: number; external: number };
  connector: { pass: number; fail: number; skip: number } | null;
  failed: boolean;
}

/**
 * What fails a run: a short seed, a request off localhost, a browser journey with no requests at all, a search that didn't come
 * from the keyword index, a journey with nothing finished, or no journeys.
 */
export function runFailed(report: Pick<LabReport, 'seed' | 'browser' | 'journeys'>): boolean {
  if (report.seed.status === 'failed' || report.browser.external > 0) return true;
  if (report.browser.requests === 0 && report.journeys.some((journey) => !journey.id.startsWith('connector-'))) return true;
  if (report.journeys.some((journey) => (journey.tallies?.notKeyword ?? 0) > 0)) return true;
  return report.journeys.length === 0 || report.journeys.some((journey) => Object.values(journey.series).every((series) => series.n === 0));
}

/** The seed's verdict from what it should have left and what it left. */
export function seedResult(found: Omit<SeedResult, 'status' | 'problems'>): SeedResult {
  const problems = [
    found.documentsExpected === 0 ? 'no_documents' : '',
    found.documents !== found.documentsExpected ? 'documents_short' : '',
    found.indexed !== found.indexedExpected ? 'index_short' : '',
    found.keywordDocuments !== found.keywordExpected ? 'keyword_index_short' : '',
  ].filter(Boolean);
  return { ...found, status: problems.length ? 'failed' : 'ok', problems };
}
