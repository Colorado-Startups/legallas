// SPDX-License-Identifier: Apache-2.0
// Image checks on the built site (plan PR-L1). astro:assets keeps a full-size copy of an imported image in the build
// whenever code reads the import itself (`.src`, `.width`, `.height`, a spread, or passing it anywhere but <Picture>
// or <Image>). These checks catch that: no file under dist/_astro/ may be a byte-identical copy of a raster original
// under src/assets/legallas/, and no built PNG may be wider than MAX_PNG_WIDTH (the largest shown is 384px, Ask at 2x).
// scripts/dist-audit.ts runs them on every build.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Finding } from './dist-csp.ts';

/** Built PNGs wider than this are full-size originals, not resized copies. */
export const MAX_PNG_WIDTH = 900;
const RASTER = /\.(png|apng|jpe?g|webp|avif|gif)$/i;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function* files(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else yield full;
  }
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** The width in an IHDR chunk, or null when `bytes` is not a PNG. */
export function pngWidth(bytes: Buffer): number | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  return bytes.readUInt32BE(16);
}

/**
 * Checks every image under `dist`/_astro. `originals` is the source folder whose raster files must never be copied
 * into the build as they are (src/assets/legallas); pass null to skip that check.
 */
export function checkImages(dist: string, originals: string | null): Finding[] {
  const found: Finding[] = [];
  const sources = new Map<string, string>();
  if (originals) {
    for (const file of files(originals)) {
      if (RASTER.test(file)) sources.set(sha256(readFileSync(file)), path.relative(originals, file));
    }
  }
  for (const file of files(path.join(dist, '_astro'))) {
    if (!RASTER.test(file)) continue;
    const rel = path.relative(dist, file);
    const bytes = readFileSync(file);
    const original = sources.get(sha256(bytes));
    if (original) found.push({ file: rel, problem: `byte-identical copy of the original ${original}; something reads the image import outside <Picture>` });
    const width = pngWidth(bytes);
    if (width !== null && width > MAX_PNG_WIDTH) found.push({ file: rel, problem: `PNG ${width}px wide, over the ${MAX_PNG_WIDTH}px limit for built images` });
  }
  return found;
}
