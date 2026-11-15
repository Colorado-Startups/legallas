// SPDX-License-Identifier: Apache-2.0
// What a dry run prints: counts, then a table of paths and sizes. Never file contents.
import { createHash } from 'node:crypto';
import type { LocalFile, SyncPlan } from './diff.ts';
import { kindOf } from './diff.ts';
import type { SkipReason } from './guard.ts';
import { maskPath, type KnownMatcher } from './pii.ts';

export function formatBytes(size: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * A short fingerprint of what the plan would do (paths, hashes, actions; not the random ids). Pass it to
 * `--apply --expect <fingerprint>` to make sure the run applies exactly the dry run the owner approved. `extra` adds
 * the SSN guard's flags and acknowledgements (pii-scan.ts piiFingerprintEntries); with none it changes nothing.
 */
export function planFingerprint(plan: SyncPlan<LocalFile>, extra: readonly string[] = []): string {
  const entries = [
    ...plan.adds.map((op) => `add\0${op.path}\0${op.sha256}`),
    ...plan.changes.map((op) => `change\0${op.path}\0${op.sha256}`),
    ...plan.renames.map((op) => `rename\0${op.fromPath}\0${op.path}\0${op.sha256}`),
    ...plan.removals.map((row) => `remove\0${row.path}`),
    ...extra,
  ].sort();
  return createHash('sha256').update(entries.join('\n')).digest('hex').slice(0, 12);
}

export interface ReportInput {
  plan: SyncPlan<LocalFile>;
  files: readonly LocalFile[];
  skipped: Record<SkipReason, number>;
  /** Pages, Numbers and Keynote documents saved as folders, not synced. */
  iworkPackages: readonly string[];
  target: string;
  pendingPulls: number;
  toIndex: { direct: number; extracted: number };
  extractor: string;
  /** Aggregate counts only, no table of paths. */
  summary: boolean;
  /** The SSN guard's lines (pii-scan.ts formatPiiReport) and its fingerprint entries. */
  pii?: { lines: readonly string[]; fingerprint: readonly string[] };
  /** The known SSNs, so a path holding one prints masked too (pii.ts maskPath). */
  known?: KnownMatcher | null;
}

function kindCounts(files: readonly LocalFile[]): string {
  const counts = new Map<string, { n: number; bytes: number }>();
  for (const file of files) {
    const { kind } = kindOf(file.rel);
    const entry = counts.get(kind) ?? { n: 0, bytes: 0 };
    entry.n += 1;
    entry.bytes += file.size;
    counts.set(kind, entry);
  }
  return [...counts]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([kind, { n, bytes }]) => `${kind} ${n} (${formatBytes(bytes)})`)
    .join(', ');
}

function table(plan: SyncPlan<LocalFile>, known: KnownMatcher | null): string[] {
  const shown = (rel: string) => maskPath(rel, known);
  const rows: [string, number, string][] = [
    ...plan.adds.map((op): [string, number, string] => ['add', op.size, shown(op.path)]),
    ...plan.changes.map((op): [string, number, string] => ['change', op.size, shown(op.path)]),
    ...plan.renames.map((op): [string, number, string] => ['rename', op.size, `${shown(op.fromPath)} -> ${shown(op.path)}`]),
    ...plan.removals.map((row): [string, number, string] => ['remove', row.size, shown(row.path)]),
  ];
  return rows.map(([action, size, where]) => `  ${action.padEnd(7)} ${formatBytes(size).padStart(9)}  ${where}`);
}

/** Pages, Numbers and Keynote documents saved as folders, with the fix. `showPaths` follows the report's own rule: paths are case data. */
export function iworkPackageLines(rels: readonly string[], showPaths: boolean, known: KnownMatcher | null = null): string[] {
  const head = `Not synced: ${rels.length} saved as a folder, so any already in the room stay at their last synced version. In the app, choose File > Advanced > Change File Type > Single File.`;
  return showPaths ? [head, ...rels.map((rel) => `  ${maskPath(rel, known)}`)] : [head];
}

export function formatReport(input: ReportInput): string {
  const { plan, files } = input;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const upload = [...plan.adds, ...plan.changes].reduce((sum, op) => sum + op.size, 0);
  const lines = [
    `Sync dry run (${input.target})`,
    `  Source: ${files.length} files, ${formatBytes(total)}: ${kindCounts(files) || 'none'}`,
    `  Skipped: ${input.skipped.dotfile} dotfiles, ${input.skipped['lock-or-placeholder']} lock or placeholder files`,
    `  Plan: ${plan.adds.length} adds, ${plan.changes.length} changes, ${plan.renames.length} renames, ` +
      `${plan.removals.length} removals, ${plan.unchanged.length} unchanged (${formatBytes(upload)} to upload)`,
    `  Index: ${input.toIndex.direct} text files and ${input.toIndex.extracted} PDFs and images to (re)index; extractor: ${input.extractor}`,
    `  Counsel uploads waiting to be pulled: ${input.pendingPulls}`,
  ];
  if (!input.summary && plan.adds.length + plan.changes.length + plan.renames.length + plan.removals.length > 0) {
    lines.push('', ...table(plan, input.known ?? null));
  }
  if (input.iworkPackages.length > 0) lines.push('', ...iworkPackageLines(input.iworkPackages, !input.summary, input.known ?? null));
  if (input.pii && input.pii.lines.length > 0) lines.push('', ...input.pii.lines);
  lines.push('', `Plan fingerprint: ${planFingerprint(plan, input.pii?.fingerprint)}`);
  return lines.join('\n');
}
