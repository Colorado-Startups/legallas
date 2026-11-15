// SPDX-License-Identifier: Apache-2.0
// Paragraph text from a .docx (the OLLS C.R.S. title downloads), with no dependency: a .docx is a zip, and the
// text is in word/document.xml. Reads the zip's central directory, inflates the one entry and keeps each
// <w:p> as one line. Formatting, footnotes and headers are ignored.
import { inflateRawSync } from 'node:zlib';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

interface CentralEntry {
  name: string;
  method: number;
  size: number;
  local: number;
}

/** A zip archive's central directory, entry by entry. */
function* centralEntries(zip: Buffer): Generator<CentralEntry> {
  // The end-of-central-directory record sits in the last 64 KB (plus its own 22 bytes).
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(at) !== CENTRAL) throw new Error('bad zip central directory');
    const nameLength = zip.readUInt16LE(at + 28);
    yield { name: zip.subarray(at + 46, at + 46 + nameLength).toString('utf8'), method: zip.readUInt16LE(at + 10), size: zip.readUInt32LE(at + 20), local: zip.readUInt32LE(at + 42) };
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
}

/** The names in a zip archive's central directory, in order. */
export function zipNames(zip: Buffer): string[] {
  return [...centralEntries(zip)].map((entry) => entry.name);
}

/**
 * One entry's bytes from a zip archive, or null when the archive has no such entry. Stored or deflated only. With
 * `maxBytes`, a larger entry throws, so a zip bomb can't fill memory.
 */
export function zipEntry(zip: Buffer, name: string, maxBytes?: number): Buffer | null {
  for (const { name: entry, method, size, local } of centralEntries(zip)) {
    if (entry !== name) continue;
    if (zip.readUInt32LE(local) !== LOCAL) throw new Error('bad zip local header');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    if (method === 0) {
      if (maxBytes !== undefined && data.length > maxBytes) throw Object.assign(new Error('entry too large'), { code: 'ERR_BUFFER_TOO_LARGE' });
      return Buffer.from(data);
    }
    if (method === 8) return inflateRawSync(data, maxBytes === undefined ? {} : { maxOutputLength: maxBytes });
    throw new Error(`unsupported zip method ${method}`);
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML character references and the five named entities decoded. */
export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/** The text of each paragraph of a WordprocessingML body, in order. Tabs and breaks become spaces. */
export function docxParagraphs(documentXml: string): string[] {
  const out: string[] = [];
  for (const [paragraph] of documentXml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    let text = '';
    for (const match of paragraph.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>/g)) {
      text += match[1] !== undefined ? decodeXml(match[1]) : ' ';
    }
    out.push(text.replace(/[ \t]+/g, ' ').trim());
  }
  return out;
}

/** Paragraph text of a .docx file's main document. */
export function readDocx(zip: Buffer): string[] {
  const xml = zipEntry(zip, 'word/document.xml');
  if (!xml) throw new Error('no word/document.xml in the .docx');
  return docxParagraphs(xml.toString('utf8'));
}
