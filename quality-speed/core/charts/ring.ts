// SPDX-License-Identifier: Apache-2.0
// The score ring: Quality outer, Speed inside it, Consumption innermost, total in the middle. Each lens is a third of
// the total, so the three rings are drawn the same width. A ring given no Consumption draws the older two-ring form.

import { wholeScore } from './charts.js';
import { clamp, esc, iconPath, isNum, num, safeHref } from './svg.ts';

export type RingSize = 'xl' | 'lg' | 'md' | 'sm';

export interface RingScore {
  q: number;
  s: number;
  c?: number;
}

export interface RingProps {
  /** Rings with the same id move together when the timeline replays history. */
  id?: string;
  q: number | null;
  s: number | null;
  /** Consumption. Leave it out for a two-ring chart; given, it draws a third ring, and null reads as 0. */
  c?: number | null;
  /** The total from the scoring code. The ring never recalculates it. */
  total: number | null;
  size?: RingSize;
  label?: string;
  /** Short text next to the label, such as a room's share of the page. */
  note?: string;
  href?: string;
  baseline?: RingScore;
  now?: RingScore;
  /** Show Quality and Speed as words and numbers under the ring. Defaults to on, except at `sm`. */
  key?: boolean;
  /** Road to 100's own ring, which its toggles move. */
  roadRing?: boolean;
}

const SIZES: readonly RingSize[] = ['xl', 'lg', 'md', 'sm'];
type Kind = 'q' | 's' | 'c';
type Geometry = Record<Kind, { r: number; width: number }>;
const TWO: Geometry = { q: { r: 84, width: 20 }, s: { r: 58, width: 10 }, c: { r: 0, width: 0 } };
/** Three equal rings leave the middle a 48-unit radius, room for the total and its glyphs. */
const THREE: Geometry = { q: { r: 86, width: 12 }, s: { r: 70, width: 12 }, c: { r: 54, width: 12 } };

function arc(rings: Geometry, kind: Kind, value: number): string {
  const { r, width } = rings[kind];
  return `<circle class="qs-rv qs-rv-${kind}" data-arc="${kind}" cx="100" cy="100" r="${r}" stroke-width="${width}" pathLength="100" stroke-dasharray="${num(clamp(value, 0, 100))} 100" transform="rotate(-90 100 100)"/>`;
}

function track(rings: Geometry, kind: Kind): string {
  const { r, width } = rings[kind];
  return `<circle class="qs-rt qs-rt-${kind}" cx="100" cy="100" r="${r}" stroke-width="${width}"/>`;
}

/** A short radial mark across one ring at a score, for baseline and now. */
function tick(rings: Geometry, value: number, kind: Kind, cls: string): string {
  const { r, width } = rings[kind];
  const angle = (clamp(value, 0, 100) / 100) * 2 * Math.PI;
  const at = (rho: number) => [(100 + rho * Math.sin(angle)).toFixed(2), (100 - rho * Math.cos(angle)).toFixed(2)];
  const [x1, y1] = at(r - width / 2 - 2);
  const [x2, y2] = at(r + width / 2 + 2);
  return `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
}

function ticks(rings: Geometry, score: RingScore | undefined, cls: string): string {
  if (!score) return '';
  const third = rings === THREE && isNum(score.c) ? tick(rings, score.c, 'c', cls) : '';
  return tick(rings, score.q, 'q', cls) + tick(rings, score.s, 's', cls) + third;
}

/** The small glyphs in the middle: a warning when empty, a check at 100. */
function glyph(name: string, cls: string, y: number): string {
  return `<path class="qs-rg ${cls}" transform="translate(90 ${y}) scale(1.25)" d="${iconPath(name)}"/>`;
}

function ringKey(q: number, s: number, c: number | null): string {
  const item = (kind: Kind, name: string, value: number) =>
    `<span class="qs-ring-k"><svg class="qs-k qs-k-${kind}" viewBox="0 0 18 6" width="18" height="6" aria-hidden="true"><line x1="1" y1="3" x2="17" y2="3"/></svg>${name} <b data-num="${kind}">${wholeScore(value)}</b></span>`;
  return `<div class="qs-ring-key">${item('q', 'Quality', q)}${item('s', 'Speed', s)}${c === null ? '' : item('c', 'Consumption', c)}</div>`;
}

/** One score ring. */
export function ring(props: RingProps): string {
  const size = props.size && SIZES.includes(props.size) ? props.size : 'lg';
  const score = isNum(props.q) && isNum(props.s) && isNum(props.total) ? { q: props.q, s: props.s, total: props.total } : null;
  const missing = !score;
  const { q, s, total } = score ?? { q: 0, s: 0, total: 0 };
  const three = props.c !== undefined;
  const rings = three ? THREE : TWO;
  // Null reads as 0, never as a gap: an unmeasured lens can't look finished.
  const c = three ? (isNum(props.c) && score ? props.c : 0) : null;
  const label = props.label ?? '';
  const prefix = label ? `${label}: ` : '';
  const spoken = missing
    ? `${prefix}no data, scores 0.`
    : `${prefix}total ${total} of 100. Quality ${wholeScore(q)}. Speed ${wholeScore(s)}.${c === null ? '' : ` Consumption ${wholeScore(c)}.`}`;
  const classes = ['qs-ring', `qs-ring--${size}`];
  if (missing) classes.push('is-missing');
  if (!missing && total >= 100) classes.push('is-full');
  const svg =
    `<svg class="qs-ring-svg" viewBox="0 0 200 200" role="img" aria-label="${esc(spoken)}">` +
    `${track(rings, 'q')}${track(rings, 's')}${c === null ? '' : track(rings, 'c')}${arc(rings, 'q', q)}${arc(rings, 's', s)}${c === null ? '' : arc(rings, 'c', c)}` +
    `<line class="qs-goal-seam" x1="100" y1="4" x2="100" y2="${three ? 52 : 49}"/>${ticks(rings, props.baseline, 'qs-tick-base')}${ticks(rings, props.now, 'qs-tick-now')}` +
    `<text class="qs-ring-total" x="100" y="100" data-num="total">${total}</text>` +
    `${glyph('alert', 'qs-rg-alert', 56)}${glyph('check', 'qs-rg-check', 126)}</svg>`;
  const href = safeHref(props.href);
  const face = href ? `<a class="qs-ring-link" href="${esc(href)}">${svg}</a>` : svg;
  const showKey = (props.key ?? size !== 'sm') && !missing;
  const caption = label || props.note
    ? `<figcaption>${label ? `<span class="qs-ring-name">${esc(label)}</span>` : ''}${props.note ? `<span class="qs-ring-note">${esc(props.note)}</span>` : ''}</figcaption>`
    : '';
  const id = props.id ? ` data-qs-ring="${esc(props.id)}"` : '';
  const name = label ? ` data-name="${esc(label)}"` : '';
  return `<figure class="${classes.join(' ')}"${id}${name}${props.roadRing ? ' data-qs-road-ring' : ''}>${face}${showKey ? ringKey(q, s, c) : ''}${caption}</figure>`;
}
