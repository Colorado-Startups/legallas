// SPDX-License-Identifier: Apache-2.0
// A small, dependency-free zip writer for the counsel pack, plus a reader for its central directory so the
// pack can check what it wrote. Large and already-compressed files (PDFs, images, Office files) are stored;
// small text files are deflated. Sizes and CRCs are computed before each entry is written, so no data
// descriptors are needed and every common unzip tool (Finder, Windows Explorer, unzip, Java) reads it.
// No Zip64: a pack over 4 GB or 65,535 files is refused with a hint to upload the folder instead.
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, readFile, rename, rm, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipInput {
  /** Name inside the zip ('/'-separated). */
  name: string;
  /** File on disk. */
  file: string;
}

export interface ZipListing {
  name: string;
  method: number;
  crc32: number;
  compressedSize: number;
  size: number;
}

const STORE = 0;
const DEFLATE = 8;
const VERSION = 20;
const UTF8_FLAG = 0x0800;
const MADE_BY_UNIX = 3 << 8;
const REGULAR_FILE_MODE = 0o100644;
const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_RECORD = 22;
const MAX_U32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;
const DEFLATE_MAX_BYTES = 32 * 1024 * 1024;
const DEFLATE_EXTENSIONS = new Set(['.csv', '.txt', '.md', '.json', '.html', '.htm', '.xml', '.svg', '.rtf', '.eml']);
const TOO_LARGE = 'The pack is too large for one zip (4 GB or 65,535 files); upload the folder instead';

interface Written {
  name: Buffer;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
}

/** MS-DOS date and time fields (local time, two-second resolution) for the zip headers. */
export function dosDateTime(when: Date): { time: number; date: number } {
  const year = Math.max(1980, when.getFullYear());
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

async function crcOfFile(file: string): Promise<{ crc: number; size: number }> {
  let crc = 0;
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    crc = crc32(chunk as Buffer, crc);
    size += (chunk as Buffer).length;
  }
  return { crc, size };
}

function localHeader(entry: Written, stamp: { time: number; date: number }): Buffer {
  const header = Buffer.alloc(LOCAL_HEADER);
  header.writeUInt32LE(LOCAL_SIG, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(entry.method, 8);
  header.writeUInt16LE(stamp.time, 10);
  header.writeUInt16LE(stamp.date, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressedSize, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(entry.name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, entry.name]);
}

function centralHeader(entry: Written, stamp: { time: number; date: number }): Buffer {
  const header = Buffer.alloc(CENTRAL_HEADER);
  header.writeUInt32LE(CENTRAL_SIG, 0);
  header.writeUInt16LE(MADE_BY_UNIX | VERSION, 4);
  header.writeUInt16LE(VERSION, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt16LE(stamp.time, 12);
  header.writeUInt16LE(stamp.date, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressedSize, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.name.length, 28);
  // Extra and comment lengths, disk number and internal attributes stay zero.
  header.writeUInt32LE((REGULAR_FILE_MODE << 16) >>> 0, 38);
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, entry.name]);
}

function endRecord(count: number, centralSize: number, centralOffset: number): Buffer {
  const record = Buffer.alloc(END_RECORD);
  record.writeUInt32LE(END_SIG, 0);
  record.writeUInt16LE(count, 8);
  record.writeUInt16LE(count, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  return record;
}

/** Writes one entry at `offset` and returns what the central directory needs. */
async function writeEntry(out: FileHandle, input: ZipInput, offset: number, stamp: { time: number; date: number }): Promise<Written> {
  const name = Buffer.from(input.name.normalize('NFC'), 'utf8');
  const { crc, size } = await crcOfFile(input.file);
  let data: Buffer | null = null;
  if (size <= DEFLATE_MAX_BYTES && DEFLATE_EXTENSIONS.has(path.extname(input.name).toLowerCase())) {
    const raw = await readFile(input.file);
    const packed = deflateRawSync(raw);
    if (raw.length !== size || crc32(raw) !== crc) throw new Error('A file changed while the zip was written; run the pack again');
    if (packed.length < raw.length) data = packed;
  }
  const entry: Written = { name, method: data ? DEFLATE : STORE, crc, compressedSize: data ? data.length : size, size, offset };
  if (offset + LOCAL_HEADER + name.length + entry.compressedSize >= MAX_U32) throw new Error(TOO_LARGE);
  const header = localHeader(entry, stamp);
  await out.write(header, 0, header.length, offset);
  let position = offset + header.length;
  if (data) {
    await out.write(data, 0, data.length, position);
    return entry;
  }
  let check = 0;
  for await (const chunk of createReadStream(input.file)) {
    const buffer = chunk as Buffer;
    if (position + buffer.length > offset + header.length + size) throw new Error('A file changed while the zip was written; run the pack again');
    check = crc32(buffer, check);
    await out.write(buffer, 0, buffer.length, position);
    position += buffer.length;
  }
  if (check !== crc || position !== offset + header.length + size) throw new Error('A file changed while the zip was written; run the pack again');
  return entry;
}

/**
 * True when entries of these names and sizes fit a zip without Zip64. Stored sizes are an upper bound
 * (deflate is only kept when smaller), so a pack that passes here cannot overflow while being written.
 */
export function zipFits(entries: readonly { name: string; size: number }[]): boolean {
  if (entries.length >= MAX_ENTRIES) return false;
  let total = END_RECORD;
  for (const { name, size } of entries) {
    const nameBytes = Buffer.byteLength(name.normalize('NFC'), 'utf8');
    if (size >= MAX_U32) return false;
    total += LOCAL_HEADER + CENTRAL_HEADER + 2 * nameBytes + size;
  }
  return total < MAX_U32;
}

/**
 * Writes `inputs` to `target` as one zip. It is written beside the target under a temporary name and
 * renamed into place only when complete, so a failed run never leaves a half-written zip behind. An aborted
 * `signal` stops it before the next entry (the temp file is removed).
 */
export async function writeZip(target: string, inputs: readonly ZipInput[], when: Date, signal?: AbortSignal): Promise<{ entries: number; bytes: number }> {
  const sized = await Promise.all(inputs.map(async (input) => ({ name: input.name, size: (await lstat(input.file)).size })));
  if (!zipFits(sized)) throw new Error(TOO_LARGE);
  const stamp = dosDateTime(when);
  const temp = `${target}.partial-${randomBytes(4).toString('hex')}`;
  const out = await open(temp, 'wx', 0o600);
  try {
    const written: Written[] = [];
    let offset = 0;
    for (const input of inputs) {
      if (signal?.aborted) throw new Error('Interrupted while writing the zip');
      const entry = await writeEntry(out, input, offset, stamp);
      written.push(entry);
      offset += LOCAL_HEADER + entry.name.length + entry.compressedSize;
    }
    const central = Buffer.concat(written.map((entry) => centralHeader(entry, stamp)));
    if (offset + central.length + END_RECORD >= MAX_U32) throw new Error(TOO_LARGE);
    await out.write(central, 0, central.length, offset);
    const end = endRecord(written.length, central.length, offset);
    await out.write(end, 0, end.length, offset + central.length);
    await out.close();
    await rename(temp, target);
    return { entries: written.length, bytes: offset + central.length + END_RECORD };
  } catch (error) {
    await out.close().catch(() => undefined);
    await rm(temp, { force: true });
    throw error;
  }
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new Error('Damaged zip');
  return buffer;
}

/** Lists a zip's entries from its central directory (no comment, no Zip64: the shape writeZip produces). */
export async function listZip(file: string): Promise<ZipListing[]> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    if (size < END_RECORD) throw new Error('Not a zip this pack wrote');
    const end = await readAt(handle, size - END_RECORD, END_RECORD);
    if (end.readUInt32LE(0) !== END_SIG) throw new Error('Not a zip this pack wrote');
    const count = end.readUInt16LE(10);
    const central = await readAt(handle, end.readUInt32LE(16), end.readUInt32LE(12));
    const entries: ZipListing[] = [];
    let at = 0;
    for (let i = 0; i < count; i += 1) {
      if (central.readUInt32LE(at) !== CENTRAL_SIG) throw new Error('Damaged zip central directory');
      const nameLength = central.readUInt16LE(at + 28);
      entries.push({
        name: central.subarray(at + CENTRAL_HEADER, at + CENTRAL_HEADER + nameLength).toString('utf8'),
        method: central.readUInt16LE(at + 10),
        crc32: central.readUInt32LE(at + 16),
        compressedSize: central.readUInt32LE(at + 20),
        size: central.readUInt32LE(at + 24),
      });
      at += CENTRAL_HEADER + nameLength + central.readUInt16LE(at + 30) + central.readUInt16LE(at + 32);
    }
    return entries;
  } finally {
    await handle.close();
  }
}
