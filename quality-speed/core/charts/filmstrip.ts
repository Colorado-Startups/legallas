// SPDX-License-Identifier: Apache-2.0
// The journey filmstrip: the screens of one scored journey in order, with what each took. It opens from a heatmap
// cell. A step the product can't do yet shows as an empty red frame, so the page reads as a map of the backlog.

import { esc, fmtValue, icon, isNum, pct, provenance, safeHref, scoreBand, sr, tableView } from './svg.ts';
import type { Stage } from './svg.ts';
import { sketch } from './sketch.ts';
import type { SketchKind } from './sketch.ts';

export type FrameState = 'ok' | 'slow' | 'stop';

export interface FilmFrame {
  label: string;
  /** A screenshot from the invented room. */
  src?: string;
  alt?: string;
  /** A schematic screen, used when there's no screenshot yet. */
  sketch?: SketchKind;
  ms?: number | null;
  budgetMs?: number;
  /** `stop` is a step the product can't complete yet. */
  state?: FrameState;
  /** Issue that would make this step work. */
  ref?: string;
  href?: string;
}

export interface FilmstripProps {
  /** The heatmap cell links to `#<id>`. */
  id: string;
  title: string;
  score?: number | null;
  frames: FilmFrame[];
  /** The journey's goal time. */
  budgetMs?: number;
  time?: string;
  stage?: Stage;
  /** Show this panel when the page opens. Other panels stay closed until their link is followed. */
  open?: boolean;
  /** Where the close link goes: an id on the page, usually the heatmap the panel opened from. An `open` panel without one has no close link. */
  back?: string;
}

/** A step with no time hasn't been proved, so it reads as stopped whatever it says. */
function stateOf(frame: FilmFrame): FrameState {
  if (frame.state === 'stop' || !isNum(frame.ms) || frame.ms < 0) return 'stop';
  if (frame.state === 'slow' || (frame.budgetMs !== undefined && frame.ms > frame.budgetMs)) return 'slow';
  return 'ok';
}

function shot(frame: FilmFrame): string {
  if (frame.src) {
    const src = safeHref(frame.src);
    return src ? `<img src="${esc(src)}" alt="${esc(frame.alt ?? frame.label)}" width="320" height="200" loading="lazy" decoding="async">` : '';
  }
  return sketch(frame.sketch ?? 'document');
}

function frameItem(frame: FilmFrame): string {
  const state = stateOf(frame);
  const time = state === 'stop' ? icon('alert') : `<b>${esc(fmtValue(frame.ms ?? Number.NaN, 'ms'))}</b>`;
  const slow = state === 'slow' ? `${icon('clock')}${sr('over budget')}` : '';
  const href = safeHref(frame.href);
  const ref = frame.ref ? (href ? `<a href="${esc(href)}">${esc(frame.ref)}</a>` : `<span>${esc(frame.ref)}</span>`) : '';
  return (
    `<li class="qs-frame is-${state}"><div class="qs-shot">${shot(frame)}</div>` +
    `<div class="qs-frame-cap"><span class="qs-frame-time">${time}${slow}</span><span class="qs-frame-name">${esc(frame.label)}</span>${ref}</div></li>`
  );
}

/** A bar of the journey's time, one segment per screen. What the product can't do yet stays an empty red run. */
function journeyBar(frames: FilmFrame[], budgetMs?: number): string {
  const msOf = (f: FilmFrame) => (isNum(f.ms) && f.ms > 0 ? f.ms : 0);
  const total = frames.reduce((sum, f) => sum + msOf(f), 0);
  const blocked = frames.some((f) => stateOf(f) === 'stop');
  const scale = Math.max(total, budgetMs ?? 0) * (blocked ? 1.35 : 1.04) || 1;
  let cursor = 0;
  const parts = frames
    .filter((f) => msOf(f) > 0)
    .map((f) => {
      const width = msOf(f) / scale;
      const cls = stateOf(f) === 'slow' ? 'qs-seg-slow' : 'qs-seg-s';
      const rect = `<rect class="${cls}" x="${pct(cursor)}" y="4" width="${pct(width)}" height="12" rx="2" data-tv="${esc(fmtValue(msOf(f), 'ms'))}" data-tl="${esc(f.label)}"/>`;
      cursor += width;
      return rect;
    })
    .join('');
  const rest = blocked ? `<rect class="qs-track-empty" x="${pct(cursor)}" y="4" width="${pct(1 - cursor)}" height="12" rx="2"/>` : '';
  const goal = budgetMs ? `<line class="qs-goal" x1="${pct(budgetMs / scale)}" x2="${pct(budgetMs / scale)}" y1="0" y2="20"/>` : '';
  return `<svg class="qs-film-bar" width="100%" height="20" aria-hidden="true">${parts}${rest}${goal}</svg>`;
}

/** One journey's panel. A link to its id opens it, and the browser's back button or the close link leaves it. */
export function filmstrip(props: FilmstripProps): string {
  const total = props.frames.reduce((sum, f) => sum + (f.ms ?? 0), 0);
  const blocked = props.frames.length === 0 || props.frames.some((f) => stateOf(f) === 'stop');
  const score =
    props.score === undefined ? ''
    : isNum(props.score) ? `<span class="qs-heat-step qs-h${scoreBand(props.score)}">${props.score}</span>`
    : `<span class="qs-heat-step qs-h0">${icon('alert')}${sr('Missing')}</span>`;
  const budget = props.budgetMs ? `<span class="qs-film-goal">◆ ${esc(fmtValue(props.budgetMs, 'ms'))}</span>` : '';
  const sum = blocked ? icon('alert') : `<b>${esc(fmtValue(total, 'ms'))}</b>`;
  const back = safeHref(props.back) ?? (props.open ? null : '#');
  const close = back ? `<a class="qs-btn" href="${esc(back)}">${icon('x')}${sr('Close')}</a>` : '';
  const table = props.frames.map((f) => [f.label, f.ms === undefined || f.ms === null ? '' : fmtValue(f.ms, 'ms'), f.budgetMs ? fmtValue(f.budgetMs, 'ms') : '', stateOf(f), f.ref ?? '']);
  return (
    `<section class="qs-film${props.open ? ' is-open' : ''}" id="${esc(props.id)}" aria-label="${esc(props.title)}">` +
    `<header class="qs-film-head">${score}<h3>${esc(props.title)}</h3><span class="qs-film-sum">${sum}${budget}</span>${provenance(props.time, props.stage)}` +
    `${close}</header>` +
    `${journeyBar(props.frames, props.budgetMs)}<ol class="qs-frames">${props.frames.map(frameItem).join('')}</ol>` +
    `${tableView(props.title, ['Step', 'Time', 'Budget', 'State', 'Ref'], table)}</section>`
  );
}
