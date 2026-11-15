// SPDX-License-Identifier: Apache-2.0
// The complaint brief, who held what: the control panels (track-control.ts, viz/control.ts) at two moments, what
// the client was told and what was filed (the violation's contrast dates), else the first step and the last. A
// two-tab switch picks the moment (arrows move, Home and End jump); over the picture, the step it shows and who
// ran its entities at that date per the record. The drawing loads on demand (R20).
import { guideSend } from '../guide-bus.ts';
import { mountControl } from '../track-control.ts';
import { el, partyChip, slug } from '../track-dom.ts';
import { controlInputs, stepKey, type TrackMatter, type TrackViolation } from '../track-model.ts';
import { controllersFor, controlModel } from '../viz/control-layout.ts';
import { beforeAfter, partyOf } from './model.ts';

/** Draws the switch and the panels into `parent`; false (and nothing drawn) when the story has under two steps. */
export function renderOwnership(parent: Element, v: TrackViolation, matter: TrackMatter): boolean {
  const choices = beforeAfter(v);
  if (!choices) return false;
  const id = slug(v.id);
  const bar = el('div', { class: 'brief-own__switch', role: 'tablist', 'aria-label': `Moment shown for ${v.mark}` }, parent);
  const panel = el('div', { class: 'brief-own__panel', role: 'tabpanel', id: `brief-own-${id}-panel`, tabindex: '0' }, parent);
  const where = el('p', { class: 'brief-own__step' }, panel);
  const run = el('p', { class: 'brief-own__run' }, panel);
  const { parties, links } = controlInputs(matter);
  const model = controlModel(v, parties, links);
  const picture = mountControl(el('div', { class: 'track-control-mount' }, panel), model, v.steps, `Who held or ran what: ${v.mark}`);
  const tabs = choices.map((choice, i) => el('button', {
    type: 'button', role: 'tab', class: 'brief-own__tab c-select', id: `brief-own-${id}-${i}`, 'aria-controls': panel.id,
  }, bar, choice.label));
  const select = (i: number, focus: boolean) => {
    const index = choices[i]!.index; // safe: i is a choice index
    const step = v.steps[index]!; // safe: beforeAfter returns step indices
    tabs.forEach((tab, j) => {
      tab.setAttribute('aria-selected', String(j === i));
      tab.tabIndex = j === i ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', tabs[i]!.id); // safe: one tab per choice
    where.textContent = `Step ${index + 1} of ${v.steps.length}: ${step.label}`;
    run.replaceChildren();
    el('span', { class: 't-label brief-own__label' }, run, 'Run by, per the record');
    const people = controllersFor(model, index, step).flatMap((pid) => partyOf(matter, pid) ?? []);
    if (people.length === 0) el('span', { class: 'brief-own__none' }, run, 'No one is tied to these entities in the record at this date.');
    for (const person of people) partyChip(person.name, person.side, run);
    picture.show(index);
    if (focus) tabs[i]!.focus(); // safe: as above
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => {
      select(i, false);
      guideSend({ type: 'open' });
    });
    tab.addEventListener('keydown', (event) => {
      const to = stepKey(event.key, i, tabs.length);
      if (to === null) return;
      event.preventDefault();
      if (to !== i) select(to, true);
    });
  });
  select(0, false);
  return true;
}
