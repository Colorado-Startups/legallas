// SPDX-License-Identifier: Apache-2.0
// A copy of the counsel room's documents for a firm whose IT has not yet approved the live connection:
// counsel load it into a Harvey Vault (folder upload) or a SharePoint site that Copilot can read.
//
//   npm run counsel-pack -- --out <dir>   build or refresh the pack in <dir> (outside sourceRoot and any repo)
//   --dry-run           read D1 and the source folder, print what a run would do, write nothing
//   --zip               also write <dir>.zip
//   --target <t>        remote (default, production D1, read-only) or local (wrangler dev state)
//   --include-uploads   also include counsel uploads, read from legallas-files
//   --questions         also write QUESTIONS-FOR-YOUR-LAWYER.md, the checklist's open points (off unless asked for)
//   --verbose           list each document's outcome by path (case data: keep it off shared logs)
//   --config <file>     another legallas.config.json
//
// What counsel may see comes from the live D1 rows; the bytes come from sourceRoot, walked by the sync guard
// and checked against D1's sha256. See counsel-pack-build.ts. The pack only reads from Cloudflare.
// Ctrl-C (or SIGTERM) lets the copies in flight finish, saves the manifest and exits; a second one exits at
// once. The next run clears any temp files (and a partial zip beside --out) an interrupt left behind.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildPack, type PackReport } from './counsel-pack-build.ts';
import { assertStoredName, controlPrefixOf, DEFAULT_CONFIG_PATH, parseSyncConfig } from './config.ts';
import { GuardAbort } from './guard.ts';
import { formatBytes, iworkPackageLines } from './report.ts';
import { cliWrangler, type Target } from './wrangler.ts';

export interface CounselPackOptions {
  out: string;
  zip: boolean;
  target: Target;
  includeUploads: boolean;
  questions: boolean;
  verbose: boolean;
  dryRun: boolean;
  config: string;
}

const USAGE = 'usage: npm run counsel-pack -- --out <dir> [--dry-run] [--zip] [--target remote|local] [--include-uploads] [--questions] [--verbose] [--config <file>]';
const DEFAULT_BANNER = 'Attorney work product.';
const BANNER_MAX = 200;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export function parseCounselPackArgs(args: readonly string[]): CounselPackOptions {
  const options: CounselPackOptions = {
    out: '', zip: false, target: 'remote', includeUploads: false, questions: false, verbose: false, dryRun: false,
    config: DEFAULT_CONFIG_PATH,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const value = args[i + 1];
    if (arg === '--out' && value && !value.startsWith('--')) options.out = path.resolve(args[++i]);
    else if (arg === '--zip') options.zip = true;
    else if (arg === '--target' && (value === 'remote' || value === 'local')) options.target = args[++i] as Target;
    else if (arg === '--include-uploads') options.includeUploads = true;
    else if (arg === '--questions') options.questions = true;
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--config' && value) options.config = path.resolve(args[++i]);
    else throw new Error(USAGE);
  }
  if (!options.out) throw new Error(`--out is required\n${USAGE}`);
  return options;
}

/** The confidentiality line for README.txt: the room's banner from legallas.config.json, or a plain default. */
export function bannerOf(raw: unknown): string {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).banner : undefined;
  if (typeof value !== 'string') return DEFAULT_BANNER;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= BANNER_MAX && !CONTROL.test(trimmed) ? trimmed : DEFAULT_BANNER;
}

/** The summary printed after a run: counts and sizes only, plus paths when --verbose asks for them. */
export function formatPackReport(report: PackReport, verbose: boolean): string {
  const o = report.outcomes;
  const dry = report.dryRun;
  const skipped = o.missing + o.changed + o.conflict + o.unavailable + o.failed;
  const packed = `${o.copied + o.unchanged} documents (${formatBytes(report.packedBytes)})`;
  const lines = [
    dry
      ? `Dry run, nothing was written. Would pack ${packed}; ${o.copied} to copy (${formatBytes(report.copiedBytes)}), ${o.unchanged} unchanged.`
      : `Pack: ${packed}; ${o.copied} copied (${formatBytes(report.copiedBytes)}), ${o.unchanged} unchanged.`,
    `${dry ? 'Would remove' : 'Removed'} ${report.removed} documents no longer in the room (${formatBytes(report.removedBytes)}).`,
  ];
  if (report.sweptTemps > 0) lines.push(`${dry ? 'Would clear' : 'Cleared'} ${report.sweptTemps} temp files an interrupted run left behind.`);
  if (skipped > 0) {
    lines.push(
      `${dry ? 'Would skip' : 'Skipped'} ${skipped}: ${o.missing} missing on this Mac, ${o.changed} different from the room, ` +
        `${o.conflict} where --out already holds another file, ${o.unavailable} uploads that could not be read, ` +
        `${o.failed} that failed to copy (disk full or a link inside --out; run again once fixed).`,
    );
  }
  if (report.staleLocal > 0) lines.push(`${report.staleLocal} kept from the last pack although this Mac's copy changed since; run sync.`);
  if (report.replacedEdits > 0) {
    lines.push(`${report.replacedEdits} pack files edited since the last run ${dry ? 'would be' : 'were'} replaced with the room's version.`);
  }
  if (report.left > 0) lines.push(`${report.left} files no longer in the room were edited since the pack wrote them and were left in place.`);
  if (report.ignored > 0) lines.push(`${report.ignored} D1 rows were ignored (hidden or malformed).`);
  if (report.iworkPackages.length > 0) lines.push(...iworkPackageLines(report.iworkPackages, verbose));
  if (report.zip) lines.push(`Zip: ${report.zip.entries} entries (${formatBytes(report.zip.bytes)}).`);
  if (verbose) for (const { outcome, rel } of report.details) lines.push(`  ${outcome.padEnd(11)} ${rel}`);
  return lines.join('\n');
}

/** The error printed on failure: reason counts and codes only, paths only with --verbose. */
export function describeFailure(error: unknown, verbose: boolean): string {
  if (error instanceof GuardAbort) {
    const counts = new Map<string, number>();
    for (const v of error.violations) counts.set(v.reason, (counts.get(v.reason) ?? 0) + 1);
    const lines = [`${error.message.replace('Nothing was synced.', 'Nothing was packed.')}`, ...[...counts].map(([reason, n]) => `  ${reason.padEnd(17)} ${n}`)];
    if (verbose) lines.push(...error.violations.map((v) => `  ${v.reason.padEnd(17)} ${v.rel}`));
    else lines.push('Run again with --verbose to list the paths.');
    return lines.join('\n');
  }
  // File system errors carry the path they failed on; only the code and the call are shown.
  const fsError = error as NodeJS.ErrnoException;
  if (!verbose && typeof fsError?.code === 'string' && typeof fsError.syscall === 'string') return `File system error: ${fsError.code} (${fsError.syscall})`;
  return error instanceof Error ? error.message : String(error);
}

/** The process signals that stop a run, with the exit code each one gets. */
const SIGNALS = [['SIGINT', 130], ['SIGTERM', 143]] as const;

/** The part of `process` saveOnSignal uses; a fake in tests. */
export interface SignalTarget {
  on(signal: string, handler: () => void): unknown;
  off(signal: string, handler: () => void): unknown;
  exit(code: number): void;
  /** One line to stderr. */
  warn(line: string): void;
}

const processTarget: SignalTarget = {
  on: (signal, handler) => process.on(signal, handler),
  off: (signal, handler) => process.off(signal, handler),
  exit: (code) => process.exit(code),
  warn: (line) => process.stderr.write(`${line}\n`),
};

/**
 * On the first SIGINT or SIGTERM, runs `stop` (finish in-flight copies, save the manifest) and then exits
 * with the signal's code. A failed save is reported by its error code only. A second signal exits at once.
 * Returns the function that removes the handlers.
 */
export function saveOnSignal(stop: () => Promise<void>, target: SignalTarget = processTarget): () => void {
  let stopping = false;
  const handlers = SIGNALS.map(([signal, code]) => {
    const handler = () => {
      if (stopping) return target.exit(code);
      stopping = true;
      void stop()
        .catch((error: NodeJS.ErrnoException) => target.warn(`Could not save the pack manifest on interrupt (${typeof error?.code === 'string' ? error.code : 'error'}).`))
        .finally(() => target.exit(code));
    };
    target.on(signal, handler);
    return [signal, handler] as const;
  });
  return () => {
    for (const [signal, handler] of handlers) target.off(signal, handler);
  };
}

async function main(options: CounselPackOptions): Promise<void> {
  const text = await readFile(options.config, 'utf8').catch(() => {
    throw new Error(`Missing ${path.basename(options.config)}. Copy legallas.config.example.json and fill in the paths.`);
  });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // JSON.parse quotes the input around the error, and the config holds local paths: never pass it on.
    throw new Error(`${path.basename(options.config)} is not valid JSON`);
  }
  assertStoredName(raw);
  const config = parseSyncConfig(raw);
  const w = cliWrangler(options.target);
  const { out, includeUploads, questions, zip, dryRun } = options;
  const report = await buildPack(
    { out, sourceRoot: config.sourceRoot, prefix: controlPrefixOf(raw), banner: bannerOf(raw), includeUploads, questions, zip, dryRun },
    {
      d1Query: (sql) => w.d1Query(sql),
      r2Get: (bucket, key, file) => w.r2Get(bucket, key, file),
      now: new Date(),
      onInterrupt: (save) => saveOnSignal(save),
    },
  );
  process.stdout.write(`${formatPackReport(report, options.verbose)}\n`);
}

if (import.meta.main) {
  let verbose = false;
  Promise.resolve()
    .then(() => {
      const options = parseCounselPackArgs(process.argv.slice(2));
      verbose = options.verbose;
      return main(options);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${describeFailure(error, verbose)}\n`);
      process.exitCode = 1;
    });
}
