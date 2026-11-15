// SPDX-License-Identifier: Apache-2.0
// The lab's mutant outcomes from its last runs, so a run tests only the mutants whose code or tests changed, as Stryker's
// incremental mode does. A mutant's key hashes the mutated file and every project file its covering tests load: change
// any of them and the mutant runs again. A file a test reads rather than imports (a migration, a fixture) is not in it.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** What a run of a mutant found: a test failed, a test ran past its timeout (both kill it), or it survived. */
export type Ran = 'failed' | 'timeout' | 'survived';
const RAN: ReadonlySet<string> = new Set(['failed', 'timeout', 'survived']);

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** The files a mutant's tests load, as one hash: each path relative to the checkout, so the key holds on any runner. */
export function contextKey(files: ReadonlyMap<string, string>): string {
  return sha([...files.keys()].sort().map((rel) => `${rel}\0${sha(files.get(rel)!)}`).join('\n'));
}

/** A mutant's key: what else changes every outcome (Node, the dependencies), its tests' files, and the mutated text. */
export const mutantKey = (salt: string, context: string, mutated: string) => sha(`${salt}\n${context}\n${mutated}`);

/** The outcomes `file` holds; none when it is missing or unreadable, so a bad cache only costs a full run. */
export function readOutcomes(file: string): Map<string, Ran> {
  if (!existsSync(file)) return new Map();
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return new Map();
    return new Map(Object.entries(parsed).filter((entry): entry is [string, Ran] => RAN.has(entry[1] as string)));
  } catch {
    return new Map();
  }
}

/**
 * What to keep: this run's outcomes, cached or run. The older ones only when a risk stopped before its mutants had keys,
 * because then its outcomes can't be told from stale ones; otherwise the file would grow with every change.
 */
export function toKeep(before: ReadonlyMap<string, Ran>, now: ReadonlyMap<string, Ran>, keyless: boolean): Map<string, Ran> {
  return keyless ? new Map([...before, ...now]) : new Map(now);
}

export function writeOutcomes(file: string, outcomes: ReadonlyMap<string, Ran>): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(Object.fromEntries(outcomes))}\n`);
}
