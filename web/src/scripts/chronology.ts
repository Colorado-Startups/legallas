// SPDX-License-Identifier: Apache-2.0
// Card P2 (Chronology page). Loads the matter, mounts the timeline (F5a) with the violation chips, the filter row,
// the lane control and the Timeline or Table toggle, keeps the selected-event panel and the ?event=<id> deep link in
// step, and prints the table. ?p=<person or org id> (the People page's "Open in chronology", R57) presets the
// Person filter and ?v=<violation id> the violation chip; each stays in the URL while its filter is set. Litigation
// events stay hidden until the Litigation chip is on (a deep link to one turns it on). j and k step through the
// events while focus is in the work area (R80). The page guide looks toward an event the reader points at or
// focuses, and reads when one is opened (guide-bus.ts). With no published matter (404 not_built) the page shows
// its one-sentence empty state; a load that fails anywhere (the fetch, the data, the timeline) ends on its error
// line (settle, page-load.ts).
import { controlPrefix, pageMatter, type RoomEvent, type ServedMatter } from './matter-api.ts';
import {
  eventFromSearch, firstStep, isLitigation, litigationCount, orderedEvents, personFromSearch, personOptions, selectedLine,
  stepKey, summaryLine, toTimelineFilters, violationFromSearch, violationOptions, withEventParam, withParam,
  type FilterState,
} from './chronology-model.ts';
import { mountFilters, type FilterRow } from './chronology-filters.ts';
import { renderInView, type InViewEvent, type InViewParts } from './chronology-inview.ts';
import { renderPanel, tableCites, type PanelParts } from './chronology-panel.ts';
import { initExhibitLinks } from './exhibit-pane.ts';
import { guideLook, guideSend } from './guide-bus.ts';
import { settle, type LoadState } from './page-load.ts';
import type { Position } from './chronology-model.ts';
import { createTimeline, type Domain, type LaneMode, type TimelineHandle, type TimelineView } from './viz/timeline.ts';

const NARROW = '(max-width: 47.99rem)';

function need<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`chronology: missing ${selector}`);
  return el;
}

function panelParts(root: HTMLElement): PanelParts {
  return {
    root,
    position: need(root, '[data-chron-pos]'),
    date: need(root, '[data-chron-date]'),
    kind: need(root, '[data-chron-kind]'),
    title: need(root, '[data-chron-title]'),
    summary: need(root, '[data-chron-event-summary]'),
    people: need(root, '[data-chron-people]'),
    violations: need(root, '[data-chron-violations-list]'),
    counts: need(root, '[data-chron-counts]'),
    sources: need(root, '[data-chron-sources]'),
    previous: need(root, '[data-chron-prev]'),
    next: need(root, '[data-chron-next]'),
    ask: need(root, '[data-chron-ask]'),
    empty: need(root, '[data-chron-panel-empty]'),
    body: need(root, '[data-chron-panel-body]'),
  };
}

/** True while a person is typing, so j and k stay letters. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Set aria-pressed across a button group from the value each button carries in `attr`. */
function press(group: Iterable<HTMLButtonElement>, attr: string, value: string): void {
  for (const button of group) button.setAttribute('aria-pressed', String(button.getAttribute(attr) === value));
}

class ChronologyPage {
  private readonly prefix = controlPrefix();
  private readonly panel: PanelParts;
  private readonly timeline: TimelineHandle;
  private readonly filters: FilterRow;
  private ordered: RoomEvent[];
  /** Every event in date order, for stepping out of an event the filters hide. */
  private readonly all: RoomEvent[];
  private position: Position | null = null;
  private selected: string | null = null;
  private view: TimelineView;
  private printView: TimelineView | null = null;
  private readonly inView: InViewParts;
  /** What the chart's window last showed (onWindow), for the In view table. */
  private shown: { domain: Domain; events: InViewEvent[]; whole: boolean } | null = null;

  constructor(private readonly root: HTMLElement, private readonly matter: ServedMatter) {
    this.panel = panelParts(need(root, '[data-chron-panel]'));
    this.inView = {
      root: need(root, '[data-chron-inview]'), range: need(root, '[data-chron-inview-range]'), rows: need(root, '[data-chron-inview-rows]'),
    };
    this.all = orderedEvents(matter, {});
    this.ordered = this.all;
    this.view = window.matchMedia(NARROW).matches ? 'table' : 'chart';
    const form = need<HTMLFormElement>(root, '[data-chron-filters]');
    const search = window.location.search;
    const linked = matter.events.find((event) => event.id === eventFromSearch(search, matter.events));
    this.filters = mountFilters(
      {
        form, toggle: need(root, '[data-chron-filter-toggle]'), chips: need(root, '[data-chron-active]'),
        marks: need(root, '[data-chron-marks]'),
        presetPerson: personFromSearch(search, personOptions(matter)),
        presetViolation: violationFromSearch(search, violationOptions(matter)),
        presetLitigation: !!linked && isLitigation(linked),
      },
      matter,
      (state) => this.applyFilters(state),
    );
    const host = need<HTMLElement>(root, '[data-chron-timeline]');
    this.timeline = createTimeline(host, {
      data: matter,
      view: this.view,
      filters: toTimelineFilters(this.filters.state()),
      periods: true,
      label: 'Chronology',
      onSelect: (event) => this.select(event.id, 'pick'),
      renderCites: tableCites(this.prefix),
      // The page's own Timeline or Table toggle replaces the timeline's Table tool.
      tableTool: false,
      onWindow: (domain, events, whole) => {
        this.shown = { domain, events, whole };
        this.renderInView();
      },
    });
    initExhibitLinks();
    this.bindTools();
    for (const el of [form, need(root, '[data-chron-tools]'), need(root, '[data-chron-body]'), need(root, '[data-chron-provenance]')]) {
      (el as HTMLElement).hidden = false;
    }
    if (violationOptions(matter).length) need<HTMLElement>(root, '[data-chron-lane="violation"]').hidden = false;
    this.setView(this.view);
    // Litigation starts hidden, so the filters always apply on load.
    this.applyFilters(this.filters.state());
    this.select(linked?.id ?? null, 'load');
  }

  private bindTools(): void {
    const lanes = [...this.root.querySelectorAll<HTMLButtonElement>('[data-chron-lane]')];
    this.root.addEventListener('click', (event) => {
      const target = event.target as Element | null;
      const view = target?.closest<HTMLButtonElement>('[data-chron-view]');
      const lane = target?.closest<HTMLButtonElement>('[data-chron-lane]');
      const inViewPick = target?.closest<HTMLElement>('[data-chron-inview-pick]');
      if (view) this.setView(view.dataset.chronView as TimelineView);
      else if (inViewPick) this.select(inViewPick.dataset.chronInviewPick ?? null, 'pick');
      else if (lane) {
        press(lanes, 'data-chron-lane', lane.dataset.chronLane ?? 'side');
        this.timeline.setLaneMode(lane.dataset.chronLane as LaneMode);
        if (this.selected) this.timeline.select(this.selected);
      } else if (target?.closest('[data-chron-print]')) this.print();
      else if (target?.closest('[data-chron-prev]')) this.step(-1, target);
      else if (target?.closest('[data-chron-next]')) this.step(1, target);
    });
    const body = need<HTMLElement>(this.root, '[data-chron-body]');
    this.bindGuide(need<HTMLElement>(this.root, '[data-chron-timeline]'));
    body.addEventListener('keydown', (event) => {
      if (event.defaultPrevented) return;
      const direction = stepKey(event, isTyping(event.target), body.contains(event.target as Node));
      if (!direction) return;
      event.preventDefault();
      this.stepByKey(direction);
    });
    window.addEventListener('beforeprint', () => this.enterPrint());
    window.addEventListener('afterprint', () => this.leavePrint());
    window.addEventListener('popstate', () => this.select(eventFromSearch(window.location.search, this.matter.events), 'load'));
  }

  /** The guide looks toward the event under the pointer or in focus, once per event (chart marks and table rows). */
  private bindGuide(host: HTMLElement): void {
    let last: Element | null = null;
    const look = (event: Event) => {
      const el = (event.target as Element | null)?.closest('.tl-event, tr[data-event-id]') ?? null;
      if (!el || el === last) return;
      last = el;
      guideLook(el);
    };
    host.addEventListener('pointerover', look);
    host.addEventListener('focusin', look);
    host.addEventListener('pointerleave', () => {
      last = null;
    });
  }

  private setView(view: TimelineView): void {
    this.view = view;
    press(this.root.querySelectorAll<HTMLButtonElement>('[data-chron-view]'), 'data-chron-view', view);
    // Lanes only shape the chart; the table has none to choose.
    need<HTMLElement>(this.root, '[data-chron-lanes]').hidden = view === 'table';
    this.timeline.setView(view);
    this.renderInView();
  }

  /** The In view table follows the chart's window; it shows only while the chart is zoomed in (R59). */
  private renderInView(): void {
    const shown = this.shown;
    renderInView(this.inView, this.view === 'chart' && !!shown && !shown.whole, shown?.domain ?? null, shown?.events ?? [], {
      selectedId: this.selected,
      renderCites: tableCites(this.prefix),
    });
  }

  /** Print always shows the table (the chart's twin), then returns to the view the reader had. */
  private print(): void {
    this.enterPrint();
    window.print();
  }

  private enterPrint(): void {
    if (this.printView !== null) return;
    this.printView = this.view;
    this.timeline.setView('table');
  }

  private leavePrint(): void {
    if (this.printView === null) return;
    this.timeline.setView(this.printView);
    this.printView = null;
  }

  private applyFilters(state: FilterState): void {
    const filters = toTimelineFilters(state);
    this.timeline.setFilters(filters);
    this.ordered = orderedEvents(this.matter, filters);
    const withPerson = withParam(window.location.href, 'p', state.person || null);
    history.replaceState(history.state, '', withParam(new URL(withPerson, window.location.href).href, 'v', state.violation || null));
    if (this.selected) this.timeline.select(this.selected);
    this.renderSummary(state);
    this.renderPanel();
  }

  private renderSummary(state: FilterState): void {
    const litigationHidden = !state.litigation && litigationCount(this.matter.events) > 0;
    need(this.root, '[data-chron-summary]').textContent = summaryLine(this.matter.events, this.ordered.length, litigationHidden);
  }

  private renderPanel(): void {
    const event = this.matter.events.find((candidate) => candidate.id === this.selected) ?? null;
    this.position = renderPanel(this.panel, this.matter, event, this.ordered, this.all, this.prefix);
  }

  /** Select an event (null clears). 'pick' is a reader's choice: it updates the URL and, on phones, shows the panel. */
  private select(id: string | null, how: 'pick' | 'load' | 'step'): void {
    this.selected = id;
    this.timeline.select(id);
    this.renderPanel();
    this.renderInView();
    this.announce(how === 'pick' ? id : null);
    if (how !== 'load' && id) guideSend({ type: 'open' });
    if (how !== 'load') history.replaceState(history.state, '', withEventParam(window.location.href, id));
    if (how === 'pick' && id && window.matchMedia(NARROW).matches) {
      this.panel.root.scrollIntoView({ block: 'start' });
      this.panel.title.focus({ preventScroll: true });
    }
  }

  /** Says a reader's pick once in the polite status (R83); loading, stepping and clearing say nothing. */
  private announce(id: string | null): void {
    const event = id ? this.matter.events.find((candidate) => candidate.id === id) : undefined;
    need(this.root, '[data-chron-status]').textContent = event ? selectedLine(event) : '';
  }

  /**
   * j and k: the next or previous event in the filtered order (the first or last with nothing selected). The chart
   * moves focus to the event; the table keeps focus and brings the row into view.
   */
  private stepByKey(direction: -1 | 1): void {
    const id = this.position ? (direction < 0 ? this.position.previous : this.position.next) : firstStep(this.ordered, direction);
    if (!id) return;
    this.select(id, 'step');
    if (this.view === 'chart') this.timeline.focusEvent(id);
    else this.root.querySelector(`tr[data-event-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  /** Previous and Next walk the filtered order and pan the chart to the event, keeping focus on the button. */
  private step(direction: -1 | 1, from: Element): void {
    const id = direction < 0 ? this.position?.previous : this.position?.next;
    if (!id) return;
    this.select(id, 'step');
    if (this.view === 'chart') this.timeline.focusEvent(id);
    const button = from.closest<HTMLButtonElement>('button');
    (button && !button.disabled ? button : this.panel.title).focus({ preventScroll: true });
  }
}

/** What the page shows only once it has drawn; an error takes it all away, so the error line stands alone. */
const DRAWN = '[data-chron-tools], [data-chron-marks], [data-chron-filters], [data-chron-active], [data-chron-body], [data-chron-provenance]';

/** Where the page's load ended. Ready is the page's own doing (the constructor shows its parts as it builds them). */
function showState(root: HTMLElement, state: LoadState): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-chron-loading]')) el.hidden = true;
  const empty = root.querySelector<HTMLElement>('[data-chron-empty]');
  if (empty) empty.hidden = state !== 'empty';
  const error = root.querySelector<HTMLElement>('[data-chron-error]');
  if (error) error.hidden = state !== 'error';
  if (state !== 'error') return;
  for (const el of root.querySelectorAll<HTMLElement>(DRAWN)) el.hidden = true;
  const summary = root.querySelector('[data-chron-summary]');
  if (summary) summary.textContent = '';
}

/** Every step can fail (the fetch, the data, the timeline while it mounts); each one ends on the error line. */
async function start(): Promise<void> {
  const root = document.querySelector<HTMLElement>('[data-chronology]');
  if (!root) return;
  const emptyText = (text: string) => {
    need(root, '[data-chron-empty-text]').textContent = text;
    return 'empty' as const;
  };
  await settle((state) => showState(root, state), async () => {
    const matter = await pageMatter();
    if (!matter) return emptyText('No chronology has been published yet.');
    if (!matter.events.length) return emptyText('The record has no dated events yet.');
    new ChronologyPage(root, matter);
    return 'ready';
  }, () => guideSend({ type: 'error' }));
}

void start();
