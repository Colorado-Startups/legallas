// SPDX-License-Identifier: Apache-2.0
// Track pages: the control panels under the story stepper (layout in control-layout.ts). One fixed picture for
// every step of a violation: the people, the orgs that hold or act, then the entities. Per step only the ties
// change: each line carries its state in its dash and in words on the line (solid in the record, long dashes
// claimed later, short dashes alleged, dotted denied), so nothing rests on color. The step's own entities are
// brought forward. The lines are one Tab stop (arrows move between them); hovering or focusing one lists the
// statements behind it, and Enter or a click pins them with their cites. Below 600px the picture becomes a list,
// each node with its ties under it. The table twin lists every tie at the step. On a busy picture the words may
// sit off their line, joined by a thin leader, or in short form with the full words in the tooltip, the label's
// name and the table (control-labels.ts). CSP: no style= attributes; positions go through custom properties
// (track-control.css reads them).
import type { Cite, LinkStatement } from '../../../worker/matter-types.ts';
import { formatPartialDate } from '../matter-api.ts';
import {
  BASIS_WORDS, layoutControl, notFormedYet, shareWords, stepFocus,
  type ControlGeometry, type ControlLink, type ControlModel, type ControlStep, type TieAt, type TieState,
} from './control-layout.ts';
import { shortName, shortWords } from './control-labels.ts';
import {
  createFrame, fillTable, hideTip, html, linearNext, observeWidth, rovingFocus, shapeSvg, showTip, SIDE_WORDS, svg, type Frame,
} from './core.ts';

/** Options for the control picture: its title and how a statement's cites are drawn. */
export interface ControlOptions<C> {
  title: string;
  /** Draws a statement's cites as chips that open the exhibit pane. */
  cites(cites: readonly C[], parent: HTMLElement, label: string): void;
  /** A cite as text, for the table ("DOE-000412 at 3"). */
  citeText(cite: C): string;
}

/** The control picture's handle: show the ties at a step, and destroy it. */
export interface ControlHandle {
  /** Shows the ties at step `index`; the parties keep their places. */
  show(index: number): void;
  destroy(): void;
}

/** Each state in words, for the legend and the table. */
const STATE_WORDS: Record<TieState, string> = {
  record: 'In the record',
  claimed: 'Claimed later',
  alleged: 'Alleged',
  denied: 'Denied',
};

const LEGEND: [TieState, string][] = [
  ['record', 'In the record: solid line'],
  ['claimed', 'Claimed later: long dashes, with when and by what source'],
  ['alleged', 'Alleged: short dashes, with the word alleged'],
  ['denied', 'Denied: dotted line, with when it was denied'],
];

const ROW_WORDS = { people: 'People', holders: 'Holding and acting organizations', entities: 'Entities' } as const;

const px = (n: number) => `${Math.round(n)}px`;

function place(node: HTMLElement, x: number, y: number, w: number, h: number): void {
  node.style.setProperty('--x', px(x));
  node.style.setProperty('--y', px(y));
  node.style.setProperty('--w', px(w));
  node.style.setProperty('--h', px(h));
}

/** A short line sample in a state's dash, for the legend and the list. */
function lineSample(state: TieState, parent: Element): void {
  const box = svg('svg', { class: 'track-control__sample', viewBox: '0 0 32 8', width: 32, height: 8, 'aria-hidden': 'true', focusable: 'false' }, parent);
  svg('path', { class: 'track-control__line', 'data-state': state, d: 'M1 4H31' }, box);
}

/** One statement in words: held or denied, when, as of when, from what, the share. */
function statementWords(st: LinkStatement): string {
  const span = st.since || st.until
    ? `${st.since ? formatPartialDate(st.since) : 'start not stated'} to ${st.until ? formatPartialDate(st.until) : 'open'}`
    : 'dates not stated';
  const how = st.direct === null ? '' : st.direct ? 'direct' : 'through another entity';
  return [st.held ? 'Held' : 'Denied', span, `as of ${formatPartialDate(st.asOf)}`, BASIS_WORDS[st.basis], shareWords(st.share), how]
    .filter(Boolean).join('; ');
}

interface Drawn {
  canvas: HTMLElement;
  /** One sentence for a step with no tie drawn. */
  empty: HTMLElement;
  /** Re-draws the ties for a step; returns the focusable tie marks in reading order. */
  ties(index: number): HTMLElement[];
}

/** What every part of one control panel shares: its inputs, its frame and the picture drawn now. */
interface Panel<C extends Cite> {
  model: ControlModel<C>;
  steps: readonly ControlStep[];
  opts: ControlOptions<C>;
  frame: Frame;
  detail: HTMLElement;
  current: number;
  drawn: Drawn | null;
  focused: number;
  /** Ties whose label shows the short words in the picture drawn now. */
  short: Set<number>;
}

const NO_TIE_WORDS = 'No tie is in the record at this date.';

function partyName<C extends Cite>(panel: Panel<C>, id: string): string {
  return panel.model.parties.get(id)?.name ?? id;
}

/** A tie in one sentence, for a mark's accessible name. */
function tieSentence<C extends Cite>(panel: Panel<C>, link: ControlLink<C>, tie: TieAt<C>): string {
  return `${partyName(panel, link.from)} to ${partyName(panel, link.to)}: ${tie.words}${tie.later ? `. ${tie.later}` : ''}`;
}

/** The key under the title: line styles, focus, not-yet-formed and one shape per side. */
function drawLegend<C extends Cite>(frame: Frame, model: ControlModel<C>, steps: readonly ControlStep[]): void {
  const legend = html('ul', { class: 'track-control__legend', 'aria-label': 'How to read the lines' }, frame.root);
  frame.root.insertBefore(legend, frame.plot);
  for (const [state, words] of LEGEND) {
    const item = html('li', { class: 'track-control__key' }, legend);
    lineSample(state, item);
    html('span', {}, item, words);
  }
  const focusKey = html('li', { class: 'track-control__key' }, legend);
  html('span', { class: 'track-control__swatch', 'data-focus': '', 'aria-hidden': 'true' }, focusKey);
  html('span', {}, focusKey, 'Brought forward at this step');
  if (model.ties.some((_, i) => [...model.parties.values()].some((p) => notFormedYet(p, steps[i]?.date ?? '')))) {
    const later = html('li', { class: 'track-control__key' }, legend);
    html('span', { class: 'track-control__swatch', 'data-later': '', 'aria-hidden': 'true' }, later);
    html('span', {}, later, 'Not formed yet');
  }
  for (const side of new Set([...model.parties.values()].map((p) => p.side))) {
    const item = html('li', { class: 'track-control__key' }, legend);
    shapeSvg(side, 12, item);
    html('span', {}, item, SIDE_WORDS[side]);
  }
}

/** The sources for a tie the record gives as a parent link, with no dated statement. */
function drawStructuralDetail<C extends Cite>(panel: Panel<C>, link: ControlLink<C>): void {
  const item = html('div', { class: 'track-control__statement' }, panel.detail);
  html('p', { class: 'track-control__statement-facts' }, item, `The organization record names ${partyName(panel, link.to)} as its parent; no source dates the tie.`);
  panel.opts.cites(link.cites ?? [], item, `Sources for ${partyName(panel, link.from)}`);
}

/** The dated statements behind a tie, oldest first, each with its cites. */
function drawStatementDetail<C extends Cite>(panel: Panel<C>, link: ControlLink<C>): void {
  const list = html('ul', { class: 'track-control__statements' }, panel.detail);
  for (const st of [...link.statements].sort((a, b) => (a.asOf < b.asOf ? -1 : 1))) {
    const item = html('li', { class: 'track-control__statement', 'data-held': String(st.held) }, list);
    html('p', { class: 'track-control__statement-facts' }, item, statementWords(st));
    if (st.note) html('p', { class: 'track-control__statement-note' }, item, st.note);
    panel.opts.cites(st.cites, item, `Sources for this statement, ${formatPartialDate(st.asOf)}`);
  }
}

/** Pins the sources behind tie `i` under the picture. */
function openDetail<C extends Cite>(panel: Panel<C>, i: number): void {
  const link = panel.model.links[i]!; // safe: i indexes model.links
  const { detail } = panel;
  detail.replaceChildren();
  detail.hidden = false;
  const head = html('div', { class: 'track-control__detail-head' }, detail);
  html('p', { class: 'track-control__detail-title' }, head, `${partyName(panel, link.from)} to ${partyName(panel, link.to)}: ${link.label}`);
  const close = html('button', { type: 'button', class: 'c-button c-button--quiet' }, head, 'Close');
  close.addEventListener('click', () => {
    detail.hidden = true;
    panel.drawn?.canvas.querySelector<HTMLElement>(`[data-tie="${i}"]`)?.focus();
  });
  if (link.structural) drawStructuralDetail(panel, link);
  else drawStatementDetail(panel, link);
}

/** Shows the tooltip for tie `i` at `anchor`. */
function tipFor<C extends Cite>(panel: Panel<C>, anchor: Element, i: number): void {
  const link = panel.model.links[i]!; // safe: i indexes model.links
  const tie = panel.model.ties[panel.current]?.[i];
  const lines = (tie?.basis ?? []).map((st) => ({ value: st.asOf, label: st.note ?? BASIS_WORDS[st.basis] }));
  // Short words, and a later claim the label may clip, read in full here.
  if (tie && (panel.short.has(i) || tie.later)) lines.unshift({ value: '', label: `${tie.words}${tie.later ? `. ${tie.later}` : ''}` });
  if (link.structural) lines.push({ value: '', label: 'Parent in the organization record, undated.' });
  lines.push({ value: '', label: 'Enter or click for the sources.' });
  showTip(panel.frame, anchor, `${partyName(panel, link.from)} to ${partyName(panel, link.to)}: ${tie ? STATE_WORDS[tie.state].toLowerCase() : 'not shown'}`, lines);
}

/** Makes a tie mark a button: hover and focus show the tip, Enter, Space or a click pin the sources. */
function wire<C extends Cite>(panel: Panel<C>, mark: HTMLElement, i: number): void {
  mark.dataset.tie = String(i);
  mark.setAttribute('role', 'button');
  mark.addEventListener('pointerenter', () => tipFor(panel, mark, i));
  mark.addEventListener('pointerleave', () => hideTip(panel.frame));
  mark.addEventListener('blur', () => hideTip(panel.frame));
  mark.addEventListener('click', () => openDetail(panel, i));
  mark.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openDetail(panel, i);
  });
}

/** The words on a tie, in full or (with `label`) in the short form, and a later claim under them. */
function tieWords<C extends Cite>(tie: TieAt<C>, parent: HTMLElement, label?: string): void {
  const [words, later] = label === undefined ? [tie.words, tie.later] : shortWords(label, tie);
  html('span', { class: 'track-control__words' }, parent, words);
  if (later) html('span', { class: 'track-control__later' }, parent, later);
}

/** One party's box: its side shape and its name (the series alone when the full name is long). */
function nodeBox<C extends Cite>(panel: Panel<C>, id: string, parent: HTMLElement, mode: 'picture' | 'list'): HTMLElement {
  const party = panel.model.parties.get(id)!; // safe: rows hold party ids
  const node = html('div', { class: 'track-control__node', 'data-side': party.side, 'data-kind': party.kind, 'data-party': id, 'data-mode': mode }, parent);
  shapeSvg(party.side, 14, node);
  const shown = shortName(party.name);
  if (shown === party.name) {
    html('span', { class: 'track-control__name' }, node, party.name);
  } else {
    // The series alone fits the box; the tooltip and screen readers get the full name, as does the table twin.
    node.title = party.name;
    const label = html('span', { class: 'track-control__name' }, node);
    html('span', { 'aria-hidden': 'true' }, label, shown);
    html('span', { class: 'u-vh' }, label, party.name);
  }
  html('span', { class: 'track-control__note' }, node);
  return node;
}

/** Brings the step's own parties forward and marks those not formed yet. */
function markNodes<C extends Cite>(panel: Panel<C>, canvas: HTMLElement, index: number): void {
  const step = panel.steps[index];
  const focus = stepFocus(step);
  for (const node of canvas.querySelectorAll<HTMLElement>('[data-party]')) {
    const id = node.dataset.party!; // safe: set in nodeBox
    const later = notFormedYet(panel.model.parties.get(id), step?.date ?? '');
    node.toggleAttribute('data-focus', focus.has(id));
    node.toggleAttribute('data-later', later);
    node.querySelector('.track-control__note')!.textContent = later ? 'Not formed yet' : ''; // safe: nodeBox adds it
  }
}

/** One edge of the picture: its line, head and leader in the lines layer, its label in the labels layer. */
function drawEdge<C extends Cite>(
  panel: Panel<C>, edge: ControlGeometry['edges'][number], tie: TieAt<C>, near: boolean, lines: Element, layer: HTMLElement,
): HTMLElement {
  const link = panel.model.links[edge.link]!; // safe: edges index model.links
  const g = svg('g', {}, lines);
  svg('path', { class: 'track-control__line', 'data-state': tie.state, 'data-near': near, d: edge.d }, g);
  svg('path', { class: 'track-control__head', 'data-near': near, d: edge.head }, g);
  if (edge.leader) {
    svg('path', { class: 'track-control__leader', 'data-near': near, d: edge.leader.d }, g);
    svg('circle', { class: 'track-control__anchor', 'data-near': near, cx: edge.leader.x, cy: edge.leader.y, r: 2.5 }, g);
  }
  const label = html('span', {
    class: 'track-control__tie', 'data-state': tie.state, 'data-near': near, 'data-mode': 'picture', 'data-short': edge.short,
  }, layer);
  place(label, edge.label.x, edge.label.y, edge.label.w, edge.label.h);
  tieWords(tie, label, edge.short ? link.label : undefined);
  label.setAttribute('aria-label', tieSentence(panel, link, tie));
  wire(panel, label, edge.link);
  return label;
}

/** Re-draws every edge of the picture for a step; returns the tie marks in reading order. */
function drawPictureTies<C extends Cite>(panel: Panel<C>, geo: ControlGeometry, lines: Element, layer: HTMLElement, index: number): HTMLElement[] {
  lines.replaceChildren();
  layer.replaceChildren();
  const focus = stepFocus(panel.steps[index]);
  const marks: HTMLElement[] = [];
  for (const edge of geo.edges) {
    const tie = panel.model.ties[index]?.[edge.link];
    if (!tie) continue;
    const link = panel.model.links[edge.link]!; // safe: edges index model.links
    marks.push(drawEdge(panel, edge, tie, focus.has(link.from) || focus.has(link.to), lines, layer));
  }
  return marks;
}

/** The wide picture: the parties in fixed places, the ties as lines between them. */
function drawPicture<C extends Cite>(panel: Panel<C>, geo: ControlGeometry): Drawn {
  const canvas = html('div', { class: 'track-control', 'data-mode': 'picture', role: 'group', 'aria-label': panel.opts.title }, panel.frame.plot);
  canvas.style.setProperty('--h', px(geo.height + 8));
  const lines = svg('svg', { class: 'track-control__lines', width: geo.width, height: geo.height + 8, viewBox: `0 0 ${geo.width} ${geo.height + 8}`, 'aria-hidden': 'true', focusable: 'false' }, canvas);
  const layer = html('div', { class: 'track-control__labels' }, canvas);
  panel.short = new Set(geo.edges.filter((e) => e.short).map((e) => e.link));
  for (const [id, r] of geo.nodes) place(nodeBox(panel, id, canvas, 'picture'), r.x, r.y, r.w, r.h);
  return {
    canvas,
    empty: html('p', { class: 'track-control__empty', hidden: true }, canvas, NO_TIE_WORDS),
    ties: (index: number): HTMLElement[] => drawPictureTies(panel, geo, lines, layer, index),
  };
}

/** Builds the narrow list: one card per party, with an empty list for its outgoing ties. */
function drawListCards<C extends Cite>(panel: Panel<C>, canvas: HTMLElement): Map<string, HTMLElement> {
  const lists = new Map<string, HTMLElement>();
  let group: HTMLElement | null = null;
  panel.model.rows.forEach((row, r) => {
    // The entity tiers share one titled group; the tiers keep their order inside it.
    if (!group || panel.model.rows[r - 1]?.kind !== row.kind) {
      group = html('section', { class: 'track-control__row' }, canvas);
      html('p', { class: 'track-control__row-title t-label' }, group, ROW_WORDS[row.kind]);
    }
    for (const id of row.ids) {
      const card = html('div', { class: 'track-control__card' }, group!); // safe: set at the top of the row
      nodeBox(panel, id, card, 'list');
      lists.set(id, html('ul', { class: 'track-control__out' }, card));
    }
  });
  return lists;
}

/** Fills each party's list with its ties at a step; returns the tie marks in reading order. */
function drawListTies<C extends Cite>(panel: Panel<C>, lists: Map<string, HTMLElement>, index: number): HTMLElement[] {
  for (const list of lists.values()) list.replaceChildren();
  const marks: HTMLElement[] = [];
  panel.model.links.forEach((link, i) => {
    const tie = panel.model.ties[index]?.[i];
    const list = lists.get(link.from);
    if (!tie || !list) return;
    const item = html('li', {}, list);
    const mark = html('span', { class: 'track-control__tie', 'data-state': tie.state, 'data-mode': 'list' }, item);
    lineSample(tie.state, mark);
    const text = html('span', { class: 'track-control__tie-text' }, mark);
    html('span', { class: 'track-control__to' }, text, partyName(panel, link.to));
    tieWords(tie, text);
    mark.setAttribute('aria-label', tieSentence(panel, link, tie));
    wire(panel, mark, i);
    marks.push(mark);
  });
  for (const list of lists.values()) list.hidden = list.childElementCount === 0;
  return marks;
}

/** The narrow layout: each party with its ties under it. */
function drawList<C extends Cite>(panel: Panel<C>): Drawn {
  const canvas = html('div', { class: 'track-control', 'data-mode': 'list', role: 'group', 'aria-label': panel.opts.title }, panel.frame.plot);
  panel.short = new Set();
  const lists = drawListCards(panel, canvas);
  return {
    canvas,
    empty: html('p', { class: 'track-control__empty', hidden: true }, canvas, NO_TIE_WORDS),
    ties: (index: number): HTMLElement[] => drawListTies(panel, lists, index),
  };
}

/** The table twin: every tie at a step. */
function fillControlTable<C extends Cite>(panel: Panel<C>, index: number): void {
  const { model, opts } = panel;
  const rows = model.links.map((link, i) => {
    const tie = model.ties[index]?.[i];
    const lead = tie?.basis[0];
    const cites = (link.structural ? link.cites ?? [] : (tie?.basis ?? []).flatMap((st) => st.cites)).map((c) => opts.citeText(c)).filter(Boolean);
    const source = link.structural ? 'organization record' : lead ? `${BASIS_WORDS[lead.basis]}, ${lead.asOf}` : '';
    return [
      partyName(panel, link.from), partyName(panel, link.to), link.label,
      tie ? `${STATE_WORDS[tie.state]}: ${tie.words}${tie.later ? `. ${tie.later}` : ''}` : 'Not shown at this date',
      source, [...new Set(cites)].join('; '),
    ];
  });
  fillTable(panel.frame.tableWrap, `${opts.title}, ties at step ${index + 1}`, [
    { label: 'From' }, { label: 'To' }, { label: 'Tie' }, { label: 'State at this step' }, { label: 'Source' }, { label: 'Cites' },
  ], rows);
}

/** Draws the ties at the current step. `keepFocus`: a tie had focus, so focus the same tie, or the first. */
function applyStep<C extends Cite>(panel: Panel<C>, keepFocus: boolean): void {
  const { drawn } = panel;
  if (!drawn) return;
  markNodes(panel, drawn.canvas, panel.current);
  const marks = drawn.ties(panel.current);
  drawn.empty.hidden = marks.length > 0;
  const focusAt = rovingFocus(marks, linearNext(marks.length), (i) => {
    panel.focused = Number(marks[i]?.dataset.tie ?? -1);
    tipFor(panel, marks[i]!, panel.focused); // safe: i comes from marks
  });
  if (keepFocus && marks.length > 0) focusAt(Math.max(marks.findIndex((m) => Number(m.dataset.tie) === panel.focused), 0));
  fillControlTable(panel, panel.current);
}

function panelHasFocus<C extends Cite>(panel: Panel<C>): boolean {
  return panel.drawn?.canvas.contains(document.activeElement) ?? false;
}

/** Draws the control picture of ties into the container and returns its handle. */
export function renderControl<C extends Cite>(
  container: HTMLElement, model: ControlModel<C>, steps: readonly ControlStep[], opts: ControlOptions<C>,
): ControlHandle {
  const frame: Frame = createFrame(container, {
    title: opts.title,
    caption: 'Who held or ran what at each step. The places stay fixed; only the ties change, each in words on its line.',
  });
  frame.root.classList.add('track-control-frame');
  drawLegend(frame, model, steps);
  const detail = html('div', { class: 'track-control__detail', hidden: true, role: 'region', 'aria-label': 'Sources for the tie' }, frame.root);
  const panel: Panel<C> = { model, steps, opts, frame, detail, current: 0, drawn: null, focused: -1, short: new Set() };

  const stop = observeWidth(frame.plot, (width: number) => {
    const keep = panelHasFocus(panel);
    panel.drawn?.canvas.remove();
    const geo = layoutControl(model, width);
    panel.drawn = geo ? drawPicture(panel, geo) : drawList(panel);
    applyStep(panel, keep);
  });

  return {
    show(index: number): void {
      panel.current = Math.min(Math.max(index, 0), Math.max(steps.length - 1, 0));
      detail.hidden = true;
      hideTip(frame);
      applyStep(panel, panelHasFocus(panel));
    },
    destroy(): void {
      stop();
      frame.destroy();
    },
  };
}
