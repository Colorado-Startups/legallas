// SPDX-License-Identifier: Apache-2.0
// Defined terms in text the client renders (DESIGN.md sections 7 and 9). The matching rules are terms-model.ts;
// this file builds the c-term elements with DOM calls only (never innerHTML) and wires their popovers.

import { wireTerms } from './terms-popover.ts';
import { findTerms, indexTerms, type TermDef, type TermIndex } from './terms-model.ts';

export type { TermDef } from './terms-model.ts';

/** The terms already marked in one scope. Each page has one (pageTermScope); a test or a detached view may pass its own. */
export interface TermScope {
  seen: Set<string>;
}

let pageScope: TermScope | null = null;
let serial = 0;
const indexes = new WeakMap<readonly TermDef[], TermIndex>();

/** Elements whose text is never searched: links (cite chips are links), controls, code and terms already marked. */
const SKIP = 'a, button, input, select, textarea, label, code, kbd, pre, script, style, svg, [data-term], [data-no-terms]';

/** The page's scope, seeded with the terms already marked on the page, so each shows once. */
export function pageTermScope(): TermScope {
  if (!pageScope) {
    pageScope = { seen: new Set() };
    for (const node of document.querySelectorAll<HTMLElement>('[data-term]')) {
      if (node.dataset.term) pageScope.seen.add(node.dataset.term);
    }
  }
  return pageScope;
}

function indexFor(terms: readonly TermDef[]): TermIndex {
  let index = indexes.get(terms);
  if (!index) {
    index = indexTerms(terms);
    indexes.set(terms, index);
  }
  return index;
}

/** One c-term: the word as the text says it, and its definition as the button's description and popover. */
export function termElement(text: string, def: TermDef): HTMLElement {
  serial += 1;
  const id = `term-c-${serial}`;
  const root = document.createElement('span');
  root.className = 'c-term';
  root.dataset.term = def.term;
  const word = document.createElement('button');
  word.type = 'button';
  word.className = 'c-term__word';
  word.dataset.termWord = '';
  word.setAttribute('aria-describedby', id);
  word.textContent = text;
  const pop = document.createElement('span');
  pop.className = 'c-term__pop';
  pop.id = id;
  pop.setAttribute('role', 'tooltip');
  pop.dataset.termPop = '';
  pop.hidden = true;
  pop.textContent = def.means;
  root.append(word, pop);
  return root;
}

/**
 * Stable API (W3 and later pages): `text` as DOM nodes, with the first use on the page of each defined term
 * (`matter.meta.definedTerms`) as a c-term and every later use plain. Append the result to an element that is
 * not a link or a button. Longest term first, whole words only, abbreviations exact, never inside a cite such as
 * "DOE-000412 at 3". Pass `scope` only to count first uses apart from the page's.
 */
export function termify(text: string, definedTerms: readonly TermDef[], scope: TermScope = pageTermScope()): Node[] {
  const matches = findTerms(text, indexFor(definedTerms), scope.seen);
  if (matches.length === 0) return text ? [document.createTextNode(text)] : [];
  wireTerms();
  const nodes: Node[] = [];
  let at = 0;
  for (const match of matches) {
    if (match.start > at) nodes.push(document.createTextNode(text.slice(at, match.start)));
    nodes.push(termElement(match.text, match.term));
    at = match.end;
  }
  if (at < text.length) nodes.push(document.createTextNode(text.slice(at)));
  return nodes;
}

/**
 * Marks defined terms in the text already inside `root`, in reading order, leaving links (and so cite chips),
 * controls and code alone. For prose built elsewhere; text built here should go through termify.
 */
export function termifyIn(root: Element, definedTerms: readonly TermDef[], scope: TermScope = pageTermScope()): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
  for (const node of texts) {
    const nodes = termify(node.data, definedTerms, scope);
    if (nodes.length > 1 || (nodes[0] && nodes[0].nodeType !== Node.TEXT_NODE)) node.replaceWith(...nodes);
  }
}
