// SPDX-License-Identifier: Apache-2.0
// Reads a PNG's IHDR header (size and color type) with no node:zlib, so validate.ts can run inside the Worker
// that builds each firm's Copilot package (mcp/copilot-package.ts). png.ts re-exports these for the icon tools.

/** The eight bytes every PNG starts with. */
export const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** IHDR color type 6: truecolor with alpha. */
export const COLOR_TYPE_RGBA = 6;

/** Size and color type from the IHDR chunk, or null when the bytes are not a PNG. */
export function readPngHeader(png: Uint8Array): { width: number; height: number; colorType: number } | null {
  if (png.length < 33 || PNG_SIGNATURE.some((byte, i) => png[i] !== byte)) return null;
  if (String.fromCharCode(...png.subarray(12, 16)) !== 'IHDR') return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20), colorType: view.getUint8(25) };
}
