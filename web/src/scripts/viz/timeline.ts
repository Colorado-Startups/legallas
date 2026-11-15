// SPDX-License-Identifier: Apache-2.0
// Card F5a (timeline viz). The chronology timeline: lanes by side, actor or event type; partial dates as bands;
// zoom by buttons, keys and the minimap brush; hover and focus readouts; a table twin; a compact ribbon for the
// Overview. Framework-free SVG, CSP-safe (no style= attributes), themed only through tokens in timeline.css.
//
//   const timeline = createTimeline(el, { data, onSelect: (event) => openEvent(event) });
//   timeline.setFilters({ people: ['p-roe'], from: '2012' });
import './timeline.css';
import type { MatterEvent } from '../../../worker/matter-types.ts';
import { isoLabel } from './timeline-dates.ts';
import { drawEvent, drawFrame } from './timeline-draw.ts';
import { layoutTimeline, type MarkBox, type TimelineMode } from './timeline-layout.ts';
import { createMinimap, type Minimap } from './timeline-minimap.ts';
import {
  applyFilters, buildItems, buildLanes, laneName, periodSpans, SIDE_LABELS, SIDE_ORDER, uniqueItems, type Lane,
  type LaneMode, type MarkSide, type PeriodSpan, type TimelineData, type TimelineFilters, type TimelineItem,
} from './timeline-model.ts';
import { bindInput } from './timeline-input.ts';
import { clear, html, shapeIcon, svg } from './timeline-svg.ts';
import { renderTable } from './timeline-table.ts';
import { buildToolbar, showZoomTools, updateToolbar, type ToolAction } from './timeline-toolbar.ts';
import { createTooltip, type Tooltip } from './timeline-tooltip.ts';
import { clampDomain, ensureVisible, fullExtent, ZOOM_STEP, zoomDomain, type Domain } from './timeline-zoom.ts';

export type { Domain, LaneMode, TimelineData, TimelineFilters, TimelineMode };
/** Which view of the timeline shows: the chart or the table. */
export type TimelineView = 'chart' | 'table';

/** Options for the timeline: its data, and its mode, full or ribbon. */
export interface TimelineOptions {
  data: TimelineData;
  /** 'full' (the Chronology page) or 'ribbon' (the compact Overview strip). Default 'full'. */
  mode?: TimelineMode;
  laneMode?: LaneMode;
  /** Actor lanes beyond this fold into "Others". Default 10. */
  maxActorLanes?: number;
  filters?: TimelineFilters;
  view?: TimelineView;
  /** Accessible name, for example "Chronology". */
  label?: string;
  /** Called on click, Enter or Space on an event, and from the table. */
  onSelect?: (event: MatterEvent) => void;
  /** Fill a table row's Sources cell (cite chips). Default: the count. */
  renderCites?: (cell: HTMLElement, event: MatterEvent) => void;
  /** The toolbar's Table tool. Default true; a page with its own Timeline or Table switch turns it off. */
  tableTool?: boolean;
  /** After the window or the filters change (at most once a frame): the window, its events, whether it is all. */
  onWindow?: (domain: Domain, events: MatterEvent[], whole: boolean) => void;
  /**
   * Shade each violation's period behind the plot, its letter at the start (data.violations). With a violation
   * filter set, only those violations' periods show. Default false.
   */
  periods?: boolean;
}

/** The timeline's handle: replace its data, its filters and its lane mode. */
export interface TimelineHandle {
  setData(data: TimelineData): void;
  setFilters(filters: TimelineFilters): void;
  setLaneMode(mode: LaneMode): void;
  setView(view: TimelineView): void;
  zoomIn(): void;
  zoomOut(): void;
  showAll(): void;
  /** Mark an event selected (null clears) without calling onSelect. */
  select(id: string | null): void;
  /** Move keyboard focus to an event, panning it into view. */
  focusEvent(id: string): void;
  destroy(): void;
}

const ANNOUNCE_MS = 400;

const SIDE_KEYS: readonly MarkSide[] = [...SIDE_ORDER, 'filing'];

class Timeline implements TimelineHandle {
  private readonly options: TimelineOptions;
  private readonly mode: TimelineMode;
  private readonly root: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly plot: SVGSVGElement;
  private readonly tableHost: HTMLElement;
  private readonly live: HTMLElement;
  private readonly tooltip: Tooltip;
  private readonly minimap: Minimap | null;
  private readonly miniHost: HTMLElement;
  private readonly toolbar: HTMLElement | null;
  private readonly observer: ResizeObserver;
  private data: TimelineData;
  private laneMode: LaneMode;
  private filters: TimelineFilters;
  private view: TimelineView;
  private lanes: Lane[] = [];
  /** One item per event per lane (an event can sit in several violation lanes). */
  private items: TimelineItem[] = [];
  /** One item per event, in date order: the table, counts and the window list. */
  private events: TimelineItem[] = [];
  private periods: PeriodSpan[] = [];
  private extent: Domain | null = null;
  private domain: Domain | null = null;
  private marks = new Map<string, MarkBox>();
  private focusedId: string | null = null;
  private selectedId: string | null = null;
  private width = 0;
  private frame = 0;
  private announceTimer = 0;
  private windowKey = '';
  private tableTeardown: () => void = () => {};
  private inputTeardown: () => void = () => {};

  constructor(container: HTMLElement, options: TimelineOptions) {
    this.options = options;
    this.mode = options.mode ?? 'full';
    this.data = options.data;
    this.laneMode = options.laneMode ?? 'side';
    this.filters = options.filters ?? {};
    this.view = options.view ?? 'chart';
    this.root = html('figure', { class: 'tl', 'data-mode': this.mode }, container);
    this.toolbar = this.mode === 'full'
      ? buildToolbar(this.root, { show: options.tableTool !== false, pressed: this.view === 'table' }, (action) => this.act(action))
      : null;
    this.legend = html('ul', { class: 'tl-legend', hidden: '' }, this.root);
    this.stage = html('div', { class: 'tl-stage' }, this.root);
    // tabindex -1: without it Chrome gives the overflowing svg a nameless Tab stop before the events.
    this.plot = svg('svg', { class: 'tl-svg', tabindex: -1 }, this.stage);
    this.tooltip = createTooltip(this.stage);
    this.miniHost = html('div', { class: 'tl-mini-host', hidden: '' }, this.root);
    this.minimap = this.mode === 'full'
      ? createMinimap(this.miniHost, {
        onRange: (domain) => this.setDomain(domain, true),
        onZoom: (factor) => this.zoom(factor),
      })
      : null;
    this.tableHost = html('div', { class: 'tl-table-host', hidden: '' }, this.root);
    this.live = html('p', { class: 'u-vh', 'aria-live': 'polite' }, this.root);
    this.listen();
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(this.root);
    this.rebuild();
  }

  private act(action: ToolAction): void {
    if (action === 'zoom-out') this.zoomOut();
    else if (action === 'zoom-in') this.zoomIn();
    else if (action === 'reset') this.showAll();
    else this.setView(this.view === 'table' ? 'chart' : 'table');
  }

  private listen(): void {
    this.inputTeardown = bindInput(this.plot, {
      tooltip: this.tooltip,
      mark: (id) => this.marks.get(id),
      navPoints: () => this.items.map((item) => ({
        id: item.id, lane: this.lanes.findIndex((lane) => lane.key === item.lane), t: item.span.start,
      })),
      focusedId: () => this.focusedId,
      setFocused: (id) => {
        this.focusedId = id;
      },
      focusEvent: (id) => this.focusEvent(id),
      choose: (id) => this.choose(id),
      zoomIn: () => this.zoomIn(),
      zoomOut: () => this.zoomOut(),
    });
  }

  // ---- model ----

  /** Lanes and items from data, then filters, then the full window. */
  private rebuild(): void {
    this.lanes = buildLanes(this.data, this.laneMode, this.options.maxActorLanes ?? 10);
    this.refilter();
  }

  private refilter(): void {
    this.items = applyFilters(buildItems(this.data, this.lanes, this.laneMode), this.filters);
    this.events = uniqueItems(this.items);
    this.periods = this.options.periods ? periodSpans(this.data, this.filters.violations ?? []) : [];
    this.extent = fullExtent(this.items.map((item) => item.span));
    this.domain = this.extent;
    if (this.focusedId && !this.items.some((item) => item.id === this.focusedId)) this.focusedId = null;
    this.renderTableView();
    this.schedule();
  }

  private itemById(id: string): TimelineItem | undefined {
    return this.items.find((item) => item.id === id);
  }

  // ---- rendering ----

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private summary(): string {
    const label = this.options.label ?? 'Chronology';
    if (!this.events.length) return `${label}: no events match these filters.`;
    const first = isoLabel(this.events[0].span.start, 'year');
    const last = isoLabel(Math.max(...this.events.map((item) => item.span.start)), 'year');
    const range = first === last ? `in ${first}` : `from ${first} to ${last}`;
    const n = this.events.length;
    const lanes = `in ${this.lanes.length} lanes: ${this.lanes.map(laneName).join(', ')}.`;
    return `${label}: ${n} ${n === 1 ? 'event' : 'events'} ${range}, ${lanes}${this.periodSummary()}`;
  }

  /** The shaded periods in words: " Shaded periods: A from 2011-09 on; C 2012 to 2013-06." */
  private periodSummary(): string {
    if (!this.periods.length) return '';
    const words = this.periods.map((period) =>
      period.to === null ? `${period.letter} from ${period.from} on` : `${period.letter} ${period.from} to ${period.to}`);
    return ` Shaded periods: ${words.join('; ')}.`;
  }

  private render(): void {
    const chart = this.view === 'chart';
    this.stage.hidden = !chart;
    this.tableHost.hidden = chart;
    this.miniHost.hidden = !chart || !this.minimap;
    if (this.toolbar) showZoomTools(this.toolbar, chart);
    if (!chart) return;
    this.width = Math.max(240, Math.floor(this.stage.clientWidth || this.root.clientWidth));
    const domain = this.domain ?? { start: 0, end: 1 };
    const layout = layoutTimeline(this.lanes, this.items, domain, this.width, this.mode, this.periods);
    const refocus = this.plot.contains(document.activeElement);
    const labels = layout.sideLabels || this.mode === 'full';
    const filingKey = this.filingKeyInGutter(layout.sideLabels);
    const events = drawFrame(this.plot, layout, this.summary(), this.mode === 'ribbon', labels, filingKey);
    events.setAttribute('aria-label', 'Events. Arrow keys move between events, plus and minus zoom, Enter opens.');
    this.marks = new Map(layout.marks.map((mark) => [mark.id, mark]));
    const tabId = this.focusedId && this.marks.has(this.focusedId) ? this.focusedId : layout.marks[0]?.id ?? null;
    for (const mark of layout.marks) {
      drawEvent(events, mark, { focusedId: this.focusedId, selectedId: this.selectedId }, mark.id === tabId);
    }
    this.renderLegend(labels, filingKey);
    if (this.toolbar && this.domain && this.extent) updateToolbar(this.toolbar, this.domain, this.extent);
    this.notifyWindow();
    if (this.minimap && this.extent && this.domain) this.minimap.render(this.events, this.extent, this.domain, this.width);
    if (refocus && tabId) this.eventEl(tabId)?.focus({ preventScroll: true });
  }

  /** With side lanes and a label column, the filing outline's key joins the lane labels (R59). */
  private filingKeyInGutter(labelColumn: boolean): boolean {
    return this.laneMode === 'side' && labelColumn && this.items.some((item) => item.mark === 'filing');
  }

  private inWindow({ start, end }: Domain): TimelineItem[] {
    return this.events.filter((item) => item.span.end > start && item.span.start < end);
  }

  /** Tells the page what the window shows when the window or the filtered items changed since last time. */
  private notifyWindow(): void {
    if (!this.options.onWindow || !this.domain || !this.extent) return;
    const key = `${this.domain.start}:${this.domain.end}:${this.events.map((item) => item.id).join(',')}`;
    if (key === this.windowKey) return;
    this.windowKey = key;
    const whole = this.domain.end - this.domain.start >= this.extent.end - this.extent.start - 1;
    this.options.onWindow({ ...this.domain }, this.inWindow(this.domain).map((item) => item.event), whole);
  }

  /** Shapes present, keyed by side: needed whenever lane labels and the drawn filing key do not name them. */
  private renderLegend(laneLabels: boolean, filingKey: boolean): void {
    const sideLanes = this.laneMode === 'side' && laneLabels;
    const present = new Set(this.items.map((item) => item.mark));
    const sides = SIDE_KEYS.filter((side) => present.has(side));
    const show = sides.length > 1 && (!sideLanes || (present.has('filing') && !filingKey));
    this.legend.hidden = !show;
    clear(this.legend);
    if (!show) return;
    this.legend.setAttribute('aria-label', 'Key');
    for (const side of sides) {
      if (sideLanes && side !== 'filing') continue;
      const li = html('li', { class: 'tl-legend__item' }, this.legend);
      shapeIcon(side, 12, li);
      html('span', {}, li, SIDE_LABELS[side]);
    }
  }

  private renderTableView(): void {
    this.tableTeardown();
    this.tableTeardown = renderTable(this.tableHost, this.items, this.lanes, {
      label: this.options.label ?? 'Chronology',
      onSelect: this.options.onSelect ? (event) => this.choose(event.id) : undefined,
      renderCites: this.options.renderCites,
      selectedId: this.selectedId,
    });
  }

  private eventEl(id: string): SVGGElement | null {
    return this.plot.querySelector<SVGGElement>(`.tl-event[data-event-id="${CSS.escape(id)}"]`);
  }

  // ---- view changes ----

  private setDomain(domain: Domain, quiet = false): void {
    if (!this.extent) return;
    this.domain = clampDomain(domain, this.extent);
    this.schedule();
    if (!quiet) this.announce();
  }

  private zoom(factor: number): void {
    if (!this.domain || !this.extent) return;
    const focused = this.focusedId ? this.marks.get(this.focusedId) : undefined;
    const at = focused
      ? focused.item.span.start + (focused.item.span.end - focused.item.span.start) / 2
      : (this.domain.start + this.domain.end) / 2;
    this.setDomain(zoomDomain(this.domain, factor, at, this.extent));
  }

  /** Tell screen readers what the window now shows, once the person stops changing it. */
  private announce(): void {
    clearTimeout(this.announceTimer);
    this.announceTimer = window.setTimeout(() => {
      if (!this.domain) return;
      const shown = this.inWindow(this.domain);
      this.live.textContent = `Showing ${isoLabel(this.domain.start, 'day')} to ${isoLabel(this.domain.end, 'day')}, ${shown.length} ${shown.length === 1 ? 'event' : 'events'}.`;
    }, ANNOUNCE_MS);
  }

  private choose(id: string): void {
    const item = this.itemById(id);
    if (!item) return;
    this.select(id);
    this.options.onSelect?.(item.event);
  }

  // ---- public API ----

  setData(data: TimelineData): void {
    this.data = data;
    this.rebuild();
  }

  setFilters(filters: TimelineFilters): void {
    this.filters = { ...filters };
    this.refilter();
  }

  setLaneMode(mode: LaneMode): void {
    this.laneMode = mode;
    this.rebuild();
  }

  setView(view: TimelineView): void {
    this.view = view;
    this.toolbar?.querySelector('[data-tl-action="table"]')?.setAttribute('aria-pressed', String(view === 'table'));
    this.tooltip.hide();
    this.schedule();
  }

  zoomIn(): void {
    this.zoom(ZOOM_STEP);
  }

  zoomOut(): void {
    this.zoom(1 / ZOOM_STEP);
  }

  showAll(): void {
    if (this.extent) this.setDomain(this.extent);
  }

  select(id: string | null): void {
    this.selectedId = id;
    for (const el of this.plot.querySelectorAll<SVGGElement>('.tl-event')) {
      const mark = el.dataset.eventId ? this.marks.get(el.dataset.eventId) : undefined;
      if (id && mark?.item.event.id === id) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
    }
    this.renderTableView();
    this.schedule();
  }

  focusEvent(id: string): void {
    const item = this.itemById(id);
    if (!item || !this.domain || !this.extent) return;
    this.focusedId = id;
    const next = ensureVisible(this.domain, item.span, this.extent);
    if (next !== this.domain || !this.marks.has(id)) {
      this.domain = next;
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.render();
    }
    this.eventEl(id)?.focus({ preventScroll: true });
  }

  destroy(): void {
    this.observer.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    clearTimeout(this.announceTimer);
    this.tableTeardown();
    this.inputTeardown();
    this.minimap?.destroy();
    this.tooltip.destroy();
    this.root.remove();
  }
}

/** Mount a timeline at the end of `container`. */
export function createTimeline(container: HTMLElement, options: TimelineOptions): TimelineHandle {
  return new Timeline(container, options);
}
