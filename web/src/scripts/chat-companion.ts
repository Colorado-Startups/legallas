// SPDX-License-Identifier: Apache-2.0
// The Ask page's companion (card P7): the rig, driven only by real state through D3's reducer
// (companion-contract.ts) and drawn by companion-rive.ts (the stills at once, Rive on top when motion is
// allowed). The page reports events; this file keeps the model, the label under the bust, the Quiet
// switch and the gaze.
//
// Events, as the page sees them (R28, R61): typing is listening; a sent question is reading, with the
// documents count once the server reports it; streamed text is speaking; a focused or hovered cite is
// citing; the verdict settles to idle or unknown (the dontKnow flag); a failure is error.
import { INITIAL_MODEL, reduce, stateOf, type CompanionEvent, type CompanionModel, type CompanionState } from './companion-contract.ts';
import { readQuiet, writeQuiet } from './companion-quiet.ts';
import { mount, type Companion } from './companion-rive.ts';
import type { GlyphHost } from './glyph.ts';

const LABELS: Record<CompanionState, string> = {
  hello: 'Ready',
  idle: 'Ready',
  listening: 'Listening',
  reading: 'Reading',
  speaking: 'Answering',
  citing: 'Citing',
  unknown: 'Not in the record',
  error: 'No answer',
};

/** The companion's handle on the page: its phone glyph and the way to feed it events. */
export interface CompanionView {
  /** The small Legallas that stands in for the bust on a phone, for glyphWhile; null when there is none. */
  glyph: GlyphHost | null;
  /** Feeds one event to the reducer; redraws only when the model changes. */
  send(event: CompanionEvent): void;
  /** The line under the label, such as "6 documents, 11 pages". */
  note(text: string): void;
}

function wireQuiet(host: HTMLElement, bust: Companion): void {
  const toggle = host.querySelector<HTMLButtonElement>('[data-companion-quiet]');
  const apply = (quiet: boolean) => {
    toggle?.setAttribute('aria-pressed', String(quiet));
    bust.setQuiet(quiet);
  };
  apply(readQuiet());
  toggle?.addEventListener('click', () => {
    const quiet = toggle.getAttribute('aria-pressed') !== 'true';
    apply(quiet);
    writeQuiet(quiet);
  });
}

/** The gaze follows the pointer, relative to the bust; companion-rive ignores it under Quiet and reduced motion. */
function wireGaze(art: HTMLElement, bust: Companion): void {
  let frame = 0;
  let last: PointerEvent | null = null;
  document.addEventListener(
    'pointermove',
    (event) => {
      last = event;
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        if (!last) return;
        const box = art.getBoundingClientRect();
        const x = (last.clientX - (box.left + box.width / 2)) / (window.innerWidth / 2);
        const y = (last.clientY - (box.top + box.height / 3)) / (window.innerHeight / 2);
        bust.look(x, y);
      });
    },
    { passive: true },
  );
}

/**
 * Mounts the companion in the page's [data-companion] host, or returns a no-op view when there is none.
 * The bust mounts only once its box is shown: on a phone the small Legallas stands in, and Rive is not fetched.
 */
export function companionView(host: HTMLElement | null): CompanionView {
  const art = host?.querySelector<HTMLElement>('[data-companion-art]');
  if (!host || !art) return { glyph: null, send() {}, note() {} };
  const label = host.querySelector('[data-companion-state]');
  const line = host.querySelector('[data-companion-note]');
  let bust: Companion | null = null;
  let model: CompanionModel = INITIAL_MODEL;
  const draw = () => {
    const state = stateOf(model);
    host.dataset.state = state;
    bust?.setState(state);
    bust?.setDocs(model.docs);
    if (label) label.textContent = LABELS[state];
  };
  const shown = () => {
    if (bust || art.getClientRects().length === 0) return;
    bust = mount(art);
    wireQuiet(host, bust);
    wireGaze(art, bust);
    draw();
  };
  new ResizeObserver(shown).observe(art);
  shown();
  draw();
  return {
    glyph: host.querySelector<HTMLElement>('[data-companion-glyph]'),
    send(event) {
      const next = reduce(model, event);
      if (next === model) return;
      model = next;
      draw();
    },
    note(text) {
      if (line) line.textContent = text;
    },
  };
}
