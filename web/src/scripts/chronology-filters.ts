// SPDX-License-Identifier: Apache-2.0
// Card P2 (Chronology page). The filters. Above the row, always in view: one chip per violation plus All (one at a
// time), and the Litigation chip, off until the reader asks for the case's own filings, pleadings, orders and
// service. The row: a person select, kind toggles (every other kind on until the reader turns one off), a
// partial-date range, and Clear filters. On phones the row folds behind a Filters button that shows how many of
// its filters are set. Every filter that is set also shows as a removable chip above the timeline (the People
// page's ?p= and a ?v= deep link among them). The filters report their state; chronology.ts applies it.
import type { EventType, ServedMatter } from './matter-api.ts';
import {
  activeChips, activeFilterCount, EMPTY_FILTERS, litigationCount, personOptions, radioStep, toggleKinds, validFilterDate,
  violationOptions, type ChronMatter, type FilterFacet, type FilterNames, type FilterState, type ViolationOption,
} from './chronology-model.ts';
import { TYPE_NAMES } from './viz/timeline-model.ts';
import { clear, html, shapeIcon, svg } from './viz/timeline-svg.ts';

/** The controls of one filter row: read its state and clear it. */
export interface FilterRow {
  state(): FilterState;
  clear(): void;
}

/** Where the row lives and what it starts with. */
export interface FilterHosts {
  form: HTMLFormElement;
  toggle: HTMLButtonElement;
  /** The active-filter chips. */
  chips: HTMLElement;
  /** The violation chips and the Litigation chip. */
  marks: HTMLElement;
  /** A person or org preset by a cross-link (?p=), already checked against the options. */
  presetPerson?: string | null;
  /** A violation preset by a deep link (?v=), already checked against the options. */
  presetViolation?: string | null;
  /** Litigation shown from the start (a deep link to a litigation event). */
  presetLitigation?: boolean;
}

function need<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`chronology: missing ${selector}`);
  return el;
}

function fillOptions(form: HTMLFormElement, matter: ServedMatter): void {
  const person = need<HTMLSelectElement>(form, '[data-chron-person]');
  for (const party of personOptions(matter)) {
    const option = html('option', { value: party.id }, person, party.name);
    option.dataset.side = party.side;
  }
}

/**
 * One chip per violation after All: its letter mark, then its title (cut by CSS, whole in the tooltip). One is
 * chosen at a time, so the chips are radios in the page's radiogroup, and only the checked one is a tab stop.
 */
function fillViolations(marks: HTMLElement, options: readonly ViolationOption[]): void {
  const group = need<HTMLElement>(marks, '[data-chron-violations]');
  for (const option of options) {
    const chip = html('button', {
      type: 'button', role: 'radio', class: 'c-button chron-vchip c-select', 'aria-checked': 'false', tabindex: '-1',
      'data-chron-v': option.id, title: option.title,
    }, group);
    html('span', { class: 'c-mark', 'data-mark': option.mark }, chip, option.mark);
    html('span', { class: 'chron-vchip__title' }, chip, option.title);
  }
  group.hidden = options.length === 0;
}

/** The Litigation chip says how many events it holds back; with none in the record it does not show. */
function fillLitigation(marks: HTMLElement, matter: ChronMatter): void {
  const n = litigationCount(matter.events);
  const chip = need<HTMLButtonElement>(marks, '[data-chron-litigation]');
  need(chip, '[data-chron-litigation-count]').textContent = String(n);
  chip.setAttribute('aria-label', `Litigation, ${n} ${n === 1 ? 'event' : 'events'}`);
  // Filings and orders wear the outline square on the chart, so the chip that holds them back wears it too.
  chip.insertBefore(shapeIcon('filing', 12), chip.firstChild);
  chip.hidden = n === 0;
}

function fillKinds(form: HTMLFormElement, kinds: readonly EventType[]): void {
  const host = need<HTMLElement>(form, '[data-chron-kinds]');
  host.closest<HTMLElement>('fieldset')?.toggleAttribute('hidden', kinds.length === 0);
  for (const kind of kinds) {
    const button = html('button', {
      type: 'button', class: 'c-button chron-kind', 'aria-pressed': 'true', 'data-chron-kind': kind,
    }, host);
    html('span', {}, button, TYPE_NAMES[kind]);
  }
}

/** Fold the row on phones; the button carries how many filters are set. */
function bindToggle(form: HTMLFormElement, toggle: HTMLButtonElement): void {
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    form.dataset.state = open ? 'open' : 'closed';
  });
}

function showCount(badge: HTMLElement, toggle: HTMLButtonElement, n: number): void {
  badge.textContent = String(n);
  badge.hidden = n === 0;
  toggle.setAttribute('aria-label', n ? `Filters, ${n} set` : 'Filters');
}

function filterNames(form: HTMLFormElement, violations: readonly ViolationOption[]): FilterNames {
  const label = (select: string, id: string) =>
    [...need<HTMLSelectElement>(form, select).options].find((option) => option.value === id)?.textContent ?? id;
  return {
    person: (id) => label('[data-chron-person]', id),
    violation: (id) => violations.find((option) => option.id === id)?.mark ?? id,
    kind: (kind) => TYPE_NAMES[kind],
  };
}

/** A removable chip: the filter's label and a 1.5px line cross. */
function renderChips(host: HTMLElement, state: FilterState, names: FilterNames): void {
  clear(host);
  const chips = activeChips(state, names);
  host.hidden = chips.length === 0;
  for (const chip of chips) {
    const button = html('button', {
      type: 'button', class: 'c-button chron-active__chip', 'data-chron-remove': chip.facet,
      'aria-label': `Remove filter: ${chip.label}`,
    }, html('li', {}, host));
    html('span', {}, button, chip.label);
    const cross = svg('svg', { class: 'chron-active__x', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' }, button);
    svg('path', { d: 'M4.5 4.5l7 7m0-7-7 7' }, cross);
  }
}

/** The filters' inputs. */
interface Controls {
  person: HTMLSelectElement;
  from: HTMLInputElement;
  to: HTMLInputElement;
  litigation: HTMLButtonElement;
  kinds(): HTMLButtonElement[];
  violations(): HTMLButtonElement[];
}

function controlsOf(form: HTMLFormElement, marks: HTMLElement): Controls {
  return {
    person: need(form, '[data-chron-person]'),
    from: need(form, '[data-chron-from]'),
    to: need(form, '[data-chron-to]'),
    litigation: need(marks, '[data-chron-litigation]'),
    kinds: () => [...form.querySelectorAll<HTMLButtonElement>('[data-chron-kind]')],
    violations: () => [...marks.querySelectorAll<HTMLButtonElement>('[data-chron-v]')],
  };
}

const pressed = (button: Element) => button.getAttribute('aria-pressed') === 'true';
const checked = (radio: Element) => radio.getAttribute('aria-checked') === 'true';

function readState(c: Controls): FilterState {
  return {
    person: c.person.value,
    violation: c.violations().find(checked)?.dataset.chronV ?? '',
    hiddenKinds: c.kinds()
      .filter((button) => !pressed(button))
      .map((button) => button.dataset.chronKind as EventType),
    litigation: pressed(c.litigation),
    from: c.from.value,
    to: c.to.value,
  };
}

/** Check one violation radio ('' is All), uncheck the rest, and make the checked one the group's tab stop. */
function pickViolation(c: Controls, id: string): void {
  for (const radio of c.violations()) {
    const on = radio.dataset.chronV === id;
    radio.setAttribute('aria-checked', String(on));
    radio.tabIndex = on ? 0 : -1;
  }
}

/** Clear one facet, or every facet (Litigation goes back to off, its default). */
function reset(c: Controls, facet: FilterFacet | 'all'): void {
  if (facet === 'person' || facet === 'all') c.person.value = EMPTY_FILTERS.person;
  if (facet === 'violation' || facet === 'all') pickViolation(c, EMPTY_FILTERS.violation);
  if (facet === 'kinds' || facet === 'all') for (const button of c.kinds()) button.setAttribute('aria-pressed', 'true');
  if (facet === 'dates' || facet === 'all') c.from.value = c.to.value = EMPTY_FILTERS.from;
  if (facet === 'all') c.litigation.setAttribute('aria-pressed', String(EMPTY_FILTERS.litigation));
}

function listenMarks(marks: HTMLElement, c: Controls, changed: () => void): void {
  // A click, or Space or Enter on the focused radio (a button's own click), checks a violation; Litigation toggles.
  marks.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const violation = target?.closest<HTMLButtonElement>('[data-chron-v]');
    if (violation) {
      if (checked(violation)) return;
      pickViolation(c, violation.dataset.chronV ?? '');
    } else if (target?.closest('[data-chron-litigation]')) {
      c.litigation.setAttribute('aria-pressed', String(!pressed(c.litigation)));
    } else return;
    changed();
  });
  // The arrows, Home and End move focus through the violation radios and check the one they land on.
  marks.addEventListener('keydown', (event) => {
    const radios = c.violations();
    const from = radios.findIndex((radio) => radio === event.target);
    const to = from === -1 ? null : radioStep(event, from, radios.length);
    if (to === null) return;
    event.preventDefault();
    const radio = radios[to]!; // safe: radioStep returns an index below radios.length
    radio.focus();
    if (checked(radio)) return;
    pickViolation(c, radio.dataset.chronV ?? '');
    changed();
  });
}

function listen(hosts: FilterHosts, c: Controls, changed: () => void): void {
  const { form, chips, toggle } = hosts;
  listenMarks(hosts.marks, c, changed);
  chips.addEventListener('click', (event) => {
    const chip = (event.target as Element | null)?.closest<HTMLElement>('[data-chron-remove]');
    if (!chip) return;
    reset(c, chip.dataset.chronRemove as FilterFacet);
    changed();
    (chips.querySelector<HTMLElement>('[data-chron-remove]') ?? toggle).focus({ preventScroll: true });
  });
  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('change', changed);
  for (const input of [c.from, c.to]) input.addEventListener('input', () => validFilterDate(input.value) && changed());
  form.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const kind = target?.closest<HTMLButtonElement>('[data-chron-kind]');
    if (kind) kind.setAttribute('aria-pressed', String(kind.getAttribute('aria-pressed') === 'false'));
    else if (target?.closest('[data-chron-clear]')) reset(c, 'all');
    else return;
    changed();
  });
}

/** Wire the filters. `onChange` runs after every change with the new state; the presets apply without it. */
export function mountFilters(hosts: FilterHosts, matter: ServedMatter, onChange: (state: FilterState) => void): FilterRow {
  const { form, toggle, marks } = hosts;
  const violations = violationOptions(matter);
  fillOptions(form, matter);
  fillKinds(form, toggleKinds(matter.events));
  fillViolations(marks, violations);
  fillLitigation(marks, matter);
  marks.hidden = false;
  bindToggle(form, toggle);
  const names = filterNames(form, violations);
  const badge = need<HTMLElement>(toggle, '[data-chron-filter-count]');
  const c = controlsOf(form, marks);
  const show = () => {
    for (const input of [c.from, c.to]) input.setAttribute('aria-invalid', String(!validFilterDate(input.value)));
    const now = readState(c);
    showCount(badge, toggle, activeFilterCount(now));
    renderChips(hosts.chips, now, names);
    return now;
  };
  const changed = () => onChange(show());
  listen(hosts, c, changed);
  if (hosts.presetPerson) c.person.value = hosts.presetPerson;
  if (hosts.presetViolation) pickViolation(c, hosts.presetViolation);
  if (hosts.presetLitigation) c.litigation.setAttribute('aria-pressed', 'true');
  show();
  return {
    state: () => readState(c),
    clear: () => {
      reset(c, 'all');
      changed();
    },
  };
}
