// SPDX-License-Identifier: Apache-2.0
// The sync's active-content check: worker/active-content.ts on every document the room will hold, by name then bytes.
//
// | | |
// |---|---|
// | Flagged | --apply refuses until replaced, or acknowledged: --allow-active <sha256>, one each, as --allow-pii |
// | Fingerprint | Flags and acknowledgements |
// | Read once | Per sha256 and ACTIVE_RULES_VERSION: <cacheDir>/active-cleared.json, written after an apply |
import { createReadStream } from 'node:fs';
import { open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { entryRule, scanKindOf, scanStream, SCAN_HEAD_BYTES, type ActiveRule } from '../worker/active-content.ts';
import type { SyncPlan } from './diff.ts';
import { mapLimit } from './pool.ts';
import { fillSnapshot, type Snapshot, type SnapshotFile } from './snapshot.ts';

/** Bump when the rules catch more: every document is read again. */
export const ACTIVE_RULES_VERSION = 1;
const SCAN_CONCURRENCY = 2;

export interface ActiveTarget {
  rel: string;
  sha256: string;
  file: string;
}

export interface ActiveFlag {
  path: string;
  sha256: string;
  rule: ActiveRule;
}

export interface ActiveScan {
  scanned: number;
  flagged: ActiveFlag[];
}

export interface ActiveGate {
  open: ActiveFlag[];
  acknowledged: ActiveFlag[];
  unused: string[];
}

const clearedFile = (cacheDir: string) => path.join(cacheDir, 'active-cleared.json');

/** Cleared sha256s; none if missing, broken or from other rules. */
export async function loadActiveCleared(cacheDir: string): Promise<ReadonlySet<string>> {
  const saved = await readFile(clearedFile(cacheDir), 'utf8').then((text) => JSON.parse(text) as { rules?: unknown; sha256s?: unknown }).catch(() => null);
  return new Set(saved?.rules === ACTIVE_RULES_VERSION && Array.isArray(saved.sha256s) ? (saved.sha256s as string[]) : []);
}

function liveFiles(plan: SyncPlan<SnapshotFile>): SnapshotFile[] {
  return [...plan.adds, ...plan.changes, ...plan.renames, ...plan.unchanged].map((doc) => doc.file);
}

/** Clears every document the plan leaves in the room. Call after the gates pass. */
export async function saveActiveCleared(cacheDir: string, plan: SyncPlan<SnapshotFile>): Promise<void> {
  const sha256s = [...new Set(liveFiles(plan).map((file) => file.sha256))].sort();
  await writeFile(clearedFile(cacheDir), JSON.stringify({ rules: ACTIVE_RULES_VERSION, sha256s }), { mode: 0o600 });
}

/** Uncleared documents the room will hold, in path order. */
export function activeTargets(plan: SyncPlan<SnapshotFile>, cleared: ReadonlySet<string>): ActiveTarget[] {
  return liveFiles(plan)
    .filter((file) => !cleared.has(file.sha256))
    .map((file) => ({ rel: file.rel.normalize('NFC'), sha256: file.sha256, file: file.snapshot }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** By name, then bytes. Unreadable: 'unchecked'. */
export async function scanFile(file: string, rel: string): Promise<ActiveRule | null> {
  // The file's name only: a folder called activeX says nothing.
  const byName = entryRule(path.posix.basename(rel));
  if (byName) return byName;
  try {
    const handle = await open(file, 'r');
    const head = new Uint8Array(SCAN_HEAD_BYTES);
    const { bytesRead } = await handle.read(head, 0, head.length, 0).finally(() => handle.close());
    const kind = scanKindOf(head.subarray(0, bytesRead));
    return kind ? await scanStream(kind, createReadStream(file, { highWaterMark: 1024 * 1024 })) : null;
  } catch {
    return 'unchecked';
  }
}

export async function scanForActive(targets: readonly ActiveTarget[], scan: (file: string, rel: string) => Promise<ActiveRule | null> = scanFile): Promise<ActiveScan> {
  const rules = await mapLimit(targets, SCAN_CONCURRENCY, (target) => scan(target.file, target.rel));
  const flagged = targets.flatMap((target, i) => (rules[i] ? [{ path: target.rel, sha256: target.sha256, rule: rules[i]! }] : []));
  return { scanned: targets.length, flagged };
}

export function activeGate(scan: ActiveScan, allow: readonly string[]): ActiveGate {
  const allowed = new Set(allow);
  const flagged = new Set(scan.flagged.map((doc) => doc.sha256));
  return {
    open: scan.flagged.filter((doc) => !allowed.has(doc.sha256)),
    acknowledged: scan.flagged.filter((doc) => allowed.has(doc.sha256)),
    unused: [...allowed].filter((sha) => !flagged.has(sha)).sort(),
  };
}

/** Why --apply stops, or null. */
export function activeRefusal(gate: ActiveGate): string | null {
  const reasons = [
    gate.open.length > 0 ? `${gate.open.length} can run code when opened and are not acknowledged (replace each with a copy without it, or pass --allow-active <sha256> for each)` : '',
    gate.unused.length > 0 ? `${gate.unused.length} --allow-active values match no flagged document` : '',
  ].filter(Boolean);
  return reasons.length === 0 ? null : `Active-content check: ${reasons.join('; ')}. Nothing was changed.`;
}

export function activeFingerprintEntries(scan: ActiveScan, allow: readonly string[]): string[] {
  return [...scan.flagged.map((doc) => `active\0${doc.path}\0${doc.sha256}\0${doc.rule}`), ...[...new Set(allow)].map((sha) => `allow-active\0${sha}`)];
}

const MEANING: Readonly<Record<ActiveRule, string>> = {
  'pdf-javascript': 'a PDF with JavaScript',
  'pdf-launch': 'a PDF that starts a program',
  'office-macros': 'Office macros',
  'office-activex': 'an ActiveX control',
  runnable: 'a program or script',
  unchecked: 'could not be checked',
};

/** Terminal lines; --summary drops paths. `print` masks a path holding a number. */
export function formatActiveReport(scan: ActiveScan, gate: ActiveGate, summary: boolean, print: (rel: string) => string): string[] {
  if (scan.scanned === 0 && gate.unused.length === 0) return [];
  const lines = [`Active-content check: ${scan.scanned} documents read (any these rules have not cleared).`];
  if (scan.flagged.length === 0) lines.push('  Nothing flagged.');
  else {
    lines.push(`  Flagged: ${scan.flagged.length} (${gate.open.length} open, ${gate.acknowledged.length} acknowledged)`);
    if (!summary) {
      for (const doc of scan.flagged) {
        const status = gate.acknowledged.includes(doc) ? 'acknowledged' : 'open';
        lines.push(`    ${status.padEnd(12)} ${doc.sha256}  ${print(doc.path)}  (${MEANING[doc.rule]})`);
      }
    }
    if (gate.open.length > 0) lines.push('  --apply refuses until each open document is replaced by a copy without the code, or acknowledged with --allow-active <sha256>.');
  }
  if (gate.unused.length > 0) lines.push(`  --allow-active matching no flagged document: ${gate.unused.join(' ')}`);
  return lines;
}

/** One run's check. */
export async function activeCheck(snapshot: Snapshot, plan: SyncPlan<SnapshotFile>, cacheDir: string, allow: readonly string[], summary: boolean, print: (rel: string) => string, log: (line: string) => void) {
  const targets = activeTargets(plan, await loadActiveCleared(cacheDir));
  await fillSnapshot(snapshot, targets.map((target) => target.file));
  if (targets.length > 0) log(`Active-content check: reading ${targets.length} documents...`);
  const scan = await scanForActive(targets);
  const gate = activeGate(scan, allow);
  return { gate, lines: formatActiveReport(scan, gate, summary, print), fingerprint: activeFingerprintEntries(scan, allow) };
}
