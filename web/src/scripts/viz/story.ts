// SPDX-License-Identifier: Apache-2.0
// The By date picture (Entities & People, ?view=dates). Entities by the date each was formed, one row per date,
// earliest first (story-layout.ts), with the matter's milestones on the same spine: each violation step under its
// letter mark, and the suit under the filing square. A tile carries its side's shape, "Under <parent>",
// "Defendant side" and the marks of the violations it is in. With one violation chosen, the entities it names keep
// its mark and the parents drawn for context say so in words. Shape and words back every state, never color alone.
// HTML, so names wrap at any width; drawn on the viz/core.ts frame with a table twin and one Tab stop. CSP: no
// style= attributes; text only (matter strings are untrusted data).

import { createFrame, fillTable, html, linearNext, rovingFocus, shapeSvg, SIDE_WORDS, type ChartHandle, type Frame } from './core.ts';
import { storyRows, type StoryMilestone, type StoryOrg } from './story-layout.ts';

export type { StoryMilestone, StoryOrg } from './story-layout.ts';

/** Options for the entity story chart: its title, caption and names for parents that are not drawn. */
export interface StoryOptions {
  title?: string;
  caption?: string;
  /** Names for parents that are not drawn ("Under Harbor Labs, Inc."). */
  names?: ReadonlyMap<string, string>;
  /** The letter marks of the violations each entity is in, in letter order. */
  marks?: ReadonlyMap<string, readonly string[]>;
  /** One violation chosen: its mark and the entities it names. Every other entity drawn is a parent of one. */
  focus?: { mark: string; ids: ReadonlySet<string> } | null;
  selected?: string | null;
  /** Starts on the table twin (a redraw keeps the reader's choice). */
  view?: 'chart' | 'table';
  /** Called when a person chooses an entity. */
  onSelect?: (id: string) => void;
}

/** The story chart's handle: mark an entity as chosen. */
export interface StoryHandle extends ChartHandle {
  /** Marks `id` as the chosen entity (aria-pressed), or none. */
  select(id: string | null): void;
}

interface Tile {
  id: string;
  button: HTMLButtonElement;
}

/** A violation's letter badge (DESIGN.md section 3): the letter is its text, the shape its outline. */
function badge(mark: string, parent: Element): HTMLElement {
  return html('span', { class: 'c-mark viz-story__badge', 'data-mark': mark, 'aria-hidden': 'true' }, parent, mark);
}

function drawMilestone(m: StoryMilestone, parent: Element): void {
  const p = html('p', { class: 'viz-story__event', 'data-kind': m.kind }, parent);
  if (m.kind === 'suit') shapeSvg('filing', 12, p);
  else if (m.mark) {
    badge(m.mark, p);
    html('span', { class: 'u-vh' }, p, `${m.mark}. `);
  }
  html('span', {}, p, m.label);
}

/** The words a tile adds about its violation(s): its marks, or, with one violation chosen, that it is only a parent. */
function tileStanding(id: string, opts: StoryOptions): { marks: readonly string[]; words: string } {
  const focus = opts.focus ?? null;
  if (focus) {
    return focus.ids.has(id)
      ? { marks: [focus.mark], words: `In violation ${focus.mark}` }
      : { marks: [], words: `Parent of a violation ${focus.mark} entity` };
  }
  const marks = opts.marks?.get(id) ?? [];
  return { marks, words: marks.length > 0 ? `In violation ${marks.join(', ')}` : '' };
}

function drawTile(org: StoryOrg, date: string | null, parent: Element, names: ReadonlyMap<string, string>, opts: StoryOptions): HTMLButtonElement {
  const li = html('li', { class: 'viz-story__cell' }, parent);
  const standing = tileStanding(org.id, opts);
  const context = Boolean(opts.focus) && standing.marks.length === 0;
  const button = html('button', {
    type: 'button', class: 'viz-story__tile', 'data-side': org.side, 'aria-pressed': 'false',
    'data-state': context ? 'context' : undefined,
  }, li);
  const name = html('span', { class: 'viz-story__name' }, button);
  shapeSvg(org.side, 14, name);
  html('span', {}, name, org.name);
  const under = org.parent ? names.get(org.parent) : undefined;
  if (under) html('span', { class: 'viz-story__under' }, button, `Under ${under}`);
  const foot = html('span', { class: 'viz-story__foot' }, button);
  if (org.side === 'defendant') html('span', { class: 'viz-story__side' }, foot, 'Defendant side');
  for (const mark of standing.marks) badge(mark, foot);
  if (context) html('span', { class: 'viz-story__context' }, foot, 'Parent only');
  const words = [org.name, SIDE_WORDS[org.side], date ? `formed ${date}` : 'formation date not in the record'];
  if (under) words.push(`under ${under}`);
  if (standing.words) words.push(standing.words);
  button.setAttribute('aria-label', words.join(', '));
  return button;
}

function legend(frame: Frame, orgs: readonly StoryOrg[], opts: StoryOptions): void {
  const ul = html('ul', { class: 'viz-legend viz-story__legend' });
  frame.plot.before(ul);
  for (const side of new Set(orgs.map((o) => o.side))) {
    const li = html('li', { class: 'viz-legend__item' }, ul);
    shapeSvg(side, 14, li);
    html('span', {}, li, SIDE_WORDS[side]);
  }
  const focus = opts.focus ?? null;
  if (focus) {
    const named = html('li', { class: 'viz-legend__item' }, ul);
    badge(focus.mark, named);
    html('span', {}, named, `Named in violation ${focus.mark}`);
  }
  if (focus && orgs.some((o) => !focus.ids.has(o.id))) {
    const context = html('li', { class: 'viz-legend__item' }, ul);
    html('span', { class: 'viz-story__swatch', 'data-state': 'context', 'aria-hidden': 'true' }, context);
    html('span', {}, context, 'Parent only, drawn for its place in the structure');
  }
  const suit = html('li', { class: 'viz-legend__item' }, ul);
  shapeSvg('filing', 12, suit);
  html('span', {}, suit, 'Suit filed');
}

/** Draws the By date picture of `orgs` and `milestones` into `container`. */
export function renderStory(container: HTMLElement, orgs: StoryOrg[], milestones: StoryMilestone[], opts: StoryOptions = {}): StoryHandle {
  const title = opts.title ?? 'Entities by date formed';
  const frame = createFrame(container, {
    title,
    caption: opts.caption ?? 'One row per date, earliest first. Entities formed on the same day share a row.',
    view: opts.view,
  });
  frame.root.classList.add('viz-story-frame');
  const names = new Map(opts.names ?? []);
  for (const o of orgs) names.set(o.id, o.name);
  const rows = storyRows(orgs, milestones);
  const byId = new Map(orgs.map((o) => [o.id, o]));
  legend(frame, orgs, opts);

  const list = html('ol', { class: 'viz-story', 'aria-label': title }, frame.plot);
  const tiles: Tile[] = [];
  for (const row of rows) {
    const li = html('li', { class: 'viz-story__row', 'data-undated': row.date === null ? 'true' : undefined }, list);
    html('span', { class: 'viz-story__date' }, html('div', { class: 'viz-story__when' }, li), row.date ?? 'Date not in the record');
    const what = html('div', { class: 'viz-story__what' }, li);
    for (const i of row.milestones) drawMilestone(milestones[i], what);
    if (row.orgs.length === 0) continue;
    const ul = html('ul', { class: 'viz-story__tiles' }, what);
    for (const id of row.orgs) {
      const button = drawTile(byId.get(id) as StoryOrg, row.date, ul, names, opts); // safe: rows only hold ids from `orgs`
      button.addEventListener('click', () => opts.onSelect?.(id));
      tiles.push({ id, button });
    }
  }
  rovingFocus(tiles.map((t) => t.button), linearNext(tiles.length), () => {});

  fillTable(frame.tableWrap, title, [
    { label: 'Entity' }, { label: 'Formed' }, { label: 'Under' }, { label: 'Side' }, { label: 'Violations' },
  ], rows.flatMap((row) => row.orgs.map((id) => {
    const org = byId.get(id) as StoryOrg; // safe: rows only hold ids from `orgs`
    return [org.name, row.date ?? 'Not in the record', org.parent ? names.get(org.parent) ?? '' : '', SIDE_WORDS[org.side],
      tileStanding(id, opts).marks.join(', ')];
  })));

  const select = (id: string | null) => {
    for (const tile of tiles) tile.button.setAttribute('aria-pressed', String(tile.id === id));
  };
  select(opts.selected ?? null);
  return { frame, select, destroy: () => frame.destroy() };
}
