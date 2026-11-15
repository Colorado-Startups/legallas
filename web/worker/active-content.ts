// SPDX-License-Identifier: Apache-2.0
// Refuses files that can run code when opened: counsel uploads (routes/files.ts), the owner's sync (scripts/active-scan.ts).
// One streaming pass; a heuristic, not an antivirus.
//
//   pdf-javascript   name /JavaScript (any byte) or /JS (PDF syntax only), #xx decoded, object streams decompressed
//   pdf-launch       name /Launch
//   office-macros    zip entry vbaProject.bin or .docm/.xlsm/..., or 97-2003 _VBA_PROJECT
//   office-activex   zip entry under activeX/
//   runnable         zip entry that runs: .exe, .js, .lnk, .dmg, ...
//   unchecked        object stream too big, undecodable, or unreadable in an unencrypted file; reader error
//
// Not read: encrypted PDFs' object streams, nested archives, XFA scripts, PowerPoint 97-2003 macros.

export type ActiveRule = 'pdf-javascript' | 'pdf-launch' | 'office-macros' | 'office-activex' | 'runnable' | 'unchecked';
export type ScanKind = 'pdf' | 'zip' | 'ole';

/** Viewers accept %PDF- anywhere in the first 1 KB. */
export const SCAN_HEAD_BYTES = 1024 + 5;
/** Object stream caps: compressed, decompressed, decompressed per file. Past one: unchecked. */
export const MAX_OBJSTM_BYTES = 8 * 1024 * 1024;
export const MAX_INFLATED_BYTES = 32 * 1024 * 1024;
export const MAX_INFLATED_TOTAL = 64 * 1024 * 1024;

const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const PDF_MAGIC = ascii('%PDF-');
const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const EMPTY = new Uint8Array(0);

function startsWith(head: Uint8Array, bytes: readonly number[]): boolean {
  return head.length >= bytes.length && bytes.every((b, i) => head[i] === b);
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  for (let i = haystack.indexOf(needle[0]!); i >= 0 && i + needle.length <= haystack.length; i = haystack.indexOf(needle[0]!, i + 1)) {
    let j = 1;
    while (j < needle.length && haystack[i + j] === needle[j]) j += 1;
    if (j === needle.length) return i;
  }
  return -1;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** The reader a file's first SCAN_HEAD_BYTES call for; null: none. */
export function scanKindOf(head: Uint8Array): ScanKind | null {
  if (startsWith(head, ZIP_LOCAL) || startsWith(head, ZIP_EMPTY)) return 'zip';
  if (startsWith(head, OLE_MAGIC)) return 'ole';
  return indexOfBytes(head.subarray(0, SCAN_HEAD_BYTES), PDF_MAGIC) >= 0 ? 'pdf' : null;
}

// ---- Names ----

const MACRO_EXTENSIONS = new Set(['docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppsm', 'ppam', 'sldm']);
/** Run or mounted on a double-click. */
const RUNNABLE_EXTENSIONS = new Set([
  'exe', 'com', 'scr', 'pif', 'cpl', 'dll', 'msi', 'msp', 'msix', 'appx', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe',
  'js', 'jse', 'wsf', 'wsh', 'hta', 'jar', 'lnk', 'reg', 'xll', 'wll', 'iso', 'img', 'vhd', 'vhdx',
  'sh', 'command', 'pkg', 'mpkg', 'dmg', 'scpt',
]);

/** The rule a zip entry or synced file breaks by name alone. */
export function entryRule(name: string): ActiveRule | null {
  const segments = name.replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean);
  const base = segments.at(-1) ?? '';
  const folders = segments.slice(0, -1);
  if (base === 'vbaproject.bin') return 'office-macros';
  if (folders.includes('activex')) return 'office-activex';
  if (folders.some((folder) => folder.endsWith('.app'))) return 'runnable';
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1) : '';
  if (MACRO_EXTENSIONS.has(ext)) return 'office-macros';
  if (RUNNABLE_EXTENSIONS.has(ext)) return 'runnable';
  return null;
}

interface Scanner {
  finding: ActiveRule | null;
  push(chunk: Uint8Array): Promise<void>;
  finish(): Promise<void>;
}

// ---- Zip ----

/** Entry names from local headers (PK\3\4) and the central directory (PK\1\2), which Office reads. */
class ZipScanner implements Scanner {
  finding: ActiveRule | null = null;
  private carry = EMPTY;
  private readonly decoder = new TextDecoder();

  async push(chunk: Uint8Array): Promise<void> {
    const buf = this.carry.length > 0 ? concat(this.carry, chunk) : chunk;
    this.carry = EMPTY;
    for (let i = 0; this.finding === null; ) {
      const p = buf.indexOf(0x50, i);
      if (p < 0) return;
      if (p + 4 > buf.length) return void (this.carry = buf.slice(p));
      const local = buf[p + 1] === 0x4b && buf[p + 2] === 0x03 && buf[p + 3] === 0x04;
      const central = buf[p + 1] === 0x4b && buf[p + 2] === 0x01 && buf[p + 3] === 0x02;
      if (local || central) {
        const fixed = local ? 30 : 46;
        const at = p + (local ? 26 : 28);
        if (p + fixed > buf.length) return void (this.carry = buf.slice(p));
        const length = buf[at]! | (buf[at + 1]! << 8);
        if (p + fixed + length > buf.length) return void (this.carry = buf.slice(p));
        this.finding = entryRule(this.decoder.decode(buf.subarray(p + fixed, p + fixed + length)));
      }
      i = p + 1;
    }
  }

  async finish(): Promise<void> {}
}

// ---- Word and Excel 97-2003 ----

/** "_VBA_PROJECT", UTF-16LE: where these files keep macros. */
const OLE_VBA = Uint8Array.from([...'_VBA_PROJECT'].flatMap((c) => [c.charCodeAt(0), 0]));

class OleScanner implements Scanner {
  finding: ActiveRule | null = null;
  private carry = EMPTY;

  async push(chunk: Uint8Array): Promise<void> {
    const buf = this.carry.length > 0 ? concat(this.carry, chunk) : chunk;
    if (indexOfBytes(buf, OLE_VBA) >= 0) this.finding = 'office-macros';
    this.carry = buf.slice(Math.max(0, buf.length - (OLE_VBA.length - 1)));
  }

  async finish(): Promise<void> {}
}

// ---- PDF ----

const OBJ = 0;
const LIT = 1;
const HEX = 2;
const DATA = 3;

/** Read in every byte. */
const LONG_NAMES: ReadonlyMap<string, ActiveRule> = new Map([
  ['JavaScript', 'pdf-javascript'],
  ['Launch', 'pdf-launch'],
]);
/** Filters not undone here: an object stream with one is unchecked. */
const OTHER_FILTERS = new Set([
  'ASCIIHexDecode', 'AHx', 'ASCII85Decode', 'A85', 'LZWDecode', 'LZW', 'RunLengthDecode', 'RL', 'CCITTFaxDecode', 'CCF',
  'JBIG2Decode', 'DCTDecode', 'DCT', 'JPXDecode', 'Crypt', 'DecodeParms', 'DP',
]);
/** Raw bytes kept per name: 3x the longest above, all #-escaped. */
const MAX_NAME = 48;
const MAX_WORD = 8;
const ENDSTREAM = ascii('endstream');
/** KMP fallbacks for ENDSTREAM. */
const ENDSTREAM_FAIL = [0, 0, 0, 0, 0, 0, 1, 0, 0];

const isWhite = (b: number) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0x0c || b === 0x00;
const isDelim = (b: number) =>
  b === 0x2f || b === 0x28 || b === 0x29 || b === 0x3c || b === 0x3e || b === 0x5b || b === 0x5d || b === 0x7b || b === 0x7d || b === 0x25;

function hexValue(b: number | undefined): number {
  if (b === undefined) return -1;
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  const lower = b | 0x20;
  return lower >= 0x61 && lower <= 0x66 ? lower - 0x57 : -1;
}

/** Name bytes, #xx decoded, as Latin-1. */
function decodeName(raw: readonly number[]): string {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const high = raw[i] === 0x23 ? hexValue(raw[i + 1]) : -1;
    const low = high >= 0 ? hexValue(raw[i + 2]) : -1;
    if (low >= 0) {
      out += String.fromCharCode(high * 16 + low);
      i += 2;
    } else out += String.fromCharCode(raw[i]!);
  }
  return out;
}

/** A valid zlib header: deflate, checksum holds. */
function zlibHeader(data: Uint8Array): boolean {
  return data.length >= 2 && (data[0]! & 0x0f) === 8 && ((data[0]! << 8) | data[1]!) % 31 === 0;
}

/** Raw deflate into `sink`. 'bad': failed (sink saw what came out first). */
async function inflateRaw(data: Uint8Array, cap: number, sink: (chunk: Uint8Array) => void): Promise<'ok' | 'over' | 'bad'> {
  const reader = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return 'ok';
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => undefined);
        return 'over';
      }
      sink(value);
    }
  } catch {
    return 'bad';
  }
}

/** Bytes to cut off the end, likeliest first: zlib's 4-byte checksum and the EOL before endstream count as junk. */
function cutsToTry(body: Uint8Array, zlib: boolean): number[] {
  let eol = 0;
  if (body.at(-1) === 0x0a) eol = body.at(-2) === 0x0d ? 2 : 1;
  else if (body.at(-1) === 0x0d) eol = 1;
  const checksum = zlib ? 4 : 0;
  const all = [checksum + eol, checksum, ...Array.from({ length: 13 }, (_, i) => i)];
  return [...new Set(all)].filter((cut) => cut <= body.length);
}

/** A PDF as a byte stream: names, strings, dictionaries, stream data. `inner`: an object stream's contents. */
class PdfScanner implements Scanner {
  finding: ActiveRule | null = null;
  private mode = OBJ;
  private name: number[] | null = null;
  private nameTooLong = false;
  private nameInSyntax = false;
  private word: number[] = [];
  private wordTooLong = false;
  private afterDict = false;
  private pendingLt = false;
  private pendingGt = false;
  private depth = 0;
  private escaped = false;
  /** After "stream": 0 data, 1 blanks before EOL, 2 after CR. */
  private eol = 0;
  private matched = 0;
  private objStm = false;
  private flate = false;
  private otherFilter = false;
  private data: Uint8Array[] | null = null;
  private dataBytes = 0;
  private dataFlate = false;
  private readonly ready: { data: Uint8Array; flate: boolean }[] = [];
  private inflated = 0;
  private unreadable = false;
  private encrypted = false;

  private readonly inner: boolean;

  constructor(inner = false) {
    this.inner = inner;
  }

  private flag(rule: ActiveRule): void {
    this.finding ??= rule;
  }

  private endName(): void {
    const raw = this.name!;
    this.name = null;
    if (this.nameTooLong) return void (this.nameTooLong = false);
    const name = decodeName(raw);
    const rule = LONG_NAMES.get(name);
    if (rule) return this.flag(rule);
    if (!this.nameInSyntax) return;
    if (name === 'JS') return this.flag('pdf-javascript');
    if (this.inner) return;
    if (name === 'ObjStm') this.objStm = true;
    else if (name === 'FlateDecode' || name === 'Fl') this.flate = true;
    else if (OTHER_FILTERS.has(name)) this.otherFilter = true;
    else if (name === 'Encrypt') this.encrypted = true;
  }

  private names(b: number): void {
    if (this.name !== null) {
      if (isWhite(b) || isDelim(b)) this.endName();
      else if (this.name.length < MAX_NAME) this.name.push(b);
      else this.nameTooLong = true;
    }
    if (b === 0x2f) {
      this.name = [];
      this.nameInSyntax = this.mode === OBJ;
    }
  }

  private endObject(): void {
    this.objStm = false;
    this.flate = false;
    this.otherFilter = false;
  }

  private endWord(terminator: number): void {
    if (this.word.length === 0 && !this.wordTooLong) return;
    const word = this.wordTooLong ? '' : String.fromCharCode(...this.word);
    const afterDict = this.afterDict;
    this.word = [];
    this.wordTooLong = false;
    this.afterDict = false;
    if (word === 'obj' || word === 'endobj') this.endObject();
    else if (word === 'stream' && afterDict && !this.inner) this.startStream(terminator);
  }

  private startStream(terminator: number): void {
    this.mode = DATA;
    this.matched = 0;
    this.eol = terminator === 0x0a ? 0 : terminator === 0x0d ? 2 : 1;
    if (!this.objStm) return;
    if (this.otherFilter) return this.flag('unchecked');
    this.data = [];
    this.dataBytes = 0;
    this.dataFlate = this.flate;
  }

  /** Keeps an object stream's data. */
  private keep(chunk: Uint8Array, from: number, to: number): void {
    if (this.data === null || to <= from) return;
    this.dataBytes += to - from;
    if (this.dataBytes > MAX_OBJSTM_BYTES) {
      this.data = null;
      return this.flag('unchecked');
    }
    this.data.push(chunk.slice(from, to));
  }

  /** Queues an object stream's data, less "endstream". */
  private endStream(): void {
    this.mode = OBJ;
    this.afterDict = false;
    this.endObject();
    if (this.data === null) return;
    const whole = new Uint8Array(this.dataBytes);
    let at = 0;
    for (const part of this.data) {
      whole.set(part, at);
      at += part.length;
    }
    this.data = null;
    this.ready.push({ data: whole.subarray(0, Math.max(0, whole.length - ENDSTREAM.length)), flate: this.dataFlate });
  }

  /** One byte outside stream data. */
  private syntax(b: number): void {
    if (this.mode === LIT) {
      if (this.escaped) this.escaped = false;
      else if (b === 0x5c) this.escaped = true;
      else if (b === 0x28) this.depth += 1;
      else if (b === 0x29 && --this.depth === 0) this.mode = OBJ;
      return;
    }
    if (this.mode === HEX) {
      if (b === 0x3e) this.mode = OBJ;
      return;
    }
    if (this.pendingLt) {
      this.pendingLt = false;
      if (b === 0x3c) return void (this.afterDict = false);
      this.mode = HEX;
      return this.syntax(b);
    }
    if (this.pendingGt) {
      this.pendingGt = false;
      if (b === 0x3e) return void (this.afterDict = true);
    }
    if (isWhite(b)) return this.endWord(b);
    if (isDelim(b)) {
      this.endWord(b);
      this.afterDict = false;
      if (b === 0x28) {
        this.mode = LIT;
        this.depth = 1;
      } else if (b === 0x3c) this.pendingLt = true;
      else if (b === 0x3e) this.pendingGt = true;
      return;
    }
    if (this.word.length < MAX_WORD) this.word.push(b);
    else this.wordTooLong = true;
  }

  /** Reads a chunk; whole object streams wait for drain(). */
  read(chunk: Uint8Array): void {
    let from = 0;
    let slash = -1;
    let e = -1;
    for (let i = 0; i < chunk.length && this.finding === null; i += 1) {
      if (this.mode === DATA && this.eol === 0 && this.name === null && this.matched === 0) {
        // Stream data: jump to the next "/" or "e".
        if (slash < i) slash = chunk.indexOf(0x2f, i);
        if (e < i) e = chunk.indexOf(0x65, i);
        const next = slash < 0 ? e : e < 0 ? slash : Math.min(slash, e);
        if (next < 0) break;
        i = next;
      }
      const b = chunk[i]!;
      if (this.mode !== DATA) {
        this.names(b);
        this.syntax(b);
        if (this.mode === DATA) from = i + 1;
        continue;
      }
      if (this.eol !== 0) {
        const blank = this.eol === 1 && (b === 0x20 || b === 0x09);
        const lineEnd = (this.eol === 1 && (b === 0x0d || b === 0x0a)) || (this.eol === 2 && b === 0x0a);
        if (blank || lineEnd) {
          if (lineEnd) this.eol = b === 0x0d ? 2 : 0;
          from = i + 1;
          continue;
        }
        this.eol = 0;
        from = i;
      }
      this.names(b);
      while (this.matched > 0 && b !== ENDSTREAM[this.matched]) this.matched = ENDSTREAM_FAIL[this.matched - 1]!;
      if (b === ENDSTREAM[this.matched]) this.matched += 1;
      if (this.matched === ENDSTREAM.length) {
        this.keep(chunk, from, i + 1);
        this.endStream();
      }
    }
    if (this.mode === DATA) this.keep(chunk, from, chunk.length);
  }

  /** Ends a trailing name. */
  endOfObjects(): void {
    if (this.name !== null) this.endName();
  }

  /** An object stream's contents, decompressed if Flate. */
  private async readObjects(data: Uint8Array, flate: boolean): Promise<void> {
    if (!flate) {
      const objects = new PdfScanner(true);
      objects.read(data);
      objects.endOfObjects();
      if (objects.finding) this.flag(objects.finding);
      return;
    }
    const zlib = zlibHeader(data);
    const body = zlib ? data.subarray(2) : data;
    for (const cut of cutsToTry(body, zlib)) {
      const objects = new PdfScanner(true);
      const room = Math.max(0, Math.min(MAX_INFLATED_BYTES, MAX_INFLATED_TOTAL - this.inflated));
      const result = await inflateRaw(body.subarray(0, body.length - cut), room, (chunk) => {
        this.inflated += chunk.length;
        objects.read(chunk);
      });
      objects.endOfObjects();
      if (objects.finding) return this.flag(objects.finding);
      if (result === 'over') return this.flag('unchecked');
      if (result === 'ok') return;
    }
    this.unreadable = true;
  }

  private async drain(): Promise<void> {
    while (this.ready.length > 0 && this.finding === null) {
      const { data, flate } = this.ready.shift()!;
      await this.readObjects(data, flate);
    }
  }

  async push(chunk: Uint8Array): Promise<void> {
    if (this.finding !== null) return;
    this.read(chunk);
    await this.drain();
  }

  async finish(): Promise<void> {
    if (this.name !== null) this.endName();
    // A file cut off inside an object stream: read what there is.
    if (this.data !== null) {
      this.dataBytes += ENDSTREAM.length;
      this.data.push(new Uint8Array(ENDSTREAM.length));
      this.endStream();
    }
    await this.drain();
    // Encrypted object streams never decompress: a limit, not a finding.
    if (this.unreadable && !this.encrypted) this.flag('unchecked');
  }
}

function scannerFor(kind: ScanKind): Scanner {
  if (kind === 'pdf') return new PdfScanner();
  if (kind === 'zip') return new ZipScanner();
  return new OleScanner();
}

/** The first finding, or null. An error is 'unchecked'. */
export async function scanStream(kind: ScanKind, body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ActiveRule | null> {
  const scanner = scannerFor(kind);
  try {
    for await (const chunk of body) {
      await scanner.push(chunk);
      if (scanner.finding) return scanner.finding;
    }
    await scanner.finish();
    return scanner.finding;
  } catch {
    return 'unchecked';
  }
}

/** A whole file. For tests and small files. */
export function scanBytes(bytes: Uint8Array): Promise<ActiveRule | null> {
  const kind = scanKindOf(bytes);
  return kind ? scanStream(kind, [bytes]) : Promise.resolve(null);
}

export interface ActiveGuard {
  /** Passes bytes through; errors on a finding. */
  stream: TransformStream<Uint8Array, Uint8Array>;
  finding(): ActiveRule | null;
}

/** The upload check: a finding, or a reader error ('unchecked'), errors the stream so put() fails. */
export function activeContentGuard(kind: ScanKind | null): ActiveGuard {
  const scanner = kind ? scannerFor(kind) : null;
  let finding: ActiveRule | null = null;
  const check = async (step: (scanner: Scanner) => Promise<void>) => {
    if (!scanner) return;
    try {
      await step(scanner);
    } catch {
      scanner.finding ??= 'unchecked';
    }
    finding = scanner.finding;
    if (finding) throw new Error(`active content: ${finding}`);
  };
  const stream = new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      await check((s) => s.push(chunk));
      controller.enqueue(chunk);
    },
    flush: () => check((s) => s.finish()),
  });
  return { stream, finding: () => finding };
}
