// SPDX-License-Identifier: Apache-2.0
// PDF and image text on Windows, where LegallasExtract (macOS Vision) can't run: the text layer through the room's own
// pdfjs-dist, and OCR through the Windows OCR API for pages whose layer can't be trusted, and for images. PowerShell 5.1
// ships with every Windows and can reach that API, so nothing is installed. The rules for which pages go to OCR, and which
// text wins, are PageTextExtractor.swift's, so a Windows founder's index reads like a Mac founder's. The one difference:
// the Mac measures a page's ink to find a scan under a thin layer, and this asks instead whether the page holds an image.
//
// stdout carries document text and goes nowhere but the parser. Errors carry a short code, never a file name or text.
import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTRACT_TIMEOUT_MS, ExtractorUnavailable, legallasExtractor, type ExtractedPage, type ExtractPages } from './extract.ts';
import type { ReadLimits } from './office.ts';

/** Pages with fewer non-whitespace characters than this are OCRed. */
export const OCR_THRESHOLD = 50;
/** A shorter layer on a page holding an image is OCRed too: a scan with a partial or stamped layer. */
export const SPARSE_THRESHOLD = 400;
/** A layer whose letters and digits are fewer than this fraction of its characters is garbage, and is OCRed. */
export const MIN_USEFUL_RATIO = 0.4;
/** OCR replaces a thin or garbage layer only when it reads this many times the layer's letters and digits. */
export const RICHER_FACTOR = 1.5;
/** OCR resolution, as on the Mac. */
const OCR_DPI = 300;
/** Pages sent to one PowerShell run, so a long scan restarts cleanly within its time limit. */
const OCR_BATCH = 20;
/** Exit code of the script when Windows has no OCR language installed. */
const NO_LANGUAGE = 4;
/** Largest amount of text one run may print. */
const MAX_OUTPUT = 256 * 1024 * 1024;
/** Heap for the process that reads one PDF. Files held in memory aren't in it, so this bounds what pdf.js builds from one. */
const PDF_HEAP_MB = 1024;
const IMAGE = /\.(?:png|jpe?g|gif|bmp|tiff?|webp|heic)$/i;

/** Characters that aren't whitespace. */
export function visibleCount(text: string): number {
  return text.replace(/\s/gu, '').length;
}

/** Letters and digits of any script. Private-use glyphs and punctuation don't count. */
export function usefulCount(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

export type LayerQuality = 'good' | 'sparse' | 'thin';

/** How far a page's text layer can be trusted. `hasImage` is asked only of a short, sound layer, so most pages pay nothing. */
export async function layerQuality(layer: string, hasImage: () => Promise<boolean>): Promise<LayerQuality> {
  const visible = visibleCount(layer);
  if (visible < OCR_THRESHOLD) return 'sparse';
  if (usefulCount(layer) < MIN_USEFUL_RATIO * visible) return 'thin';
  return visible < SPARSE_THRESHOLD && (await hasImage()) ? 'thin' : 'good';
}

/** Which text a page keeps once OCR has run. */
export function chooseText(quality: 'sparse' | 'thin', layer: string, read: string): { text: string; ocr: boolean } {
  const wins = quality === 'sparse' ? visibleCount(read) > visibleCount(layer) : usefulCount(read) > usefulCount(layer) && usefulCount(read) >= RICHER_FACTOR * usefulCount(layer);
  return wins ? { text: read, ocr: true } : { text: layer, ocr: false };
}

/** One page's text layer, and how far it can be trusted. `fields`: what is typed into its form fields, kept apart from the grade. */
export interface PdfLayer {
  n: number;
  text: string;
  quality: LayerQuality;
  fields?: string;
}

/**
 * The values typed or chosen in a page's form fields (text and choice widgets), one to a line. pdf.js's text layer leaves
 * them out, so a number typed into a filled tax form would pass the SSN guard unseen (#347). They go to search too: they
 * are what the form says.
 */
export function fieldLines(annotations: readonly unknown[]): string {
  const lines: string[] = [];
  for (const annotation of annotations) {
    if (typeof annotation !== 'object' || annotation === null) continue;
    const { fieldType, fieldValue } = annotation as { fieldType?: unknown; fieldValue?: unknown };
    if (fieldType !== 'Tx' && fieldType !== 'Ch') continue;
    for (const value of Array.isArray(fieldValue) ? fieldValue : [fieldValue]) {
      if (typeof value === 'string' && value.trim() !== '') lines.push(value.trim());
    }
  }
  return lines.join('\n');
}

/** A page's chosen text with its form field values after it. */
export function withFields(text: string, fields: string | undefined): string {
  return fields ? (text === '' ? fields : `${text}\n${fields}`) : text;
}

export type PdfLayers = (file: string) => Promise<PdfLayer[]>;

interface PdfTextItem {
  str: string;
  transform: number[];
  hasEOL?: boolean;
}

/** A page's text items as lines: items on one baseline join, and a move to another baseline starts a new line. */
export function linesOf(items: readonly PdfTextItem[]): string {
  const lines: string[] = [];
  let line = '';
  let lastY: number | null = null;
  for (const item of items) {
    const y = item.transform[5] ?? 0;
    if (lastY !== null && Math.abs(y - lastY) > 2) {
      lines.push(line);
      line = '';
    }
    line += item.str;
    lastY = y;
    if (item.hasEOL) {
      lines.push(line);
      line = '';
      lastY = null;
    }
  }
  if (line !== '') lines.push(line);
  return lines.join('\n').trim();
}

/** The parts of a pdf.js document these rules use. */
export interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<{
    getTextContent(): Promise<{ items: readonly unknown[] }>;
    getOperatorList(): Promise<{ fnArray: readonly number[] }>;
    getAnnotations?(): Promise<readonly unknown[]>;
    cleanup(): unknown;
  }>;
}

/** Each page's layer and grade. A page is let go once it's read, so a long PDF doesn't hold them all in memory. */
export async function layersOf(doc: PdfDocument, images: ReadonlySet<number>): Promise<PdfLayer[]> {
  const pages: PdfLayer[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const text = linesOf(content.items.filter((item) => typeof item === 'object' && item !== null && 'str' in item) as PdfTextItem[]);
    const quality = await layerQuality(text, async () => (await page.getOperatorList()).fnArray.some((op) => images.has(op)));
    const fields = fieldLines((await page.getAnnotations?.()) ?? []);
    pages.push(fields === '' ? { n, text, quality } : { n, text, quality, fields });
    page.cleanup();
  }
  return pages;
}

/**
 * True when a page tree node in the file's plain (uncompressed) objects lists more kids than its /Count. pdf.js takes the
 * page count from /Count and refuses a page past it, so a page beyond would go unread and the SSN guard would count the file
 * as scanned (#349). A valid tree never has fewer pages than kids. Nodes inside object streams aren't seen: no worse than
 * before.
 */
export function pageTreeUndercounts(pdf: string): boolean {
  for (const node of pdf.matchAll(/<<((?:(?!<<|>>)[\s\S])*?\/Type\s*\/Pages\b(?:(?!<<|>>)[\s\S])*?)>>/g)) {
    const body = node[1] ?? '';
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(body)?.[1];
    const count = /\/Count\s+(\d+)/.exec(body)?.[1];
    if (kids === undefined || count === undefined) continue;
    if ((kids.match(/\d+\s+\d+\s+R/g) ?? []).length > Number(count)) return true;
  }
  return false;
}

/** The child's side of pdfjsLayers. pdf.js is loaded only here, so a Mac sync never loads it. */
async function layersHere(file: string): Promise<PdfLayer[]> {
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const images = new Set(Object.entries(OPS).filter(([name]) => /^paint.*Image/.test(name)).map(([, op]) => op as number));
  const bytes = await readFile(file);
  // Latin-1 keeps one character per byte, so the structure reads as written.
  if (pageTreeUndercounts(bytes.toString('latin1'))) throw new Error('page count below its pages');
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  try {
    return await layersOf(await task.promise, images);
  } finally {
    await task.destroy();
  }
}

/**
 * Every page's layer and grade, through pdf.js in a child process with a heap limit and a deadline, as office.ts runs its
 * readers: a small PDF can unpack to fill the heap, which no catch can stop, or draw itself for ever. Anything but a clean
 * reply is a failure, never empty text, because the SSN guard counts text it was given as scanned.
 */
export function pdfjsLayers(file: string, limits: ReadLimits = {}): Promise<PdfLayer[]> {
  const args = [`--max-old-space-size=${limits.heapMb ?? PDF_HEAP_MB}`, fileURLToPath(import.meta.url), file];
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, { encoding: 'utf8', maxBuffer: MAX_OUTPUT, timeout: limits.timeoutMs ?? EXTRACT_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const code = error.killed && error.signal === 'SIGTERM' ? 'timeout' : /maxBuffer|heap out of memory/i.test(`${error.message}${stderr}`) ? 'too-large' : 'unreadable';
        return reject(new Error(`pdf failed: ${code}`));
      }
      try {
        const reply = JSON.parse(stdout) as { pages?: PdfLayer[]; code?: unknown };
        if (Array.isArray(reply.pages)) return resolve(reply.pages);
        reject(new Error(`pdf failed: ${reply.code === 'encrypted' ? 'encrypted' : 'unreadable'}`));
      } catch {
        reject(new Error('pdf failed: unreadable'));
      }
    });
  });
}

/** Reads `pages` of a PDF, or a whole image when `pages` is null, as page number to text. */
export type Ocr = (file: string, pages: readonly number[] | null) => Promise<Map<number, string>>;

/**
 * The Windows OCR API from PowerShell, as a script on stdin. Its input is in the environment, so no file name is parsed as
 * a command, and it is ASCII, so no code page can change it. Exit codes: 0 ok, 4 no OCR language.
 */
export const WINDOWS_OCR_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
$asOperation = ($methods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1' })[0]
$asAction = ($methods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
function Await($operation, [Type] $type) {
  $task = $asOperation.MakeGenericMethod($type).Invoke($null, @($operation))
  $task.Wait()
  $task.Result
}
function AwaitAction($action) {
  $task = $asAction.Invoke($null, @($action))
  $task.Wait()
}
$null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { [Console]::Error.Write('no-language'); exit 4 }

function Read-Decoder($decoder) {
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $ready = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($bitmap, [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)
  $result = Await ($engine.RecognizeAsync($ready)) ([Windows.Media.Ocr.OcrResult])
  ($result.Lines | ForEach-Object { $_.Text }) -join [char]10
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:LEGALLAS_OCR_FILE)) ([Windows.Storage.StorageFile])
$results = New-Object System.Collections.ArrayList
if ([string]::IsNullOrEmpty($env:LEGALLAS_OCR_PAGES)) {
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $null = $results.Add(@{ n = 1; text = (Read-Decoder $decoder) })
} else {
  $document = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
  $limit = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
  foreach ($number in $env:LEGALLAS_OCR_PAGES.Split(',')) {
    $page = $document.GetPage([uint32]$number - 1)
    $options = New-Object Windows.Data.Pdf.PdfPageRenderOptions
    $scale = [math]::Min([double]$env:LEGALLAS_OCR_DPI / 96, $limit / [math]::Max($page.Size.Width, $page.Size.Height))
    $options.DestinationWidth = [uint32]($page.Size.Width * $scale)
    $options.DestinationHeight = [uint32]($page.Size.Height * $scale)
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    AwaitAction ($page.RenderToStreamAsync($stream, $options))
    $stream.Seek(0)
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $null = $results.Add(@{ n = [int]$number; text = (Read-Decoder $decoder) })
    $page.Dispose()
  }
}
[Console]::Out.Write((ConvertTo-Json -InputObject $results -Compress -Depth 3))
`;

/** PowerShell's own arguments: it reads the whole script from stdin as one block, with no profile. */
export const POWERSHELL_ARGS = ['-NoProfile', '-NonInteractive', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', '& ([scriptblock]::Create([Console]::In.ReadToEnd()))'];

/** The script's answer, checked. */
export function parseOcrOutput(stdout: string): Map<number, string> {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) throw new Error('ocr failed: unreadable');
  const pages = new Map<number, string>();
  for (const entry of parsed) {
    const { n, text } = (entry ?? {}) as Record<string, unknown>;
    if (!Number.isSafeInteger(n) || (n as number) < 1) throw new Error('ocr failed: unreadable');
    // ConvertTo-Json writes an empty result as null.
    pages.set(n as number, typeof text === 'string' ? text : '');
  }
  return pages;
}

function runOcr(file: string, pages: readonly number[] | null, timeoutMs: number): Promise<Map<number, string>> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', POWERSHELL_ARGS, {
      env: { ...process.env, LEGALLAS_OCR_FILE: path.resolve(file), LEGALLAS_OCR_PAGES: pages?.join(',') ?? '', LEGALLAS_OCR_DPI: String(OCR_DPI) },
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: timeoutMs,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      tooLarge = size > MAX_OUTPUT;
      if (tooLarge) child.kill();
      else chunks.push(chunk);
    });
    child.on('error', () => reject(new ExtractorUnavailable('no PowerShell here to reach the Windows OCR API')));
    child.stdin.on('error', () => undefined);
    child.on('close', (code, signal) => {
      if (code === NO_LANGUAGE) return reject(new ExtractorUnavailable('Windows has no OCR language installed. Add one in Settings, under Time & language, then Language'));
      if (tooLarge) return reject(new Error('ocr failed: too-large'));
      if (signal) return reject(new Error('ocr failed: timeout'));
      if (code !== 0) return reject(new Error('ocr failed: unreadable'));
      try {
        resolve(parseOcrOutput(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('ocr failed: unreadable'));
      }
    });
    child.stdin.end(WINDOWS_OCR_SCRIPT);
  });
}

/** The Windows OCR API, a batch of pages to a run, each run within the per-file limit the Mac has. */
export function windowsOcr(timeoutMs = EXTRACT_TIMEOUT_MS): Ocr {
  return async (file, pages) => {
    if (pages === null) return runOcr(file, null, timeoutMs);
    const read = new Map<number, string>();
    for (let start = 0; start < pages.length; start += OCR_BATCH) {
      for (const [n, text] of await runOcr(file, pages.slice(start, start + OCR_BATCH), timeoutMs)) read.set(n, text);
    }
    return read;
  };
}

/** A file's pages: an image is always OCR, as one page. A PDF keeps its layer unless it can't be trusted. */
export function windowsExtractor(ocr: Ocr = windowsOcr(), layers: PdfLayers = pdfjsLayers): ExtractPages {
  return async (file) => {
    if (IMAGE.test(file)) return [{ n: 1, text: (await ocr(file, null)).get(1) ?? '', ocr: true }];
    const pages = await layers(file);
    // A PDF with no pages has something wrong with it, and PDFKit refuses one. As empty text, the guard would count it scanned.
    if (pages.length === 0) throw new Error('pdf failed: unreadable');
    const doubtful = pages.filter((page) => page.quality !== 'good').map((page) => page.n);
    const read = doubtful.length > 0 ? await ocr(file, doubtful) : new Map<number, string>();
    return pages.map((page): ExtractedPage => {
      if (page.quality === 'good') return { n: page.n, text: withFields(page.text, page.fields), ocr: false };
      const chosen = chooseText(page.quality, page.text, read.get(page.n) ?? '');
      return { n: page.n, text: withFields(chosen.text, page.fields), ocr: chosen.ocr };
    });
  };
}

/** What reads PDFs and images on this computer. */
export function platformExtractor(platform: NodeJS.Platform = process.platform): ExtractPages {
  return platform === 'win32' ? windowsExtractor() : legallasExtractor();
}

// The child's side of pdfjsLayers: this file, run as its own process. Its only output is one line of JSON, so pdf.js's
// warnings, which go to console.log, are turned off first. A failure's message goes nowhere, because it may quote the file.
if (import.meta.main) {
  console.log = () => undefined;
  const reply = (value: unknown) => process.stdout.write(JSON.stringify(value), () => process.exit(0));
  layersHere(process.argv[2]!).then( // safe: pdfjsLayers always passes the file
    (pages) => reply({ pages }),
    (error: unknown) => reply({ code: (error as Error).name === 'PasswordException' ? 'encrypted' : 'unreadable' }),
  );
}
