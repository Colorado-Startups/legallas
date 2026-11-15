// SPDX-License-Identifier: Apache-2.0
// The c-term popover (DESIGN.md section 7): a defined term's dotted word opens its definition on hover, focus and
// tap, and closes on Escape, on blur and on a tap elsewhere. One listener set per document, so terms termify adds
// later behave the same. One popover is open at a time.
//
// Markup, as termify builds it (script hooks are data-* attributes; classes are for style only):
//   <span class="c-term" data-term="CRG">
//     <button type="button" class="c-term__word" data-term-word aria-describedby="term-c-1">CRG</button>
//     <span class="c-term__pop" id="term-c-1" role="tooltip" data-term-pop hidden>Copperline Restaurant Group, Inc.</span>
//   </span>
// The button's description is the definition, so a screen reader hears it on focus without opening anything.

/** Keeps the popover this far inside the viewport's edges, in CSS pixels. */
const EDGE = 8;

let wired = false;
let open: HTMLElement | null = null;
/** Opened by a click or tap: stays open when the pointer leaves, until a second tap, Escape, blur or a tap elsewhere. */
let pinned = false;

function termOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-term]') : null;
}

function popOf(term: HTMLElement): HTMLElement | null {
  return term.querySelector<HTMLElement>('[data-term-pop]');
}

/** Shifts the popover back inside the viewport, and above the word when there is no room below. */
function place(term: HTMLElement, pop: HTMLElement): void {
  pop.style.setProperty('--term-shift', '0px');
  delete pop.dataset.place;
  const box = pop.getBoundingClientRect();
  const width = document.documentElement.clientWidth;
  const over = box.right - (width - EDGE);
  const under = EDGE - box.left;
  if (over > 0) pop.style.setProperty('--term-shift', `${-Math.min(over, box.left - EDGE)}px`);
  else if (under > 0) pop.style.setProperty('--term-shift', `${under}px`);
  if (box.bottom > window.innerHeight - EDGE && term.getBoundingClientRect().top > box.height + EDGE) pop.dataset.place = 'above';
}

function hide(): void {
  if (!open) return;
  const pop = popOf(open);
  if (pop) pop.hidden = true;
  delete open.dataset.state;
  open = null;
  pinned = false;
}

function show(term: HTMLElement, pin: boolean): void {
  const pop = popOf(term);
  if (!pop) return;
  if (open !== term) {
    hide();
    pop.hidden = false;
    term.dataset.state = 'open';
    open = term;
    place(term, pop);
  }
  pinned = pinned || pin;
}

function onPointerOver(event: PointerEvent): void {
  if (event.pointerType === 'touch') return; // a tap arrives as a click
  const term = termOf(event.target);
  if (term) show(term, false);
}

function onPointerOut(event: PointerEvent): void {
  if (!open || pinned || event.pointerType === 'touch') return;
  if (termOf(event.target) !== open || open.contains(event.relatedTarget as Node | null)) return;
  if (!open.contains(document.activeElement)) hide();
}

function onFocusIn(event: FocusEvent): void {
  const term = termOf(event.target);
  if (term && event.target instanceof Element && event.target.matches('[data-term-word]')) show(term, false);
}

function onFocusOut(event: FocusEvent): void {
  if (open && termOf(event.target) === open && !open.contains(event.relatedTarget as Node | null)) hide();
}

function onClick(event: MouseEvent): void {
  const term = termOf(event.target);
  if (!term) {
    hide();
    return;
  }
  if (!(event.target instanceof Element) || !event.target.closest('[data-term-word]')) return;
  if (open === term && pinned) hide();
  else show(term, true);
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !open) return;
  // First Escape closes the definition only, not the drawer or pane the term sits in.
  event.stopPropagation();
  hide();
}

/** Listens for every term on the page, now and later. Safe to call more than once. */
export function wireTerms(): void {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  document.addEventListener('pointerover', onPointerOver);
  document.addEventListener('pointerout', onPointerOut);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  document.addEventListener('click', onClick);
  window.addEventListener('keydown', onKeyDown, true);
}
