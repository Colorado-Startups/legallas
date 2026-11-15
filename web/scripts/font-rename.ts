// SPDX-License-Identifier: Apache-2.0
// Renames a font in its name table, for the visual binder's subsets (visualtheme-fonts.ts). IBM Plex Mono and Source
// Serif 4 are under OFL-1.1 with the Reserved Font Names "Plex" and "Source". A subset is a Modified Version, which may
// not use them (docs/licences/dependency-review.md, finding 3), so the subsets carry names of their own.
// Takes and returns an uncompressed font (sfnt); the caller converts from and to woff2.

/** Name IDs kept as they are, and kept through subsetting: copyright, trademark, maker, designer, description, URLs, licence. */
export const NOTICE_IDS = [0, 7, 8, 9, 10, 11, 12, 13, 14];
const NOTICES = new Set(NOTICE_IDS);

/** One record of the name table, its text decoded. */
export interface NameRecord {
  platform: number;
  encoding: number;
  language: number;
  id: number;
  text: string;
}

/** Mac records (platform 1) are single-byte; latin1 keeps their bytes as they are. The rest are UTF-16BE. */
const decode = (platform: number, raw: Buffer) => (platform === 1 ? raw.toString('latin1') : Buffer.from(raw).swap16().toString('utf16le'));
const encode = (platform: number, text: string) => (platform === 1 ? Buffer.from(text, 'latin1') : Buffer.from(text, 'utf16le').swap16());

function tables(font: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    const at = 12 + i * 16;
    const offset = font.readUInt32BE(at + 8);
    out.set(font.toString('latin1', at, at + 4), font.subarray(offset, offset + font.readUInt32BE(at + 12)));
  }
  return out;
}

/** The records of a font's name table. */
export function fontNames(font: Buffer): NameRecord[] {
  const table = tables(font).get('name');
  if (!table || table.readUInt16BE(0) !== 0) throw new Error('font-rename: needs a version 0 name table');
  const store = table.readUInt16BE(4);
  return Array.from({ length: table.readUInt16BE(2) }, (_, i) => {
    const [platform, encoding, language, id, length, offset] = [0, 2, 4, 6, 8, 10].map((o) => table.readUInt16BE(6 + i * 12 + o)) as [number, number, number, number, number, number];
    return { platform, encoding, language, id, text: decode(platform, table.subarray(store + offset, store + offset + length)) };
  });
}

function nameTable(records: NameRecord[]): Buffer {
  const strings = records.map((r) => encode(r.platform, r.text));
  const head = Buffer.alloc(6 + records.length * 12);
  head.writeUInt16BE(records.length, 2);
  head.writeUInt16BE(head.length, 4);
  let offset = 0;
  records.forEach((r, i) => {
    [r.platform, r.encoding, r.language, r.id, strings[i]!.length, offset].forEach((v, o) => head.writeUInt16BE(v, 6 + i * 12 + o * 2));
    offset += strings[i]!.length;
  });
  return Buffer.concat([head, ...strings]);
}

const pad = (data: Buffer) => Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);

function checksum(data: Buffer): number {
  const padded = pad(data);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

/** Rebuilds the font with its tables in tag order, fresh checksums and head.checkSumAdjustment. */
function build(flavor: number, parts: Map<string, Buffer>): Buffer {
  const tags = [...parts.keys()].sort();
  const pow = 2 ** Math.floor(Math.log2(tags.length));
  const dir = Buffer.alloc(12 + tags.length * 16);
  dir.writeUInt32BE(flavor, 0);
  dir.writeUInt16BE(tags.length, 4);
  dir.writeUInt16BE(pow * 16, 6);
  dir.writeUInt16BE(Math.log2(pow), 8);
  dir.writeUInt16BE((tags.length - pow) * 16, 10);
  const body: Buffer[] = [];
  let offset = dir.length;
  let headAt = -1;
  tags.forEach((tag, i) => {
    const data = Buffer.from(parts.get(tag)!);
    if (tag === 'head') (data.writeUInt32BE(0, 8), (headAt = offset));
    dir.write(tag, 12 + i * 16, 'latin1');
    dir.writeUInt32BE(checksum(data), 12 + i * 16 + 4);
    dir.writeUInt32BE(offset, 12 + i * 16 + 8);
    dir.writeUInt32BE(data.length, 12 + i * 16 + 12);
    body.push(pad(data));
    offset += pad(data).length;
  });
  const font = Buffer.concat([dir, ...body]);
  if (headAt >= 0) font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headAt + 8);
  return font;
}

/**
 * Replaces each `from` with its `to` in every name record except the notices (copyright, trademark, licence), then
 * throws if a `reserved` word is still in one, so a renamed font never carries a Reserved Font Name.
 */
export function renameFont(font: Buffer, names: Record<string, string>, reserved: readonly string[]): Buffer {
  const records = fontNames(font).map((r) =>
    NOTICES.has(r.id) ? r : { ...r, text: Object.entries(names).reduce((text, [from, to]) => text.replaceAll(from, to), r.text) });
  const left = records.find((r) => !NOTICES.has(r.id) && reserved.some((word) => r.text.includes(word)));
  if (left) throw new Error(`font-rename: name ${left.id} still reads "${left.text}"`);
  const parts = tables(font);
  parts.set('name', nameTable(records));
  return build(font.readUInt32BE(0), parts);
}
