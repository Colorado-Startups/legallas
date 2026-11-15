// SPDX-License-Identifier: Apache-2.0
// Track pages, the page entry: /regulator/ (and a complaint track, though /complaint/ is now the brief in
// src/scripts/brief/page.ts). The shell names its kind on [data-track-page], and /regulator/ shows one tab per track
// (?track=<id>). Top to bottom, pictures first: the head (title, forum, who it is against), the objective strip
// (one card and proof meter per violation), then per violation its story (the told vs filed pair, then the stepper
// over the control panels), the figures, the ribbon of its events and the proof checklist; last the Filing guide,
// which "Print guide" prints whole. The charts and the guide load lazily (R20). Everything matter-specific arrives
// from GET /api/matter at run time; the page source names no party.
import { initExhibitLinks } from './exhibit-pane.ts';
import { guideLook, guideSend } from './guide-bus.ts';
import { pageMatter, formatPartialDate, type Side } from './matter-api.ts';
import { settle, type LoadState } from './page-load.ts';
import {
  controlInputs, meterLabel, pickTrack, pointsFor, proofMeter, stepDate, stepKey, tracksOfKind, violationsOf,
  type Track, type TrackKind, type TrackMatter, type TrackViolation,
} from './track-model.ts';
import { renderContrast } from './track-contrast.ts';
import { mountControl } from './track-control.ts';
import { citeRow, el, markBadge, partyChip, slug, whenNear } from './track-dom.ts';
import { changesAt, controllersFor, controlModel, type ControlModel } from './viz/control-layout.ts';
import { pageTitle } from './room-names.ts';

function q<T extends HTMLElement>(hook: string): T | null {
  return document.querySelector<T>(`[data-track-${hook}]`);
}

const KIND: TrackKind = q('page')?.dataset.trackPage === 'regulator' ? 'regulator' : 'complaint';

function sideOf(matter: TrackMatter, id: string): { name: string; side: Side } | null {
  const party = matter.people.find((p) => p.id === id) ?? matter.orgs.find((o) => o.id === id);
  return party ? { name: party.name, side: party.side } : null;
}

function renderHead(root: HTMLElement, track: Track, matter: TrackMatter): void {
  const head = el('header', { class: 'track-head' }, root);
  el('h1', { class: 't-h1 track-head__title' }, head, track.title);
  const facts = el('dl', { class: 'track-head__facts' }, head);
  el('dt', { class: 't-label' }, facts, 'Forum');
  el('dd', {}, facts, track.forum);
  const against = track.against.flatMap((id) => sideOf(matter, id) ?? []);
  if (against.length === 0) return;
  el('dt', { class: 't-label' }, facts, 'Against');
  const chips = el('dd', { class: 'track-head__parties' }, facts);
  for (const party of against) partyChip(party.name, party.side, chips);
}

function meter(points: ReturnType<typeof pointsFor>, parent: Element): void {
  const m = proofMeter(points);
  const block = el('span', { class: 'c-meter', 'data-total': String(m.total) }, parent);
  const pips = el('span', { class: 'c-meter__pips', 'aria-hidden': 'true' }, block);
  for (const strength of m.pips) el('span', { class: 'c-meter__pip', 'data-strength': strength }, pips);
  el('span', { class: 'c-meter__label' }, block, meterLabel(m));
}

/** The guide looks toward a card or step while the pointer or focus is on it. */
function lookOn(target: HTMLElement): void {
  target.addEventListener('pointerenter', () => guideLook(target));
  target.addEventListener('focusin', () => guideLook(target));
}

function renderObjectives(root: HTMLElement, track: Track, violations: TrackViolation[]): void {
  const section = el('section', { class: 'track-objectives', 'aria-labelledby': 'track-objectives-title' }, root);
  el('h2', { class: 't-h2', id: 'track-objectives-title' }, section, 'Violations');
  const strip = el('div', { class: 'track-objectives__strip' }, section);
  for (const v of violations) {
    const card = el('article', { class: 'c-objective' }, strip);
    markBadge(v.mark, card).classList.add('c-objective__mark', 'c-mark--large');
    const title = el('h3', { class: 'c-objective__title' }, card);
    el('a', { href: `#track-v-${slug(v.id)}` }, title, v.title);
    el('p', { class: 'c-objective__summary' }, card, v.summary);
    meter(pointsFor(track, v.id), el('div', { class: 'c-objective__meta' }, card));
    lookOn(card);
  }
}

/**
 * Over the picture: "Step 2 of 6, Apr. 10, 2012", the step as a sentence, who ran its entities per the record,
 * and what changed since the step before, in words.
 */
function renderStepHead(head: HTMLElement, v: TrackViolation, index: number, model: ControlModel, matter: TrackMatter): void {
  const step = v.steps[index]!; // safe: index is a step index
  head.replaceChildren();
  const when = formatPartialDate(step.date);
  el('p', { class: 'track-step-head__where' }, head, `Step ${index + 1} of ${v.steps.length}${when ? `, ${when}` : ''}`);
  el('h4', { class: 'track-step-head__title' }, head, step.label);
  const run = el('div', { class: 'track-step-head__run' }, head);
  el('span', { class: 't-label track-step-head__label' }, run, 'Run by, per the record');
  const people = controllersFor(model, index, step).flatMap((id) => sideOf(matter, id) ?? []);
  if (people.length === 0) el('span', { class: 'track-step-head__none' }, run, 'No one is tied to these entities in the record at this date.');
  for (const person of people) partyChip(person.name, person.side, run);
  const changes = changesAt(model, index, step);
  if (changes.length === 0) return;
  const block = el('div', { class: 'track-step-head__changes' }, head);
  el('span', { class: 't-label track-step-head__label' }, block, 'Changed at this step');
  const list = el('ul', {}, block);
  for (const line of changes) el('li', {}, list, line);
}

/**
 * The story: the told vs filed pair when the violation has one, then the steps as tabs (arrows move, Home and End
 * jump) over one panel with the step head, the step's cites and the control panels.
 */
function renderStory(section: HTMLElement, v: TrackViolation, matter: TrackMatter): void {
  if (v.steps.length === 0 && !v.contrast) return;
  const id = slug(v.id);
  const block = el('div', { class: 'track-block' }, section);
  el('h3', { class: 't-h3' }, block, 'Story');
  renderContrast(block, v, matter);
  if (v.steps.length === 0) return;
  const list = el('div', { class: 'track-steps', role: 'tablist', 'aria-label': `Story of ${v.mark}` }, block);
  const panel = el('div', { class: 'track-step-panel', role: 'tabpanel', id: `track-${id}-panel`, tabindex: '0' }, block);
  const head = el('div', { class: 'track-step-head' }, panel);
  const cites = el('div', { class: 'track-step-panel__cites' }, panel);
  const { parties, links } = controlInputs(matter);
  const model = controlModel(v, parties, links);
  const picture = mountControl(el('div', { class: 'track-control-mount' }, panel), model, v.steps, `Who held or ran what: ${v.mark}`);
  const tabs = v.steps.map((step, i) => {
    const tab = el('button', {
      type: 'button', class: 'track-step c-select', role: 'tab', id: `track-${id}-step-${i}`, 'aria-controls': panel.id,
    }, list);
    el('span', { class: 'track-step__date t-mono' }, tab, stepDate(step));
    el('span', { class: 'track-step__label' }, tab, step.label);
    return tab;
  });
  const select = (index: number, focus: boolean) => {
    const step = v.steps[index]!; // safe: index is a step index
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', tabs[index]!.id); // safe: one tab per step
    renderStepHead(head, v, index, model, matter);
    cites.replaceChildren();
    citeRow(step.cites, cites, `Sources for ${step.label}`);
    picture.show(index);
    if (focus) tabs[index]!.focus(); // safe: as above
  };
  tabs.forEach((tab, i) => {
    lookOn(tab);
    tab.addEventListener('click', () => {
      select(i, false);
      guideSend({ type: 'open' });
    });
    tab.addEventListener('keydown', (event) => {
      const to = stepKey(event.key, i, tabs.length);
      if (to === null) return;
      event.preventDefault();
      if (to === i) return;
      select(to, true);
      guideSend({ type: 'open' });
    });
  });
  select(0, false);
}

/** A lazily drawn block: heading now, body when it nears the viewport. */
function lazyBlock(section: HTMLElement, title: string, load: (body: HTMLElement) => Promise<void>): void {
  const block = el('div', { class: 'track-block' }, section);
  el('h3', { class: 't-h3' }, block, title);
  const body = el('div', { class: 'track-block__body' }, block);
  whenNear(block, body, () => load(body));
}

function renderViolation(root: HTMLElement, track: Track, v: TrackViolation, matter: TrackMatter): void {
  const id = slug(v.id);
  const section = el('section', { class: 'track-violation', id: `track-v-${id}`, 'aria-labelledby': `track-v-${id}-title` }, root);
  const head = el('header', { class: 'track-violation__head' }, section);
  markBadge(v.mark, head).classList.add('c-mark--large');
  const title = el('h2', { class: 't-h2 track-violation__title', id: `track-v-${id}-title` }, head);
  el('span', { class: 'u-vh' }, title, `${v.mark}. `);
  title.append(v.title);
  renderStory(section, v, matter);
  if (v.figures.length > 0) {
    lazyBlock(section, 'Figures', async (body) => {
      const { renderFigures } = await import('./track-figures.ts');
      renderFigures(body, v.figures, v.mark);
    });
  }
  const ids = new Set(v.events);
  const events = matter.events.filter((event) => ids.has(event.id));
  if (events.length > 0) {
    lazyBlock(section, 'Events', async (body) => {
      const { createTimeline } = await import('./viz/timeline.ts');
      createTimeline(body, {
        data: { events, people: matter.people, orgs: matter.orgs },
        mode: 'ribbon',
        label: `Events of ${v.mark}`,
        onSelect: (event) => window.location.assign(`/chronology/?event=${encodeURIComponent(event.id)}`),
      });
    });
  }
  const points = pointsFor(track, v.id);
  if (points.length > 0) {
    lazyBlock(section, 'Points to prove', async (body) => {
      const { renderProofList } = await import('./proof-list.ts');
      renderProofList(body, points, { onGap: () => guideSend({ type: 'gap' }) });
    });
  }
}

/**
 * The Complaint guide (Filing guide on a regulator tab): heading and print button now, the body when it nears the
 * viewport. "Print guide" waits for the body, then prints the head and the guide only.
 */
function renderGuide(root: HTMLElement, track: Track, matter: TrackMatter): void {
  const section = el('section', { class: 'track-guide', 'aria-labelledby': 'track-guide-title' }, root);
  const head = el('header', { class: 'track-guide__head' }, section);
  el('h2', { class: 't-h2', id: 'track-guide-title' }, head, track.kind === 'regulator' ? 'Filing guide' : 'Complaint guide');
  const print = el('button', { type: 'button', class: 'c-button' }, head, 'Print guide');
  const body = el('div', { class: 'track-guide__body' }, section);
  let loading: Promise<void> | null = null;
  const load = () => (loading ??= import('./track-guide.ts').then(({ renderTrackGuide }) => renderTrackGuide(body, track, matter)));
  whenNear(section, body, load);
  print.addEventListener('click', async () => {
    // A failed load already left its one sentence in the body; print what there is.
    await load().catch(() => undefined);
    const page = q('page');
    page?.setAttribute('data-state', 'print-guide');
    window.addEventListener('afterprint', () => page?.removeAttribute('data-state'), { once: true });
    window.print();
  });
}

function renderTrack(track: Track, matter: TrackMatter): void {
  const root = q('root');
  if (!root) return;
  root.replaceChildren();
  const violations = violationsOf(track, matter);
  renderHead(root, track, matter);
  if (violations.length > 0) renderObjectives(root, track, violations);
  for (const v of violations) renderViolation(root, track, v, matter);
  renderGuide(root, track, matter);
  document.title = pageTitle(track.title);
}

/** /regulator/ tabs, one per track; the choice is kept in ?track= so a link opens the same tab. */
function renderTabs(tracks: Track[], current: Track, matter: TrackMatter): void {
  const bar = q('tabs');
  if (!bar || tracks.length < 2) return;
  bar.hidden = false;
  bar.replaceChildren();
  q('root')?.setAttribute('role', 'tabpanel');
  const tabs = tracks.map((track) => el('button', {
    type: 'button', role: 'tab', class: 'track-tab c-select', 'aria-controls': 'track-root', id: `track-tab-${slug(track.id)}`,
  }, bar, track.title));
  const select = (index: number, focus: boolean) => {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    q('root')?.setAttribute('aria-labelledby', tabs[index].id);
    const url = new URL(window.location.href);
    url.searchParams.set('track', tracks[index].id);
    history.replaceState(null, '', `${url.pathname}${url.search}`);
    renderTrack(tracks[index], matter);
    if (focus) tabs[index].focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(i, false));
    tab.addEventListener('keydown', (event) => {
      const to = stepKey(event.key, i, tabs.length);
      if (to === null) return;
      event.preventDefault();
      if (to !== i) select(to, true);
    });
  });
  const start = tracks.indexOf(current);
  tabs.forEach((tab, i) => {
    tab.setAttribute('aria-selected', String(i === start));
    tab.tabIndex = i === start ? 0 : -1;
  });
  q('root')?.setAttribute('aria-labelledby', tabs[start].id);
}

function showState(state: LoadState): void {
  q('loading')?.setAttribute('hidden', '');
  for (const ready of document.querySelectorAll<HTMLElement>('[data-track-ready]')) ready.hidden = state !== 'ready';
  // The tabs show only once drawn (renderTabs); a page that ends empty or failed hides them again.
  const tabs = q('tabs');
  if (tabs && state !== 'ready') tabs.hidden = true;
  const empty = q('empty');
  if (empty) empty.hidden = state !== 'empty';
  const error = q('error');
  if (error) error.hidden = state !== 'error';
}

/** Every step can fail (the fetch, the data, a block that throws while drawing); each one ends on the error line. */
async function main(): Promise<void> {
  await settle(showState, async () => {
    initExhibitLinks();
    const matter: TrackMatter | null = await pageMatter();
    const tracks = matter ? tracksOfKind(matter, KIND) : [];
    const track = pickTrack(tracks, new URLSearchParams(window.location.search).get('track'));
    if (!matter || !track) return 'empty';
    // On screen before drawing, as before; a block that throws still ends on the error line.
    showState('ready');
    if (KIND === 'regulator') renderTabs(tracks, track, matter);
    renderTrack(track, matter);
    return 'ready';
  }, () => guideSend({ type: 'error' }));
}

void main();
