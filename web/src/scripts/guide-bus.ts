// SPDX-License-Identifier: Apache-2.0
// The guide bus (plan PR 5a, shared contract): pages tell the Legallas guide what the reader just did, and the
// guide (guide.ts) reacts. One window event, 'legallas:guide', so a page never imports the guide or waits for it
// to load; a page without a guide sends into nothing. No imports, so it costs a page almost nothing to use. The page
// keys live here too, so a core page can name its guide (Room.astro's `guide`) in a room without the litigation pack,
// whose guide-copy.ts holds the words.

/** The pages that carry the guide band (Room.astro's `guide` prop). /ask has the companion itself. */
export const GUIDE_PAGES = ['overview', 'complaint', 'regulator', 'chronology', 'people', 'documents', 'binder', 'visual', 'doc', 'claims'] as const;
/** A page the guide can sit on. */
export type GuidePage = (typeof GUIDE_PAGES)[number];

/** What the reader just did. `look` carries a viewport point (clientX, clientY) to gaze toward. */
export type GuideEvent =
  | { type: 'look'; x: number; y: number }
  | { type: 'open' }
  | { type: 'cite' }
  | { type: 'gap' }
  | { type: 'error' }
  | { type: 'rest' };

/** The window event the guide listens for; its `detail` is a GuideEvent. */
export const GUIDE_EVENT = 'legallas:guide';

/** Tells the guide what happened. Safe to call before the guide loads, or on a page without one. */
export function guideSend(event: GuideEvent): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<GuideEvent>(GUIDE_EVENT, { detail: event }));
}

/** Sends `look` toward the centre of `el`, in viewport coordinates. */
export function guideLook(el: Element): void {
  const box = el.getBoundingClientRect();
  guideSend({ type: 'look', x: box.left + box.width / 2, y: box.top + box.height / 2 });
}
