// A measure becomes a reading in the contract's shape. Scoring itself is
// quality-speed/core/score.ts, shared by every page.

import type { Measure, MetricDef, MetricRecord } from "./types.ts";

/** A reading: missing when there is no value, otherwise ok. Staleness and sample minimums are the scorer's. */
export function toRecord(def: MetricDef, m: Measure, fallbackSource: string | null): MetricRecord {
  if (m.value === null) {
    return { id: def.id, page: "claude-code", value: null, status: "missing", stage: "live", measured_at: null, source_url: null, sample_size: null };
  }
  return {
    id: def.id, page: "claude-code", value: m.value, status: "ok", stage: "live",
    measured_at: m.time.replace(/\.\d+Z$/, "Z"), source_url: m.source ?? fallbackSource, sample_size: m.sample,
  };
}
