// SPDX-License-Identifier: Apache-2.0
// Card F5b (Charts viz). The people and organization graph: each node is its side's shape and color (people 14px,
// orgs 20px, ring members 12px) with the name beside it, members cluster around their org, and the layout is seeded so it never
// moves between loads. Drag pans; Ctrl or Cmd with the wheel (and trackpad pinch) zooms; the zoom buttons and
// + / - / 0 do the same from the keyboard. Arrows move between nodes by direction, Enter or Space selects
// (onSelect), Esc clears. Every name whose label fits without a collision shows at rest; the rest show on hover,
// focus or selection (the accessible name and the table always carry them). People-page options (R46): `money` draws heavy money edges per
// pair per series (movements by default), `edgeLabels: 'selection'` labels the chosen node's ties, `groups` boxes
// each org with its members, and the
// handle's setSides and setVisible hide nodes without moving the rest. The pure layout is force-layout.ts; the
// extra layers are force-extras.ts.

import { SIDES, type MatterLink, type MatterOrg, type MatterPerson, type Side } from '../../../worker/matter-types.ts';
import {
  createFrame, fillTable, fitLabel, hideTip, html, observeWidth, shapeSvg, showTip, SIDE_WORDS, svg, textWidth,
  type ChartHandle, type Frame,
} from './core.ts';
import { fitContent, frameHeight, marginsOf, type Box, type Margins, type Rect } from './force-fit.ts';
import { createExtras, moneyLegend, type Extras, type ExtrasOptions } from './force-extras.ts';
import {
  buildGraph, degrees, directionalNext, labelPlan, layoutForce, toScreen, zoomAt, type Graph, type GraphEdge, type GraphNode, type LabelSide, type Point, type View,
} from './force-layout.ts';
import { QUIET_ZOOM, RING_NAMED, satellites } from './force-rings.ts';

/** Options for drawing a force graph: its title, caption, selection callback and extra layers. */
export interface ForceOptions extends ExtrasOptions {
  title: string;
  caption?: string;
  /** Called with a node id when a node is chosen, and null when the choice is cleared (also by setSides/setVisible). */
  onSelect?: (id: string | null) => void;
  seed?: number;
  /** Name at most this many nodes at rest, best-connected first (the Overview's small graph, R74). Default: all that fit. */
  maxLabels?: number;
  /** 'drawing' sizes the frame's height to the drawing and the viewport (the People page, R88). Default 'fixed'. */
  frame?: 'fixed' | 'drawing';
}

/** The force graph's handle: it can mark a node as chosen without calling the selection callback. */
export interface ForceHandle extends ChartHandle {
  /** Marks a node as chosen (or none) without calling onSelect, and brings it into view. */
  select(id: string | null): void;
  /**
   * Shows only these sides: other nodes, their edges, money and groups are hidden, leave the table and the arrow
   * keys. The layout does not move. A chosen node that is hidden is cleared (onSelect(null)).
   */
  setSides(sides: Set<Side>): void;
  /** Shows only these node ids (null shows all), the same way. A node shows only when both filters allow it. */
  setVisible(ids: Set<string> | null): void;
}

interface Drawn {
  node: GraphNode;
  world: Point;
  g: SVGGElement;
  /** Mark size in px: SIZE by kind, smaller for a ring member. */
  size: number;
  /** Label box width in px and its priority (ties, orgs first among equals). */
  labelW: number;
  priority: number;
  /** A member of a ring larger than RING_NAMED: named at rest only once zoomed in to QUIET_ZOOM, or beside the chosen node. */
  quiet: boolean;
}

interface Scene {
  root: SVGSVGElement;
  graph: Graph;
  drawn: Drawn[];
  edges: Array<{ e: GraphEdge; line: SVGLineElement }>;
  extras: Extras;
  isOn(id: string): boolean;
  maxLabels: number;
}

const SIZE = { person: 14, org: 20, ring: 12 } as const;
/** Margins assumed before anything is measured (labels run right; captions sit above group boxes). */
const FIRST_MARGINS: Margins = { left: 16, right: 150, top: 40, bottom: 16 };

function graphHeight(width: number): number {
  return Math.round(Math.min(Math.max(width * 0.68, 340), 600));
}

function boxOf(points: Point[]): Box {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return points.length ? { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } : { x0: 0, y0: 0, x1: 1, y1: 1 };
}

/** How far labels, group boxes and captions reach past the shown nodes' centers, measured as drawn. */
function measureMargins(scene: Scene, view: View): Margins {
  const drawn = scene.root.getBBox();
  if (!drawn.width || !drawn.height) return FIRST_MARGINS;
  const centers = boxOf(scene.drawn.filter((d) => scene.isOn(d.node.id)).map((d) => toScreen(view, d.world)));
  return marginsOf(centers, { x0: drawn.x, y0: drawn.y, x1: drawn.x + drawn.width, y1: drawn.y + drawn.height });
}

/** Draws the graph. People, orgs, links and (optionally) money come straight from the matter. */
export function renderForce(
  container: HTMLElement, people: MatterPerson[], orgs: MatterOrg[], links: MatterLink[], opts: ForceOptions,
): ForceHandle {
  const frame = createFrame(container, { title: opts.title, caption: opts.caption });
  const scene = buildScene(frame, people, orgs, links, opts);
  let on = new Set<Side>(SIDES);
  let visible: Set<string> | null = null;
  const sideOf = new Map(scene.graph.nodes.map((n) => [n.id, n.side]));
  scene.isOn = (id) => { const side = sideOf.get(id); return side !== undefined && on.has(side) && (!visible || visible.has(id)); };
  forceTable(frame, opts.title, scene);
  let size = { w: 0, h: 0 };
  let view: View = { k: 1, x: 0, y: 0 };
  let chosen: string | null = null;

  const place = () => placeAll(scene, view);
  /** Frames the shown nodes and everything drawn around them with 24px to spare (R81); labels move with the zoom, so twice. */
  const fit = () => {
    const shown = scene.drawn.filter((d) => scene.isOn(d.node.id));
    const world = boxOf((shown.length ? shown : scene.drawn).map((d) => d.world));
    view = fitContent(world, FIRST_MARGINS, size.w, size.h);
    place();
    for (let pass = 0; pass < 2; pass += 1) {
      view = fitContent(world, measureMargins(scene, view), size.w, size.h);
      place();
    }
  };
  const zoom = (factor: number) => { view = zoomAt(view, factor, size.w / 2, size.h / 2); place(); };
  const reveal = (d: Drawn) => {
    const p = toScreen(view, d.world);
    if (p.x > 24 && p.x < size.w - 24 && p.y > 24 && p.y < size.h - 24) return;
    view = { ...view, x: view.x + size.w / 2 - p.x, y: view.y + size.h / 2 - p.y };
    place();
  };
  const select = (id: string | null) => {
    chosen = id;
    highlight(scene, id);
    const d = scene.drawn.find((x) => x.node.id === id);
    if (d) reveal(d);
    place();
  };
  const choose = (id: string | null) => { select(chosen === id ? null : id); opts.onSelect?.(chosen); };
  const refilter = () => {
    if (chosen && !scene.isOn(chosen)) { select(null); opts.onSelect?.(null); }
    keepTabStop(scene);
    forceTable(frame, opts.title, scene);
    place();
  };
  const setSides = (sides: Set<Side>) => { on = new Set(sides); refilter(); };
  const setVisible = (ids: Set<string> | null) => { visible = ids ? new Set(ids) : null; refilter(); };

  wireNodes(frame, scene, { reveal, choose, zoom, fit, clear: () => choose(null), current: () => chosen });
  wirePan(scene.root, () => view, (v) => { view = v; place(); });
  wireZoomBar(frame.plot, zoom, fit);
  const stop = observeWidth(frame.plot, (w) => {
    const world = boxOf(scene.drawn.map((d) => d.world));
    const aspect = (world.y1 - world.y0) / Math.max(world.x1 - world.x0, 1);
    size = { w, h: opts.frame === 'drawing' ? frameHeight(w, aspect, window.innerHeight, world.y1 - world.y0) : graphHeight(w) };
    for (const [k, v] of [['width', size.w], ['height', size.h]] as const) scene.root.setAttribute(k, String(v));
    scene.root.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`);
    fit();
  });
  return { frame, select, setSides, setVisible, destroy: () => { stop(); frame.destroy(); } };
}

/** The SVG layers, nodes, edges and extras, appended to the frame's plot. */
function buildScene(frame: Frame, people: MatterPerson[], orgs: MatterOrg[], links: MatterLink[], opts: ForceOptions): Scene {
  const graph = buildGraph(people, orgs, links);
  const world = layoutForce(graph, opts.seed ?? 7);
  const root = svg('svg', { class: 'viz-svg viz-force', role: 'group', 'aria-label': opts.title });
  const edgeLayer = svg('g', { class: 'viz-force__edges', 'aria-hidden': 'true' }, root);
  const nodeLayer = svg('g', { class: 'viz-force__nodes' }, root);
  const edges = graph.edges.map((e) => ({ e, line: svg('line', { class: 'viz-force__edge', 'data-kind': e.kind }, edgeLayer) }));
  const ties = degrees(graph);
  const ring = satellites(graph);
  const ringSize = new Map<string, number>();
  for (const hub of ring.values()) ringSize.set(hub, (ringSize.get(hub) ?? 0) + 1);
  const drawn: Drawn[] = graph.nodes.map((node) => {
    const size = ring.has(node.id) ? SIZE.ring : SIZE[node.kind];
    return {
      node, world: world.get(node.id) ?? { x: 0, y: 0 }, g: drawNode(nodeLayer, node, size), size,
      labelW: textWidth(fitLabel(node.name, 160)) * (node.kind === 'org' ? 1.08 : 1), priority: (ties.get(node.id) ?? 0) + (node.kind === 'org' ? 0.5 : 0),
      quiet: (ringSize.get(ring.get(node.id) ?? '') ?? 0) > RING_NAMED,
    };
  });
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const extras = createExtras(root, edgeLayer, nodeLayer, graph, opts, (id) => byId.get(id)?.side ?? 'none', (id) => byId.get(id)?.name ?? '');
  if (extras.hasMoney) frame.plot.before(moneyLegend(extras.series));
  frame.plot.append(zoomBar(), root);
  return { root, graph, drawn, edges, extras, isOn: () => true, maxLabels: opts.maxLabels ?? Infinity };
}

/** Keeps the graph's one Tab stop on a shown node when filters hide the current one. */
function keepTabStop(scene: Scene): void {
  const current = scene.drawn.find((d) => d.g.getAttribute('tabindex') === '0');
  if (current && scene.isOn(current.node.id)) return;
  const next = scene.drawn.find((d) => scene.isOn(d.node.id));
  for (const d of scene.drawn) d.g.setAttribute('tabindex', d === next ? '0' : '-1');
}

/** Moves every node and edge to its screen position for `view`, hides switched-off sides, then the extras. */
function placeAll(scene: Scene, view: View): void {
  const { drawn, edges, isOn } = scene;
  const at = new Map(drawn.map((d) => [d.node.id, toScreen(view, d.world)]));
  for (const d of drawn) {
    const p = at.get(d.node.id) as Point; // safe: every drawn node is in the map
    d.g.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
    offWhen(d.g, !isOn(d.node.id));
  }
  const { taken, named } = planLabels(scene, at, view.k);
  for (const { e, line } of edges) {
    const a = at.get(e.source);
    const b = at.get(e.target);
    offWhen(line, !isOn(e.source) || !isOn(e.target));
    if (!a || !b) continue;
    line.setAttribute('x1', a.x.toFixed(1)); line.setAttribute('y1', a.y.toFixed(1));
    line.setAttribute('x2', b.x.toFixed(1)); line.setAttribute('y2', b.y.toFixed(1));
  }
  scene.extras.place(at, isOn, taken, named);
}

/**
 * Names every node whose label fits without touching another label or mark, best-connected first (R65, R74,
 * R88), the chosen node and its ties before the rest; the others show their name on hover or focus, and a large
 * ring's members wait for zoom `k` to reach QUIET_ZOOM. Returns the placed names and the marks, for the money
 * amounts and group captions to keep clear of (R81), and the ids named.
 */
function planLabels(scene: Scene, at: Map<string, Point>, k: number): { taken: Rect[]; named: Set<string> } {
  const shown = scene.drawn.filter((d) => scene.isOn(d.node.id));
  const point = (d: Drawn) => at.get(d.node.id) as Point; // safe: every drawn node is in the map
  const boxes = shown.filter((d) => !d.quiet || k >= QUIET_ZOOM || d.g.hasAttribute('data-near')).map((d) => {
    const p = point(d);
    const half = d.size / 2;
    const w = d.labelW;
    return {
      id: d.node.id, w, h: 13, priority: d.priority + (d.g.hasAttribute('data-near') ? NEAR_FIRST : 0),
      at: [
        { side: 'right' as const, x: p.x + half + 5, y: p.y - 9 }, { side: 'left' as const, x: p.x - half - 5 - w, y: p.y - 9 },
        { side: 'above' as const, x: p.x - w / 2, y: p.y - half - 16 }, { side: 'below' as const, x: p.x - w / 2, y: p.y + half + 3 },
        { side: 'above-right' as const, x: p.x + half, y: p.y - half - 13 }, { side: 'below-right' as const, x: p.x + half, y: p.y + half },
      ],
    };
  });
  const marks = shown.map((d) => ({ id: d.node.id, ...point(d), r: d.size / 2 }));
  const plan = labelPlan(boxes, marks, scene.maxLabels);
  const taken: Rect[] = marks.map((m) => ({ x: m.x - m.r, y: m.y - m.r, w: m.r * 2, h: m.r * 2 }));
  for (const box of boxes) {
    const spot = box.at.find((a) => a.side === plan.get(box.id));
    if (spot) taken.push({ x: spot.x, y: spot.y, w: box.w, h: box.h });
  }
  for (const d of scene.drawn) {
    const side = plan.get(d.node.id) ?? 'right';
    d.g.setAttribute('data-label', plan.has(d.node.id) ? 'on' : 'off');
    const text = d.g.querySelector('.viz-force__label');
    const [x, y, anchor] = LABEL_AT[side](d.size / 2);
    text?.setAttribute('x', String(x));
    text?.setAttribute('y', String(y));
    text?.setAttribute('text-anchor', anchor);
  }
  return { taken, named: new Set(plan.keys()) };
}

/** The chosen node and its ties are named before anyone else. */
const NEAR_FIRST = 1000;

/** The label's text position relative to its mark (baseline 4px under a centered line), per side. */
const LABEL_AT: Record<LabelSide, (half: number) => [number, number, string]> = {
  right: (half) => [half + 5, 4, 'start'],
  left: (half) => [-half - 5, 4, 'end'],
  above: (half) => [0, -half - 6, 'middle'],
  below: (half) => [0, half + 13, 'middle'],
  'above-right': (half) => [half, -half - 3, 'start'],
  'below-right': (half) => [half, half + 10, 'start'],
};

function offWhen(el: Element, off: boolean): void {
  if (off) el.setAttribute('data-off', 'true'); else el.removeAttribute('data-off');
}

function drawNode(layer: SVGGElement, node: GraphNode, size: number): SVGGElement {
  const label = `${node.name}, ${node.detail ? `${node.detail}, ` : ''}${SIDE_WORDS[node.side]}`;
  const g = svg('g', { class: 'viz-force__node', 'data-kind': node.kind, role: 'button', 'aria-pressed': 'false', 'aria-label': label, tabindex: '-1' }, layer);
  svg('circle', { class: 'viz-hit__area', r: 14 }, g);
  shapeSvg(node.side, size, g, 0, 0);
  const text = svg('text', { class: 'viz-force__label', x: size / 2 + 5, y: 4, 'aria-hidden': 'true' }, g);
  text.textContent = fitLabel(node.name, 160);
  return g;
}

function zoomBar(): HTMLElement {
  const bar = html('div', { class: 'viz-zoom', role: 'group', 'aria-label': 'Zoom' });
  html('button', { type: 'button', class: 'c-button viz-zoom__button', 'data-zoom': 'in', 'aria-label': 'Zoom in' }, bar, '+');
  html('button', { type: 'button', class: 'c-button viz-zoom__button', 'data-zoom': 'out', 'aria-label': 'Zoom out' }, bar, '−');
  html('button', { type: 'button', class: 'c-button viz-zoom__button', 'data-zoom': 'fit' }, bar, 'Fit');
  return bar;
}

function wireZoomBar(plot: HTMLElement, zoom: (f: number) => void, fit: () => void): void {
  plot.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
    const which = b.getAttribute('data-zoom');
    if (which === 'fit') fit();
    else zoom(which === 'in' ? 1.25 : 0.8);
  }));
}

interface NodeActions {
  reveal(d: Drawn): void;
  choose(id: string | null): void;
  zoom(factor: number): void;
  fit(): void;
  clear(): void;
  current(): string | null;
}

/** Everything tied to a node: its graph edges, then its money lines. */
function connections(scene: Scene, id: string): Array<{ label: string; other: string }> {
  const graphLines = scene.graph.edges.flatMap((e) => (e.source === id ? [{ label: e.label, other: e.target }] : e.target === id ? [{ label: e.label, other: e.source }] : []));
  return [...graphLines, ...scene.extras.moneyLines(id)];
}

function wireNodes(frame: Frame, scene: Scene, act: NodeActions): void {
  const { drawn, graph } = scene;
  const names = new Map(graph.nodes.map((n) => [n.id, n.name]));
  const focusAt = (i: number) => {
    drawn.forEach((d, j) => d.g.setAttribute('tabindex', i === j ? '0' : '-1'));
    act.reveal(drawn[i]);
    drawn[i].g.focus();
  };
  const step = (from: number, key: string) => {
    const live = drawn.map((d, i) => ({ d, i })).filter(({ d }) => scene.isOn(d.node.id) || d === drawn[from]);
    const to = directionalNext(live.map(({ d }) => d.world), live.findIndex(({ i }) => i === from), key);
    return to >= 0 ? live[to].i : -1;
  };
  drawn[0]?.g.setAttribute('tabindex', '0');
  drawn.forEach((d, i) => {
    const show = () => {
      const lines = connections(scene, d.node.id).slice(0, 6).map((n) => ({ value: names.get(n.other) ?? '', label: n.label }));
      showTip(frame, d.g, d.node.name, lines.length ? lines : [{ value: d.node.detail, label: SIDE_WORDS[d.node.side] }]);
    };
    d.g.addEventListener('pointerenter', show);
    d.g.addEventListener('focus', show);
    d.g.addEventListener('pointerleave', () => hideTip(frame));
    d.g.addEventListener('blur', () => hideTip(frame));
    d.g.addEventListener('click', () => act.choose(d.node.id));
    d.g.addEventListener('keydown', (event) => {
      const { key } = event;
      let handled = true;
      if (key === 'Enter' || key === ' ') act.choose(d.node.id);
      else if (key === 'Escape') { if (act.current()) act.clear(); else handled = false; }
      else if (key === '+' || key === '=') act.zoom(1.25);
      else if (key === '-') act.zoom(0.8);
      else if (key === '0') act.fit();
      else if (key.startsWith('Arrow')) {
        const to = step(i, key);
        if (to >= 0) focusAt(to);
      } else handled = false;
      if (handled) event.preventDefault();
    });
  });
}

function wirePan(root: SVGSVGElement, get: () => View, set: (v: View) => void): void {
  let drag: { id: number; x: number; y: number; view: View } | null = null;
  root.addEventListener('pointerdown', (event) => {
    if ((event.target as Element).closest('.viz-force__node')) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, view: get() };
    root.setPointerCapture(event.pointerId);
    root.setAttribute('data-state', 'panning');
  });
  root.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    set({ ...drag.view, x: drag.view.x + event.clientX - drag.x, y: drag.view.y + event.clientY - drag.y });
  });
  const end = () => { drag = null; root.removeAttribute('data-state'); };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const box = root.getBoundingClientRect();
    set(zoomAt(get(), Math.exp(-event.deltaY * 0.01), event.clientX - box.left, event.clientY - box.top));
  }, { passive: false });
}

function highlight(scene: Scene, id: string | null): void {
  const near = new Set(id ? [id, ...connections(scene, id).map((n) => n.other)] : []);
  if (id) scene.root.setAttribute('data-focus', 'node'); else scene.root.removeAttribute('data-focus');
  for (const d of scene.drawn) {
    d.g.setAttribute('aria-pressed', String(d.node.id === id));
    if (near.has(d.node.id)) d.g.setAttribute('data-near', 'true'); else d.g.removeAttribute('data-near');
  }
  for (const { e, line } of scene.edges) {
    if (id && (e.source === id || e.target === id)) line.setAttribute('data-near', 'true'); else line.removeAttribute('data-near');
  }
  scene.extras.choose(id);
}

/** The table twin: every node on a shown side, with its ties and money. */
function forceTable(frame: Frame, title: string, scene: Scene): void {
  const names = new Map(scene.graph.nodes.map((n) => [n.id, n.name]));
  const rows = scene.graph.nodes.filter((n) => scene.isOn(n.id))
    .sort((a, b) => a.side.localeCompare(b.side) || a.name.localeCompare(b.name)).map((n) => [
      n.name, SIDE_WORDS[n.side], n.detail,
      connections(scene, n.id).filter((x) => scene.isOn(x.other)).map((x) => `${x.label}: ${names.get(x.other) ?? ''}`).join('; '),
    ]);
  fillTable(frame.tableWrap, title, [{ label: 'Name' }, { label: 'Side' }, { label: 'Role' }, { label: 'Connections' }], rows);
}
