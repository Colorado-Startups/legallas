// SPDX-License-Identifier: Apache-2.0
// Workstream S2 (Structure). The structure tree: every organization as a hex tile (the company shape) under the
// entity that owns or manages it, with its formation date in mono beneath the name. Defendant-side tiles carry an
// oxblood corner flag and the words "Defendant side" (never color alone); the side's own shape sits inside the hex.
// Large sibling groups fold into one "N entities" tile that opens on click. `moves` draw dashed arrows routed clear
// of every name (over the levels, up the gutters between tiles), and a short unit move runs along them only when
// the caller selects a step and motion is allowed. Drawn on the viz/core.ts frame with a table twin and roving
// focus; wide enough screens get a top-down tree, narrow ones the same tree as an indented list. Used by Entities & People and the track pages. CSP: no style= attributes.

import {
  createFrame, fillTable, fitLabel, hideTip, html, prefersReducedMotion, observeWidth, rovingFocus, shapeSvg,
  showTip, SIDE_WORDS, svg, type ChartHandle, type Frame, type MarkSide, type TipLine,
} from './core.ts';
import { guideLook } from '../guide-bus.ts';
import { bracketPath, hexPath, moveElbow, routeMove, wrapName } from './tree-geometry.ts';
import { layoutTree, type TreeLayout, type TreeNode, type TreeOrg } from './tree-layout.ts';

export { gutterX, hexPath, moveElbow, moveRoute, routeMove, wrapName } from './tree-geometry.ts';
export { formedOf, layoutTree, parentsOf } from './tree-layout.ts';
export type { TreeGroup, TreeLayout, TreeLayoutOptions, TreeNode, TreeOrg } from './tree-layout.ts';

/** A unit move: an arrow from one entity to another, labelled ("sold to the new owner"). */
export interface TreeMove {
  from: string;
  to: string;
  label: string;
}

/** Options for the org tree chart: its title, caption and the entities to bring forward. */
export interface TreeOptions {
  title?: string;
  caption?: string;
  /** Entities to bring forward (a step's entities). They never fold away. */
  highlight?: ReadonlySet<string>;
  moves?: TreeMove[];
  /** Keep the room moves take even while none is drawn, so a stepper whose later steps move never jumps. */
  roomForMoves?: boolean;
  /** Sibling groups larger than this fold. Default 6. */
  collapseOver?: number;
  /** The tile chosen on load. */
  selected?: string | null;
  /** Called when a person chooses a tile (or clears it with Escape). */
  onSelect?: (id: string | null) => void;
  view?: 'chart' | 'table';
}

/** The tree chart's handle: mark a tile as chosen, and change the highlighted entities. */
export interface TreeHandle extends ChartHandle {
  /** Marks a tile as chosen (or none) without calling onSelect; a folded tile is brought out of its group. */
  select(id: string | null): void;
  /** Changes the highlighted entities and the moves. `animate` plays the unit move (a step was selected). */
  update(next: { highlight?: ReadonlySet<string>; moves?: TreeMove[]; animate?: boolean }): void;
}

const KIND_WORDS: Record<string, string> = {
  company: 'Company', fund: 'Fund', firm: 'Firm', court: 'Court', agency: 'Agency', other: 'Organization',
};

/** Top-down geometry, px. `moveTop` is the extra room over the first level for a move's label. */
const TD = { col: 140, hex: 44, block: 66, gap: 40, pad: 16, line: 15, moveTop: 18 };
/** Indented geometry, px. `gutter` is the extra left room the moves run in. */
const IN = { row: 58, indent: 28, hex: 30, pad: 12, gutter: 30 };

/** One run of text in a tile line: its class and words. */
type Span = [cls: string, text: string];

interface Placed {
  node: TreeNode;
  /** Hex centre. */
  x: number;
  y: number;
  r: number;
  g: SVGGElement;
}

interface Geometry {
  mode: 'tree' | 'list';
  /** Left edge of the indented list's tiles (past the moves' gutter). */
  left: number;
  width: number;
  height: number;
  at(node: TreeNode): { x: number; y: number };
}

function geometry(layout: TreeLayout, width: number, moves: number): Geometry {
  const treeW = layout.columns * TD.col + TD.pad * 2;
  if (treeW <= width) {
    const left = (width - treeW) / 2 + TD.pad;
    const top = TD.pad + (moves > 0 ? TD.moveTop : 0);
    return {
      mode: 'tree', left, width,
      height: layout.levels * (TD.hex + TD.block + TD.gap) - TD.gap + TD.pad + top,
      at: (n) => ({ x: left + (n.col + 0.5) * TD.col, y: top + n.depth * (TD.hex + TD.block + TD.gap) + TD.hex / 2 }),
    };
  }
  const left = IN.pad + (moves > 0 ? IN.gutter : 0);
  return {
    mode: 'list', left, width,
    height: layout.nodes.length * IN.row + IN.pad * 2,
    at: (n) => ({ x: left + n.depth * IN.indent + IN.hex / 2, y: IN.pad + n.row * IN.row + IN.row / 2 }),
  };
}

function edgePath(geo: Geometry, p: { x: number; y: number }, c: { x: number; y: number }): string {
  if (geo.mode === 'tree') {
    const y1 = p.y + TD.hex / 2 + TD.block - 6;
    const mid = y1 + (c.y - TD.hex / 2 - y1) / 2;
    return `M${p.x} ${y1}V${mid}H${c.x}V${c.y - TD.hex / 2}`;
  }
  return `M${p.x} ${p.y + IN.hex / 2}V${c.y}H${c.x - (IN.hex / 2) * 0.87}`;
}

function sideOf(node: TreeNode): MarkSide {
  return node.org?.side ?? 'none';
}

function labelOf(node: TreeNode, names: Map<string, string>): string {
  if (node.type === 'group') {
    const under = node.parentKey ? names.get(node.parentKey) : '';
    return `${node.members.length} entities under ${under}, folded. Show them`;
  }
  const org = node.org as TreeOrg; // safe: org nodes always carry their org
  const parts = [org.name, KIND_WORDS[org.kind] ?? 'Organization', SIDE_WORDS[org.side]];
  if (node.formed) parts.push(`formed ${node.formed}`);
  if (node.descendants) parts.push(`${node.descendants} ${node.descendants === 1 ? 'entity' : 'entities'} under it`);
  return parts.join(', ');
}

/** One tile's group: brackets and hit area, the hex, the side mark, the flag and the words. */
function drawTile(layer: SVGGElement, geo: Geometry, node: TreeNode, at: { x: number; y: number }, names: Map<string, string>): Placed {
  const tree = geo.mode === 'tree';
  const r = (tree ? TD.hex : IN.hex) / 2;
  const g = svg('g', {
    class: node.type === 'group' ? 'viz-hit viz-tree__group' : 'viz-hit viz-tree__tile', role: 'button',
    'data-key': node.key, 'data-side': sideOf(node), 'aria-label': labelOf(node, names),
    'aria-pressed': node.type === 'org' ? 'false' : undefined, 'aria-expanded': node.type === 'group' ? 'false' : undefined,
  }, layer);
  const box = tree
    ? { x: at.x - TD.col / 2 + 6, y: at.y - r - 6, w: TD.col - 12, h: TD.hex + TD.block }
    : { x: at.x - r - 6, y: at.y - IN.row / 2 + 3, w: geo.width - (at.x - r - 6) - IN.pad, h: IN.row - 6 };
  svg('rect', { class: 'viz-hit__area', x: box.x, y: box.y, width: box.w, height: box.h, rx: 4 }, g);
  svg('path', { class: 'viz-tree__brackets', d: bracketPath(box.x, box.y, box.w, box.h), 'aria-hidden': 'true' }, g);
  // The list leaves room after the hex for the defendant flag, so it never touches the name.
  const textX = tree ? at.x : at.x + r + 16;
  const maxPx = tree ? TD.col - 16 : Math.max(box.w - (textX - box.x) - 8, 40);
  const anchor = tree ? 'middle' : 'start';
  const lines: Span[][] = [];
  if (node.type === 'group') {
    for (const dx of [-6, 0, 6]) svg('path', { class: 'viz-tree__hex viz-tree__hex--stack', d: hexPath(at.x + dx, at.y + dx / 2, r * 0.82) }, g);
    lines.push([['viz-tree__name', `${node.members.length} entities`]], [['viz-tree__hint', 'Show all']]);
  } else {
    const org = node.org as TreeOrg; // safe: org nodes always carry their org
    svg('path', { class: 'viz-tree__hex', d: hexPath(at.x, at.y, r) }, g);
    shapeSvg(org.side, tree ? 16 : 12, g, at.x, at.y);
    if (org.side === 'defendant') {
      const px = at.x + r * 0.87 + 3;
      const py = at.y - r;
      svg('path', { class: 'viz-tree__flag', d: `M${px} ${py + 16}V${py}l10 4l-10 4`, 'aria-hidden': 'true' }, g);
    }
    for (const line of wrapName(org.name, maxPx)) lines.push([['viz-tree__name', line]]);
    const sub: Span[] = [];
    if (node.formed) sub.push(['viz-tree__date', node.formed]);
    if (org.side === 'defendant') sub.push(['viz-tree__word', 'Defendant side']);
    if (tree) for (const s of sub) lines.push([s]);
    else if (sub.length) lines.push(sub);
  }
  lines.forEach((spans, i) => {
    const y = tree ? at.y + r + 15 + i * TD.line : at.y + 4 + (i - (lines.length - 1) / 2) * 14;
    const t = svg('text', { class: 'viz-tree__line', x: textX, y, 'text-anchor': anchor, 'aria-hidden': 'true' }, g);
    spans.forEach(([cls, text], j) => { svg('tspan', { class: cls, dx: j ? 10 : undefined }, t).textContent = text; });
  });
  return { node, x: at.x, y: at.y, r, g };
}

/** Arrow keys: a top-down tree moves by level and column; the indented list moves by row, Left to the parent. */
function treeNext(placed: Placed[], mode: Geometry['mode']): (from: number, key: string) => number {
  const index = new Map(placed.map((p, i) => [p.node.key, i]));
  const firstChild = (i: number) => placed.findIndex((p) => p.node.parentKey === placed[i].node.key);
  const parent = (i: number) => index.get(placed[i].node.parentKey ?? '') ?? -1;
  return (from, key) => {
    if (mode === 'list') {
      if (key === 'ArrowDown') return Math.min(from + 1, placed.length - 1);
      if (key === 'ArrowUp') return Math.max(from - 1, 0);
      if (key === 'ArrowLeft') return parent(from);
      if (key === 'ArrowRight') return firstChild(from);
      return -1;
    }
    if (key === 'ArrowUp') return parent(from);
    if (key === 'ArrowDown') return firstChild(from);
    const here = placed[from];
    const level = placed.map((p, i) => ({ p, i })).filter(({ p }) => p.node.depth === here.node.depth)
      .sort((a, b) => a.p.node.col - b.p.node.col);
    const at = level.findIndex(({ i }) => i === from);
    const to = key === 'ArrowRight' ? level[at + 1] : key === 'ArrowLeft' ? level[at - 1] : undefined;
    return to ? to.i : -1;
  };
}

function legend(frame: Frame, opts: { defendants: boolean; moves: boolean; highlight: boolean }): void {
  frame.root.querySelector('.viz-tree__legend')?.remove();
  const ul = html('ul', { class: 'viz-legend viz-tree__legend' });
  frame.plot.before(ul);
  const item = (cls: string, d: string, text: string) => {
    const li = html('li', { class: 'viz-legend__item' }, ul);
    const box = svg('svg', { class: 'viz-tree__key', viewBox: '0 0 20 20', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false' }, li);
    svg('path', { class: cls, d }, box);
    html('span', {}, li, text);
  };
  item('viz-tree__hex', hexPath(10, 10, 8), 'Entity, under the entity that owns or manages it');
  if (opts.defendants) item('viz-tree__flag', 'M6 18V2l10 4l-10 4', 'Defendant side');
  if (opts.moves) item('viz-tree__move', 'M3 16V5H17V12', 'Move');
  if (opts.highlight) item('viz-tree__hex viz-tree__hex--focus', hexPath(10, 10, 8), 'In focus');
}

function treeTable(frame: Frame, title: string, orgs: TreeOrg[], moves: TreeMove[], highlight: ReadonlySet<string>): void {
  const all = layoutTree(orgs, { collapseOver: Number.POSITIVE_INFINITY });
  const names = new Map(orgs.map((o) => [o.id, o.name]));
  const columns = [{ label: 'Entity' }, { label: 'Part of' }, { label: 'Kind' }, { label: 'Side' }, { label: 'Formed' },
    { label: 'Entities under it', num: true }];
  if (moves.length) columns.push({ label: 'Moves' });
  if (highlight.size) columns.push({ label: 'In focus' });
  const rows = all.nodes.map((n) => {
    const org = n.org as TreeOrg; // safe: an unfolded layout holds org nodes only
    const row = [org.name, n.parentKey ? names.get(n.parentKey) ?? '' : '', KIND_WORDS[org.kind] ?? 'Organization',
      SIDE_WORDS[org.side], n.formed ?? 'Not stated', String(n.descendants)];
    if (moves.length) row.push(moves.filter((m) => m.from === org.id).map((m) => `${m.label}: to ${names.get(m.to) ?? ''}`).join('; '));
    if (highlight.size) row.push(highlight.has(org.id) ? 'Yes' : '');
    return row;
  });
  fillTable(frame.tableWrap, title, columns, rows);
}

/** What one drawn tree shares: its inputs, its frame, what is highlighted or chosen, and the picture drawn now. */
interface TreeView {
  orgs: TreeOrg[];
  opts: TreeOptions;
  title: string;
  frame: Frame;
  names: Map<string, string>;
  folds: HTMLElement;
  moveList: HTMLElement;
  highlight: Set<string>;
  moves: TreeMove[];
  selected: string | null;
  expanded: Set<string>;
  width: number;
  placed: Placed[];
  layout: TreeLayout | null;
  focusAt: ((index: number) => void) | null;
  geo: Geometry | null;
}

/** The tiles that never fold: the highlighted ones and the chosen one. */
function pinnedKeys(view: TreeView): Set<string> {
  return new Set([...view.highlight, ...(view.selected ? [view.selected] : [])]);
}

/** Marks the chosen tile and the highlighted ones. */
function markTiles(view: TreeView): void {
  for (const p of view.placed) {
    if (p.node.type !== 'org') continue;
    p.g.setAttribute('aria-pressed', String(p.node.key === view.selected));
    if (view.highlight.has(p.node.key)) p.g.setAttribute('data-highlight', 'true'); else p.g.removeAttribute('data-highlight');
  }
}

/** A click or Enter on a tile: a folded group opens, an entity is chosen. */
function activateTile(view: TreeView, p: Placed): void {
  if (p.node.type === 'group') {
    const first = p.node.members[0];
    view.expanded.add(p.node.parentKey ?? '');
    drawTree(view, first);
    return;
  }
  view.selected = p.node.key;
  markTiles(view);
  view.opts.onSelect?.(p.node.key);
}

/** One button per open group, to fold it again. */
function drawFolds(view: TreeView): void {
  view.folds.replaceChildren();
  for (const g of view.layout?.groups ?? []) {
    if (!g.expanded) continue;
    const b = html('button', { type: 'button', class: 'c-button c-button--quiet viz-tree__fold', 'data-fold': g.parent }, view.folds,
      `Fold the ${g.size} entities under ${view.names.get(g.parent) ?? ''}`);
    b.addEventListener('click', () => { view.expanded.delete(g.parent); drawTree(view, g.parent); });
  }
}

/** A move in the top-down tree: a routed arrow with its label over the levels. Returns the arrow's path. */
function drawTreeMove(
  geo: Geometry, placed: Placed[], a: Placed, b: Placed, m: TreeMove, lane: number, under: SVGGElement, over: SVGGElement,
): string {
  const g = svg('g', { class: 'viz-tree__moveset', 'aria-hidden': 'true' }, under);
  const route = routeMove(placed, a, b, { col: TD.col, hex: TD.hex, block: TD.block, width: geo.width, lane });
  svg('path', { class: 'viz-tree__move', d: route.d }, g);
  svg('path', { class: 'viz-tree__move-head', d: route.head }, g);
  const label = svg('text', { class: 'viz-tree__move-label', x: route.label.x, y: route.label.y, 'text-anchor': 'middle', 'aria-hidden': 'true' }, over);
  label.textContent = fitLabel(m.label, TD.col * 1.5);
  return route.d;
}

/** A move in the indented list: an elbow arrow in the gutter, its words in the list under the drawing. Returns the arrow's path. */
function drawListMove(view: TreeView, geo: Geometry, a: Placed, b: Placed, m: TreeMove, lane: number, under: SVGGElement): string {
  const g = svg('g', { class: 'viz-tree__moveset', 'aria-hidden': 'true' }, under);
  const elbow = moveElbow(a, b, a.r * 0.87 + 2, b.r * 0.87 + 2, Math.max(geo.left - 10 - lane * 6, 4));
  svg('path', { class: 'viz-tree__move', d: elbow.d }, g);
  svg('path', { class: 'viz-tree__move-head', d: elbow.head }, g);
  const li = html('li', { class: 'viz-legend__item' }, view.moveList);
  html('span', {}, li, `${view.names.get(m.from) ?? ''} to ${view.names.get(m.to) ?? ''}: ${m.label}`);
  return elbow.d;
}

/** Draws every move whose two ends are on screen; plays the unit move along each when `animate`. */
function drawMoves(view: TreeView, under: SVGGElement, over: SVGGElement, geo: Geometry, animate: boolean): void {
  under.replaceChildren();
  over.replaceChildren();
  view.moveList.replaceChildren();
  const byKey = new Map(view.placed.map((p) => [p.node.key, p]));
  let lane = 0;
  for (const m of view.moves) {
    const a = byKey.get(view.layout?.keyOf.get(m.from) ?? '');
    const b = byKey.get(view.layout?.keyOf.get(m.to) ?? '');
    if (!a || !b || a === b) continue;
    const d = geo.mode === 'tree'
      ? drawTreeMove(geo, view.placed, a, b, m, lane, under, over)
      : drawListMove(view, geo, a, b, m, lane, under);
    lane += 1;
    if (animate && !prefersReducedMotion()) unitMove(over, d, Math.min(a.r, 10));
  }
  view.moveList.hidden = view.moveList.childElementCount === 0;
}

/** The svg and its layers: edges, arrows under the tiles, the tiles, then arrow labels and the moving unit on top. */
function drawTreeSvg(view: TreeView, geo: Geometry): { edges: SVGGElement; under: SVGGElement; tiles: SVGGElement; over: SVGGElement } {
  const root = svg('svg', {
    class: 'viz-svg viz-tree', 'data-mode': geo.mode, viewBox: `0 0 ${geo.width} ${geo.height}`,
    width: geo.width, height: geo.height, role: 'group', 'aria-label': view.title,
  }, view.frame.plot);
  const edges = svg('g', { class: 'viz-tree__edges', 'aria-hidden': 'true' }, root);
  // Arrows run under the tiles, so names stay readable; their labels and the moving unit sit on top.
  const under = svg('g', { class: 'viz-tree__moves' }, root);
  const tiles = svg('g', { class: 'viz-tree__tiles' }, root);
  const over = svg('g', { class: 'viz-tree__moves' }, root);
  return { edges, under, tiles, over };
}

/** Draws the parent-to-child lines and the tiles; returns the tiles placed. */
function drawTiles(layout: TreeLayout, geo: Geometry, layers: { edges: SVGGElement; tiles: SVGGElement }, names: Map<string, string>): Placed[] {
  const at = new Map(layout.nodes.map((n) => [n.key, geo.at(n)]));
  for (const e of layout.edges) {
    const p = at.get(e.from);
    const c = at.get(e.to);
    if (p && c) svg('path', { class: 'viz-tree__edge', d: edgePath(geo, p, c) }, layers.edges);
  }
  return layout.nodes.map((n) => drawTile(layers.tiles, geo, n, at.get(n.key) as { x: number; y: number }, names));
}

/** Lays out and draws the whole tree at the current width; puts focus on `focusKey`, or where it was. */
function drawTree(view: TreeView, focusKey?: string, animate = false): void {
  const { frame, opts, orgs } = view;
  if (view.width <= 0) return;
  const active = document.activeElement?.closest?.('[data-key]')?.getAttribute('data-key');
  const want = focusKey ?? (active && frame.plot.contains(document.activeElement) ? active : undefined);
  const layout = layoutTree(orgs, { collapseOver: opts.collapseOver ?? 6, expanded: view.expanded, pinned: pinnedKeys(view) });
  const geo = geometry(layout, view.width, view.moves.length || (opts.roomForMoves ? 1 : 0));
  view.layout = layout;
  view.geo = geo;
  frame.plot.replaceChildren();
  hideTip(frame);
  if (layout.nodes.length === 0) {
    html('p', { class: 'viz-tree__empty t-caption' }, frame.plot, 'No entities in the record yet.');
    return;
  }
  const layers = drawTreeSvg(view, geo);
  view.placed = drawTiles(layout, geo, layers, view.names);
  markTiles(view);
  wireTiles(view);
  drawMoves(view, layers.under, layers.over, geo, animate);
  drawFolds(view);
  legend(frame, {
    defendants: orgs.some((o) => o.side === 'defendant'), moves: view.moves.length > 0, highlight: view.highlight.size > 0,
  });
  treeTable(frame, view.title, orgs, view.moves, view.highlight);
  if (want) {
    const i = view.placed.findIndex((p) => p.node.key === want || p.node.members.includes(want));
    if (i >= 0) view.focusAt?.(i);
  }
}

/** The tooltip for a tile: a folded group's count, or an entity's kind, side, formation and size. */
function showTileTip(view: TreeView, p: Placed): void {
  guideLook(p.g); // the page guide turns toward the tile
  if (p.node.type === 'group') {
    showTip(view.frame, p.g, `${p.node.members.length} entities`, [{ value: 'Folded', label: `under ${view.names.get(p.node.parentKey ?? '') ?? ''}` }]);
    return;
  }
  const org = p.node.org as TreeOrg; // safe: org nodes always carry their org
  const lines: TipLine[] = [{ value: KIND_WORDS[org.kind] ?? 'Organization', label: SIDE_WORDS[org.side], side: org.side }];
  if (p.node.formed) lines.push({ value: p.node.formed, label: 'Formed' });
  if (p.node.descendants) lines.push({ value: String(p.node.descendants), label: 'entities under it' });
  showTip(view.frame, p.g, org.name, lines);
}

/** Hover, focus, click and keys on one tile. */
function bindTile(view: TreeView, p: Placed): void {
  const show = (): void => showTileTip(view, p);
  p.g.addEventListener('pointerenter', show);
  p.g.addEventListener('focus', show);
  p.g.addEventListener('pointerleave', () => hideTip(view.frame));
  p.g.addEventListener('blur', () => hideTip(view.frame));
  p.g.addEventListener('click', () => activateTile(view, p));
  p.g.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateTile(view, p); }
    else if (event.key === 'Escape' && view.selected) {
      event.preventDefault();
      view.selected = null;
      markTiles(view);
      view.opts.onSelect?.(null);
    }
  });
}

/** Roving focus over the tiles, and each tile's handlers. */
function wireTiles(view: TreeView): void {
  const marks = view.placed.map((p) => p.g);
  view.focusAt = rovingFocus(marks, treeNext(view.placed, view.geo?.mode ?? 'tree'), () => {});
  for (const p of view.placed) bindTile(view, p);
}

/** Draws the structure tree of `orgs` into `container`. */
export function renderTree(container: HTMLElement, orgs: TreeOrg[], opts: TreeOptions = {}): TreeHandle {
  const title = opts.title ?? 'Entity structure';
  const frame = createFrame(container, {
    title, view: opts.view,
    caption: opts.caption ?? 'Each entity sits under the entity the record says owns or manages it.',
  });
  frame.root.classList.add('viz-tree-frame');
  const folds = html('div', { class: 'viz-tree__folds' });
  frame.plot.after(folds);
  // The indented list has no room for labels on its arrows, so it lists the moves under the drawing.
  const moveList = html('ul', { class: 'viz-legend viz-tree__movelist', hidden: true });
  frame.plot.after(moveList);
  const view: TreeView = {
    orgs, opts, title, frame, names: new Map(orgs.map((o) => [o.id, o.name])), folds, moveList,
    highlight: new Set(opts.highlight ?? []), moves: opts.moves ?? [], selected: opts.selected ?? null,
    expanded: new Set<string>(), width: 0, placed: [], layout: null, focusAt: null, geo: null,
  };

  const stop = observeWidth(frame.plot, (w: number) => { view.width = w; drawTree(view); });

  return {
    frame,
    select(id: string | null): void {
      view.selected = id;
      const key = id ? view.layout?.keyOf.get(id) : undefined;
      if (id && key && key !== id) drawTree(view); else markTiles(view);
    },
    update(next: { highlight?: ReadonlySet<string>; moves?: TreeMove[]; animate?: boolean }): void {
      if (next.highlight) view.highlight = new Set(next.highlight);
      if (next.moves) view.moves = next.moves;
      drawTree(view, undefined, Boolean(next.animate));
    },
    destroy(): void { stop(); frame.destroy(); },
  };
}

/** The unit move: a small hex travels the arrow once (SMIL, so no style is written), then leaves. */
function unitMove(layer: SVGGElement, path: string, r: number): void {
  const token = svg('path', { class: 'viz-tree__token', d: hexPath(0, 0, r) }, layer);
  const motion = svg('animateMotion', { dur: '600ms', path, fill: 'freeze', begin: 'indefinite' }, token);
  if (typeof (motion as SVGAnimationElement).beginElement !== 'function') { token.remove(); return; }
  (motion as SVGAnimationElement).beginElement();
  window.setTimeout(() => token.remove(), 900);
}
