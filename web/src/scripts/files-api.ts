// SPDX-License-Identifier: Apache-2.0
// The files API as the room's pages see it: response shapes for /api/documents, /api/doc/:id and
// /api/uploads, plus small fetch helpers. Shapes mirror worker/files-catalog.ts and worker/routes/files.ts.
import { normalizeQuote } from './files-format.ts';
import { toVisit, type Visit } from './overview-news-visit.ts';
import { ROOM_FETCH_HEADERS, showSessionEnded } from './session-ended.ts';

/** One document in a folder listing. */
export interface ListedDocument {
  id: string;
  name: string;
  kind: string;
  size: number;
  pages: number | null;
  updated_at: string;
  source: 'mirror' | 'counsel';
  /**
   * Permanent document number (format with formatControl in matter-api.ts); null before a sync numbers it.
   * The three document-number fields are optional so older fixtures still type-check; the server always sends them.
   */
  control_seq?: number | null;
  /** When and by whom the document was marked Key; both null when it is not Key. */
  key_at?: string | null;
  key_by?: string | null;
}

/** One folder of the listing tree, with its path, name and guide document. */
export interface FolderNode {
  path: string;
  name: string;
  guide: ListedDocument | null;
  files: ListedDocument[];
  folders: FolderNode[];
  count: number;
  size: number;
}

/** The viewer a document opens in. */
export type Viewer = 'pdf' | 'image' | 'markdown' | 'csv' | 'text' | 'visual' | 'download';

/** A document's metadata as the room serves it. */
export interface DocMeta {
  id: string;
  name: string;
  folder: string;
  kind: string;
  content_type: string;
  size: number;
  pages: number | null;
  updated_at: string;
  source: 'mirror' | 'counsel';
  uploaded_by: string | null;
  uploader_name: string | null;
  /** As on ListedDocument. */
  control_seq?: number | null;
  key_at?: string | null;
  key_by?: string | null;
  viewer: Viewer;
}

/** One file a counsel member uploaded. */
export interface CounselUpload {
  id: string;
  name: string;
  kind: string;
  size: number;
  uploaded_at: string;
  uploaded_by: string | null;
  uploader_name: string | null;
  pulled: boolean;
}

/** The result of a fetch: the value, or the HTTP status that failed. */
export type Loaded<T> = { ok: true; value: T } | { ok: false; status: number };

/** How long a room API request may take, body included, before it counts as failed (as fetchMatter's). */
export const FETCH_TIMEOUT_MS = 30_000;

/**
 * GET a room API as JSON. Never throws: a refusal is its status, a network failure or a request that stalls past
 * FETCH_TIMEOUT_MS is status 0, so no page waits on its Loading line for ever. A caller's own signal replaces it.
 * A 401 means the sign-in ended: the page shows its "Your session ended" notice (session-ended.ts).
 */
export async function getJson<T>(url: string, init?: RequestInit): Promise<Loaded<T>> {
  try {
    const response = await fetch(url, {
      credentials: 'same-origin', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: ROOM_FETCH_HEADERS, ...init,
    });
    if (response.status === 401) showSessionEnded();
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, value: (await response.json()) as T };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Where a document opens. `page` adds a #page=N deep link; `quote` adds &q=<passage> to highlight it. */
export function docHref(id: string, page?: number | null, quote?: string | null): string {
  const hash = page ? `#page=${page}` : '';
  const q = quote ? normalizeQuote(quote) : '';
  return `/doc/?id=${encodeURIComponent(id)}${hash}${hash && q ? `&q=${encodeURIComponent(q)}` : ''}`;
}

/** The page number in a #page=N hash (as in AI citations), or null. */
export function pageFromHash(hash: string): number | null {
  const match = /(?:^#|&)page=(\d{1,6})(?:&|$)/.exec(hash);
  const page = match ? Number(match[1]) : NaN;
  return Number.isInteger(page) && page > 0 ? page : null;
}

/** The passage in a #page=N&q=<passage> hash, normalized, or null when there is none (or it is malformed). */
export function quoteFromHash(hash: string): string | null {
  const match = /(?:^#|&)q=([^&]*)/.exec(hash);
  if (!match) return null;
  try {
    return normalizeQuote(decodeURIComponent(match[1]!)) || null;
  } catch {
    return null;
  }
}

/** A document and where in it to open: the page and the passage to highlight. */
export interface DocTarget {
  id: string;
  page: number | null;
  quote: string | null;
}

/** Reads a /doc/ link (a cite chip's href) back into its target. Null for any other link. */
export function docTarget(href: string, base = 'https://room.invalid/'): DocTarget | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  const id = url.searchParams.get('id');
  if (url.pathname !== '/doc/' || !id) return null;
  return { id, page: pageFromHash(url.hash), quote: quoteFromHash(url.hash) };
}

/** The bytes, for the room's own viewers: inline, and audited as one `view` with /api/doc/:id (auditOnce dedupes). */
export function fileUrl(id: string): string {
  return `/files/${encodeURIComponent(id)}`;
}

/** An explicit download: an attachment and one `download` audit row. */
export function downloadUrl(id: string): string {
  return `${fileUrl(id)}?download=1`;
}

/** Where a folder opens: its place in the Documents index (the hash is the folder path). */
export function folderHref(path: string): string {
  return `/documents/#${encodeURIComponent(path)}`;
}

/** The data-room index as a CSV download (worker/export.ts INDEX_CSV_PATH); one `download` audit row each. */
export const INDEX_CSV_URL = '/api/documents/index.csv';

/** How long POST /api/seen may take before the browser's copy of the visit stands in: one small D1 write. */
export const SEEN_TIMEOUT_MS = 5_000;

/**
 * Records this page load and returns the member's visit as the room keeps it (POST /api/seen, worker/seen.ts). Never
 * throws: null when the room cannot say (before migration 0008, a failure, a stall past SEEN_TIMEOUT_MS), and the
 * page falls back to the browser's copy (overview-news-seen.ts).
 */
export async function postSeen(): Promise<Visit | null> {
  try {
    const response = await fetch('/api/seen', {
      method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(SEEN_TIMEOUT_MS), headers: ROOM_FETCH_HEADERS,
    });
    if (response.status === 401) showSessionEnded();
    if (!response.ok) return null;
    return toVisit(await response.json());
  } catch {
    return null;
  }
}

/** A document's Key mark: its id, whether it is marked, and when. */
export interface KeyState {
  id: string;
  key: boolean;
  key_at: string | null;
  key_by: string | null;
}

/** Marks (`on`) or clears a document's Key flag: POST /api/documents/:id/key (R35). */
export async function setKey(id: string, on: boolean): Promise<Loaded<KeyState>> {
  try {
    const response = await fetch(`/api/documents/${encodeURIComponent(id)}/key`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: on }),
    });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, value: (await response.json()) as KeyState };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Text read up to a size cap, with a flag for a file that was longer. */
export interface CappedText {
  text: string;
  /** True when the file is longer than what was read. */
  truncated: boolean;
}

/**
 * The first `maxBytes` of a text file, by a Range request, so a huge log never loads whole. A cut
 * multi-byte character at the end is dropped rather than shown as a replacement mark.
 */
export async function fetchTextCapped(id: string, maxBytes: number): Promise<CappedText> {
  const response = await fetch(fileUrl(id), { credentials: 'same-origin', headers: { Range: `bytes=0-${maxBytes - 1}` } });
  // No byte range of an empty file exists, so the server says 416: that is an empty file, not an error.
  if (response.status === 416) return { text: '', truncated: false };
  if (!response.ok) throw new Error(`files ${response.status}`);
  const total = Number(/\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '')?.[1] ?? NaN);
  const truncated = response.status === 206 && Number.isFinite(total) && total > maxBytes;
  let text = new TextDecoder().decode(await response.arrayBuffer());
  if (truncated) text = text.replace(/�+$/, '');
  return { text, truncated };
}
