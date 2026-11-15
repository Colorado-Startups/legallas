// SPDX-License-Identifier: Apache-2.0
// A text file's characters, whatever wrote it. Excel's "Unicode Text" and many Windows tools write UTF-16, some tools
// UTF-32, with or without a byte order mark. Read as UTF-8, each character comes with NULs beside it, so the SSN guard
// finds nothing and the index holds garbage.
import { open, readFile } from 'node:fs/promises';

type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'utf-32le' | 'utf-32be';

const SNIFF_BYTES = 4096;
/** The share of a byte's slots that must be NUL to call it wide text: Latin text is nearly all, other scripts less. */
const MOSTLY_NUL = 0.6;
/** Without that many NULs, UTF-16 still shows itself: at least this share of bytes NUL, and this many, ... */
const WIDE_SHARE = 0.01;
const WIDE_MIN = 8;
/** ... and this many times as many on one side of each pair as on the other. UTF-8 text holds no NUL at all. */
const WIDE_SIDE = 8;

function encodingOf(bytes: Uint8Array): Encoding {
  const [a, b, c, d] = bytes;
  if (a === 0xff && b === 0xfe) return c === 0 && d === 0 ? 'utf-32le' : 'utf-16le';
  if (a === 0xfe && b === 0xff) return 'utf-16be';
  if (a === 0 && b === 0 && c === 0xfe && d === 0xff) return 'utf-32be';
  // No mark. UTF-8 text holds no NUL, and wider text holds them in the same byte slots throughout.
  const head = bytes.subarray(0, SNIFF_BYTES);
  const zeros = [0, 0, 0, 0];
  head.forEach((byte, i) => {
    if (byte === 0) zeros[i % 4]! += 1; // safe: i % 4 is in range
  });
  const [z0, z1, z2, z3] = zeros.map((n) => n * 4 > head.length * MOSTLY_NUL);
  if (z1 && z2 && z3 && !z0) return 'utf-32le';
  if (z0 && z1 && z2 && !z3) return 'utf-32be';
  if (z1 && z3 && !z0 && !z2) return 'utf-16le';
  if (z0 && z2 && !z1 && !z3) return 'utf-16be';
  // Mostly other scripts (#275): only the Latin characters, digits among them, leave a NUL, nearly all on one side.
  const even = zeros[0]! + zeros[2]!; // safe: four slots
  const odd = zeros[1]! + zeros[3]!; // safe: four slots
  const some = Math.max(WIDE_MIN, head.length * WIDE_SHARE);
  if (odd >= some && odd >= even * WIDE_SIDE) return 'utf-16le';
  if (even >= some && even >= odd * WIDE_SIDE) return 'utf-16be';
  return 'utf-8';
}

/** TextDecoder has no UTF-32. */
function utf32(bytes: Buffer, littleEndian: boolean): string {
  let text = '';
  for (let at = 0; at + 4 <= bytes.length; at += 4) {
    const code = littleEndian ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at);
    if (code !== 0xfeff) text += code <= 0x10ffff ? String.fromCodePoint(code) : '�';
  }
  return text;
}

/** The characters of these bytes, in whichever of UTF-8, UTF-16 or UTF-32 they were written. */
export function decodeText(bytes: Buffer): string {
  const encoding = encodingOf(bytes);
  if (encoding === 'utf-8') return bytes.toString('utf8');
  if (encoding === 'utf-32le' || encoding === 'utf-32be') return utf32(bytes, encoding === 'utf-32le');
  return new TextDecoder(encoding).decode(bytes);
}

/** The file's text, in whichever of UTF-8, UTF-16 or UTF-32 it was written. */
export async function readTextFile(file: string): Promise<string> {
  return decodeText(await readFile(file));
}

/** True when the file's first bytes read as text: wide text, or no NUL at all. Binary formats hold NULs early. */
export async function looksLikeText(file: string): Promise<boolean> {
  const handle = await open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(SNIFF_BYTES), 0, SNIFF_BYTES, 0);
    const head = buffer.subarray(0, bytesRead);
    return encodingOf(head) !== 'utf-8' || !head.includes(0);
  } finally {
    await handle.close();
  }
}
