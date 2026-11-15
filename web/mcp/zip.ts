// SPDX-License-Identifier: Apache-2.0
// A store-only ZIP writer (no compression, no new dependencies), for the Copilot agent package
// (connect/copilot/package.ts) and the MCP smoke's fake one. The app package holds three small JSON files and two
// PNGs that are already deflated, so storing them costs a few hundred bytes. Timestamps are fixed at 1980-01-01 so
// the same inputs always give byte-identical output.

/** One file in the archive. Names use forward slashes; the app package keeps everything at the root. */
export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

/** CRC-32 (ISO 3309), as ZIP and PNG both use it. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date for 1980-01-01 (day 1, month 1, year offset 0); time 00:00:00. */
const DOS_DATE = (1 << 5) | 1;
const DOS_TIME = 0;
/** General purpose flag bit 11: names are UTF-8. */
const FLAG_UTF8 = 0x0800;

function localHeader(name: Buffer, entry: ZipEntry, crc: number): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed: 2.0
  header.writeUInt16LE(FLAG_UTF8, 6);
  header.writeUInt16LE(0, 8); // method: stored
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(entry.data.length, 18);
  header.writeUInt32LE(entry.data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name]);
}

function centralHeader(name: Buffer, entry: ZipEntry, crc: number, offset: number): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4); // version made by: 2.0, MS-DOS
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(FLAG_UTF8, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(entry.data.length, 20);
  header.writeUInt32LE(entry.data.length, 24);
  header.writeUInt16LE(name.length, 28);
  // extra length, comment length, disk number, internal and external attributes stay 0
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, name]);
}

/** Builds a ZIP archive that stores each entry uncompressed, in the order given. */
export function zipStore(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const local = Buffer.concat([localHeader(name, entry, crc), entry.data]);
    centrals.push(centralHeader(name, entry, crc, offset));
    locals.push(local);
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

/**
 * Reads back an archive of stored entries (as zipStore writes) from its central directory, checking each CRC.
 * Throws a plain sentence for anything else: not a ZIP, compressed entries, or damaged data.
 */
export function readZipStore(zip: Uint8Array): ZipEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) throw new Error('not a ZIP archive (or it has a comment)');
  const entries: ZipEntry[] = [];
  for (let i = 0, at = view.getUint32(end + 16, true); i < view.getUint16(end + 10, true); i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) throw new Error('the ZIP central directory is damaged');
    const nameLength = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    if (view.getUint16(at + 10, true) !== 0) throw new Error(`${name}: compressed; the package stores every file`);
    const local = view.getUint32(at + 42, true);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = zip.subarray(start, start + view.getUint32(at + 20, true));
    if (crc32(data) !== view.getUint32(at + 16, true)) throw new Error(`${name}: damaged (CRC mismatch)`);
    entries.push({ name, data });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return entries;
}
