// SPDX-License-Identifier: Apache-2.0
// The job lists of finished runs, kept from one pass to the next in the lane's facts/ (core/detail.ts), so a pass reads
// only the runs that are new or were rerun (#240). Run fields are listed fresh every pass; only job lists are kept. A job
// keeps only what measure.ts reads, as a tuple:
//
//   [name, run_attempt, conclusion, created, started, completed, hasRunner, labels, stepBits]
//
// Names, conclusions and label sets point into shared tables. Label sets stay raw, so runnerOf still refuses one it
// doesn't know. Times are seconds from the run's created_at, so they come back exact. stepBits holds one bit per gate step
// that passed and one for ranTests, and each comes back as a step, so measure.ts reads a kept job as it read the original.
// A ledger that is bad, or of another version, loads as empty, never in part.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { GATE_STEPS, ranTests, type Job, type Run } from './measure.ts';

export const LEDGER_FILE = 'runs-ledger.json.gz';
/** Bump when a tuple's meaning changes, ranTests' rule included. */
export const LEDGER_VERSION = 1;
/** core/detail.ts drops a lane's whole facts/ past this, so the next pass would start cold. */
export const MAX_LEDGER_BYTES = 2 * 1024 * 1024;
/** Unzipped, far past any real ledger, so a bad file can't fill the memory. */
const MAX_JSON_BYTES = 64 * 1024 * 1024;
const TESTS_BIT = 1 << GATE_STEPS.length;
const ALL_BITS = (TESTS_BIT << 1) - 1;
/** A step name ranTests reads as a test that ran, and that is none of the gate steps. */
const TESTS_STEP = 'tests';
/** A kept job had a runner, which is all billedMinutes and gatesRan ask of its name. */
const RUNNER = 'ledger';

export type JobTuple = [name: number, attempt: number | null, conclusion: number, created: number | null, started: number | null, completed: number | null, hasRunner: 0 | 1, labels: number, steps: number];
export type LedgerRun = [updated_at: string, run_attempt: number, jobs: JobTuple[]];

export interface Ledger {
  version: number;
  gates: string[];
  names: string[];
  conclusions: (string | null)[];
  labels: string[][];
  runs: Record<string, LedgerRun>;
}

export const emptyLedger = (): Ledger => ({ version: LEDGER_VERSION, gates: [...GATE_STEPS], names: [], conclusions: [], labels: [], runs: {} });

/** A table's index for a value, adding it the first time. */
function indexer<T>(table: T[]): (value: T) => number {
  const at = new Map<string, number>();
  return (value) => {
    const key = JSON.stringify(value);
    let index = at.get(key);
    if (index === undefined) {
      index = table.push(value) - 1;
      at.set(key, index);
    }
    return index;
  };
}

const offset = (time: string | null | undefined, base: number): number | null => (time ? (Date.parse(time) - base) / 1000 : null);
const timeAt = (base: number, seconds: number | null): string | null =>
  seconds === null ? null : new Date(Math.round(base + seconds * 1000)).toISOString().replace('.000Z', 'Z');

/** The ledger for these runs, each kept under its attempt and last update. */
export function encodeLedger(runs: readonly Run[]): Ledger {
  const ledger = emptyLedger();
  const name = indexer(ledger.names);
  const conclusion = indexer(ledger.conclusions);
  const labels = indexer(ledger.labels);
  for (const run of runs) {
    const base = Date.parse(run.created_at);
    const jobs = run.jobs.map((job): JobTuple => {
      let steps = ranTests(job) ? TESTS_BIT : 0;
      GATE_STEPS.forEach((gate, bit) => {
        if (job.steps?.some((step) => step.name === gate && step.conclusion === 'success')) steps |= 1 << bit;
      });
      const times = [offset(job.created_at, base), offset(job.started_at, base), offset(job.completed_at, base)] as const;
      return [name(job.name), job.run_attempt ?? null, conclusion(job.conclusion), ...times, job.runner_name ? 1 : 0, labels(job.labels ?? []), steps];
    });
    // A time that isn't a date can't come back exact, so that run is read again next pass rather than kept wrong.
    if (jobs.every((job) => [job[3], job[4], job[5]].every((time) => time === null || Number.isFinite(time)))) ledger.runs[run.id] = [run.updated_at, run.run_attempt, jobs];
  }
  return ledger;
}

/** The jobs kept for a run, or null when none are kept for its attempt and last update, so it must be read. */
export function cachedJobs(ledger: Ledger, run: Pick<Run, 'id' | 'created_at' | 'updated_at' | 'run_attempt'>): Job[] | null {
  const entry = Object.hasOwn(ledger.runs, run.id) ? ledger.runs[run.id] : undefined;
  const base = Date.parse(run.created_at);
  if (!entry || entry[0] !== run.updated_at || entry[1] !== run.run_attempt || !Number.isFinite(base)) return null;
  return entry[2].map(([name, attempt, conclusion, created, started, completed, hasRunner, labels, bits]): Job => {
    const steps = GATE_STEPS.filter((_, bit) => bits & (1 << bit)).map((gate): { name: string; conclusion: string | null } => ({ name: gate, conclusion: 'success' }));
    if (bits & TESTS_BIT) steps.push({ name: TESTS_STEP, conclusion: 'success' });
    return {
      name: ledger.names[name] as string,
      ...(attempt === null ? {} : { run_attempt: attempt }),
      conclusion: ledger.conclusions[conclusion] as string | null,
      created_at: timeAt(base, created),
      started_at: timeAt(base, started),
      completed_at: timeAt(base, completed),
      runner_name: hasRunner ? RUNNER : null,
      labels: [...(ledger.labels[labels] as string[])],
      steps,
    };
  });
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');
const isIndex = (v: unknown, below: number): boolean => Number.isInteger(v) && (v as number) >= 0 && (v as number) < below;
const isCount = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 1;
const isTime = (v: unknown): boolean => v === null || (typeof v === 'number' && Number.isFinite(v));

/** True only for a whole ledger of this version and these gate steps, every index in its table. */
export function isLedger(v: unknown): v is Ledger {
  if (!isObject(v) || Object.keys(v).sort().join() !== 'conclusions,gates,labels,names,runs,version') return false;
  if (v.version !== LEDGER_VERSION || !isStrings(v.gates) || v.gates.join('\n') !== GATE_STEPS.join('\n')) return false;
  const { names, conclusions, labels, runs } = v;
  if (!isStrings(names) || !Array.isArray(conclusions) || !conclusions.every((c) => c === null || typeof c === 'string')) return false;
  if (!Array.isArray(labels) || !labels.every(isStrings) || !isObject(runs)) return false;
  const isTuple = (t: unknown): boolean =>
    Array.isArray(t) && t.length === 9 && isIndex(t[0], names.length) && (t[1] === null || isCount(t[1])) && isIndex(t[2], conclusions.length) &&
    isTime(t[3]) && isTime(t[4]) && isTime(t[5]) && (t[6] === 0 || t[6] === 1) && isIndex(t[7], labels.length) && isIndex(t[8], ALL_BITS + 1);
  return Object.entries(runs).every(
    ([id, run]) => /^[1-9]\d*$/.test(id) && Array.isArray(run) && run.length === 3 && typeof run[0] === 'string' && isCount(run[1]) && Array.isArray(run[2]) && run[2].every(isTuple),
  );
}

/** The ledger in a facts folder, or an empty one when there is none or it can't be trusted whole. */
export function loadLedger(dir: string | null): Ledger {
  const file = dir ? path.join(dir, LEDGER_FILE) : null;
  if (!file || !existsSync(file) || statSync(file).size > MAX_LEDGER_BYTES) return emptyLedger();
  try {
    const parsed: unknown = JSON.parse(gunzipSync(readFileSync(file), { maxOutputLength: MAX_JSON_BYTES }).toString('utf8'));
    return isLedger(parsed) ? parsed : emptyLedger();
  } catch {
    return emptyLedger();
  }
}

/** Writes the ledger into a facts folder and returns its size in bytes. */
export function saveLedger(dir: string, ledger: Ledger): number {
  const bytes = gzipSync(JSON.stringify(ledger), { level: 9 });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, LEDGER_FILE), bytes);
  return bytes.length;
}
