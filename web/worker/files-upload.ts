// SPDX-License-Identifier: Apache-2.0
// Counsel uploads: what may come in, and how to check it without buffering the file. The body is
// streamed to R2; only its first few KB are read here, to compare the bytes with the extension.

/** Below the zone's 100 MB request limit, with room for headers. */
export const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;
/** Bytes read up front for the content check. */
export const HEAD_BYTES = 4096;
const MAX_NAME = 180;

type Magic = 'pdf' | 'png' | 'jpg' | 'zip' | 'text';

export interface UploadType {
  kind: 'pdf' | 'image' | 'markdown' | 'csv' | 'text' | 'file';
  contentType: string;
  magic: Magic;
}

const UTF8 = '; charset=utf-8';

/** The allowlist. Anything else, HTML and SVG included, is refused. */
export const UPLOAD_TYPES: Readonly<Record<string, UploadType>> = {
  pdf: { kind: 'pdf', contentType: 'application/pdf', magic: 'pdf' },
  png: { kind: 'image', contentType: 'image/png', magic: 'png' },
  jpg: { kind: 'image', contentType: 'image/jpeg', magic: 'jpg' },
  jpeg: { kind: 'image', contentType: 'image/jpeg', magic: 'jpg' },
  docx: { kind: 'file', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: 'zip' },
  xlsx: { kind: 'file', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: 'zip' },
  pptx: { kind: 'file', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic: 'zip' },
  zip: { kind: 'file', contentType: 'application/zip', magic: 'zip' },
  txt: { kind: 'text', contentType: `text/plain${UTF8}`, magic: 'text' },
  csv: { kind: 'csv', contentType: `text/csv${UTF8}`, magic: 'text' },
  md: { kind: 'markdown', contentType: `text/markdown${UTF8}`, magic: 'text' },
};

/** The lowercase extension after the last dot, or '' when there is none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function uploadTypeOf(name: string): UploadType | null {
  const ext = extensionOf(name);
  return Object.hasOwn(UPLOAD_TYPES, ext) ? UPLOAD_TYPES[ext]! : null;
}

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * The stored display name for an upload, or null if nothing usable is left. NFC; no control, format
 * or bidi characters; no path separators or colons; no leading dots; at most 180 characters, cut from
 * the base name so the extension survives.
 */
export function sanitizeUploadName(raw: string | null): string | null {
  if (raw === null || raw.length > 1024) return null;
  const cleaned = raw
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/[/\\:]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .trim();
  const chars = Array.from(cleaned);
  if (chars.length === 0) return null;
  if (chars.length <= MAX_NAME) return cleaned;
  const ext = extensionOf(cleaned);
  const keep = ext ? MAX_NAME - ext.length - 1 : MAX_NAME;
  const base = Array.from(ext ? cleaned.slice(0, cleaned.length - ext.length - 1) : cleaned).slice(0, keep).join('').trimEnd();
  return ext ? `${base}.${ext}` : base;
}

export type LengthCheck = { ok: true; size: number } | { ok: false; status: 400 | 411 | 413; error: string };

/** A declared, non-empty Content-Length within the cap. Chunked uploads (no length) are refused. */
export function checkContentLength(header: string | null): LengthCheck {
  if (header === null) return { ok: false, status: 411, error: 'length_required' };
  if (!/^\d{1,15}$/.test(header.trim())) return { ok: false, status: 400, error: 'bad_length' };
  const size = Number(header.trim());
  if (size === 0) return { ok: false, status: 400, error: 'empty_file' };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, status: 413, error: 'too_large' };
  return { ok: true, size };
}

function startsWith(head: Uint8Array, bytes: readonly number[]): boolean {
  return head.length >= bytes.length && bytes.every((b, i) => head[i] === b);
}

const strictUtf8 = () => new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

/** Plain text: no NUL bytes and valid UTF-8 (a multi-byte character cut at the end of `head` is fine). */
function looksLikeText(head: Uint8Array): boolean {
  if (head.includes(0)) return false;
  try {
    strictUtf8().decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}

/** Do the first bytes match what the extension promises? */
export function matchesMagic(type: UploadType, head: Uint8Array): boolean {
  switch (type.magic) {
    case 'pdf':
      return startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    case 'png':
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpg':
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case 'zip':
      // PK\x03\x04 starts every zip, docx, xlsx and pptx. A plain .zip may also be empty (PK\x05\x06).
      if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return true;
      return type.contentType === 'application/zip' && startsWith(head, [0x50, 0x4b, 0x05, 0x06]);
    case 'text':
      return looksLikeText(head);
  }
}

/**
 * Reads at least `want` bytes (or the whole body, if shorter) and returns them with a stream that
 * replays everything from the first byte. Memory stays bounded by `want` plus one chunk.
 */
export async function peekStream(body: ReadableStream<Uint8Array>, want: number): Promise<{ head: Uint8Array; stream: ReadableStream<Uint8Array> }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let have = 0;
  let done = false;
  while (have < want) {
    const next = await reader.read();
    if (next.done) {
      done = true;
      break;
    }
    chunks.push(next.value);
    have += next.value.byteLength;
  }

  const head = new Uint8Array(Math.min(have, want));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= head.length) break;
    const part = chunk.subarray(0, head.length - offset);
    head.set(part, offset);
    offset += part.length;
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (done) controller.close();
    },
    async pull(controller) {
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { head, stream };
}
