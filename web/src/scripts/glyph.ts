// SPDX-License-Identifier: Apache-2.0
// Card F8 (R68), plan PR-L2. The small Legallas: the rig's round head-and-shoulders miniature
// (LegallasGlyph.astro) that shows what the room is doing. It changes only on real state: working while a
// request is in flight, done when it lands, error when it fails, idle otherwise. glyph.css shows the
// state on the ring (and pulses it while working); this file never runs a timer for the animation.
//
// This file is the browser half, small on purpose: setGlyph, glyphWhile and headerGlyph for any script
// that starts real work.

/** The states the small glyph can show. */
export const GLYPH_STATES = ['idle', 'working', 'done', 'error'] as const;

/** The sizes the miniature is shown at, in CSS pixels (LegallasGlyph.astro refuses any other). */
export const GLYPH_SIZES = [16, 20, 24, 32, 40] as const;
/** One of the sizes the glyph is shown at. */
export type GlyphSize = (typeof GLYPH_SIZES)[number];
/** One of the states the glyph can show. */
export type GlyphState = (typeof GLYPH_STATES)[number];

/** How long "done" shows before the glyph settles back to idle. Error stays until the next request. */
export const DONE_HOLD_MS = 2400;

/** Whether a value is one of the glyph states. */
export function isGlyphState(value: unknown): value is GlyphState {
  return typeof value === 'string' && (GLYPH_STATES as readonly string[]).includes(value);
}

/** The parts of an element setGlyph touches, so node:test can drive it without a DOM. */
export interface GlyphHost {
  dataset: DOMStringMap;
  hasAttribute(name: string): boolean;
  querySelector(selectors: string): GlyphHost | null;
}

const settle = new WeakMap<GlyphHost, ReturnType<typeof setTimeout>>();

function glyphIn(host: GlyphHost | null): GlyphHost | null {
  if (!host) return null;
  return host.hasAttribute('data-glyph') ? host : host.querySelector('[data-glyph]');
}

/**
 * Sets a glyph's state. `el` is the glyph itself or anything that holds one (the header's
 * [data-glyph-slot]). Unknown states are refused. "done" settles back to idle after DONE_HOLD_MS
 * unless something else sets the glyph first.
 */
export function setGlyph(el: GlyphHost | null, state: GlyphState): boolean {
  const glyph = glyphIn(el);
  if (!glyph || !isGlyphState(state)) return false;
  clearTimeout(settle.get(glyph));
  settle.delete(glyph);
  glyph.dataset.state = state;
  if (state === 'done') {
    settle.set(
      glyph,
      setTimeout(() => {
        settle.delete(glyph);
        glyph.dataset.state = 'idle';
      }, DONE_HOLD_MS),
    );
  }
  return true;
}

/** Shows working while `work` runs, then done or error. Returns `work` unchanged, so callers can await it. */
export function glyphWhile<T>(el: GlyphHost | null, work: Promise<T>): Promise<T> {
  setGlyph(el, 'working');
  work.then(
    () => setGlyph(el, 'done'),
    () => setGlyph(el, 'error'),
  );
  return work;
}

/** The glyph in the header's Ask button, for scripts that start work from anywhere in the room. */
export function headerGlyph(): GlyphHost | null {
  return glyphIn(document.querySelector<HTMLElement>('[data-glyph-slot]'));
}
