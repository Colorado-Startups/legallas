// SPDX-License-Identifier: Apache-2.0
// Card F9. Tiny writers for the dev fixture's dummy files: a PDF with a real text layer (Helvetica, one
// text line per Tj, valid xref), a flat-color PNG and a one-sheet XLSX (a stored zip). Output is
// deterministic (no timestamps or random ids, and nothing compressed), so rewriting the fixture leaves every sha256
// unchanged on any machine: the sample room's extract cache (quality-speed/pages/data-room/extract-cache) is keyed by
// these hashes, written on a Mac and read on Linux.
import { crc32 } from 'node:zlib';

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 72;
const FONT_SIZE = 11;
const LEADING = 16;
/** Characters per line before wrapping: Helvetica 11pt averages about 5.5pt per character on a 468pt measure. */
export const WRAP_AT = 84;
/** Lines that fit between the margins. Longer pages are cut; callers keep pages short. */
export const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LEADING);

/** Word-wraps one paragraph to `width` characters. A single overlong word is split. */
export function wrapLine(text: string, width = WRAP_AT): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    for (let rest = word; rest.length > 0; rest = rest.slice(width)) {
      const piece = rest.slice(0, width);
      if (line === '') line = piece;
      else if (line.length + 1 + piece.length <= width) line += ` ${piece}`;
      else {
        out.push(line);
        line = piece;
      }
    }
  }
  if (line !== '' || out.length === 0) out.push(line);
  return out;
}

/** A PDF literal string body: printable ASCII only, with backslash and parentheses escaped. */
export function pdfString(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, (ch) => (/\s/.test(ch) ? ' ' : ''))
    .replace(/[\\()]/g, (ch) => `\\${ch}`);
}

function pageStream(paragraphs: readonly string[]): string {
  const lines = paragraphs.flatMap((p) => (p === '' ? [''] : wrapLine(p))).slice(0, LINES_PER_PAGE);
  const body = lines.map((line, i) => `${i === 0 ? '' : 'T* '}(${pdfString(line)}) Tj`).join('\n');
  return `BT\n/F1 ${FONT_SIZE} Tf\n${LEADING} TL\n${MARGIN} ${PAGE_HEIGHT - MARGIN} Td\n${body}\nET\n`;
}

/**
 * A PDF 1.4 file with one page per entry of `pages`; each page is a list of paragraphs (an empty string is a
 * blank line). Objects: 1 catalog, 2 page tree, 3 font, then a page and its content stream per page.
 */
export function pdfBytes(pages: readonly (readonly string[])[]): Buffer {
  if (pages.length === 0) throw new Error('A PDF needs at least one page');
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  for (const [i, page] of pages.entries()) {
    const stream = pageStream(page);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`);
  }
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  for (const [i, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** The Adler-32 checksum a zlib stream ends with (RFC 1950). */
function adler32(data: Buffer): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const STORED_BLOCK = 0xffff;

/**
 * `data` as a zlib stream of stored (uncompressed) blocks, RFC 1950 and 1951. Written by hand because node:zlib's
 * deflate is not the same everywhere: its bytes change with the zlib build and the CPU it runs on.
 */
export function zlibStored(data: Buffer): Buffer {
  const out: Buffer[] = [Buffer.from([0x78, 0x01])];
  for (let at = 0; at === 0 || at < data.length; at += STORED_BLOCK) {
    const piece = data.subarray(at, at + STORED_BLOCK);
    const head = Buffer.alloc(5);
    head[0] = at + STORED_BLOCK >= data.length ? 1 : 0;
    head.writeUInt16LE(piece.length, 1);
    head.writeUInt16LE(~piece.length & 0xffff, 3);
    out.push(head, piece);
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(adler32(data), 0);
  return Buffer.concat([...out, checksum]);
}

/** An RGB PNG: horizontal bands of the given colors (hex like "1F3A2E"), top to bottom. */
export function pngBytes(width: number, height: number, bands: readonly string[]): Buffer {
  const rgb = bands.map((hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const [r, g, b] = rgb[Math.min(rgb.length - 1, Math.floor((y * rgb.length) / height))];
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) row.set([r, g, b], 1 + x * 3);
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibStored(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A zip with every entry stored (no compression), dated 1980-01-01 so the bytes never change. */
export function zipStored(entries: readonly { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const xmlEscape = (text: string) => text.replace(/[<>&"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function column(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** A one-sheet workbook of inline strings, enough for Excel and Numbers to open. */
export function xlsxBytes(rows: readonly (readonly string[])[]): Buffer {
  const cells = rows
    .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => `<c r="${column(c)}${r + 1}" t="inlineStr"><is><t>${xmlEscape(v)}</t></is></c>`).join('')}</row>`)
    .join('');
  const parts: [string, string][] = [
    ['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ['_rels/.rels', `${XML}<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${XML}<workbook xmlns="${SHEET_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', `${XML}<worksheet xmlns="${SHEET_NS}"><sheetData>${cells}</sheetData></worksheet>`],
  ];
  return zipStored(parts.map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') })));
}
