// SPDX-License-Identifier: Apache-2.0
// Text of Apple's Pages, Numbers and Keynote files for the index, on any platform and with no Apple app or tool:
// iwa.ts reads the container and this walks the document from its root, so only what a person can reach is read
// (never Keynote's template slides or a comment). Tracked deletions are left out, and tables are set out as Excel's
// are in ooxml.ts: one line per row, cells joined by " | ". A sheet or a visible slide is one page, so a cite names
// it. A Pages document is one block of text with no page numbers, because where its pages break is only known to a
// layout engine. The SSN guard alone gets all of a file's text (iworkCarriedText), since the room serves the whole file.
// What was tested and why: docs/design/iwork-reading.md. Errors carry a short code only, never a file name.
import { execFile } from 'node:child_process';
import { open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  addObjects, allFields, fieldsOf, firstField, iwaBytes, IworkFailure, MAX_DEPTH, MAX_TOTAL_BYTES, objectAt, refOf, STORAGE, textOf, withArchive, zipPart,
  type Field, type IwaObject, type IworkCode, type Walk,
} from './iwa.ts';
import { TABLE_MODEL, tableText } from './iwork-table.ts';

export type IworkFormat = 'pages' | 'numbers' | 'key';

const IWORK = /\.(pages|numbers|key)$/i;

/** The format a file's name claims, or null. The reader then checks the bytes. */
export function iworkFormat(file: string): IworkFormat | null {
  const match = IWORK.exec(file);
  return match ? (match[1]!.toLowerCase() as IworkFormat) : null; // safe: group 1 always takes part in a match
}

const ZIP_START = Buffer.from('PK\x03\x04', 'latin1');

/**
 * Whether a file named .key isn't Keynote's, which is always a ZIP: it is as likely a private key or a licence key. It
 * stays what it was before these files were read: not indexed, and read by the SSN guard by its bytes. Pages and Numbers
 * have no such namesakes, so one that isn't theirs is a failure (not-iwork).
 */
export async function isPlainKeyFile(file: string, name: string): Promise<boolean> {
  if (iworkFormat(name) !== 'key') return false;
  const handle = await open(file, 'r');
  try {
    const { buffer } = await handle.read(Buffer.alloc(ZIP_START.length), 0, ZIP_START.length, 0);
    return !buffer.equals(ZIP_START);
  } finally {
    await handle.close();
  }
}


const PART = /^Index\/.*\.iwa$/;
/** Parts with nothing a person wrote: styles, theme slides, window state, sharing state. */
const NOT_TEXT = /^Index\/(?:DocumentStylesheet|TemplateSlide|ThemePreview|Metadata|ViewState|AnnotationAuthorStorage|DocumentMetadata)\b/;
const PASSWORD_MARKS = new Set(['.iwph', '.iwpv', '.iwpv2']);
/** iWork '09 and older keep the document in one XML file instead of .iwa parts. */
const OLD_DOCUMENTS = new Set(['index.xml', 'index.apxl', 'index.xml.gz', 'index.apxl.gz']);
const DOCUMENT_PART = 'Index/Document.iwa';
/** What the child is asked for when it is not a format's pages. */
const CARRIED = 'carried';

// Object types, as the files show them.
const SHAPE = 2011;
const CHANGE = 2060;
const GROUP = 3008;
const TABLE_INFO = 6000;
const SHEET = 2;
const SHOW = 2;
const PLACEHOLDER = 7;
/** The root object, always ID 1: 1 in Numbers and Keynote, 10000 in Pages. A renamed file fails here, not halfway. */
const APP_ROOT = 1;
const PAGES_ROOT = 10000;
const SETTINGS = 10012;
const CHANGE_DELETE = 2;

/** One document's reading, as office.ts allows one tool run. */
const READ_TIMEOUT_MS = 60_000;
/** The reading's JS heap. Far more than a saved file needs: a table's field lists are what a hostile one inflates. */
const READ_HEAP_MB = 512;
/** Most text one reading may send back. */
const MAX_OUTPUT_BYTES = 128 * 1024 * 1024;

/** [from, to) ranges a tracked change deleted, sorted: field 22 maps offsets to change objects. */
function deletedRanges(fields: readonly Field[], walk: Walk): [number, number][] {
  const entries = firstField(fields, 22);
  if (!entries) return [];
  const ranges: [number, number][] = [];
  const marks = allFields(fieldsOf(entries.bytes), 1).map((entry) => fieldsOf(entry.bytes));
  for (const [index, mark] of marks.entries()) {
    const change = objectAt(walk, firstField(mark, 2));
    if (change?.type !== CHANGE || firstField(fieldsOf(change.message), 1)?.value !== CHANGE_DELETE) continue;
    const from = firstField(mark, 1)?.value ?? 0;
    const next = marks[index + 1];
    ranges.push([from, next ? (firstField(next, 1)?.value ?? from) : Number.MAX_SAFE_INTEGER]);
  }
  return ranges.sort(([a], [b]) => a - b);
}

/** Offset -> reference for a storage table of marks: field 9 for inline objects, 16 for footnotes. */
function marksAt(fields: readonly Field[], table: number): Map<number, Field> {
  const marks = new Map<number, Field>();
  const entries = firstField(fields, table);
  if (!entries) return marks;
  for (const entry of allFields(fieldsOf(entries.bytes), 1)) {
    const mark = fieldsOf(entry.bytes);
    const target = firstField(mark, 2);
    if (target) marks.set(firstField(mark, 1)?.value ?? 0, target);
  }
  return marks;
}

/** A footnote's mark, "[n]", with its text added to `notes`; the reference object's field 2 names the note's storage. */
function footnoteMark(target: Field | undefined, walk: Walk, depth: number, notes: string[]): string {
  const reference = objectAt(walk, target);
  const storage = reference ? objectAt(walk, firstField(fieldsOf(reference.message), 2)) : undefined;
  if (storage?.type !== STORAGE) return '';
  const text = storageText(storage, walk, depth + 1, notes).trim();
  if (text === '') return '';
  notes.push(`[${notes.length + 1}] ${text}`);
  return `[${notes.length}]`;
}

/** An inline attachment holds its drawable in field 1: a table set among the words, say. */
function inlineText(attachment: IwaObject | undefined, walk: Walk, depth: number): string {
  const drawable = attachment ? objectAt(walk, firstField(fieldsOf(attachment.message), 1)) : undefined;
  const text = drawable ? drawableText(drawable, walk, depth + 1) : '';
  return text === '' ? '' : `\n${text}\n`;
}

/** A storage's characters as they stand: tracked deletions out, breaks made plain, inline objects and notes in place. */
function storageText(storage: IwaObject, walk: Walk, depth: number, notes: string[]): string {
  if (depth >= MAX_DEPTH) return '';
  walk.reached.add(storage.id);
  const fields = fieldsOf(storage.message);
  const raw = allFields(fields, 3).map((field) => field.bytes.toString('utf8')).join('');
  const deleted = deletedRanges(fields, walk);
  const inline = marksAt(fields, 9);
  const footnotes = marksAt(fields, 16);
  let out = '';
  let range = 0;
  for (let at = 0; at < raw.length; at += 1) {
    while (range < deleted.length && deleted[range]![1] <= at) range += 1; // safe: range is below the length
    const isDeleted = range < deleted.length && deleted[range]![0] <= at; // safe: range is below the length
    const char = raw[at]!; // safe: at is below the length
    // What a deleted mark points to is deleted too: read and thrown away, so it isn't taken for text the walk missed.
    if (char === '\uFFFC') {
      const box = inlineText(objectAt(walk, inline.get(at)), walk, depth);
      if (!isDeleted) out += box;
    } else if (char === '\u000E') {
      const mark = footnoteMark(footnotes.get(at), walk, depth, isDeleted ? [] : notes);
      if (!isDeleted) out += mark;
    } else if (isDeleted) continue;
    else if (char === '\r' || char === '\u2028' || char === '\u2029' || char === '\u0003' || char === '\u0004' || char === '\u0005') out += '\n';
    else if (char >= ' ' || char === '\n' || char === '\t') out += char;
  }
  return out;
}

/** A storage's text with its footnotes after it, for what has no document end to hold them: a text box, a rich cell. */
function textWithNotes(storage: IwaObject, walk: Walk, depth: number): string {
  const notes: string[] = [];
  const text = storageText(storage, walk, depth, notes).trim();
  return [text, ...notes].filter((line) => line !== '').join('\n');
}

/** The text of something placed on a page: a text box, a placeholder, a table, or a group of those. Images have none. */
function drawableText(drawable: IwaObject, walk: Walk, depth: number): string {
  if (depth >= MAX_DEPTH) return '';
  const fields = fieldsOf(drawable.message);
  if (drawable.type === TABLE_INFO) {
    const model = objectAt(walk, firstField(fields, 2));
    return model?.type === TABLE_MODEL ? tableText(model, walk, depth) : '';
  }
  if (drawable.type === GROUP) {
    return allFields(fields, 2)
      .map((child) => objectAt(walk, child))
      .map((child) => (child ? drawableText(child, walk, depth + 1) : ''))
      .filter((text) => text !== '')
      .join('\n');
  }
  // A placeholder holds its shape as field 1; a shape holds its text's storage as field 2.
  const shape = drawable.type === PLACEHOLDER ? fieldsOf(firstField(fields, 1)?.bytes ?? Buffer.alloc(0)) : drawable.type === SHAPE ? fields : null;
  const storage = shape ? objectAt(walk, firstField(shape, 2)) : undefined;
  return storage?.type === STORAGE ? textWithNotes(storage, walk, depth + 1) : '';
}

/** Lines without trailing space and runs of blank lines closed up. Line by line: a regex here could backtrack. */
function plain(text: string): string {
  return text.split('\n').map((line) => line.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Header and footer text a page prints, once each (#228). A storage's field 17 names its sections, each with three page
 * masters holding headers (1) and footers (2): 25 prints on every page, 24 on even pages when field 19 is set, and 23 on
 * a section's first page when 18 is set and 28 doesn't hide it. Settings 2 and 3 turn every header or footer off. Text
 * no page prints is still walked, so it never lands under "Other text:", and the SSN guard reads the whole file anyway.
 */
function headersAndFooters(body: IwaObject | undefined, shown: (setting: number) => boolean, walk: Walk): string[] {
  const sections = body?.type === STORAGE ? firstField(fieldsOf(body.message), 17) : undefined;
  if (!sections) return [];
  const seen = new Set<string>();
  for (const entry of allFields(fieldsOf(sections.bytes), 1)) {
    const section = objectAt(walk, firstField(fieldsOf(entry.bytes), 2));
    if (!section) continue;
    const fields = fieldsOf(section.message);
    const on = (n: number) => firstField(fields, n)?.value === 1;
    for (const [kind, printed] of [[23, on(18) && !on(28)], [24, on(19)], [25, true]] as const) {
      const master = objectAt(walk, firstField(fields, kind));
      if (!master) continue;
      for (const part of fieldsOf(master.message).filter((field) => field.n === 1 || field.n === 2)) {
        const storage = objectAt(walk, part);
        const text = storage?.type === STORAGE ? textWithNotes(storage, walk, 1) : '';
        if (printed && shown(part.n + 1) && text !== '') seen.add(text);
      }
    }
  }
  return seen.size > 0 ? [['Headers and footers:', ...seen].join('\n')] : [];
}

/** A Pages document, as one block: the body with its tables in place, then what floats, footnotes, headers and footers. */
function pagesPages(walk: Walk): Page[] {
  const root = walk.objects.get(1);
  if (root?.type !== PAGES_ROOT) throw new IworkFailure('not-iwork');
  const fields = fieldsOf(root.message);
  const body = objectAt(walk, firstField(fields, 4));
  // Field 7's settings switch the body (1), headers (2) and footers (3); unset is on. A page layout document has no body.
  const settings = objectAt(walk, firstField(fields, 7));
  const switches = settings?.type === SETTINGS ? fieldsOf(settings.message) : [];
  const shown = (setting: number) => firstField(switches, setting)?.value !== 0;
  const notes: string[] = [];
  const text = body?.type === STORAGE ? storageText(body, walk, 0, notes) : '';
  const blocks: string[] = [shown(1) ? text : ''];
  // Field 3 lists what floats, page by page: repeated pages (1), each with drawables (4, a reference in field 1).
  const floating = objectAt(walk, firstField(fields, 3));
  for (const page of floating ? allFields(fieldsOf(floating.message), 1) : []) {
    for (const entry of allFields(fieldsOf(page.bytes), 4)) {
      const drawable = objectAt(walk, firstField(fieldsOf(entry.bytes), 1));
      if (drawable) blocks.push(drawableText(drawable, walk, 0));
    }
  }
  if (shown(1) && notes.length > 0) blocks.push(['Footnotes:', ...notes].join('\n'));
  blocks.push(...headersAndFooters(body, shown, walk));
  return [{ n: 1, text: plain(blocks.filter((block) => block.trim() !== '').join('\n\n')) }];
}

/** A table named on screen is "Table: name", then its rows. Field 9 says whether the name shows: unset is off, as a protobuf bool is (#227). */
function namedTable(info: IwaObject, walk: Walk): string {
  const model = objectAt(walk, firstField(fieldsOf(info.message), 2));
  if (model?.type !== TABLE_MODEL) return '';
  const fields = fieldsOf(model.message);
  const name = textOf(firstField(fields, 8));
  const heading = name !== '' && firstField(fields, 9)?.value === 1 ? `Table: ${name}` : '';
  return [heading, tableText(model, walk, 0)].filter((line) => line !== '').join('\n');
}

/** A Numbers document: one page per sheet, "Sheet N: name", then its tables and text boxes in sheet order. */
function numbersPages(walk: Walk): Page[] {
  const root = walk.objects.get(1);
  const sheets = root?.type === APP_ROOT ? allFields(fieldsOf(root.message), 1).map((field) => objectAt(walk, field)) : [];
  if (sheets.length === 0 || sheets.some((sheet) => sheet?.type !== SHEET)) throw new IworkFailure('not-iwork');
  const pages: Page[] = [];
  for (const sheet of sheets) {
    if (!sheet) continue;
    const fields = fieldsOf(sheet.message);
    const blocks = [`Sheet ${pages.length + 1}: ${textOf(firstField(fields, 1))}`];
    for (const entry of allFields(fields, 2)) {
      const drawable = objectAt(walk, entry);
      if (drawable) blocks.push(drawable.type === TABLE_INFO ? namedTable(drawable, walk) : drawableText(drawable, walk, 0));
    }
    pages.push({ n: pages.length + 1, text: plain(blocks.filter((block) => block !== '').join('\n\n')) });
  }
  return pages;
}

/** A slide's text under `label`: its title and body first, then the rest in drawing order, then its speaker notes. */
function slideText(slide: IwaObject, walk: Walk, label: string): string {
  const fields = fieldsOf(slide.message);
  const ids = new Set<number>();
  for (const n of [5, 6, 7]) for (const field of allFields(fields, n)) ids.add(refOf(field) ?? -1);
  const lines: string[] = [];
  for (const id of ids) {
    const drawable = walk.objects.get(id);
    const text = drawable ? drawableText(drawable, walk, 0) : '';
    if (text !== '') lines.push(text);
  }
  const note = objectAt(walk, firstField(fields, 27));
  const storage = note ? objectAt(walk, firstField(fieldsOf(note.message), 1)) : undefined;
  const notes = storage?.type === STORAGE ? textWithNotes(storage, walk, 1) : '';
  return plain([label, ...lines, ...(notes !== '' ? ['Notes:', notes] : [])].join('\n'));
}

/**
 * A Keynote document: one page per visible slide in show order, numbered as the app's own PDF numbers them. A skipped
 * slide has no number: its text stays on the page before it, or the first visible one, marked, so it is never counted.
 */
function keynotePages(walk: Walk): Page[] {
  const root = walk.objects.get(1);
  const show = root?.type === APP_ROOT ? objectAt(walk, firstField(fieldsOf(root.message), 2)) : undefined;
  if (show?.type !== SHOW) throw new IworkFailure('not-iwork');
  const tree = fieldsOf(firstField(fieldsOf(show.message), 3)?.bytes ?? Buffer.alloc(0));
  const pages: Page[] = [];
  const seen = new Set<number>();
  let leading = '';
  const visit = (nodes: readonly Field[], depth: number): void => {
    if (depth >= MAX_DEPTH) return;
    for (const entry of nodes) {
      const node = objectAt(walk, entry);
      if (!node || seen.has(node.id)) continue;
      seen.add(node.id);
      const fields = fieldsOf(node.message);
      const slide = objectAt(walk, firstField(fields, 2));
      if (slide && firstField(fields, 4)?.value) {
        const text = `\n\n${slideText(slide, walk, 'Skipped slide')}`;
        if (pages.length > 0) pages.at(-1)!.text += text; // safe: pages is not empty here
        else leading += text;
      } else if (slide) {
        pages.push({ n: pages.length + 1, text: `${slideText(slide, walk, `Slide ${pages.length + 1}`)}${leading}` });
        leading = '';
      }
      // Slides indented under a parent in the navigator hang off it (field 1), in order.
      visit(allFields(fields, 1), depth + 1);
    }
  };
  visit(allFields(tree, 2), 0);
  // A deck of nothing but skipped slides still has their text.
  return pages.length === 0 && leading !== '' ? [{ n: 1, text: leading.trim() }] : pages;
}

export interface Page {
  n: number;
  text: string;
}

/**
 * Text the walk never reached, under its own heading on the last page. Every document the apps saved in testing leaves
 * none but the hidden copy Numbers keeps behind a pivot table, whose lines are all read already, so a line kept here is
 * a structure this reader does not know yet (docs/design/iwork-reading.md). Out of order beats lost: search still
 * finds it and the PII guard still reads it.
 */
function withUnreachedText(pages: Page[], walk: Walk): Page[] {
  const read = new Set(pages.flatMap((page) => page.text.split('\n')));
  const lines: string[] = [];
  for (const object of [...walk.objects.values()].sort((a, b) => a.id - b.id)) {
    if (walk.reached.has(object.id)) continue;
    const text = object.type === STORAGE ? textWithNotes(object, walk, 1) : object.type === TABLE_MODEL ? tableText(object, walk, 1) : '';
    for (const line of text.split('\n')) {
      if (line.trim() !== '' && !read.has(line)) lines.push(line.trim());
    }
  }
  if (lines.length === 0) return pages;
  const block = ['Other text:', ...lines].join('\n');
  const last = pages.at(-1);
  if (!last) return [{ n: 1, text: block }];
  last.text = last.text === '' ? block : `${last.text}\n\n${block}`;
  return pages;
}

/** Reads a document's objects, skipping the parts `skip` names, and hands them to `read`. Any failure is a short code. */
async function withDocument<T>(file: string, read: (walk: Walk) => T, skip: RegExp | null, maxTotal = MAX_TOTAL_BYTES): Promise<T> {
  try {
    return await withArchive(file, async (handle, entries) => {
      const leaf = (name: string) => name.slice(name.lastIndexOf('/') + 1);
      const names = [...entries.keys()];
      if (names.some((name) => PASSWORD_MARKS.has(leaf(name)))) throw new IworkFailure('password');
      if (!entries.has(DOCUMENT_PART)) throw new IworkFailure(names.some((name) => OLD_DOCUMENTS.has(leaf(name))) ? 'old-format' : 'not-iwork');
      const walk: Walk = { objects: new Map(), messages: [], reached: new Set(), storageText: (storage, depth) => textWithNotes(storage, walk, depth) };
      let total = 0;
      for (const [name, entry] of entries) {
        if (!PART.test(name) || skip?.test(name)) continue;
        const bytes = iwaBytes(await zipPart(handle, entry));
        total += bytes.length;
        if (total > maxTotal) throw new IworkFailure('too-large');
        addObjects(bytes, walk.objects, walk.messages);
      }
      return read(walk);
    });
  } catch (error) {
    if (error instanceof IworkFailure) throw error;
    // A read past the end of a damaged part, or a stack spent on a hostile one: the file is at fault.
    throw new IworkFailure('unreadable');
  }
}

function documentPages(walk: Walk, format: IworkFormat): Page[] {
  const pages = format === 'numbers' ? numbersPages(walk) : format === 'key' ? keynotePages(walk) : pagesPages(walk);
  return withUnreachedText(pages, walk);
}

/**
 * Text fit for the child's reply: JSON writes a control byte as six characters, and binary fields are full of them. A
 * line break takes their place, because a space would make binary into a number with spaces in it.
 */
const withoutControlBytes = (text: string) => text.replace(/[\x00-\x1f\ufffd]+/g, '\n');

/**
 * Every string in a message, at any depth. A field's bytes are text or a message of their own, so they are taken as both,
 * and a message that doesn't parse throws: the caller's to judge. Each string stands alone because a protobuf's bytes
 * can't be scanned as they are: the length in front of a 50-byte string is the character "2", and a digit beside a number
 * makes it a longer number that no rule matches.
 */
function stringsIn(message: Buffer, out: string[]): void {
  for (const field of fieldsOf(message)) {
    if (field.isVarint || field.bytes.length === 0) continue;
    out.push(withoutControlBytes(field.bytes.toString('utf8')));
    try {
      stringsIn(field.bytes, out);
    } catch (error) {
      // Text or binary, not a message. Anything else, such as a stack spent on a hostile file, means the walk stopped short.
      if (!(error instanceof IworkFailure)) throw error;
    }
  }
}

/** All the text in the file, whatever a person could reach: tracked deletions, comments, template slides, hidden names. */
function carriedText(walk: Walk): string {
  const lines: string[] = [];
  for (const object of walk.messages) {
    stringsIn(object.message, lines);
    // A text object's text can come in pieces, and a number can straddle them.
    if (object.type === STORAGE) lines.push(withoutControlBytes(allFields(fieldsOf(object.message), 3).map(textOf).join('')));
  }
  return lines.join('\n');
}

/** For tests: tighter limits than a real reading gets. */
export interface ReadLimits {
  timeoutMs?: number;
  heapMb?: number;
  /** All the parts' bytes once unpacked, which the heap limit doesn't cover (#229). */
  totalBytes?: number;
}

/**
 * An iWork document's text by page. Rejects "iwork text failed: <code>": not-iwork (shares the extension only, such as
 * a private key named .key), password (a locked file), old-format (iWork '09), too-large, timeout, or unreadable
 * (damaged). A document that opens and holds no words is empty, not a failure, as a blank Word file is. It reads in a
 * child process with a heap limit and a deadline, as office.ts runs its tools: running out of heap is a crash no catch
 * can stop, so it has to be a process that can die alone. Anything but a clean reply is a failure, never empty text.
 */
export function iworkPages(file: string, format: IworkFormat, limits: ReadLimits = {}): Promise<Page[]> {
  return askChild(file, format, limits, (reply) => (Array.isArray(reply.pages) ? reply.pages : null));
}

/**
 * All the text a file holds, for the SSN guard and never the index: the room serves the whole file, so what its pages
 * leave out still leaves with it. Fails as iworkPages does, in a child process for the same reason.
 */
export function iworkCarriedText(file: string, limits: ReadLimits = {}): Promise<string> {
  return askChild(file, CARRIED, limits, (reply) => (typeof reply.carried === 'string' ? reply.carried : null));
}

interface ChildReply {
  pages?: Page[];
  carried?: string;
  code?: IworkCode;
}

function askChild<T>(file: string, what: IworkFormat | typeof CARRIED, limits: ReadLimits, answer: (reply: ChildReply) => T | null): Promise<T> {
  const args = [`--max-old-space-size=${limits.heapMb ?? READ_HEAP_MB}`, fileURLToPath(import.meta.url), file, what, String(limits.totalBytes ?? MAX_TOTAL_BYTES)];
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, { encoding: 'utf8', maxBuffer: MAX_OUTPUT_BYTES, timeout: limits.timeoutMs ?? READ_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        const code = error.killed && error.signal === 'SIGTERM' ? 'timeout' : /maxBuffer|heap out of memory/i.test(`${error.message}${stderr}`) ? 'too-large' : 'unreadable';
        return reject(new IworkFailure(code));
      }
      try {
        const reply = JSON.parse(stdout) as ChildReply;
        const value = answer(reply);
        if (value !== null) resolve(value);
        else reject(new IworkFailure(reply.code ?? 'unreadable'));
      } catch {
        reject(new IworkFailure('unreadable'));
      }
    });
  });
}

// The child's side of askChild: this file, run as its own process. Its only output is one line of JSON.
if (import.meta.main) {
  const [file, what, total] = process.argv.slice(2) as [string, IworkFormat | typeof CARRIED, string];
  const maxTotal = Math.min(Number(total) || MAX_TOTAL_BYTES, MAX_TOTAL_BYTES);
  const reply: Promise<ChildReply> =
    what === CARRIED
      ? withDocument(file, carriedText, null, maxTotal).then((carried) => ({ carried }))
      : withDocument(file, (walk) => documentPages(walk, what), NOT_TEXT, maxTotal).then((pages) => ({ pages }));
  reply.then(
    (answer) => process.stdout.write(JSON.stringify(answer)),
    (error: unknown) => process.stdout.write(JSON.stringify({ code: error instanceof IworkFailure ? error.code : 'unreadable' })),
  );
}
