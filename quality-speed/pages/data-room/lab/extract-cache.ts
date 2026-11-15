// SPDX-License-Identifier: Apache-2.0
// The extract cache (../extract-cache/): what LegallasExtract reads from the fictional room's PDFs and images, one
// <sha256>.json per file, in the form web/scripts/extract.ts cachedExtractor reads. With it, seeding runs no Swift, so the
// sample room comes up on Linux. Fictional files only: everyRecordFile below, the dev fixtures and the invented record.
//
//   node extract-cache.ts write --binary <LegallasExtract> --out <dir>     macOS: read every file, write the folder
//   node extract-cache.ts check --binary <LegallasExtract> [--dir <dir>]   macOS: read again, fail on any different text
//   node extract-cache.ts covers [--dir <dir>]                             any OS: every file has its entry, none is stale
//   node extract-cache.ts install --out <seed cache dir>                   any OS: covers, then copies the entries where sync reads them
//
// A new or changed document needs one Mac run: the "Sample room extract" workflow, whose artifact replaces the folder.
// Messages carry hashes and page numbers, never text.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { companyFixture, devFixture, extract, guard, indexJob, piiScan, syncDiff, type ExtractedPage, type FixtureFile, type PlanFile } from './web.ts';

const { fixtureFiles, loadFixtureInputs } = devFixture;
const { diffSync, kindOf } = syncDiff;
const { EXTRACT_TIMEOUT_MS, EXTRACTOR_VERSION, parseExtractorOutput } = extract;
const { guardWalk } = guard;
const { indexWork } = indexJob;
const { scanRead } = piiScan;

export const CACHE_DIR = path.resolve(import.meta.dirname, '..', 'extract-cache');
const GOLD_BUILD = path.resolve(import.meta.dirname, '..', 'gold', 'build.ts');
const HOW_TO_REFRESH = 'Run the "Sample room extract" workflow and replace quality-speed/pages/data-room/extract-cache with its artifact.';
const ENTRY = /^([0-9a-f]{64})\.json$/;

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A record's files: a built folder as sync walks it, or the dev fixture. */
export async function recordFiles(source?: string): Promise<FixtureFile[]> {
  if (!source) return fixtureFiles(await loadFixtureInputs());
  const { files } = await guardWalk(source);
  return Promise.all(files.map(async (file) => ({ rel: file.rel, bytes: await readFile(file.abs) })));
}

/** What this file needs from ../gold/build.ts, which keeps its own types to itself. */
interface GoldBuild {
  ROOM_NAMES: readonly string[];
  loadRooms(): Promise<Record<string, unknown>>;
  roomFiles(room: string, spec: unknown, base: unknown): FixtureFile[];
}

/** Every file any room may seed: both dev fixtures (#206), and each room of the invented record once it is in this checkout. */
export async function everyRecordFile(): Promise<FixtureFile[]> {
  const inputs = await loadFixtureInputs();
  const all = [...fixtureFiles(inputs), ...companyFixture.companyFixtureFiles()];
  if (!existsSync(GOLD_BUILD)) return all;
  const gold = (await import(pathToFileURL(GOLD_BUILD).href)) as GoldBuild;
  const rooms = await gold.loadRooms();
  return [...all, ...gold.ROOM_NAMES.flatMap((room) => gold.roomFiles(room, rooms[room], inputs))];
}

/** Files sync reads through LegallasExtract: its SSN guard reads each one, indexed or not (pii-scan.ts). */
export function extractedFiles(files: readonly FixtureFile[]): FixtureFile[] {
  return files.filter((file) => scanRead(kindOf(file.rel).kind, file.rel) === 'extractor');
}

/** What a sync of these files sends: every document, and the sha256 of each one it indexes. The real plan, not a copy of its rules. */
export function syncExpectation(files: readonly FixtureFile[]): { documents: number; indexed: string[] } {
  const snapshot: PlanFile[] = files.map((file) => ({ rel: file.rel, abs: '', size: file.bytes.length, mtimeMs: 0, dev: 0, ino: 0, snapshot: '', sha256: sha256(file.bytes) }));
  const plan = diffSync(snapshot, []);
  return { documents: plan.adds.length, indexed: indexWork(plan, {}).jobs.map((job) => job.sha256) };
}

export interface Coverage {
  /** Files with no entry. */
  missing: string[];
  /** Entries no file needs. */
  stale: string[];
  /** Entries from another EXTRACTOR_VERSION, which cachedExtractor would ignore. */
  otherVersion: string[];
  /** Entries whose hash isn't their name's, or whose text isn't what their PDF holds. */
  wrongContent: string[];
}

const squashed = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The text of a PDF dev-pdf.ts wrote, a page per item with its whitespace squashed. Each of its lines is one literal string, uncompressed. */
export function writtenPdfPages(pdf: Buffer): string[] {
  const streams = [...pdf.toString('latin1').matchAll(/stream\n([\s\S]*?)endstream/g)];
  return streams.map(([, stream = '']) => squashed([...stream.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)].map(([, line = '']) => line.replace(/\\(.)/g, '$1')).join(' ')));
}

/**
 * Whether an entry holds what its name says. Any OS can read a PDF's own text this way, so planted text fails in `checks`. An image's
 * can only be read on a Mac, which is why a change to the folder also runs `swift-ocr`'s `check`.
 */
function holdsItsFile(entry: { sha256?: unknown; pages?: { text?: unknown }[] }, hash: string, file: FixtureFile | undefined): boolean {
  if (entry.sha256 !== hash || !Array.isArray(entry.pages)) return false;
  if (!file?.rel.toLowerCase().endsWith('.pdf')) return true;
  const written = writtenPdfPages(file.bytes);
  return written.length === entry.pages.length && written.every((text, i) => text === squashed(String(entry.pages?.[i]?.text)));
}

export async function coverage(files: readonly FixtureFile[], dir: string, version = EXTRACTOR_VERSION): Promise<Coverage> {
  const byHash = new Map(extractedFiles(files).map((file) => [sha256(file.bytes), file] as const));
  const names = await readdir(dir).catch(() => [] as string[]);
  const entries = new Map(names.flatMap((name) => { const hash = ENTRY.exec(name)?.[1]; return hash ? [[hash, name] as const] : []; }));
  const otherVersion: string[] = [];
  const wrongContent: string[] = [];
  for (const [hash, name] of entries) {
    const entry = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as { version?: unknown; sha256?: unknown; pages?: { text?: unknown }[] };
    if (entry.version !== version) otherVersion.push(hash);
    if (!holdsItsFile(entry, hash, byHash.get(hash))) wrongContent.push(hash);
  }
  return {
    missing: [...byHash.keys()].filter((hash) => !entries.has(hash)),
    stale: [...entries.keys()].filter((hash) => !byHash.has(hash)),
    otherVersion,
    wrongContent,
  };
}

/** Null when the folder fits the files; otherwise what to tell whoever changed them. */
export function coverageProblem(result: Coverage): string | null {
  const parts = [
    result.missing.length ? `${result.missing.length} documents have no cached text` : '',
    result.stale.length ? `${result.stale.length} cached entries belong to no document` : '',
    result.otherVersion.length ? `${result.otherVersion.length} cached entries are from another extractor version` : '',
    result.wrongContent.length ? `${result.wrongContent.length} cached entries don't hold what their file does` : '',
  ].filter(Boolean);
  return parts.length ? `The sample room's extract cache is out of step: ${parts.join(', ')}. ${HOW_TO_REFRESH}` : null;
}

/** Copies the committed entries where sync looks for them: <cacheDir>/text/. */
export async function installCache(dir: string, cacheDir: string): Promise<number> {
  const target = path.join(cacheDir, 'text');
  await mkdir(target, { recursive: true, mode: 0o700 });
  const names = (await readdir(dir)).filter((name) => ENTRY.test(name));
  for (const name of names) await copyFile(path.join(dir, name), path.join(target, name));
  return names.length;
}

/** The sha256 of each cached entry with no text on any page, such as an image with no words. Such a document has no index parts. */
export async function textlessEntries(dir: string): Promise<Set<string>> {
  const textless = new Set<string>();
  for (const name of await readdir(dir)) {
    const hash = ENTRY.exec(name)?.[1];
    if (!hash) continue;
    if (parseExtractorOutput(await readFile(path.join(dir, name), 'utf8')).every((page) => page.text.trim() === '')) textless.add(hash);
  }
  return textless;
}

/** One entry as committed: stable key order, one line per field, so a refresh diffs by page. */
export function entryJson(sha: string, pages: readonly ExtractedPage[], version = EXTRACTOR_VERSION): string {
  return `${JSON.stringify({ version, sha256: sha, pages: pages.map(({ n, text, ocr }) => ({ n, ocr, text })) }, null, 1)}\n`;
}

/** The page numbers whose text differs, or whose page exists on one side only. */
export function pagesThatDiffer(a: readonly ExtractedPage[], b: readonly ExtractedPage[]): number[] {
  const text = (pages: readonly ExtractedPage[]) => new Map(pages.map((page) => [page.n, page.text]));
  const [left, right] = [text(a), text(b)];
  return [...new Set([...left.keys(), ...right.keys()])].filter((n) => left.get(n) !== right.get(n)).sort((x, y) => x - y);
}

function readWith(binary: string, file: string): Promise<ExtractedPage[]> {
  return new Promise((resolve, reject) => {
    execFile(binary, [file], { encoding: 'utf8', maxBuffer: 1 << 30, timeout: EXTRACT_TIMEOUT_MS }, (error, stdout) => {
      if (error) reject(new Error(`LegallasExtract failed (exit ${String(error.code)})`));
      else resolve(parseExtractorOutput(stdout));
    });
  });
}

/** Reads each distinct file through the binary, from a scratch folder, one at a time. */
async function extractAll(binary: string, files: readonly FixtureFile[]): Promise<Map<string, ExtractedPage[]>> {
  const scratch = await mkdtemp(path.join(tmpdir(), 'legallas-extract-'));
  const read = new Map<string, ExtractedPage[]>();
  try {
    for (const [index, file] of files.entries()) {
      if (read.has(sha256(file.bytes))) continue;
      const name = path.join(scratch, `${String(index).padStart(6, '0')}${path.extname(file.rel).toLowerCase()}`);
      await writeFile(name, file.bytes);
      read.set(sha256(file.bytes), await readWith(binary, name));
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return read;
}

async function write(binary: string, out: string, files: readonly FixtureFile[]): Promise<void> {
  await mkdir(out, { recursive: true });
  const read = await extractAll(binary, extractedFiles(files));
  for (const [hash, pages] of read) await writeFile(path.join(out, `${hash}.json`), entryJson(hash, pages));
  const ocr = [...read.values()].flat().filter((page) => page.ocr).length;
  process.stdout.write(`Wrote ${read.size} entries (${[...read.values()].flat().length} pages, ${ocr} read by OCR) to ${out}\n`);
}

async function check(binary: string, dir: string, files: readonly FixtureFile[]): Promise<void> {
  const fit = coverageProblem(await coverage(files, dir));
  if (fit) throw new Error(fit);
  const read = await extractAll(binary, extractedFiles(files));
  const differ: string[] = [];
  for (const [hash, pages] of read) {
    const cached = parseExtractorOutput(await readFile(path.join(dir, `${hash}.json`), 'utf8'));
    const pagesOff = pagesThatDiffer(pages, cached);
    if (pagesOff.length > 0) differ.push(`${hash}: pages ${pagesOff.join(', ')}`);
  }
  if (differ.length > 0) throw new Error(`LegallasExtract now reads ${differ.length} documents differently:\n${differ.join('\n')}\n${HOW_TO_REFRESH}`);
  process.stdout.write(`The extractor still reads all ${read.size} documents exactly as cached.\n`);
}

const USAGE = 'usage: node extract-cache.ts write --binary <path> --out <dir> | check --binary <path> [--dir <dir>] | covers [--dir <dir>] | install --out <dir>';

export function parseCacheArgs(args: readonly string[]): { command: 'write' | 'check' | 'covers' | 'install'; binary: string; out: string; dir: string } {
  const [command, ...rest] = args;
  const options = { binary: '', out: '', dir: CACHE_DIR };
  for (let i = 0; i < rest.length; i += 2) {
    const value = rest[i + 1];
    if (!value) throw new Error(USAGE);
    if (rest[i] === '--binary') options.binary = path.resolve(value);
    else if (rest[i] === '--out') options.out = path.resolve(value);
    else if (rest[i] === '--dir') options.dir = path.resolve(value);
    else throw new Error(USAGE);
  }
  if (command === 'write' && options.binary && options.out) return { command, ...options };
  if (command === 'check' && options.binary) return { command, ...options };
  if (command === 'covers') return { command, ...options };
  if (command === 'install' && options.out) return { command, ...options };
  throw new Error(USAGE);
}

async function main(): Promise<void> {
  const { command, binary, out, dir } = parseCacheArgs(process.argv.slice(2));
  const files = await everyRecordFile();
  if (command === 'write') await write(binary, out, files);
  else if (command === 'check') await check(binary, dir, files);
  else {
    const problem = coverageProblem(await coverage(files, dir));
    if (problem) throw new Error(problem);
    process.stdout.write(`The extract cache covers all ${new Set(extractedFiles(files).map((file) => sha256(file.bytes))).size} distinct documents.\n`);
    if (command === 'install') process.stdout.write(`${await installCache(dir, out)} entries installed in ${out}.\n`);
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
