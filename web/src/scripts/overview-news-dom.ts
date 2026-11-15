// SPDX-License-Identifier: Apache-2.0
// Card P1a: small DOM builders for the Overview news. Everything is built with createElement and textContent:
// no innerHTML, no style attributes (CSP). Document and cite links open in the exhibit pane (exhibit-pane.ts).
import { docHref } from './files-api.ts';
import { controlPrefix, formatCite, formatControl, type ServedCite } from './doc-facts.ts';

type Attrs = Record<string, string | undefined>;

/** An element with a class, attributes and children (strings become text nodes). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  children: (Node | string | null | undefined | false)[] = [],
  attrs: Attrs = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [name, value] of Object.entries(attrs)) if (value !== undefined) node.setAttribute(name, value);
  for (const child of children) if (child) node.append(child);
  return node;
}

/**
 * A link to a document (at a page) that opens in F7's exhibit pane: overview-news.ts calls initExhibitLinks() once,
 * and the pane takes plain clicks on a[data-exhibit] (R66). A modified click still opens /doc/ in a new tab.
 */
export function docLink(docId: string, page: number | null, className: string, children: (Node | string)[]): HTMLAnchorElement {
  return el('a', className, children, { href: docHref(docId, page), 'data-exhibit': '' });
}

/** A cite chip, "DOE-000014 at 2"; null when the document has no number yet. The cite's note is its title (R33). */
export function citeChip(cite: Pick<ServedCite, 'doc' | 'page' | 'control' | 'note'>): HTMLAnchorElement | null {
  const label = formatCite(controlPrefix(), cite);
  if (!label) return null;
  const chip = docLink(cite.doc, cite.page, 'c-cite', [label]);
  if (cite.note) chip.title = cite.note;
  return chip;
}

/** "DOE-000611" in mono, or nothing before the document is numbered. */
export function controlText(seq: number | null): HTMLElement | null {
  const text = formatControl(controlPrefix(), seq);
  return text ? el('span', 'u-mono ov-control', [text]) : null;
}

const SVG = 'http://www.w3.org/2000/svg';

/** The Key target badge (two rings and a core, one ink). Decorative: the card's text says "Key". */
export function keyBadge(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'ov-badge');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [r, fill] of [['6.5', 'none'], ['3.75', 'none'], ['1.5', 'currentColor']] as const) {
    const ring = document.createElementNS(SVG, 'circle');
    ring.setAttribute('cx', '8');
    ring.setAttribute('cy', '8');
    ring.setAttribute('r', r);
    ring.setAttribute('fill', fill);
    ring.setAttribute('stroke', 'currentColor');
    ring.setAttribute('stroke-width', fill === 'none' ? '1.25' : '0');
    svg.append(ring);
  }
  return svg;
}

/** Replaces a list's contents with one sentence (an empty state or an error). */
export function sayInstead(target: Element, sentence: string): void {
  target.replaceChildren(el('p', 'ov-empty', [sentence]));
}
