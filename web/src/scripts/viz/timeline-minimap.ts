// SPDX-License-Identifier: Apache-2.0
// Card F5a (timeline viz). The overview strip under the timeline: every event as a hairline tick, and a brush
// window showing the visible range. Drag the window to pan, its edges to resize, or the track to draw a new range.
// The window is a keyboard slider too: arrows pan, Page Up/Down pan a full window, +/- zoom, Home/End go to the ends.
import { isoLabel } from './timeline-dates.ts';
import type { TimelineItem } from './timeline-model.ts';
import { chooseTicks, tickLabelFits, TICK_OFFSET } from './timeline-ticks.ts';
import { brushGrip, dragBrush, msToPx, panDomain, pxToMs, type BrushGrip, type Domain } from './timeline-zoom.ts';
import { clear, crisp, svg } from './timeline-svg.ts';

const HEIGHT = 52;
const TRACK = { y0: 6, y1: 34 };
const PAD = 8;
const HANDLE = { w: 6, h: 18 };

/** Callbacks for the minimap: the person moved or resized the window, or pressed plus or minus on it. */
export interface MinimapCallbacks {
  /** The person moved or resized the window. */
  onRange(domain: Domain): void;
  /** The person pressed + or - on the window. */
  onZoom(factor: number): void;
}

/** The minimap's handle: render it and destroy it. */
export interface Minimap {
  render(items: TimelineItem[], extent: Domain, domain: Domain, width: number): void;
  destroy(): void;
}

interface Drag {
  grip: BrushGrip;
  start: Domain;
  fromMs: number;
}

interface View {
  extent: Domain;
  domain: Domain;
  width: number;
}

class MinimapView implements Minimap {
  private readonly root: SVGSVGElement;
  private readonly marks: SVGGElement;
  private readonly shades: SVGRectElement[];
  private readonly thumb: SVGGElement;
  private readonly frame: SVGRectElement;
  private readonly handles: SVGRectElement[];
  private readonly ticks: SVGGElement;
  private readonly callbacks: MinimapCallbacks;
  private view: View | null = null;
  private drag: Drag | null = null;

  constructor(host: HTMLElement, callbacks: MinimapCallbacks) {
    this.callbacks = callbacks;
    const trackH = TRACK.y1 - TRACK.y0;
    this.root = svg('svg', { class: 'tl-mini', height: HEIGHT, role: 'group', 'aria-label': 'Range' }, host);
    this.marks = svg('g', { class: 'tl-mini-marks', 'aria-hidden': 'true' }, this.root);
    this.shades = [0, 1].map(() => svg('rect', { class: 'tl-mini-shade', y: TRACK.y0, height: trackH }, this.root));
    this.thumb = svg('g', {
      class: 'tl-mini-thumb', tabindex: 0, role: 'slider', 'aria-label': 'Visible range',
      'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-orientation': 'horizontal',
    }, this.root);
    this.frame = svg('rect', { class: 'tl-mini-window', y: TRACK.y0 + 0.75, height: trackH - 1.5, rx: 3 }, this.thumb);
    this.handles = [0, 1].map(() => svg('rect', {
      class: 'tl-mini-handle', width: HANDLE.w, height: HANDLE.h, rx: 2, y: (TRACK.y0 + TRACK.y1 - HANDLE.h) / 2,
    }, this.thumb));
    this.ticks = svg('g', { class: 'tl-mini-ticks', 'aria-hidden': 'true' }, this.root);
    this.root.addEventListener('pointerdown', this.onPointerDown);
    this.root.addEventListener('pointermove', this.onPointerMove);
    this.root.addEventListener('pointerup', this.onPointerUp);
    this.root.addEventListener('pointercancel', this.onPointerUp);
    this.thumb.addEventListener('keydown', this.onKeyDown);
  }

  private toPx(ms: number): number {
    return this.view ? msToPx(ms, this.view.extent, PAD, this.view.width - PAD) : 0;
  }

  private toMs(px: number): number {
    return this.view ? pxToMs(px, this.view.extent, PAD, this.view.width - PAD) : 0;
  }

  private whole(): boolean {
    return !!this.view && this.view.domain.end - this.view.domain.start >= this.view.extent.end - this.view.extent.start - 1;
  }

  private windowPx(): { x0: number; x1: number } {
    return this.view ? { x0: this.toPx(this.view.domain.start), x1: this.toPx(this.view.domain.end) } : { x0: 0, x1: 0 };
  }

  private localX(event: PointerEvent): number {
    return event.clientX - this.root.getBoundingClientRect().left;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.view || event.button !== 0) return;
    const px = this.localX(event);
    this.drag = { grip: brushGrip(px, this.windowPx(), this.whole()), start: this.view.domain, fromMs: this.toMs(px) };
    this.root.setPointerCapture(event.pointerId);
    this.root.dataset.dragging = this.drag.grip;
    event.preventDefault();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.view) return;
    const px = this.localX(event);
    if (!this.drag) {
      this.root.dataset.grip = brushGrip(px, this.windowPx(), this.whole());
      return;
    }
    this.callbacks.onRange(dragBrush(this.drag.grip, this.drag.start, this.drag.fromMs, this.toMs(px), this.view.extent));
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.drag) return;
    this.drag = null;
    delete this.root.dataset.dragging;
    if (this.root.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.view) return;
    const { domain, extent } = this.view;
    const span = domain.end - domain.start;
    const moves: Record<string, number> = {
      ArrowLeft: -span / 10, ArrowRight: span / 10, PageUp: -span, PageDown: span,
      Home: extent.start - domain.start, End: extent.end - domain.end,
    };
    if (event.key in moves) this.callbacks.onRange(panDomain(domain, moves[event.key], extent));
    else if (event.key === '+' || event.key === '=') this.callbacks.onZoom(2);
    else if (event.key === '-' || event.key === '_') this.callbacks.onZoom(0.5);
    else return;
    event.preventDefault();
  };

  render(items: TimelineItem[], extent: Domain, domain: Domain, width: number): void {
    this.view = { extent, domain, width };
    this.root.setAttribute('width', String(width));
    this.root.setAttribute('viewBox', `0 0 ${width} ${HEIGHT}`);
    this.drawMarks(items);
    this.drawWindow();
    this.drawTicks();
  }

  private drawMarks(items: TimelineItem[]): void {
    clear(this.marks);
    for (const item of items) {
      const x = crisp(this.toPx(item.span.start + (item.span.end - item.span.start) / 2));
      svg('line', {
        class: 'tl-mini-mark', 'data-side': item.mark, x1: x, x2: x, y1: TRACK.y0 + 6, y2: TRACK.y1 - 6,
      }, this.marks);
    }
  }

  private drawWindow(): void {
    if (!this.view) return;
    const { extent, domain, width } = this.view;
    const { x0, x1 } = this.windowPx();
    const set = (el: Element, attrs: Record<string, number>) => {
      for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
    };
    set(this.shades[0], { x: PAD, width: Math.max(0, x0 - PAD) });
    set(this.shades[1], { x: x1, width: Math.max(0, width - PAD - x1) });
    set(this.frame, { x: x0, width: Math.max(1, x1 - x0) });
    set(this.handles[0], { x: x0 - HANDLE.w / 2 });
    set(this.handles[1], { x: x1 - HANDLE.w / 2 });
    const full = extent.end - extent.start;
    this.thumb.setAttribute('aria-valuenow', String(Math.round(((domain.start - extent.start) / full) * 100)));
    this.thumb.setAttribute('aria-valuetext', `${isoLabel(domain.start, 'day')} to ${isoLabel(domain.end, 'day')}`);
  }

  private drawTicks(): void {
    if (!this.view) return;
    const { extent, width } = this.view;
    clear(this.ticks);
    for (const tick of chooseTicks(extent.start, extent.end, width - PAD * 2).ticks) {
      const x = this.toPx(tick.value);
      if (x < PAD || x > width - PAD) continue;
      svg('line', { class: 'tl-axis', x1: crisp(x), x2: crisp(x), y1: TRACK.y1, y2: TRACK.y1 + 4 }, this.ticks);
      if (tickLabelFits(x, tick.label, width)) {
        svg('text', { class: 'tl-tick', x: x + TICK_OFFSET, y: HEIGHT - 4 }, this.ticks).textContent = tick.label;
      }
    }
  }

  destroy(): void {
    this.root.remove();
  }
}

/** Creates a minimap in the host element. */
export function createMinimap(host: HTMLElement, callbacks: MinimapCallbacks): Minimap {
  return new MinimapView(host, callbacks);
}
