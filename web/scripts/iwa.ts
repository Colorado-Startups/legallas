// SPDX-License-Identifier: Apache-2.0
// The container of Apple's iWork files (Pages, Numbers, Keynote), for iwork.ts. A file is a ZIP of .iwa parts; a part
// is a stream of Snappy blocks in Apple's own framing, holding length-prefixed protobuf objects. Apple publishes no
// file format, so this reads only what invented files saved by the apps show (web/fixtures/iwork/README.md),
// with no third-party code. Every byte is untrusted: lengths are checked before use, and any malformed input throws
// IworkFailure, a short code and never a file name.
import { open, type FileHandle } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

export type IworkCode = 'not-iwork' | 'unreadable' | 'too-large' | 'password' | 'old-format' | 'timeout';

/** A failure iwork.ts can report: extract's failureCode reads the code, the last word of the message. */
export class IworkFailure extends Error {
  readonly code: IworkCode;
  constructor(code: IworkCode) {
    super(`iwork text failed: ${code}`);
    this.code = code;
  }
}

// These two limit memory outside the JS heap, which the child process's limit in iwork.ts does not cover.
/** Largest part read: a bigger one fails the document as "too-large" (a zip bomb, say). */
export const MAX_PART_BYTES = 64 * 1024 * 1024;
/** Most text-bearing bytes one document may expand to, across its parts. */
export const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_BYTES = 22;
const MAX_COMMENT = 0xffff;
const ZIP64_MARK = 0xffffffff;
const STORED = 0;
const DEFLATED = 8;

export interface ZipEntry {
  name: string;
  method: number;
  compressed: number;
  size: number;
  /** Offset of the local header. */
  offset: number;
}

/** Reads the central directory: the media a large deck holds is never loaded. */
export async function zipEntries(handle: FileHandle): Promise<Map<string, ZipEntry>> {
  const { size } = await handle.stat();
  const tailLength = Math.min(size, EOCD_BYTES + MAX_COMMENT);
  const tail = Buffer.alloc(tailLength);
  await handle.read(tail, 0, tailLength, size - tailLength);
  let eocd = -1;
  for (let at = tailLength - EOCD_BYTES; at >= 0 && eocd < 0; at -= 1) if (tail.readUInt32LE(at) === EOCD_SIGNATURE) eocd = at;
  if (eocd < 0) {
    // No directory. A ZIP's opening bytes mean one cut short; anything else only shares the extension (a private key named .key).
    const head = Buffer.alloc(4);
    await handle.read(head, 0, 4, 0);
    throw new IworkFailure(head.readUInt32LE(0) === LOCAL_SIGNATURE ? 'unreadable' : 'not-iwork');
  }
  const count = tail.readUInt16LE(eocd + 10);
  const directoryBytes = tail.readUInt32LE(eocd + 12);
  const directoryAt = tail.readUInt32LE(eocd + 16);
  // ZIP64 is only for archives past 4 GB, which only a deck full of video reaches.
  if (directoryAt === ZIP64_MARK || directoryBytes === ZIP64_MARK) throw new IworkFailure('too-large');
  if (directoryAt + directoryBytes > size) throw new IworkFailure('unreadable');
  const directory = Buffer.alloc(directoryBytes);
  await handle.read(directory, 0, directoryBytes, directoryAt);
  const entries = new Map<string, ZipEntry>();
  let at = 0;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > directory.length || directory.readUInt32LE(at) !== CENTRAL_SIGNATURE) throw new IworkFailure('unreadable');
    const nameLength = directory.readUInt16LE(at + 28);
    const end = at + 46 + nameLength;
    if (end > directory.length) throw new IworkFailure('unreadable');
    const name = directory.toString('utf8', at + 46, end);
    entries.set(name, {
      name,
      method: directory.readUInt16LE(at + 10),
      compressed: directory.readUInt32LE(at + 20),
      size: directory.readUInt32LE(at + 24),
      offset: directory.readUInt32LE(at + 42),
    });
    at = end + directory.readUInt16LE(at + 30) + directory.readUInt16LE(at + 32);
  }
  return entries;
}

/** One entry's bytes, capped at MAX_PART_BYTES. A stored link in the archive is only ever read as bytes. */
export async function zipPart(handle: FileHandle, entry: ZipEntry): Promise<Buffer> {
  if (entry.compressed > MAX_PART_BYTES || entry.size > MAX_PART_BYTES) throw new IworkFailure('too-large');
  const head = Buffer.alloc(30);
  await handle.read(head, 0, 30, entry.offset);
  if (head.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new IworkFailure('unreadable');
  const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  const raw = Buffer.alloc(entry.compressed);
  const { bytesRead } = await handle.read(raw, 0, entry.compressed, start);
  if (bytesRead !== entry.compressed) throw new IworkFailure('unreadable');
  if (entry.method === STORED) return raw;
  if (entry.method !== DEFLATED) throw new IworkFailure('unreadable');
  try {
    return inflateRawSync(raw, { maxOutputLength: MAX_PART_BYTES });
  } catch (error) {
    throw new IworkFailure((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' ? 'too-large' : 'unreadable');
  }
}

/** Decodes one Snappy block (Google's public format description), `room` bytes at most. */
function snappyBlock(input: Buffer, from: number, to: number, room: number): Buffer {
  let at = from;
  let wanted = 0;
  for (let shift = 0; ; shift += 7) {
    if (at >= to || shift > 28) throw new IworkFailure('unreadable');
    const byte = input[at++]!; // safe: at is below to
    wanted += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) break;
  }
  if (wanted > room) throw new IworkFailure('too-large');
  const out = Buffer.allocUnsafe(wanted);
  let pos = 0;
  while (at < to) {
    const tag = input[at++]!; // safe: at is below to
    const kind = tag & 3;
    if (kind === 0) {
      let length = tag >> 2;
      if (length >= 60) {
        const bytes = length - 59;
        if (at + bytes > to) throw new IworkFailure('unreadable');
        length = input.readUIntLE(at, bytes);
        at += bytes;
      }
      length += 1;
      if (at + length > to || pos + length > wanted) throw new IworkFailure('unreadable');
      input.copy(out, pos, at, at + length);
      at += length;
      pos += length;
      continue;
    }
    const extra = kind === 1 ? 1 : kind === 2 ? 2 : 4;
    if (at + extra > to) throw new IworkFailure('unreadable');
    const length = kind === 1 ? ((tag >> 2) & 7) + 4 : (tag >> 2) + 1;
    const distance = kind === 1 ? ((tag >> 5) << 8) | input[at]! : input.readUIntLE(at, extra); // safe: bounds checked above
    at += extra;
    if (distance === 0 || distance > pos || pos + length > wanted) throw new IworkFailure('unreadable');
    // Byte by byte on purpose: a copy may overlap its own output, which is how Snappy encodes runs.
    for (let i = 0; i < length; i += 1, pos += 1) out[pos] = out[pos - distance]!; // safe: distance is checked above
  }
  // Every byte was written, so nothing of allocUnsafe's old memory can reach the text.
  if (pos !== wanted) throw new IworkFailure('unreadable');
  return out;
}

/**
 * An .iwa part's bytes. Apple's framing differs from Snappy's own: no stream identifier and no checksums, only
 * a run of chunks, each a type byte (always 0) and a 24-bit little-endian length.
 */
export function iwaBytes(part: Buffer): Buffer {
  const blocks: Buffer[] = [];
  let at = 0;
  let total = 0;
  while (at < part.length) {
    if (at + 4 > part.length || part[at] !== 0) throw new IworkFailure('unreadable');
    const length = part.readUIntLE(at + 1, 3);
    at += 4;
    if (at + length > part.length) throw new IworkFailure('unreadable');
    const block = snappyBlock(part, at, at + length, MAX_PART_BYTES - total);
    blocks.push(block);
    total += block.length;
    at += length;
  }
  return Buffer.concat(blocks, total);
}

export interface Field {
  n: number;
  /** The varint value of a varint field, otherwise 0. */
  value: number;
  /** The bytes of a length-delimited or fixed-width field; empty for a varint. */
  bytes: Buffer;
  isVarint: boolean;
}

const EMPTY = Buffer.alloc(0);

/** Reads a varint at `at`; returns [value, next]. Past 2^53 it loses precision, which only an ID that large would notice. */
function varint(bytes: Buffer, at: number): [number, number] {
  let value = 0;
  let pos = at;
  for (let scale = 1, count = 0; ; scale *= 128, count += 1) {
    if (pos >= bytes.length || count >= 10) throw new IworkFailure('unreadable');
    const byte = bytes[pos++]!; // safe: pos is below the length
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) return [value, pos];
  }
}

/** A protobuf message's fields in order. No schema: iwork.ts names the field numbers it reads. */
export function fieldsOf(bytes: Buffer): Field[] {
  const fields: Field[] = [];
  let at = 0;
  while (at < bytes.length) {
    const [key, afterKey] = varint(bytes, at);
    const n = Math.floor(key / 8);
    const wire = key % 8;
    if (n === 0) throw new IworkFailure('unreadable');
    at = afterKey;
    if (wire === 0) {
      const [value, next] = varint(bytes, at);
      fields.push({ n, value, bytes: EMPTY, isVarint: true });
      at = next;
      continue;
    }
    let length: number;
    if (wire === 1) length = 8;
    else if (wire === 5) length = 4;
    else if (wire === 2) [length, at] = varint(bytes, at);
    else throw new IworkFailure('unreadable');
    if (at + length > bytes.length) throw new IworkFailure('unreadable');
    fields.push({ n, value: 0, bytes: bytes.subarray(at, at + length), isVarint: false });
    at += length;
  }
  return fields;
}

export const firstField = (fields: readonly Field[], n: number): Field | undefined => fields.find((field) => field.n === n);
export const allFields = (fields: readonly Field[], n: number): Field[] => fields.filter((field) => field.n === n);

/** The ID in a reference, a message whose field 1 is the object's ID. */
export function refOf(field: Field | undefined): number | null {
  if (!field || field.isVarint) return null;
  const id = firstField(fieldsOf(field.bytes), 1);
  return id?.isVarint ? id.value : null;
}

export interface IwaObject {
  id: number;
  type: number;
  message: Buffer;
}

/** Adds a part's objects to `objects`: a varint length, an ArchiveInfo, then the payloads it lists. */
export function addObjects(bytes: Buffer, objects: Map<number, IwaObject>, messages: IwaObject[] = []): void {
  let at = 0;
  while (at < bytes.length) {
    const [length, afterLength] = varint(bytes, at);
    if (afterLength + length > bytes.length) throw new IworkFailure('unreadable');
    const info = fieldsOf(bytes.subarray(afterLength, afterLength + length));
    at = afterLength + length;
    const id = firstField(info, 1)?.value ?? 0;
    for (const [index, entry] of allFields(info, 2).entries()) {
      const fields = fieldsOf(entry.bytes);
      const size = firstField(fields, 3)?.value ?? 0;
      if (at + size > bytes.length) throw new IworkFailure('unreadable');
      const object = { id, type: firstField(fields, 1)?.value ?? 0, message: bytes.subarray(at, at + size) };
      messages.push(object);
      // Only an archive's first message is its object; any others are version notes.
      if (index === 0) objects.set(id, object);
      at += size;
    }
  }
}

/** A text object, and how deep text may nest: a table in a text box in a cell. */
export const STORAGE = 2001;
export const MAX_DEPTH = 8;

/** One document's reading. */
export interface Walk {
  objects: Map<number, IwaObject>;
  /** Every message read. The map keeps one for each ID and no version notes, and the SSN guard wants them all. */
  messages: IwaObject[];
  /** The text objects and tables the walk reached. */
  reached: Set<number>;
  /** Reads a text object: a rich text cell's, for iwork-table.ts. */
  storageText: (storage: IwaObject, depth: number) => string;
}

export const objectAt = (walk: Walk, field: Field | undefined): IwaObject | undefined => walk.objects.get(refOf(field) ?? -1);
export const textOf = (field: Field | undefined): string => (field && !field.isVarint ? field.bytes.toString('utf8') : '');

/** Opens `file` and reads what `read` asks for, always closing it. Not a ZIP at all fails as "unreadable". */
export async function withArchive<T>(file: string, read: (handle: FileHandle, entries: Map<string, ZipEntry>) => Promise<T>): Promise<T> {
  const handle = await open(file, 'r').catch(() => {
    throw new IworkFailure('unreadable');
  });
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new IworkFailure('unreadable');
    if (stats.size < EOCD_BYTES) throw new IworkFailure('not-iwork');
    return await read(handle, await zipEntries(handle));
  } finally {
    await handle.close();
  }
}
