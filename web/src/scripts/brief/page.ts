// SPDX-License-Identifier: Apache-2.0
// The complaint brief (/complaint/), the page entry: the complaint track as one page a lawyer new to the matter
// can read in five minutes, top to bottom. The head (caption, forum, the theory in one line, Download draft and
// Print brief); per violation what was said against what was filed; who's who; who held what, as told and as
// filed; the dated steps; money and figures; each count against its proof (the claims map, or the points to
// prove before counts exist); hurdles; dates to confirm; key exhibits; the drafts. The full seven-part outline
// prints after the brief and is not shown on screen. A section whose data is absent is left out. Running text
// goes through termify, in reading order, so each defined term is marked at its first use. The charts and the
// outline load lazily (R20). Everything matter-specific arrives from GET /api/matter; the source names no party.
import { initExhibitLinks } from '../exhibit-pane.ts';
import { downloadUrl } from '../files-api.ts';
import { guideSend } from '../guide-bus.ts';
import { pageMatter } from '../matter-api.ts';
import { settle, type LoadState } from '../page-load.ts';
import { termifyIn } from '../terms.ts';
import { renderContrast } from '../track-contrast.ts';
import { el, markBadge, partyChip, slug, whenNear } from '../track-dom.ts';
import { pickTrack, pointsFor, tracksOfKind, violationsOf, type Track, type TrackMatter, type TrackViolation } from '../track-model.ts';
import { renderCast } from './cast.ts';
import { renderClaimsMap } from './claims-map.ts';
import { briefSection, prose, type Terms } from './dom.ts';
import { renderDrafts } from './downloads.ts';
import { renderExhibits } from './exhibits.ts';
import { renderDates, renderHurdles } from './hurdles.ts';
import { briefPlan, downloadLabel, partyOf, stepsHeading, storySteps, type BriefPlan } from './model.ts';
import { renderOwnership } from './ownership.ts';
import { renderSteps } from './steps.ts';
import { pageTitle } from '../room-names.ts';
import { currentPleading } from '../../../worker/room-settings.ts';

function q<T extends HTMLElement>(hook: string): T | null {
  return document.querySelector<T>(`[data-brief-${hook}]`);
}

/** Every lazy body on the page, so Print brief can wait until each is drawn. */
const lazies: (() => Promise<void>)[] = [];

/** Draws `load` into `body` when the section nears the viewport (or the browser idles, or printing starts). */
function lazy(section: HTMLElement, body: HTMLElement, load: (body: HTMLElement) => Promise<void>): void {
  let started: Promise<void> | null = null;
  const run = () => (started ??= load(body));
  whenNear(section, body, run);
  lazies.push(() => run().catch(() => undefined));
}

function renderHead(root: HTMLElement, track: Track, matter: TrackMatter, plan: BriefPlan, terms: Terms): void {
  const head = el('header', { class: 'brief-head' }, root);
  el('p', { class: 'brief-head__kicker' }, head, `Drafting brief for a ${currentPleading} complaint`);
  el('h1', { class: 't-h1 brief-head__title' }, head, track.title);
  el('p', { class: 'brief-head__forum' }, head, track.forum);
  if (plan.line) prose('p', { class: 't-lead brief-head__line' }, head, plan.line, terms);
  const against = track.against.flatMap((id) => partyOf(matter, id) ?? []);
  if (plan.cast.length === 0 && against.length > 0) {
    // Without a cast, the head names the defendants, as the track lists them.
    const line = el('p', { class: 'brief-head__against' }, head);
    el('span', { class: 't-label' }, line, 'Against');
    for (const party of against) partyChip(party.name, party.side, line);
  }
  const actions = el('p', { class: 'brief-head__actions' }, head);
  const draft = plan.drafts[0];
  if (draft) {
    el('a', { class: 'c-button c-button--primary', href: downloadUrl(draft.doc), download: '' }, actions, downloadLabel(draft.label));
  }
  const print = el('button', { type: 'button', class: 'c-button' }, actions, 'Print brief');
  print.addEventListener('click', async () => {
    // A lazy section that failed already left its one sentence; print what there is.
    await Promise.all(lazies.map((draw) => draw()));
    window.print();
  });
}

/** One violation: its title as the heading (a conclusion), its summary, then what was said against what was filed. */
function renderViolation(root: HTMLElement, v: TrackViolation, matter: TrackMatter, terms: Terms): void {
  const id = `brief-v-${slug(v.id)}`;
  const section = el('section', { class: 'brief-section brief-violation', id, 'aria-labelledby': `${id}-title` }, root);
  const title = el('h2', { class: 't-h2 brief-section__title brief-violation__title', id: `${id}-title` }, section);
  markBadge(v.mark, title).classList.add('c-mark--large');
  el('span', { class: 'u-vh' }, title, `${v.mark}. `);
  title.append(v.title);
  if (v.summary) prose('p', { class: 'brief-violation__summary' }, section, v.summary, terms);
  const pair = el('div', { class: 'brief-violation__pair' }, section);
  // The pair's cards sit right under the violation's h2 here, so they head with h3.
  renderContrast(pair, v, matter, 'h3');
  termifyIn(pair, terms);
}

/** "C: " before a heading when the track rests on more than one violation, so each part says whose it is. */
function marked(v: TrackViolation, many: boolean, heading: string): string {
  return many ? `${v.mark}: ${heading}` : heading;
}

function renderStory(root: HTMLElement, violations: readonly TrackViolation[], matter: TrackMatter, terms: Terms): void {
  const many = violations.length > 1;
  for (const v of violations) {
    const heading = v.contrast ? 'Who held what, as told and as filed' : 'Who held what, at the first step and the last';
    const section = briefSection(root, `own-${v.id}`, marked(v, many, heading));
    if (!renderOwnership(section, v, matter)) section.remove();
  }
  for (const v of violations) {
    const steps = storySteps(v);
    if (steps.length === 0) continue;
    const section = briefSection(root, `steps-${v.id}`, marked(v, many, stepsHeading(steps)));
    renderSteps(section, steps, `Steps of ${v.mark}`, terms);
  }
}

function renderProof(root: HTMLElement, track: Track, violations: readonly TrackViolation[], plan: BriefPlan, terms: Terms): void {
  if (plan.map) {
    const section = briefSection(root, 'claims', 'Counts and their proof');
    el('p', { class: 'brief-section__intro' }, section,
      'Each count the complaint would plead, its elements, and the strongest proof the record has for each. Open a cell to read its page.');
    renderClaimsMap(section, plan.map, terms);
    return;
  }
  // Before the counts are written, the points to prove carry the proof, one checklist per violation.
  const withPoints = violations.filter((v) => pointsFor(track, v.id).length > 0);
  if (withPoints.length === 0) return;
  const section = briefSection(root, 'points', 'Points to prove');
  for (const v of withPoints) {
    const body = el('div', { class: 'brief-section__body' }, section);
    if (withPoints.length > 1) el('h3', { class: 't-h3' }, body, `Violation ${v.mark}`);
    lazy(section, body, async (into) => {
      const { renderProofList } = await import('../proof-list.ts');
      renderProofList(into, pointsFor(track, v.id), { onGap: () => guideSend({ type: 'gap' }) });
      termifyIn(into, terms);
    });
  }
}

function renderBrief(track: Track, matter: TrackMatter): void {
  const root = q('root');
  if (!root) return;
  root.replaceChildren();
  const terms = matter.meta.definedTerms;
  const violations = violationsOf(track, matter);
  const plan = briefPlan(track, matter, violations);
  renderHead(root, track, matter, plan, terms);
  for (const v of violations) renderViolation(root, v, matter, terms);
  if (plan.cast.length > 0) renderCast(briefSection(root, 'cast', "Who's who"), plan.cast, terms);
  renderStory(root, violations, matter, terms);
  if (plan.money) {
    const money = plan.money;
    const section = briefSection(root, 'money', 'Money and figures');
    lazy(section, el('div', { class: 'brief-section__body' }, section), async (body) => {
      const { renderMoney } = await import('./money.ts');
      renderMoney(body, money);
    });
  }
  renderProof(root, track, violations, plan, terms);
  if (plan.hurdles.length > 0) renderHurdles(briefSection(root, 'hurdles', 'Hurdles before filing'), plan.hurdles, terms);
  if (plan.dates.length > 0) renderDates(briefSection(root, 'dates', 'Dates to confirm with counsel'), plan.dates, terms);
  if (plan.exhibits.length > 0) renderExhibits(briefSection(root, 'exhibits', 'Key exhibits'), plan.exhibits, terms);
  if (plan.drafts.length > 0) renderDrafts(briefSection(root, 'drafts', 'Drafts'), plan.drafts);
  // The seven-part outline, for paper only: Print brief (or the browser's print) puts it after the brief.
  const outline = briefSection(root, 'outline', 'Full outline', 'brief-outline');
  lazy(outline, el('div', { class: 'track-guide__body' }, outline), async (body) => {
    const { renderTrackGuide } = await import('../track-guide.ts');
    renderTrackGuide(body, track, matter);
  });
  document.title = pageTitle(track.title);
}

function showState(state: LoadState): void {
  q('loading')?.setAttribute('hidden', '');
  for (const ready of document.querySelectorAll<HTMLElement>('[data-brief-ready]')) ready.hidden = state !== 'ready';
  const empty = q('empty');
  if (empty) empty.hidden = state !== 'empty';
  const error = q('error');
  if (error) error.hidden = state !== 'error';
}

/** Every step can fail (the fetch, the data, a section that throws while drawing); each one ends on the error line. */
async function main(): Promise<void> {
  await settle(showState, async () => {
    initExhibitLinks();
    const matter: TrackMatter | null = await pageMatter();
    const track = matter ? pickTrack(tracksOfKind(matter, 'complaint'), new URLSearchParams(window.location.search).get('track')) : null;
    if (!matter || !track) return 'empty';
    // On screen before drawing, as before; a section that throws still ends on the error line.
    showState('ready');
    renderBrief(track, matter);
    return 'ready';
  }, () => guideSend({ type: 'error' }));
}

void main();
