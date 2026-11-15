// SPDX-License-Identifier: Apache-2.0
// The visuals' AI side files (decision D8): each visual's rendered text, and a PNG when one fits, in legallas-files at
// meta/visual-ai/<html sha256>.{txt,png}. scripts/visual-ai.ts keeps them in the sync's plan; the visual binder
// (worker/visuals.ts) and Ask's visual answers (worker/visual-ai.ts) read them. They are not documents: no D1 row, no
// control number, never listed, served by /files or put in legallas-index.
export const VISUAL_AI_PREFIX = 'meta/visual-ai/';
export type VisualAiExt = 'txt' | 'png';
const SIDE_SHA256 = /^[0-9a-f]{64}$/;
const SIDE_KEY = /^meta\/visual-ai\/[0-9a-f]{64}\.(?:txt|png)$/;

/**
 * The largest PNG a side file holds: an AI result embeds an image as base64 of at most 100,000 characters, which is
 * 75,000 bytes, and of at most one megapixel.
 */
export const VISUAL_PNG_MAX_BYTES = 75_000;
export const VISUAL_PNG_MAX_PIXELS = 1_000_000;

/** The side-file key for a visual's HTML sha256. Throws on anything but a lowercase hex sha256. */
export function visualAiKey(sha256: string, ext: VisualAiExt): string {
  if (!SIDE_SHA256.test(sha256)) throw new Error('visualAiKey: bad sha256');
  return `${VISUAL_AI_PREFIX}${sha256}.${ext}`;
}

/** True for a side-file key (meta/visual-ai/<sha256>.txt or .png) and nothing else. */
export function isVisualAiKey(key: string): boolean {
  return SIDE_KEY.test(key);
}

/** Width and height from a PNG's IHDR chunk, or null when the bytes are not a PNG. */
export function pngSize(png: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.byteLength < 24 || signature.some((byte, i) => png[i] !== byte)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** True for a PNG within the side-file limits: VISUAL_PNG_MAX_BYTES and VISUAL_PNG_MAX_PIXELS. */
export function sidePngFits(png: Uint8Array): boolean {
  const size = pngSize(png);
  return size !== null && png.byteLength <= VISUAL_PNG_MAX_BYTES && size.width * size.height <= VISUAL_PNG_MAX_PIXELS;
}
