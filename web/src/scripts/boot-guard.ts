// SPDX-License-Identifier: Apache-2.0
// The room's boot guard: the first script on every room page (Room.astro puts it in <head>). A deploy replaces the
// build's hashed chunks all at once, and for the minute or so it takes to reach every edge, a page's HTML can come
// from one build and a chunk from the other. The chunk is then missing, the browser never runs the page's script,
// and the page would sit on its Loading line with no code left to notice. The guard notices: it reloads the page
// once, which fetches one build whole, and if the page fails again soon after, it shows the page's own error line
// ("did not load; reload the page to try again") instead of reloading again.
//
// It imports nothing at run time, so its file keeps the same hashed name from build to build and is there in both.
// Pages opt in to the error line with two hooks: [data-load-pending] on the Loading line, [data-load-failed] on the
// error block. Giving up also ends every [aria-busy="true"] region, so a screen reader reads the error and a height
// held for the filled page (the Overview's header) is let go. A chunk that fails after the page has left its Loading
// line is a lazy section's, which already says it could not load (whenNear in track-dom.ts); the guard leaves it
// alone.
import type { GuideEvent } from './guide-bus.ts';

/** The room's stored name as a literal (worker/stored-name.ts): the minified key stays one, and a stored key can be read. */
declare const ROOM_STORED_NAME: string | undefined;

/** The guide's window event (guide-bus.ts GUIDE_EVENT), written out so the guard imports nothing at run time. */
export const GUIDE_EVENT = 'legallas:guide';

/** sessionStorage key holding the time (ms) of the guard's last reload in this tab. */
export const RELOAD_KEY = `${typeof ROOM_STORED_NAME === 'string' ? ROOM_STORED_NAME : 'legallas'}:boot-reload`;

/** A second failure within this long of a reload shows the error line instead of reloading again. */
export const RELOAD_WINDOW_MS = 60_000;

/** sessionStorage, or what a test passes. Either call may throw: storage blocked, full, or switched off. */
export type ReloadStore = Pick<Storage, 'getItem' | 'setItem'>;

/** An element the guard shows, hides or marks no longer busy. */
export interface LoadHook {
  hidden: boolean;
  setAttribute?(name: string, value: string): void;
}

/** The few DOM calls the guard makes, so tests can pass a stand-in for document. */
export interface LoadHooks {
  querySelectorAll(selectors: string): Iterable<LoadHook>;
}

/** True for one of this build's own module scripts: a <script> served from /_astro/ on this origin. */
export function isBuildScript(target: unknown, origin: string): boolean {
  const el = target as { tagName?: unknown; src?: unknown } | null;
  if (!el || el.tagName !== 'SCRIPT' || typeof el.src !== 'string' || !el.src) return false;
  try {
    const url = new URL(el.src);
    return url.origin === origin && url.pathname.startsWith('/_astro/');
  } catch {
    return false;
  }
}

/** True while the page still shows a Loading line it declared with [data-load-pending]. */
export function stillLoading(doc: LoadHooks): boolean {
  for (const el of doc.querySelectorAll('[data-load-pending]')) if (!el.hidden) return true;
  return false;
}

/**
 * Trades the Loading line for the page's error block, and ends the page's busy regions. Does nothing (false) on a
 * page past its Loading line or with no hooks: a page that drew itself is never covered by an error.
 */
export function showLoadFailed(doc: LoadHooks): boolean {
  if (!stillLoading(doc)) return false;
  for (const el of doc.querySelectorAll('[data-load-pending]')) el.hidden = true;
  for (const el of doc.querySelectorAll('[data-load-failed]')) el.hidden = false;
  for (const el of doc.querySelectorAll('[aria-busy="true"]')) el.setAttribute?.('aria-busy', 'false');
  return true;
}

/**
 * Whether the guard may reload the page now, given the tab's storage and the time. When it says yes, it records
 * `now` under RELOAD_KEY first, so that the reloaded page, failing again, can tell it was already reloaded. Without
 * working storage it never reloads (nothing could stop a loop); a time it cannot read, or one ahead of `now` (the
 * clock moved back), counts as a reload just made. A window rather than once per tab: a room left open for days
 * can still heal itself after a later deploy.
 */
export function reloadOnce(store: ReloadStore | null, now: number): boolean {
  if (!store) return false;
  try {
    const last = store.getItem(RELOAD_KEY);
    if (last !== null) {
      const at = /^\d{1,15}$/.test(last) ? Number(last) : Number.NaN;
      if (!(at <= now) || now - at < RELOAD_WINDOW_MS) return false;
    }
    // Written before the reload: if the write fails, the reloaded page could not tell, so there is no reload.
    store.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

let settled = false;

/** One failure is enough: reload, or give up and show the error line. Later failures on the same page are ignored. */
function recover(): void {
  if (settled) return;
  settled = true;
  let store: ReloadStore | null = null;
  try {
    store = window.sessionStorage;
  } catch {
    // Storage switched off: reloadOnce gets null.
  }
  if (reloadOnce(store, Date.now())) {
    window.location.reload();
    return;
  }
  if (showLoadFailed(document)) {
    window.dispatchEvent(new CustomEvent<GuideEvent>(GUIDE_EVENT, { detail: { type: 'error' } }));
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // Capture: a script's load error does not bubble, but it does pass through window on its way to the script.
  window.addEventListener('error', (event) => {
    if (isBuildScript(event.target, window.location.origin)) recover();
  }, true);
}
