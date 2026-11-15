// SPDX-License-Identifier: Apache-2.0
// Card P4 (Claims & Proof). Small DOM pieces the page's views share: cite chips, party chips with side marks,
// strength marks and the one route every cite click takes (openCite). Text only: matter strings are untrusted
// data and never reach innerHTML. CSP: no style= attributes; classes and data attributes carry every look.

import { controlPrefix, formatCite, type ProofStrength, type ServedCite, type Side } from './matter-api.ts';
import { shapeSvg } from './viz/core.ts';
import { ringSvg, STRENGTH_WORDS } from './viz/matrix.ts';
import { citeHref } from './viz/tile.ts';
import { openExhibit } from './exhibit-pane.ts';
import type { Party } from './claims-model.ts';

export { STRENGTH_WORDS };

type Attrs = Record<string, string | undefined>;

/** Creates an element with attributes and optional text, appended to a parent when one is given. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Attrs = {}, parent?: Element | null, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) if (value !== undefined) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  parent?.append(node);
  return node;
}

/**
 * Every cite on this page opens here: the exhibit pane (card F7), at the cited page, with `opener` (the chip or
 * button) marked expanded while the pane is open and focused again when it closes.
 */
export function openCite(docId: string, page: number | null, opener?: HTMLElement | null, quote?: string | null): void {
  void openExhibit({ id: docId, page, quote, opener });
}

/** The cite as the room writes it, "DOE-000412 at 3"; before a number is assigned, the page alone. */
export function citeText(cite: Pick<ServedCite, 'control' | 'page'>): string {
  const text = formatCite(controlPrefix(), cite);
  if (text) return text;
  return cite.page === null ? 'Unnumbered document' : `Unnumbered, page ${cite.page}`;
}

/** A cite chip: a real link (it works without script), whose click goes through openCite. */
export function citeChip(cite: ServedCite, parent: Element, title?: string | null): HTMLAnchorElement {
  const link = el('a', { class: 'c-cite', href: citeHref(cite) }, parent, citeText(cite));
  const note = cite.note ?? title ?? undefined;
  if (note) link.title = note;
  followWithPane(link, cite);
  return link;
}

/** Plain clicks open the cite in place; modified clicks keep the browser's own behavior (new tab, and so on). */
export function followWithPane(link: HTMLAnchorElement, cite: Pick<ServedCite, 'doc' | 'page'>): void {
  link.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openCite(cite.doc, cite.page, link);
  });
}

/** A neutral chip with the party's side shape: shape backs color, and the name stays in ink. */
export function partyChip(party: Party, parent: Element): HTMLElement {
  const chip = el('span', { class: 'c-chip claims-party', 'data-side': party.side ?? undefined }, parent);
  if (party.side) shapeSvg(party.side as Side, 12, chip);
  el('span', {}, chip, party.name);
  return chip;
}

/** The target-ring mark for a strength, decorative: the word or label beside it carries the meaning. */
export function ring(strength: ProofStrength, size: number, parent: Element): SVGSVGElement {
  return ringSvg(strength, size, parent);
}

/** A ring and its word, the "Strongest" column and the By count summary. */
export function strengthWord(strength: ProofStrength, parent: Element): HTMLElement {
  const wrap = el('span', { class: 'claims-strength', 'data-strength': strength }, parent);
  ring(strength, 16, wrap);
  el('span', {}, wrap, STRENGTH_WORDS[strength]);
  return wrap;
}
