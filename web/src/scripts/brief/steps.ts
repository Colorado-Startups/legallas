// SPDX-License-Identifier: Apache-2.0
// The complaint brief, the dated steps: a labelled horizontal timeline, one column per step in story order, each
// with its number on the rule, its ISO date, the step as a sentence, why it matters (`note`) and one cite. Steps
// are evenly spaced (the dates say when; spacing by time would crowd the early steps). Below 48rem it runs down
// the page. The structure picture lives on /people/; the control panels sit in their own section.
import { guideLook } from '../guide-bus.ts';
import { citeChip, el } from '../track-dom.ts';
import type { StepItem } from './model.ts';
import { prose, type Terms } from './dom.ts';

/** Draws the steps as an ordered list into `parent`; `label` names the list ("Steps of C"). */
export function renderSteps(parent: Element, steps: readonly StepItem[], label: string, terms: Terms): HTMLOListElement {
  const list = el('ol', { class: 'brief-steps', 'aria-label': label }, parent);
  list.style.setProperty('--steps', String(Math.min(steps.length, 6)));
  for (const step of steps) {
    const item = el('li', { class: 'brief-step' }, list);
    el('span', { class: 'brief-step__n', 'aria-hidden': 'true' }, item, String(step.n));
    if (step.iso) el('time', { class: 'brief-step__date t-mono', datetime: step.iso }, item, step.iso);
    prose('p', { class: 'brief-step__label' }, item, step.label, terms);
    if (step.note) prose('p', { class: 'brief-step__note' }, item, step.note, terms);
    if (step.cite) citeChip(step.cite, el('p', { class: 'brief-step__cite' }, item));
    item.addEventListener('pointerenter', () => guideLook(item));
    item.addEventListener('focusin', () => guideLook(item));
  }
  return list;
}
