// SPDX-License-Identifier: Apache-2.0
// Card P3 (People). The Entities & People page: the entity structure tree (the default view), the force graph of
// people and organizations placed by side with side filter chips, the table, the entities by date formed with
// violation chips (All, A, B, C), a name search and the profile drawer. The chosen party, the view and the By date
// violation live in the URL (?p=<id>, ?view=graph, table or dates, ?v=<id>), so a profile can be linked. Cites
// open the exhibit pane (card F7) beside the profile.
import { initExhibitLinks } from './exhibit-pane.ts';
import { guideSend } from './guide-bus.ts';
import { controlPrefix, pageMatter, type ServedMatter, type Side } from './matter-api.ts';
import { settle, type LoadState } from './page-load.ts';
import { renderGraph, type PeopleGraph } from './people-graph.ts';
import {
  clientSideLabel, matchParties, partiesOf, profileOf, readUrlState, SIDE_ORDER, summaryLine, tableRows, writeUrlState,
  type Party, type PeopleUrlState, type PeopleView,
} from './people-model.ts';
import { renderProfile } from './people-profile.ts';
import { datedOrgs, datesPicture, dateViolations, pickViolation } from './people-dates.ts';
import { renderTable, type PeopleTable } from './people-table.ts';
import { html } from './viz/core.ts';
import { renderStory, type StoryHandle } from './viz/story.ts';
import { anyDated } from './viz/story-layout.ts';
import { renderTree, type TreeHandle } from './viz/tree.ts';

const root = document.querySelector<HTMLElement>('[data-people]');

function q<T extends Element>(selector: string): T {
  return root?.querySelector<T>(selector) ?? (document.querySelector<T>(selector) as T);
}

/** Leaves the Loading line (static in the markup, so it shows from the first paint) for the page, empty or error. */
function showOnly(which: 'page' | 'empty' | 'error'): void {
  q<HTMLElement>('[data-people-loading]').hidden = true;
  root!.hidden = which !== 'page';
  q<HTMLElement>('[data-people-empty]').hidden = which !== 'empty';
  q<HTMLElement>('[data-people-status]').hidden = which !== 'error';
}

interface Page {
  matter: ServedMatter;
  parties: Party[];
  prefix: string;
  state: PeopleUrlState;
  sides: Set<Side>;
  query: string;
  graph: PeopleGraph | null;
  tree: TreeHandle | null;
  dates: StoryHandle | null;
  table: PeopleTable;
}

/** Courts and agencies are parties, not entities in a structure: the tree leaves them to the graph and table. */
function structureOrgs(matter: ServedMatter): ServedMatter['orgs'] {
  return matter.orgs.filter((o) => o.kind !== 'court' && o.kind !== 'agency');
}

function visibleIds(page: Page): Set<string> {
  return new Set(matchParties(page.parties, page.query).filter((p) => page.sides.has(p.side)).map((p) => p.id));
}

function syncUrl(page: Page): void {
  const search = writeUrlState(window.location.search, page.state);
  window.history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`);
}

function refresh(page: Page): void {
  const visible = visibleIds(page);
  page.graph?.setVisible(visible);
  page.table.update(visible, page.state.party);
  const shown = q<HTMLElement>('[data-people-count]');
  shown.textContent = visible.size === page.parties.length ? '' : `${visible.size} of ${page.parties.length} shown.`;
}

/** Below 64rem the profile is a bottom sheet over the page (people.css), so it must take focus or it covers it. */
const SHEET = '(max-width: 64rem)';
/** What had focus when the profile opened from outside it, so closing the profile can hand focus back. */
let opener: HTMLElement | SVGElement | null = null;

/** Opens the profile for `id` (or closes it with null). `from` is who asked, so that view is not told twice. */
function choose(page: Page, id: string | null, from: 'graph' | 'tree' | 'dates' | 'other' = 'other', focus = false): void {
  const profile = id ? profileOf(page.matter, page.parties, id) : null;
  page.state.party = profile ? profile.party.id : null;
  const host = q<HTMLElement>('[data-people-profile]');
  const active = document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement
    ? document.activeElement : null;
  // A person acting (not a ?p= link on load) whose focus is outside the profile: remember where to come back to.
  const acting = active !== null && active !== document.body && !host.contains(active);
  if (profile && acting) opener = active;
  host.hidden = !profile;
  root!.toggleAttribute('data-profile-open', Boolean(profile));
  if (profile) {
    if (acting) guideSend({ type: 'open' }); // a person opened a profile: the guide reads along
    const heading = renderProfile(host, profile, page.prefix);
    if (focus || (acting && window.matchMedia(SHEET).matches)) heading.focus();
  } else host.replaceChildren();
  if (from !== 'graph') page.graph?.select(page.state.party);
  if (from !== 'tree') page.tree?.select(page.state.party);
  page.dates?.select(page.state.party);
  refresh(page);
  syncUrl(page);
}

/** Closes the profile from inside it and returns focus to what opened it (the search box if that is gone). */
function closeProfile(page: Page): void {
  const back = opener;
  opener = null;
  choose(page, null);
  (back?.isConnected ? back : q<HTMLElement>('[data-people-find]')).focus();
}

const VIEWS: readonly PeopleView[] = ['structure', 'graph', 'table', 'dates'];

/** The By date chips: All, then one per violation with its letter mark and title (text only: matter strings). */
function drawDateChips(page: Page): void {
  const group = q<HTMLElement>('[data-people-vchips]');
  const options = dateViolations(page.matter);
  for (const option of options) {
    const chip = html('button', {
      type: 'button', class: 'c-button people-vchip c-select', 'aria-pressed': 'false', 'data-people-v': option.id,
      title: `${option.mark}. ${option.title}`,
    }, group);
    html('span', { class: 'c-mark', 'data-mark': option.mark }, chip, option.mark);
    html('span', { class: 'people-vchip__title' }, chip, option.title);
  }
  group.hidden = options.length === 0;
}

/** Draws the By date picture for the chosen violation (or All), and presses its chip. */
function drawDates(page: Page): void {
  const violation = pickViolation(page.matter, page.state.violation)?.id ?? null;
  page.state.violation = violation;
  for (const chip of root!.querySelectorAll<HTMLButtonElement>('[data-people-v]')) {
    chip.setAttribute('aria-pressed', String((chip.dataset.peopleV || null) === violation));
  }
  const host = q<HTMLElement>('[data-people-dates-picture]');
  const view = page.dates?.frame.plot.hidden ? 'table' : 'chart';
  page.dates?.destroy();
  page.dates = null;
  host.replaceChildren();
  if (!anyDated(datedOrgs(page.matter))) {
    q<HTMLElement>('[data-people-vchips]').hidden = true;
    const box = html('div', { class: 'c-empty' }, host);
    html('p', { class: 'c-empty__text' }, box, 'The record does not date when any entity was formed.');
    return;
  }
  const pic = datesPicture(page.matter, violation);
  page.dates = renderStory(host, pic.orgs, pic.milestones, {
    caption: pic.focus
      ? `Violation ${pic.focus.mark}: its entities, the parents above them, its steps and the suit, one row per date.`
      : 'One row per date, earliest first. Entities formed on the same day share a row; each step sits under its violation\'s letter.',
    names: new Map(page.matter.orgs.map((o) => [o.id, o.name])),
    marks: pic.marks,
    focus: pic.focus,
    selected: page.state.party,
    view,
    onSelect: (id) => choose(page, id, 'dates'),
  });
}

function setView(page: Page, view: PeopleView): void {
  page.state.view = view;
  root!.dataset.view = view;
  q<HTMLElement>('[data-people-structure]').hidden = view !== 'structure';
  q<HTMLElement>('[data-people-graph]').hidden = view !== 'graph';
  q<HTMLElement>('[data-people-table]').hidden = view !== 'table';
  q<HTMLElement>('[data-people-dates]').hidden = view !== 'dates';
  for (const b of root!.querySelectorAll<HTMLButtonElement>('[data-people-view]')) {
    b.setAttribute('aria-pressed', String(b.dataset.peopleView === view));
  }
  syncUrl(page);
}

function wire(page: Page): void {
  root!.addEventListener('click', (event) => {
    const target = event.target as Element;
    const pick = target.closest<HTMLElement>('[data-people-select]');
    if (pick) { choose(page, pick.dataset.peopleSelect ?? null, 'other', pick.closest('[data-people-profile]') !== null); return; }
    if (target.closest('[data-people-close]')) { closeProfile(page); return; }
    const view = target.closest<HTMLElement>('[data-people-view]');
    if (view) { setView(page, VIEWS.find((v) => v === view.dataset.peopleView) ?? 'structure'); return; }
    const chip = target.closest<HTMLButtonElement>('[data-people-v]');
    if (chip) {
      if (chip.getAttribute('aria-pressed') === 'true') return;
      page.state.violation = chip.dataset.peopleV || null;
      drawDates(page);
      syncUrl(page);
      return;
    }
    const side = target.closest<HTMLButtonElement>('[data-people-side]');
    if (side) {
      const value = side.dataset.peopleSide as Side;
      if (page.sides.has(value)) page.sides.delete(value); else page.sides.add(value);
      side.setAttribute('aria-pressed', String(page.sides.has(value)));
      refresh(page);
    }
  });
  const find = q<HTMLInputElement>('[data-people-find]');
  find.addEventListener('input', () => { page.query = find.value; refresh(page); });
  find.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const first = matchParties(page.parties, page.query).find((p) => page.sides.has(p.side));
    if (first) choose(page, first.id);
  });
  document.addEventListener('keydown', (event) => {
    // While the exhibit pane is open, Esc belongs to it: the profile holds the cite its focus returns to.
    if (event.key !== 'Escape' || !page.state.party || event.defaultPrevented || document.documentElement.dataset.exhibit) return;
    const inProfile = (event.target as Element | null)?.closest?.('[data-people-profile]');
    if (inProfile) closeProfile(page); else choose(page, null);
  });
}

function start(matter: ServedMatter): void {
  const parties = partiesOf(matter);
  const page: Page = {
    matter, parties, prefix: controlPrefix(), state: readUrlState(window.location.search),
    sides: new Set(SIDE_ORDER), query: '', graph: null, tree: null, dates: null,
    table: renderTable(q<HTMLElement>('[data-people-table]'), tableRows(matter, parties)),
  };
  q<HTMLElement>('[data-people-summary]').textContent = summaryLine(parties);
  const client = root!.querySelector<HTMLElement>('[data-people-side="client"] [data-people-side-label]');
  if (client) client.textContent = clientSideLabel(matter);
  showOnly('page');
  page.tree = renderTree(q<HTMLElement>('[data-people-structure]'), structureOrgs(matter), {
    selected: page.state.party, onSelect: (id) => choose(page, id, 'tree'),
  });
  page.graph = renderGraph(q<HTMLElement>('[data-people-graph]'), {
    matter, onSelect: (id) => choose(page, id, 'graph'),
  });
  drawDateChips(page);
  drawDates(page);
  wire(page);
  initExhibitLinks();
  setView(page, page.state.view);
  choose(page, page.state.party);
}

function showState(state: LoadState): void {
  showOnly(state === 'ready' ? 'page' : state);
}

/** Every step can fail (the fetch, the data, a picture that throws while drawing); each one ends on the error line. */
async function main(): Promise<void> {
  if (!root) return;
  await settle(showState, async () => {
    const matter = await pageMatter();
    if (!matter || matter.people.length + matter.orgs.length === 0) return 'empty';
    start(matter);
    return 'ready';
  });
}

void main();
