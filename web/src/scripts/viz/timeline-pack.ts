// SPDX-License-Identifier: Apache-2.0
// Card F5a (timeline viz). Collision avoidance inside a lane: marks that would overlap move to the next row, and
// a title label is drawn only where it fits before the next mark in its row. Pure: no DOM.

/** A mark's horizontal extent in pixels, x0 <= x1, plus the width its full label would take. */
export interface Extent {
  x0: number;
  x1: number;
  label: number;
}

/** The result of packing extents into rows: the row of each extent and the row count. */
export interface Packed {
  /** Row index per extent, in input order. */
  rows: number[];
  rowCount: number;
  /** Label width granted per extent, in input order; 0 means the label is hidden (the tooltip and table carry it). */
  labels: number[];
}

/** Space kept between a mark and the next thing in its row, and between a mark and its label. */
export const PACK_GAP = 6;
/** A cut label narrower than this (about a dozen characters) is noise; hide it instead. */
export const MIN_LABEL = 88;

/** Greedy first-fit by start: each extent goes in the first row whose last end is clear of it. */
export function firstFit(spans: { x0: number; x1: number }[], gap = PACK_GAP): { rows: number[]; rowCount: number } {
  const order = spans.map((_, index) => index).sort((a, b) => spans[a].x0 - spans[b].x0 || a - b);
  const rowEnds: number[] = [];
  const rows = new Array<number>(spans.length).fill(0);
  for (const index of order) {
    const { x0, x1 } = spans[index];
    let row = rowEnds.findIndex((end) => end + gap <= x0);
    if (row < 0) {
      row = rowEnds.length;
      rowEnds.push(x1);
    } else {
      rowEnds[row] = x1;
    }
    rows[index] = row;
  }
  return { rows, rowCount: rowEnds.length };
}

/** Per row, each label gets the room up to the next mark (or the plot edge), or nothing if that room is too small. */
export function fitLabels(extents: Extent[], rows: number[], plotEnd: number, gap = PACK_GAP): number[] {
  const labels = new Array<number>(extents.length).fill(0);
  const byRow = new Map<number, number[]>();
  extents.forEach((_, index) => {
    const list = byRow.get(rows[index]) ?? [];
    list.push(index);
    byRow.set(rows[index], list);
  });
  for (const list of byRow.values()) {
    list.sort((a, b) => extents[a].x0 - extents[b].x0 || a - b);
    list.forEach((index, position) => {
      const next = list[position + 1];
      const limit = next === undefined ? plotEnd : extents[next].x0 - gap;
      const room = Math.min(extents[index].label, limit - (extents[index].x1 + gap));
      labels[index] = room >= Math.min(MIN_LABEL, extents[index].label) && room > 0 ? room : 0;
    });
  }
  return labels;
}

/**
 * Pack a lane. First try giving every mark its full label (each label counts as part of its mark); if that needs
 * more than `maxRows` rows, pack the marks alone and fit labels into the gaps that remain.
 */
export function packLane(extents: Extent[], plotEnd: number, maxRows: number): Packed {
  const withLabels = extents.map((extent) => ({
    x0: extent.x0,
    x1: extent.label > 0 ? Math.min(plotEnd, extent.x1 + PACK_GAP + extent.label) : extent.x1,
  }));
  const generous = firstFit(withLabels);
  if (generous.rowCount <= maxRows) {
    return { ...generous, labels: fitLabels(extents, generous.rows, plotEnd) };
  }
  const tight = firstFit(extents);
  return { ...tight, labels: fitLabels(extents, tight.rows, plotEnd) };
}

/** Cut a label to a pixel width using a per-character estimate, ending in an ellipsis when cut. */
export function truncate(text: string, width: number, charWidth: number): string {
  const fit = Math.floor(width / charWidth);
  if (fit >= text.length) return text;
  if (fit < 2) return '';
  return `${text.slice(0, fit - 1).trimEnd()}…`;
}
