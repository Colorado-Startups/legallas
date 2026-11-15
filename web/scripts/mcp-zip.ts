// SPDX-License-Identifier: Apache-2.0
// A small ZIP reader for the legallas-mcp smoke: it opens the Copilot agent package that POST
// /connect/copilot-package returns, so the smoke can run connect/copilot/validate.ts on its files. It reads the
// central directory (so data descriptors do not matter), supports stored and deflated entries, and refuses
// anything else (ZIP64, encryption, entries in folders) with a fixed message that never quotes the input.
import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
/** The package holds five small files; anything far larger is not ours. */
const MAX_ENTRIES = 64;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

/** True when the bytes start like a ZIP archive (a local file header, `PK\x03\x04`). */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function findEndOfCentralDirectory(view: DataView): number {
  const last = view.byteLength - EOCD_SIZE;
  for (let at = last; at >= 0 && at >= last - MAX_COMMENT; at--) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at;
  }
  throw new Error('zip_no_end_record');
}

function entryData(bytes: Uint8Array, view: DataView, localOffset: number, method: number, size: number, rawSize: number): Uint8Array {
  if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) throw new Error('zip_bad_local_header');
  const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
  if (start + size > bytes.length) throw new Error('zip_truncated');
  const raw = bytes.subarray(start, start + size);
  if (method === 0) return raw;
  if (method !== 8) throw new Error('zip_unsupported_method');
  const inflated = inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
  if (inflated.length !== rawSize) throw new Error('zip_size_mismatch');
  return new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.length);
}

/** Every file in the archive by name, from the central directory. Throws a `zip_*` code on anything unexpected. */
export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < EOCD_SIZE) throw new Error('zip_too_short');
  const end = findEndOfCentralDirectory(view);
  const count = view.getUint16(end + 10, true);
  if (count > MAX_ENTRIES) throw new Error('zip_too_many_entries');
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw new Error('zip_bad_central_header');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const rawSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const skip = nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (flags & 0x1) throw new Error('zip_encrypted');
    if (size > MAX_ENTRY_BYTES || rawSize > MAX_ENTRY_BYTES) throw new Error('zip_entry_too_large');
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(name)) throw new Error('zip_unexpected_name');
    files.set(name, entryData(bytes, view, view.getUint32(at + 42, true), method, size, rawSize));
    at += 46 + skip;
  }
  return files;
}
