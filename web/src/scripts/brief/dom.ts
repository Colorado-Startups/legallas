// SPDX-License-Identifier: Apache-2.0
// The complaint brief: the DOM pieces every section shares. Each section is a <section> with an h2 that states
// what it shows; running text goes through termify, so the first use on the page of each defined term
// (`meta.definedTerms`) is marked once. Text only: matter strings never reach innerHTML. CSP: no style= attributes.
import type { DefinedTerm } from '../matter-api.ts';
import { termify } from '../terms.ts';
import { el, slug } from '../track-dom.ts';

/** The defined terms that a brief's text may link to. */
export type Terms = readonly DefinedTerm[];

type Attrs = Record<string, string | undefined>;

/** An element holding `text` with its defined terms marked; never a link or a button (terms are buttons). */
export function prose<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Attrs, parent: Element, text: string, terms: Terms,
): HTMLElementTagNameMap[K] {
  const node = el(tag, attrs, parent);
  node.append(...termify(text, terms));
  return node;
}

/** One brief section: the h2 (a conclusion, or a plain label), then whatever the caller adds. */
export function briefSection(root: Element, key: string, heading: string, extra = ''): HTMLElement {
  const id = `brief-${slug(key)}`;
  const section = el('section', { class: `brief-section ${extra}`.trim(), id, 'aria-labelledby': `${id}-title` }, root);
  el('h2', { class: 't-h2 brief-section__title', id: `${id}-title` }, section, heading);
  return section;
}

/**
 * Makes a whole card open its cite: a click anywhere on it that is not on a control follows the card's cite chip
 * (which opens the exhibit pane). Keyboard users reach the chip itself, so the card adds no tab stop.
 */
export function cardOpens(card: HTMLElement, chip: HTMLAnchorElement): void {
  card.classList.add('brief-opens');
  card.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (!target || target.closest('a, button, [data-term]') || window.getSelection()?.toString()) return;
    chip.click();
  });
}
