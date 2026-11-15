// SPDX-License-Identifier: Apache-2.0
// Document facts as the room's pages see them, and the two formatters every page shares. GET /api/matter serves each
// live document's date, type, parties and privilege with its control number, and the people and organizations those
// parties name; the route is the litigation pack's (worker/routes/matter.ts), so a room without the pack answers 404
// and its pages list documents without facts. This is the single home for control numbers ("DOE-000412") and prose
// dates ("Oct. 17, 2023"); pages never format either themselves. The pack's pages read the rest of the manifest
// through matter-api.ts.
import type { PartialDate, ServedCite, ServedMatter } from '../../worker/matter-types.ts';
import { CONTROL_PREFIX_FALLBACK } from './control-prefix.ts';
import { isCompanyRoom } from './room-shape.ts';
import { ROOM_FETCH_HEADERS, SessionEndedError, showSessionEnded } from './session-ended.ts';

export type { PartialDate, ServedCite, ServedDocFacts, ServedMatter, Side } from '../../worker/matter-types.ts';

/** How long GET /api/matter may take, body included, before the page gives up and shows its error line. */
export const MATTER_TIMEOUT_MS = 30_000;

/**
 * The matter, or null when none has been published yet (the page shows its empty state). A request that stalls
 * rejects after MATTER_TIMEOUT_MS, so no page waits on its Loading line for ever; a caller's own signal replaces it.
 * An ended sign-in (401, session-ended.ts) shows the page's "Your session ended" notice and rejects.
 */
export async function fetchMatter(init?: RequestInit): Promise<ServedMatter | null> {
  if (isCompanyRoom()) return null;
  const res = await fetch('/api/matter', {
    credentials: 'same-origin', signal: AbortSignal.timeout(MATTER_TIMEOUT_MS), headers: ROOM_FETCH_HEADERS, ...init,
  });
  if (res.status === 401) {
    showSessionEnded();
    throw new SessionEndedError('matter');
  }
  if (res.status === 404 || !res.ok) {
    // Nothing reads this body, so it is closed, not left open for the browser to wait on (#274).
    await res.body?.cancel().catch(() => undefined);
    if (res.status === 404) return null;
    throw new Error(`matter: ${res.status}`);
  }
  return (await res.json()) as ServedMatter;
}

let shared: Promise<ServedMatter | null> | null = null;

/**
 * The page's one GET /api/matter, shared by every script that draws from it (#274): the first caller sends it, the
 * rest wait on the same answer. A failed request is forgotten, so a later caller may try again. Callers treat the
 * answer as read-only, since every script on the page holds the same object.
 */
export function pageMatter(): Promise<ServedMatter | null> {
  shared ??= fetchMatter().catch((error: unknown) => {
    shared = null;
    throw error;
  });
  return shared;
}

/** The control-number prefix Room.astro sets on <html data-control-prefix>; the fallback outside the room. */
export function controlPrefix(root: { dataset: DOMStringMap } | undefined = globalThis.document?.documentElement): string {
  const prefix = root?.dataset.controlPrefix ?? '';
  return /^[A-Z]{2,6}$/.test(prefix) ? prefix : CONTROL_PREFIX_FALLBACK;
}

/** "DOE-000412". '' when the document has no number yet (before migration 0003 or the next sync). */
export function formatControl(prefix: string, seq: number | null | undefined): string {
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) return '';
  return `${prefix}-${String(seq).padStart(6, '0')}`;
}

/** "DOE-000412 at 3", the room's cite form; just the number for a whole-file cite. '' without a number. */
export function formatCite(prefix: string, cite: Pick<ServedCite, 'control' | 'page'>): string {
  const control = formatControl(prefix, cite.control);
  if (!control) return '';
  return cite.page === null ? control : `${control} at ${cite.page}`;
}

/** Bluebook month abbreviations (T12): May, June and July are written out. */
const MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'] as const;
const PARTIAL = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/** Prose dates: "2023-10-17" is "Oct. 17, 2023", "2023-10" is "Oct. 2023", "2023" is "2023". '' if malformed. */
export function formatPartialDate(date: PartialDate | null | undefined): string {
  const match = date ? PARTIAL.exec(date) : null;
  if (!match) return '';
  const [, year, month, day] = match;
  if (month === undefined) return year!;
  const name = MONTHS[Number(month) - 1];
  if (!name) return '';
  if (day === undefined) return `${name} ${year}`;
  const d = Number(day);
  return d >= 1 && d <= 31 ? `${name} ${d}, ${year}` : '';
}
