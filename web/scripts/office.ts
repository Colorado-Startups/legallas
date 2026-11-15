// SPDX-License-Identifier: Apache-2.0
// Text of office documents for the index, with no network. On macOS, Word (.docx, .doc), RTF and OpenDocument text go
// through /usr/bin/textutil with the format forced from the extension and subsidiary resources off, and PowerPoint
// (.pptx) and Excel (.xlsx) are read from their OOXML parts (ooxml.ts) with /usr/bin/unzip -p, one part at a time to
// stdout. Everywhere else (a Windows founder's OneDrive folder, a Linux runner) the same formats are read with no outside
// tool (office-read.ts), in a child process of this file with the same deadline, so a file built to hang or to fill memory
// fails alone. Either way nothing is unpacked to disk, so a link stored in the archive is never followed. A document is one page of text, so a cite names the document and no page (worker/page-known.ts)
// (indexparts.ts still marks it every ~150 words). Errors carry a short code only, never a file name.
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { zipNames as zipEntryNames } from './law/docx.ts';
import { docText, docxText, MAX_PART_BYTES, odtText, rtfText, TooLarge, zipText } from './office-read.ts';
import { attrsOf, cellText, partNumber, relTargets, sheetRows, slideLines, usualPrefixes } from './ooxml.ts';

export type OfficeFormat = 'docx' | 'doc' | 'rtf' | 'odt' | 'pptx' | 'xlsx';

const OFFICE = /\.(docx|doc|rtf|odt|pptx|xlsx)$/i;
/** One tool run. Typical files take well under a second; this only trips on a hang. */
const TOOL_TIMEOUT_MS = 60_000;
/** Largest office file read whole, where this code reads it. */
const MAX_FILE_BYTES = 256 * 1024 * 1024;
/** The child reader's heap: running out is a crash no catch can stop, which is why it is a process that can die alone. */
const READ_HEAP_MB = 512;
/** At most this many slides or sheets are read from one file. */
const MAX_PARTS = 1000;
/** Archive entries are named only with these characters before unzip is asked for them (no wildcards). */
const PLAIN_ENTRY = /^[A-Za-z0-9_./]+$/;

/** The office format of a file by its extension, or null. Snapshot clones keep the lowercase extension. */
export function officeFormat(file: string): OfficeFormat | null {
  const match = OFFICE.exec(file);
  return match ? (match[1]!.toLowerCase() as OfficeFormat) : null; // safe: group 1 always takes part in a match
}

interface ToolOutput {
  stdout: string;
  stderr: string;
}

/** Runs a tool; a failure rejects as "office text failed: <code>" (timeout, too-large or unreadable). */
function tool(command: string, args: string[]): Promise<ToolOutput> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8', maxBuffer: MAX_PART_BYTES, timeout: TOOL_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (!error) return resolve({ stdout, stderr });
      const code = error.killed && error.signal === 'SIGTERM' ? 'timeout' : /maxBuffer/i.test(error.message) ? 'too-large' : 'unreadable';
      reject(new Error(`office text failed: ${code}`));
    });
  });
}

/** Line breaks and the characters Cocoa uses for page breaks and inline pictures, made plain. */
function plain(text: string): string {
  return text.replace(/\r\n?|[\u2028\u2029\f\v]/g, '\n').replace(/\uFFFC/g, '').replace(/[ \t]+$/gm, '').trim();
}

/**
 * .doc and OpenDocument text through textutil. textutil exits 0 even when it cannot read a file, saying
 * so on stderr, so any stderr with no text out is a failure. The format is forced from the extension, so a
 * file that is really HTML is refused rather than laid out by WebKit, and -noload keeps resources from loading.
 */
async function textutilText(file: string, format: OfficeFormat): Promise<string> {
  const { stdout, stderr } = await tool('/usr/bin/textutil', ['-convert', 'txt', '-stdout', '-noload', '-format', format, '--', file]);
  if (stdout.trim() === '' && stderr.trim() !== '') throw new Error('office text failed: unreadable');
  return plain(stdout);
}

/** An office file's archive: the entry names safe to ask for, and one entry as UTF-8 text ('' when it has no such entry). */
interface Zip {
  names: ReadonlySet<string>;
  part(name: string): Promise<string>;
}

/** Through /usr/bin/unzip. */
async function unzipTool(file: string): Promise<Zip> {
  const { stdout } = await tool('/usr/bin/unzip', ['-Z1', '--', file]);
  const names = new Set(stdout.split('\n').filter((name) => PLAIN_ENTRY.test(name)));
  return { names, part: async (name) => (names.has(name) ? (await tool('/usr/bin/unzip', ['-p', '--', file, name])).stdout : '') };
}

/** The whole file, within the limit. */
async function fileBytes(file: string): Promise<Buffer> {
  if ((await stat(file)).size > MAX_FILE_BYTES) throw new TooLarge('too-large');
  return readFile(file);
}

/** With no outside tool. */
async function zipHere(file: string): Promise<Zip> {
  const bytes = await fileBytes(file);
  const names = new Set(zipEntryNames(bytes).filter((name) => PLAIN_ENTRY.test(name)));
  return { names, part: async (name) => (names.has(name) ? zipText(bytes, name) : '') };
}

/** Each part with its namespaces at their usual prefixes (ooxml.ts). A part that doesn't close fails the file. */
function withUsualPrefixes(zip: Zip): Zip {
  return {
    names: zip.names,
    part: async (name) => {
      const xml = await zip.part(name);
      try {
        return usualPrefixes(xml);
      } catch {
        throw new Error('office text failed: unreadable');
      }
    },
  };
}

/**
 * The parts a container lists in order (slides in presentation.xml, sheets in workbook.xml), resolved through its
 * relationships, as [part, attributes of the listing element]. Falls back to the parts matching `pattern` in
 * number order when the listing names none of them.
 */
async function orderedParts(
  zip: Zip,
  container: string,
  element: RegExp,
  pattern: RegExp,
): Promise<[string, Record<string, string>][]> {
  const dir = container.slice(0, container.lastIndexOf('/') + 1);
  const rels = relTargets(await zip.part(`${dir}_rels/${container.slice(dir.length)}.rels`), dir);
  const listed: [string, Record<string, string>][] = [];
  for (const match of (await zip.part(container)).matchAll(element)) {
    const attrs = attrsOf(match[0]);
    const part = rels.get(attrs['r:id'] ?? '');
    if (part && pattern.test(part) && zip.names.has(part)) listed.push([part, attrs]);
  }
  if (listed.length > 0) return listed.slice(0, MAX_PARTS);
  const found = [...zip.names].filter((name) => pattern.test(name)).sort((a, b) => partNumber(a) - partNumber(b));
  return found.slice(0, MAX_PARTS).map((part) => [part, {}]);
}

/** Each slide in presentation order as "Slide N", its text, then its speaker notes. */
async function pptxText(file: string, openZip: (file: string) => Promise<Zip>): Promise<string> {
  const zip = withUsualPrefixes(await openZip(file));
  const slides = await orderedParts(zip, 'ppt/presentation.xml', /<p:sldId\b[^>]*>/g, /^ppt\/slides\/slide\d+\.xml$/);
  const blocks: string[] = [];
  for (const [index, [slide]] of slides.entries()) {
    const lines = slideLines(await zip.part(slide));
    const rels = relTargets(await zip.part(slide.replace(/([^/]+)$/, '_rels/$1.rels')), 'ppt/slides/', /\/notesSlide$/);
    const notesPart = [...rels.values()][0];
    const notes = notesPart ? slideLines(await zip.part(notesPart)) : [];
    blocks.push([`Slide ${index + 1}`, ...lines, ...(notes.length > 0 ? ['Notes:', ...notes] : [])].join('\n'));
  }
  return plain(blocks.join('\n\n'));
}

/** Each sheet in workbook order as "Sheet N: name", then one line per row with cells joined by " | ". */
async function xlsxText(file: string, openZip: (file: string) => Promise<Zip>): Promise<string> {
  const zip = withUsualPrefixes(await openZip(file));
  const strings = (await zip.part('xl/sharedStrings.xml')).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g);
  const shared = [...strings].map((m) => cellText(m[1]!.replace(/<rPh\b[\s\S]*?<\/rPh>/g, ''))); // safe: group 1 always matches
  const workbook = await zip.part('xl/workbook.xml');
  const ctx = { shared, styles: await zip.part('xl/styles.xml'), date1904: /<workbookPr\b[^>]*date1904="(?:1|true)"/.test(workbook) };
  const sheets = await orderedParts(zip, 'xl/workbook.xml', /<sheet\b[^>]*>/g, /^xl\/worksheets\/sheet\d+\.xml$/);
  const blocks: string[] = [];
  for (const [index, [sheet, attrs]] of sheets.entries()) {
    const title = attrs.name ? `Sheet ${index + 1}: ${attrs.name}` : `Sheet ${index + 1}`;
    blocks.push([title, ...sheetRows(await zip.part(sheet), ctx)].join('\n'));
  }
  return plain(blocks.join('\n\n'));
}

/** Every format with no outside tool. A presentation or a workbook with nothing in it isn't one: a plain zip reads so. */
async function readHere(file: string, format: OfficeFormat): Promise<string> {
  if (format === 'pptx' || format === 'xlsx') {
    const text = format === 'pptx' ? await pptxText(file, zipHere) : await xlsxText(file, zipHere);
    if (text === '') throw new Error('not an office file');
    return text;
  }
  const bytes = await fileBytes(file);
  if (format === 'docx') return plain(docxText(bytes));
  if (format === 'odt') return plain(odtText(bytes));
  if (format === 'rtf') return plain(rtfText(bytes));
  return plain(docText(bytes));
}

/** For tests: tighter limits than a real reading gets. */
export interface ReadLimits {
  timeoutMs?: number;
  heapMb?: number;
}

/**
 * readHere in a child process. Anything but a clean reply is a failure, never empty text, because the SSN guard counts
 * text it was given as scanned: a crash, a timeout, too much output, or a reply it can't parse.
 */
export function officeTextInChild(file: string, format: OfficeFormat, limits: ReadLimits = {}): Promise<string> {
  const args = [`--max-old-space-size=${limits.heapMb ?? READ_HEAP_MB}`, fileURLToPath(import.meta.url), file, format];
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, { encoding: 'utf8', maxBuffer: MAX_PART_BYTES * 2, timeout: limits.timeoutMs ?? TOOL_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const code = error.killed && error.signal === 'SIGTERM' ? 'timeout' : /maxBuffer|heap out of memory/i.test(`${error.message}${stderr}`) ? 'too-large' : 'unreadable';
        return reject(new Error(`office text failed: ${code}`));
      }
      try {
        const reply = JSON.parse(stdout) as { text?: unknown; code?: unknown };
        if (typeof reply.text === 'string') return resolve(reply.text);
        reject(new Error(`office text failed: ${reply.code === 'too-large' ? 'too-large' : 'unreadable'}`));
      } catch {
        reject(new Error('office text failed: unreadable'));
      }
    });
  });
}

/** The text of an office document, or a rejection "office text failed: <code>". */
export async function officeText(file: string, format: OfficeFormat): Promise<string> {
  if (process.platform !== 'darwin') return officeTextInChild(file, format);
  if (format === 'pptx') return pptxText(file, unzipTool);
  if (format === 'xlsx') return xlsxText(file, unzipTool);
  // textutil reads Word's hidden text and RTF's hidden and struck text as body text (#278): these readers leave it out.
  if (format === 'docx' || format === 'rtf') return officeTextInChild(file, format);
  return textutilText(file, format);
}

// The child's side of officeTextInChild: this file, run as its own process. Its only output is one line of JSON, and its
// message on a failure goes nowhere, because it may quote the file.
if (import.meta.main) {
  const [file, format] = process.argv.slice(2) as [string, OfficeFormat];
  readHere(file, format).then(
    (text) => process.stdout.write(JSON.stringify({ text })),
    (error: unknown) => process.stdout.write(JSON.stringify({ code: error instanceof TooLarge ? 'too-large' : 'unreadable' })),
  );
}
