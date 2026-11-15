// SPDX-License-Identifier: Apache-2.0
// Text for the index. PDFs and raster images go through the LegallasExtract Swift CLI (PDFKit text, Vision
// OCR for scanned pages and images), built from this repo. Markdown, CSV and plain-text kinds are read directly. Results are cached
// by sha256 in <cacheDir>/text/ so unchanged files are never extracted twice. SEC Form D XML is read directly
// too, but set out as labelled text (src/scripts/formd.ts), the same text the room's viewer shows; so is an email
// (.eml, src/scripts/eml.ts). Word, RTF, OpenDocument text, PowerPoint and Excel files are read as text by office.ts,
// on every computer, and Pages, Numbers and Keynote files by iwork.ts. LegallasExtract itself is macOS only;
// extract-windows.ts reads PDFs and images on Windows.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderEml } from '../src/scripts/eml.ts';
import { renderFormD } from '../src/scripts/formd.ts';
import type { Kind } from './diff.ts';
import { isPlainKeyFile, iworkFormat, iworkPages } from './iwork.ts';
import { officeFormat, officeText } from './office.ts';
import { readTextFile } from './text-file.ts';

export interface ExtractedPage {
  n: number;
  text: string;
  ocr: boolean;
  /**
   * Set on direct text a renderer produced: an SEC Form D set out from its XML, an email from its MIME, or an
   * office or iWork document's text. Never cached.
   */
  rendered?: boolean;
}

/** The extraction interface sync depends on. */
export type ExtractPages = (file: string) => Promise<ExtractedPage[]>;

export class ExtractorUnavailable extends Error {}

export type ExtractorStatus = 'ready' | 'needs-build' | 'not-built';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SOURCE_DIRS = ['Sources/LegallasExtract', 'Sources/LegallasExtraction'];
const BINARY = '.build/release/LegallasExtract';
const MAX_OUTPUT = 1 << 30;
/**
 * Per-file limit for one LegallasExtract run. Typical PDFs take well under a second and OCR-heavy scans about
 * 20 s under load, so this only trips when Vision hangs. execFile then sends SIGTERM and the run fails as
 * "timeout", which sync skips (retried next run) and --check-index counts under that code.
 */
export const EXTRACT_TIMEOUT_MS = 180_000;

/** Agent instruction files never reach the index; the rule lives in worker/agent-files.ts, shared with the MCP. */
export { isAgentFile } from '../worker/agent-files.ts';

/**
 * True for an office document (Word, RTF, OpenDocument text, PowerPoint, Excel, Pages, Numbers, Keynote) with a path
 * segment, a folder or the file name, that contains "privileged" in any case. Those stay download-only: the room still
 * lists them and opens them, but they never reach the index, so Ask never reads or quotes them. The rule covers office
 * files only (the owner, 2026-10-04): PDFs, Markdown, text and email in the same folders are indexed as before. `rel` is
 * the path inside the shared folder, as for isAgentFile.
 */
export function isPrivilegedOffice(rel: string): boolean {
  return (officeFormat(rel) !== null || iworkFormat(rel) !== null) && rel.split(/[\\/]/).some((segment) => /privileged/i.test(segment));
}

/** Where save-back puts approved drafts, at the top of the company folder (propose-and-approve, Decision 3). */
export const DRAFTS_FOLDER = 'Drafts';

/**
 * A draft is never indexed, so Ask and the members' AIs can't cite it as evidence. It stays a document anyone can
 * open. Moving it out of Drafts/ (once signed, say) makes it searchable.
 */
export function isDraft(rel: string): boolean {
  return rel.normalize('NFC').split('/')[0]?.toLowerCase() === DRAFTS_FOLDER.toLowerCase();
}

/**
 * How a document's text is obtained for the index, or null when it is not indexed. Images are OCR'd by the
 * extractor except SVG, which is vector markup Vision cannot read. Office and iWork documents are read directly
 * (office.ts, iwork.ts); an HTML visual is read from its rendered text (directTextPages, decision D8), never its
 * markup. ZIP and other files stay download-only. `file` is any path with the extension.
 * indexWork also leaves out agent instruction files (isAgentFile) and privileged office files (isPrivilegedOffice).
 */
export function indexSource(kind: Kind, file = ''): 'extractor' | 'direct' | null {
  if (kind === 'pdf') return 'extractor';
  if (kind === 'image') return /\.svg$/i.test(file) ? null : 'extractor';
  if (kind === 'markdown' || kind === 'csv' || kind === 'text' || kind === 'visual') return 'direct';
  if (kind === 'file' && (officeFormat(file) !== null || iworkFormat(file) !== null)) return 'direct';
  return null;
}

async function newestMtime(dir: string): Promise<number> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  let newest = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const info = await stat(path.join(entry.parentPath, entry.name)).catch(() => null);
    if (info) newest = Math.max(newest, info.mtimeMs);
  }
  return newest;
}

export async function extractorStatus(repoRoot = REPO_ROOT, platform: NodeJS.Platform = process.platform): Promise<ExtractorStatus> {
  // Windows reads PDFs and images with what it ships (extract-windows.ts). There is nothing to build.
  if (platform === 'win32') return 'ready';
  const binary = await stat(path.join(repoRoot, BINARY)).catch(() => null);
  const sources = Math.max(...(await Promise.all(SOURCE_DIRS.map((dir) => newestMtime(path.join(repoRoot, dir))))));
  if (!binary) return sources > 0 ? 'needs-build' : 'not-built';
  return sources > binary.mtimeMs ? 'needs-build' : 'ready';
}

/** Runs a command. With timeoutMs, a run that overruns is killed and fails as "<name> failed: timeout" (no args, no stderr). */
function run(command: string, args: string[], cwd: string, timeoutMs = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, maxBuffer: MAX_OUTPUT, encoding: 'utf8', timeout: timeoutMs }, (error, stdout, stderr) => {
      const name = path.basename(command);
      if (error && timeoutMs > 0 && error.killed && error.signal === 'SIGTERM') reject(new Error(`${name} failed: timeout`));
      else if (error) reject(new Error(`${name} failed: ${String(stderr).trim().split('\n').slice(-3).join(' ')}`));
      else resolve(stdout);
    });
  });
}

/** Validates the CLI's JSON: {sha256, pages: [{n, text, ocr}]}. */
export function parseExtractorOutput(stdout: string): ExtractedPage[] {
  const parsed: unknown = JSON.parse(stdout);
  const pages = (parsed as { pages?: unknown })?.pages;
  if (!Array.isArray(pages)) throw new Error('LegallasExtract output has no pages array');
  return pages.map((page: unknown) => {
    const { n, text, ocr } = (page ?? {}) as Record<string, unknown>;
    if (!Number.isSafeInteger(n) || (n as number) < 1 || typeof text !== 'string') throw new Error('LegallasExtract output has a malformed page');
    return { n: n as number, text, ocr: ocr === true };
  });
}

/**
 * The LegallasExtract-backed extractor. The release binary is rebuilt once per run when its sources are
 * newer. Until the Swift target exists, every call rejects with ExtractorUnavailable and sync skips PDFs.
 * Each file gets timeoutMs (the build does not); a run that overruns rejects with "LegallasExtract failed: timeout".
 */
export function legallasExtractor(repoRoot = REPO_ROOT, timeoutMs = EXTRACT_TIMEOUT_MS): ExtractPages {
  let ready: Promise<string> | null = null;
  const ensureBinary = async () => {
    const status = await extractorStatus(repoRoot);
    if (status === 'not-built') throw new ExtractorUnavailable('extractor not built: LegallasExtract has no sources or binary in this checkout');
    if (status === 'needs-build') {
      await run('swift', ['build', '-c', 'release', '--product', 'LegallasExtract'], repoRoot).catch((error: Error) => {
        throw new ExtractorUnavailable(`extractor not built: ${error.message}`);
      });
    }
    return path.join(repoRoot, BINARY);
  };
  return async (file) => {
    ready ??= ensureBinary();
    const binary = await ready;
    return parseExtractorOutput(await run(binary, [file], repoRoot, timeoutMs));
  };
}

/**
 * Versions of the text read directly from files whose text is rendered rather than read as it is, one per
 * renderer, so a bump re-indexes just that renderer's files; Markdown, CSV and other text carry no version.
 * RENDER_VERSION is XML's, where a Form D is set out as labelled text (src/scripts/formd.ts). 1: Form D as text.
 */
export const RENDER_VERSION = 1;
/** Emails (.eml) set out by src/scripts/eml.ts. 1: headers, attachment names and the plain text, not raw MIME. */
export const EMAIL_RENDER_VERSION = 1;
/** Office documents read by office.ts (textutil, OOXML parts). 1: first indexed. 2: Word's and RTF's hidden and struck text left out. */
export const OFFICE_RENDER_VERSION = 2;
/** Pages, Numbers and Keynote files read by iwork.ts. 1: first indexed. 2: a hidden table name left out. */
export const IWORK_RENDER_VERSION = 2;
/**
 * HTML visuals, read from the text of the page as rendered in headless Chrome (scripts/visual-render.ts and
 * visual-dom.ts), kept in the sync cache by scripts/visual-ai.ts. Bump it when the walker's text changes for the
 * same page: cached text from an older walker is then ignored until `npm run visuals -- --ai` renders it again.
 * 1: headings, lines, lists, table rows, SVG labels and notes.
 */
export const VISUAL_RENDER_VERSION = 1;

/**
 * Text indexed as it is (Markdown, CSV, plain text), recorded as the manifest's `text`. Bump it when reading such a file
 * gives other text for the same bytes. 1: UTF-16 and UTF-32 read as their text, so those files are indexed again once.
 */
export const PLAIN_TEXT_VERSION = 1;

export type RenderKind = 'formd' | 'email' | 'office' | 'iwork' | 'visual';

/** Which renderer sets out a file's direct text, by its name or path, or null for text indexed as it is. */
export function renderKind(file: string): RenderKind | null {
  if (/\.xml$/i.test(file)) return 'formd';
  if (/\.eml$/i.test(file)) return 'email';
  if (/\.html?$/i.test(file)) return 'visual';
  if (iworkFormat(file) !== null) return 'iwork';
  return officeFormat(file) !== null ? 'office' : null;
}

const RENDER_VERSIONS: Record<RenderKind, number> = {
  formd: RENDER_VERSION,
  email: EMAIL_RENDER_VERSION,
  office: OFFICE_RENDER_VERSION,
  iwork: IWORK_RENDER_VERSION,
  visual: VISUAL_RENDER_VERSION,
};

/** The render version for a file whose direct text is rendered (by its name or path), otherwise null. */
export function renderVersion(file: string): number | null {
  const kind = renderKind(file);
  return kind === null ? null : RENDER_VERSIONS[kind];
}

/** Reads a visual's rendered text by the sha256 of its HTML (scripts/visual-ai.ts visualTextSource), or null. */
export type VisualTextSource = (sha256: string) => Promise<string | null>;

/** A visual whose rendered text is not in the cache (or no cache was given): it is not indexed this run. */
export class VisualTextMissing extends Error {
  override name = 'VisualTextMissing';
  constructor() {
    super('no rendered text for this visual yet: visual-text');
  }
}

/**
 * A visual's index text: the cached text of its rendered page, found by the sha256 of the very bytes in `file`, so
 * text can never be paired with a different version of the page. Never the HTML itself.
 */
async function visualPages(file: string, visualText: VisualTextSource | undefined): Promise<ExtractedPage[]> {
  if (!visualText) throw new VisualTextMissing();
  const sha256 = createHash('sha256').update(await readFile(file)).digest('hex');
  const text = await visualText(sha256);
  if (text === null) throw new VisualTextMissing();
  return [{ n: 1, text, ocr: false, rendered: true }];
}

/**
 * Markdown, CSV and text are indexed as one page of their own text. An SEC Form D in XML is one page of its
 * fields as labelled text, an email one page of its headers, attachment names and text, an office document one page
 * of its text, and an iWork document one page per sheet or slide; `name` is the document's file name (snapshot files
 * have opaque names), which picks the renderer and gives a filing's accession number, and is required so no caller can
 * drop it. XML that is not a
 * Form D, and a .eml that is not an email, are indexed as they are. An HTML visual is one page of its rendered text
 * from `visualText` (the side file's text, decision D8); without it, or before the page was rendered, it throws
 * VisualTextMissing rather than read the markup.
 */
export async function directTextPages(file: string, name: string, visualText?: VisualTextSource): Promise<ExtractedPage[]> {
  const office = officeFormat(name);
  if (office) return [{ n: 1, text: await officeText(file, office), ocr: false, rendered: true }];
  if (await isPlainKeyFile(file, name)) return [];
  const iwork = iworkFormat(name);
  if (iwork) return (await iworkPages(file, iwork)).map((page) => ({ ...page, ocr: false, rendered: true }));
  if (renderKind(name) === 'visual') return visualPages(file, visualText);
  const text = await readTextFile(file);
  const kind = renderKind(name);
  const rendered = kind === 'formd' ? renderFormD(text, name) : kind === 'email' ? renderEml(text) : null;
  return [rendered === null ? { n: 1, text, ocr: false } : { n: 1, text: rendered, ocr: false, rendered: true }];
}

/**
 * Version of the text LegallasExtract produces. Bump it whenever a change to Sources/LegallasExtraction or
 * Sources/LegallasExtract alters the text for the same file (OCR reading order, retries), so cached text is
 * extracted again. 2: tables read row by row, skipped lines re-read, 400 dpi retry. 3: pages whose text layer is
 * thin for the ink on them, or garbage, are OCRed too, and OCR replaces the layer when it reads clearly more.
 */
export const EXTRACTOR_VERSION = 3;

/** The version recorded in a cache entry, or null when the entry is not valid JSON (a truncated write heals). */
function cachedVersion(entry: string): unknown {
  try {
    return (JSON.parse(entry) as { version?: unknown } | null)?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Wraps an extractor with a sha256-keyed cache in <cacheDir>/text/ (files are 0600). An entry written by an
 * older extractor (a different or missing version), or one that is not valid JSON, is a miss and is overwritten.
 * Only successful extractions are cached.
 */
export function cachedExtractor(
  extract: ExtractPages,
  cacheDir: string,
  version = EXTRACTOR_VERSION,
): (file: string, sha256: string) => Promise<ExtractedPage[]> {
  const dir = path.join(cacheDir, 'text');
  return async (file, sha256) => {
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('cachedExtractor: bad sha256');
    const cached = path.join(dir, `${sha256}.json`);
    const hit = await readFile(cached, 'utf8').catch(() => null);
    if (hit !== null && cachedVersion(hit) === version) return parseExtractorOutput(hit);
    const pages = await extract(file);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(cached, JSON.stringify({ version, sha256, pages }), { mode: 0o600 });
    return pages;
  };
}
