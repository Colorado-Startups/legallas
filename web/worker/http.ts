// SPDX-License-Identifier: Apache-2.0
// Small HTTP helpers shared by route modules.

export function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const response = Response.json(body, { status, headers });
  return response;
}

export function errorJson(error: string, status: number): Response {
  return json({ error }, status);
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isWrite(method: string): boolean {
  return WRITE_METHODS.has(method.toUpperCase());
}

/**
 * Document reads (/files, /api/doc) write audit rows, so another example.com page must not be able to
 * trigger them with an <img> or a link: only the room itself (same-origin), a typed URL or bookmark
 * (none), or a non-browser client (no header) may read.
 */
export function isAllowedDocumentRead(request: Request): boolean {
  const site = request.headers.get('Sec-Fetch-Site');
  return site === null || site === 'same-origin' || site === 'none';
}

/**
 * State-changing requests must come from the room's own pages. SameSite cookies are not enough here:
 * example.com and room.example.com are the same site, so the exact Origin and the browser's
 * Sec-Fetch-Site header are both required.
 */
export function isSameOriginWrite(request: Request): boolean {
  const expected = new URL(request.url).origin;
  return request.headers.get('Origin') === expected && request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

/**
 * The request body as text, or null when it is larger than `max` bytes. Streams with a running count,
 * so an oversized or unbounded (chunked) body is never buffered whole.
 */
export async function readLimited(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
