// Issues page: turns issue records into metric records in the shared format (quality-speed/contract/README.md). A record
// never carries a floor, goal or weight; those live in manifest.json, the reviewed list.

import type { Manifest, MetricRecord } from "../../contract/format.ts";
import type { Detail } from "../../core/detail.ts";
import { closesSince, excluded, inScope, round, rows, type Config, type Issue, type Rank, type Row, type Severity } from "./compute.ts";

export type { Manifest, MetricRecord } from "../../contract/format.ts";

/** The run that read the issues. Only a run link proves a reading, so with none every record is missing. */
export type Provenance = { run_url: string | null };

/** A metric's reading. `none`: a good read found nothing to measure, such as no open issue at all. */
export type Reading = { value: number | null; sample: number; none?: true };

/** An error whose message is fixed text, safe for a run log. Anything else is logged without its message. */
export class CollectError extends Error {}

/**
 * The checks a read must pass before any number comes from it; anything else is an error, never a reading. Pages can
 * shift while they are read, so an issue seen twice counts once, as its latest update.
 */
export function checkIssues(input: unknown): Issue[] {
  if (!Array.isArray(input)) throw new CollectError("the read is not a list");
  const time = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
  for (const i of input as Issue[]) {
    const ok =
      typeof i === "object" &&
      i !== null &&
      Number.isInteger(i.number) &&
      (i.state === "open" || i.state === "closed") &&
      time(i.created_at) &&
      time(i.updated_at) &&
      (i.state === "open" || time(i.closed_at)) &&
      Array.isArray(i.labels) &&
      i.labels.every((l) => typeof l?.name === "string") &&
      (i.body === undefined || i.body === null || typeof i.body === "string") &&
      (i.type === undefined || i.type === null || typeof i.type?.name === "string") &&
      (i.milestone === undefined || i.milestone === null || typeof i.milestone?.title === "string");
    if (!ok) throw new CollectError("an item in the read is malformed");
  }
  const latest = new Map<number, Issue>();
  for (const i of input as Issue[]) {
    const seen = latest.get(i.number);
    if (!seen || Date.parse(i.updated_at) > Date.parse(seen.updated_at)) latest.set(i.number, i);
  }
  return [...latest.values()];
}

export type Readings = { values: Map<string, Reading>; rows: Row[]; excluded: number[] };

/**
 * What the collector reads beside the issue list. Absent, the metrics it feeds are unmeasured.
 *   reopened    open issues with a reopened event (GraphQL `REOPENED_EVENT`)
 *   labelUses   each label's issues plus pull requests, open or closed
 *   milestones  every milestone's title, open or closed
 */
export type RepoFacts = { reopened: ReadonlySet<number>; labelUses: readonly number[]; milestones: readonly string[] };

/**
 * Every metric's reading from one set of issues. Each is a count of open issues, or of closes, that a fix takes off at once
 * (#846): no window of the latest N. Every issue in scope is the sample, so a cleared list still reads.
 *
 * `closedByCommit` says, for each completed close since `closes_since`, whether its closer is a merged pull request or a
 * commit (`collect.ts` closedByPr): `main` takes no direct pushes, so that commit is a merged pull request's. A close
 * it doesn't cover leaves `closed_by_hand` unmeasured, never good news.
 */
export function readings(all: Issue[], cfg: Config, now: number, closedByCommit: ReadonlyMap<number, boolean>, repo?: RepoFacts): Readings {
  const work = rows(all, cfg, now);
  const scoped = inScope(all, cfg);
  const values = new Map<string, Reading>();
  const count = (n: number): Reading => ({ value: n, sample: scoped.length });

  values.set("missing_parts", count(work.filter((r) => !(r.goal && r.who && r.where && r.done)).length));
  values.set("unranked", count(work.filter((r) => r.p === null).length));

  const closes = closesSince(scoped, cfg);
  const known = closes.every((i) => closedByCommit.has(i.number));
  const byHand = closes.filter((i) => closedByCommit.get(i.number) === false).length;
  values.set("closed_by_hand", known ? count(byHand) : { value: null, sample: scoped.length });

  values.set("stale", count(work.filter((r) => r.stale).length));
  values.set("untyped", count(work.filter((r) => !r.typed).length));
  values.set("overdue", count(work.filter((r) => r.overdue).length));

  const unread = { value: null, sample: scoped.length };
  values.set("reopened", repo ? count(work.filter((r) => repo.reopened.has(r.n)).length) : unread);
  values.set("unused_labels", repo ? { value: repo.labelUses.filter((n) => n === 0).length, sample: repo.labelUses.length } : unread);
  // No launch milestone: nothing to read, never a good 0.
  values.set("launch_open", repo?.milestones.includes(cfg.launch_milestone) ? count(work.filter((r) => r.launch).length) : unread);
  return { values, rows: work, excluded: excluded(all, cfg) };
}

const RANK_IDS: readonly (Rank | null)[] = ["P1", "P2", "P3", null];
const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low"];

/** A detail reading id: `p1_high`, or `none_low` for an open issue with no one rank. */
export const cellId = (p: Rank | null, sev: Severity) => `${p === null ? "none" : p.toLowerCase()}_${sev}`;

/**
 * The page's drill-down (core/detail.ts): open issues in scope by rank and severity, every cell present, and `open`, their
 * total. Numbers only.
 */
export function detail(work: readonly Row[]): Detail {
  const readings: Detail["readings"] = { open: { value: work.length, limit: null, n: work.length } };
  for (const p of RANK_IDS) {
    for (const sev of SEVERITIES) {
      const value = work.filter((r) => r.p === p && r.sev === sev).length;
      readings[cellId(p, sev)] = { value, limit: null, n: work.length };
    }
  }
  return { checks: {}, readings };
}

const nullableRound = (v: number | null) => (v === null ? null : round(v, 4));

/** UTC to the second, the contract's time format. */
export const utc = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

const RUN_URL = /^https:\/\/github\.com\/Colorado-Startups\/legallas\/actions\/runs\/[1-9]\d*$/;

/**
 * Records in the shared format. A reading with fewer samples than the list's minimum still shows its value;
 * scoring gives it 0. No reading, or no workflow run behind it to prove the read ran, is missing: never good news.
 */
export function records(values: Map<string, Reading>, m: Manifest, p: Provenance, now: number): MetricRecord[] {
  const run = p.run_url !== null && RUN_URL.test(p.run_url) ? p.run_url : null;
  return m.metrics.map((d) => {
    const r = values.get(d.id);
    if (run !== null && r?.none && d.coverage_metric !== undefined) {
      return { id: d.id, page: m.page, value: null, status: "no_events", stage: "live", measured_at: utc(now), source_url: run, sample_size: 0 };
    }
    if (run === null || !r || r.value === null || !Number.isFinite(r.value)) return missing(d.id, m.page);
    return { id: d.id, page: m.page, value: r.value, status: "ok", stage: "live", measured_at: utc(now), source_url: run, sample_size: r.sample };
  });
}

function missing(id: string, page: Manifest["page"]): MetricRecord {
  return { id, page, value: null, status: "missing", stage: "live", measured_at: null, source_url: null, sample_size: null };
}

/** Every record missing: what a failed read produces. */
export function allMissing(m: Manifest): MetricRecord[] {
  return m.metrics.map((d) => missing(d.id, m.page));
}
