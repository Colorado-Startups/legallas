// SPDX-License-Identifier: Apache-2.0
// Minimal PNG encoding for the two app icons: 8-bit RGBA, no interlace, filter 0 on every row. readPngHeader
// (png-header.ts, re-exported here) reads any PNG's size and color type; decodeRgba reads back only what
// encodeRgba writes (tests use it).
import { deflateSync, inflateSync } from 'node:zlib';
import { COLOR_TYPE_RGBA, PNG_SIGNATURE, readPngHeader } from './png-header.ts';
import { crc32 } from '../../mcp/zip.ts';

export { COLOR_TYPE_RGBA, readPngHeader };

const SIGNATURE = Buffer.from(PNG_SIGNATURE);

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Encodes width x height RGBA pixels (row-major, 4 bytes each) as a PNG. */
export function encodeRgba(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) throw new Error('png_size_mismatch');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(COLOR_TYPE_RGBA, 9);
  // compression, filter and interlace methods stay 0
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Reads back RGBA pixels from a PNG written by encodeRgba (filter 0 rows only). */
export function decodeRgba(png: Uint8Array): { width: number; height: number; rgba: Buffer } {
  const header = readPngHeader(png);
  if (!header || header.colorType !== COLOR_TYPE_RGBA) throw new Error('png_not_rgba');
  const buf = Buffer.from(png);
  const parts: Buffer[] = [];
  for (let at = 8; at < buf.length; ) {
    const length = buf.readUInt32BE(at);
    if (buf.toString('latin1', at + 4, at + 8) === 'IDAT') parts.push(buf.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = header.width * 4;
  const rgba = Buffer.alloc(header.height * stride);
  for (let y = 0; y < header.height; y++) {
    if (raw[y * (stride + 1)] !== 0) throw new Error('png_filter_unsupported');
    rgba.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { width: header.width, height: header.height, rgba };
}
