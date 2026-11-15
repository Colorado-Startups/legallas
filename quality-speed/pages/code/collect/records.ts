// SPDX-License-Identifier: Apache-2.0
// Turns measurements into readings in the shared metric format (quality-speed/contract): one record per metric of
// the lane, in manifest order. A metric the collector did not measure, or measured badly, is written as missing, so
// nothing on the reviewed list can drop off the page by failing. The contract's own validator checks the result.
import type { Manifest, MetricRecord } from '../../../contract/format.ts';
import { validateManifest, validateRecords } from '../../../contract/validate.ts';

export interface Measurement {
  value: number;
  /** When the number was measured (for CI-derived numbers, the newest sample or run read). */
  time: string;
  sampleSize: number;
}

const RUN_LINK = /^https:\/\/github\.com\/Colorado-Startups\/legallas\/actions\/runs\/[1-9]\d*$/;

/**
 * One record per id in `ids`, in manifest order. `run` is the link to the run doing the measuring, on the commit
 * being scored; outside a CI run there is none, and every reading is missing. A non-finite value, too few samples or
 * a time in the future is missing too.
 */
export function buildRecords(
  manifest: Manifest,
  ids: readonly string[],
  measured: ReadonlyMap<string, Measurement>,
  run: string | null,
  now: Date,
): MetricRecord[] {
  const wanted = new Set(ids);
  return manifest.metrics
    .filter((def) => wanted.has(def.id))
    .map((def) => {
      const m = measured.get(def.id);
      const usable =
        m !== undefined &&
        run !== null &&
        RUN_LINK.test(run) &&
        Number.isFinite(m.value) &&
        m.value >= 0 &&
        (def.unit !== 'percent' || m.value <= 100) &&
        Number.isInteger(m.sampleSize) &&
        m.sampleSize >= def.min_samples &&
        Date.parse(m.time) <= now.getTime();
      if (!usable) {
        return { id: def.id, page: manifest.page, value: null, status: 'missing', stage: 'lab', measured_at: null, source_url: null, sample_size: null };
      }
      return {
        id: def.id,
        page: manifest.page,
        value: Math.round(m.value * 1e6) / 1e6,
        status: 'ok',
        stage: 'lab',
        measured_at: new Date(Date.parse(m.time)).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        source_url: run,
        sample_size: m.sampleSize,
      };
    });
}

/** Reads manifest.json through the contract's validator; any error stops the collector. */
export function readManifest(json: string): Manifest {
  const result = validateManifest(JSON.parse(json), 'code');
  if (!result.value || result.errors.length > 0) throw new Error(`manifest.json: ${result.errors.join('; ')}`);
  return result.value;
}

/** Checks built records with the contract's validator, so a collector bug fails here rather than on the site. */
export function checkRecords(records: MetricRecord[], manifest: Manifest, now: Date): void {
  const { errors } = validateRecords(records, manifest, new Date(now.getTime() + 60_000));
  if (errors.length > 0) throw new Error(`readings: ${errors.join('; ')}`);
}

/** What the docs lane (docs.ts) measures: the repository's docs and comments, read from git alone. */
export const DOC_IDS: readonly string[] = [
  'public_symbols_documented',
  'long_sentence_share',
  'broken_internal_links',
  'dead_names',
  'lag_drill',
  'doc_lag_hours_p90',
  'reading_minutes_p90',
];

/** The metric ids the lane measures, in manifest order: the docs lane takes DOC_IDS, nightly the rest. */
export function laneIds(manifest: Manifest, lane: string): string[] {
  if (lane !== 'nightly' && lane !== 'docs') throw new Error(`no lane ${lane}`);
  return manifest.metrics.map((m) => m.id).filter((id) => DOC_IDS.includes(id) === (lane === 'docs'));
}
