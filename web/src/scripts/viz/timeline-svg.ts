// SPDX-License-Identifier: Apache-2.0
// Card F5a (timeline viz). Element helpers for the timeline. The party shapes and the svg/html builders live
// in core.ts (one copy of the DESIGN.md section 3 geometry for every chart); these wrappers add the timeline's
// own classes. Every value goes in through attributes or textContent: no style= attributes (CSP), no
// innerHTML of data.
import { html, shapeSvg, svg } from './core.ts';
import type { MarkSide } from './timeline-model.ts';

export { html, svg };

/** Round to a half pixel so 1px rules land on the pixel grid. */
export function crisp(value: number): number {
  return Math.round(value) + 0.5;
}

/** A party shape centered on (cx, cy) at `size` pixels: `viz-mark c-shape` with `data-side` (R34), decorative. */
export function shape(side: MarkSide, size: number, cx: number, cy: number, parent?: Element): SVGSVGElement {
  const el = shapeSvg(side, size, parent, cx, cy);
  el.classList.add('tl-shape');
  return el;
}

/** A standalone inline shape for HTML (legends, table cells), `px` square. */
export function shapeIcon(side: MarkSide, px: number, parent?: Element): SVGSVGElement {
  const el = shapeSvg(side, px, parent);
  el.classList.add('tl-shape', 'tl-icon');
  return el;
}

/** Remove every child. */
export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}
