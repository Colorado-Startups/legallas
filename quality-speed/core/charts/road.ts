// SPDX-License-Identifier: Apache-2.0
// Road to 100: a waterfall of the fixes left, from the score now up to the goal. Toggle a fix and the ring moves.
// Each fix keeps its place in the cascade, so nothing jumps. A bar shows what the fix adds to the total, split into
// its Quality, Speed and Consumption parts, a third each.

import { ring } from './ring.ts';
import { esc, icon, isNum, jsonBlock, num, pct, safeHref, tableView } from './svg.ts';

export interface RoadScore {
  q: number;
  s: number;
  /** Consumption. Left out, it counts as 0, as a page with no consumption metric scores. */
  c?: number;
  total: number;
}

export interface RoadFixProps {
  id: string;
  label: string;
  /** Points this fix adds to the Quality ring. */
  q: number;
  /** Points this fix adds to the Speed ring. */
  s: number;
  /** Points this fix adds to the Consumption ring. */
  c?: number;
  /** Issue or pull request behind the fix. */
  ref?: string;
  href?: string;
}

export interface RoadProps {
  title?: string;
  baseline: RoadScore;
  now: RoadScore;
  fixes: RoadFixProps[];
}

/** What a fix adds to the total: a third of each lens's points, as in core/score.ts. */
export function fixGain(fix: { q: number; s: number; c?: number | undefined }): number {
  return (fix.q + fix.s + (isNum(fix.c) ? fix.c : 0)) / 3;
}

const x = (score: number) => pct(score / 100);

function axis(props: RoadProps): string {
  const { baseline, now } = props;
  const mark = (cls: string, score: number) => `<line class="${cls}" x1="${x(score)}" x2="${x(score)}" y1="17" y2="35"/>`;
  return (
    `<svg class="qs-road-axis" width="100%" height="50" aria-hidden="true">` +
    `<line class="qs-axis" x1="0" x2="100%" y1="26" y2="26"/>` +
    `${mark('qs-tick-base', baseline.total)}${mark('qs-tick-now', now.total)}${mark('qs-goal', 100)}` +
    `<text class="qs-ref-strong" x="${x(now.total)}" y="13" text-anchor="${now.total > 78 ? 'end' : 'start'}">▼ ${esc(now.total)}</text>` +
    `<text class="qs-ref" x="${x(baseline.total)}" y="47" text-anchor="${baseline.total < 12 ? 'start' : 'end'}">▽ ${esc(baseline.total)}</text>` +
    `<text class="qs-ref" x="100%" y="47" text-anchor="end">◆ 100</text></svg>`
  );
}

function bar(inner: string): string {
  return `<svg class="qs-road-bar" width="100%" height="24" aria-hidden="true">${inner}</svg>`;
}

function segments(start: number, fix: { q: number; s: number; c?: number | undefined }, label: string): string {
  const qPart = fix.q / 3;
  const sPart = fix.s / 3;
  const cPart = (isNum(fix.c) ? fix.c : 0) / 3;
  const seg = (from: number, width: number, kind: 'q' | 's' | 'c') =>
    !(width > 0) ? '' : `<rect class="qs-seg-${kind}" x="${x(from)}" y="5" width="${x(width)}" height="14" rx="2" data-tv="+${num(width, 1)}" data-tl="${esc(label)}"/>`;
  return seg(start, qPart, 'q') + seg(start + qPart, sPart, 's') + seg(start + qPart + sPart, cPart, 'c');
}

/** The score so far. */
function nowRow(now: RoadScore): string {
  return `<li class="qs-road-row is-on is-ref"><span class="qs-road-name qs-ref-text">▼ ${esc(now.total)}</span>${bar(segments(0, { q: now.q, s: now.s, c: now.c ?? 0 }, String(now.total)))}<span class="qs-road-gain"></span></li>`;
}

function fixRow(fix: RoadFixProps, start: number): string {
  const link = safeHref(fix.href);
  const ref = !fix.ref ? '' : link ? `<a class="qs-ref-link" href="${esc(link)}">${esc(fix.ref)}</a>` : `<span class="qs-ref-link">${esc(fix.ref)}</span>`;
  return (
    `<li class="qs-road-row"><div class="qs-road-who"><label class="qs-road-name"><input type="checkbox" value="${esc(fix.id)}" disabled><span>${esc(fix.label)}</span></label>${ref}</div>` +
    `${bar(`<line class="qs-link" x1="${x(start)}" x2="${x(start)}" y1="0" y2="24"/>${segments(start, fix, fix.label)}`)}` +
    `<span class="qs-road-gain">+${esc(num(fixGain(fix), 1))}</span></li>`
  );
}

function gapRow(start: number, gap: number): string {
  return (
    `<li class="qs-road-row is-gap"><span class="qs-road-name">${icon('alert')}<span>No fix yet</span></span>` +
    `${bar(`<rect class="qs-track-empty" x="${x(start)}" y="5" width="${x(gap)}" height="14" rx="2"/>`)}` +
    `<span class="qs-road-gain">+${esc(num(gap, 1))}</span></li>`
  );
}

/** A score to draw. One that isn't all numbers draws as zero, and the ring shows it in red. */
function drawn(score: RoadScore): RoadScore {
  return isNum(score.q) && isNum(score.s) && isNum(score.total) ? score : { q: 0, s: 0, ...(score.c === undefined ? {} : { c: 0 }), total: 0 };
}

/** The whole Road to 100 block: the ring, the axis with baseline, now and goal, and one row per fix. */
export function roadTo100(props: RoadProps): string {
  const { fixes } = props;
  const baseline = drawn(props.baseline);
  const now = drawn(props.now);
  let cursor = fixGain(now);
  const rows = fixes.map((fix) => {
    const row = fixRow(fix, cursor);
    cursor += fixGain(fix);
    return row;
  });
  if (100 - cursor > 0.01) rows.push(gapRow(cursor, 100 - cursor));
  const data = { now: props.now, fixes: fixes.map((f) => ({ id: f.id, q: f.q, s: f.s, ...(f.c === undefined ? {} : { c: f.c }) })) };
  const table = fixes.map((f) => [f.label, f.ref ?? '', num(f.q, 1), num(f.s, 1), num(f.c ?? 0, 1), num(fixGain(f), 1)]);
  const title = props.title ?? 'Road to 100';
  const face = ring({
    q: props.now.q,
    s: props.now.s,
    ...(props.now.c === undefined ? {} : { c: props.now.c }),
    total: props.now.total,
    baseline: { q: baseline.q, s: baseline.s, ...(baseline.c === undefined ? {} : { c: baseline.c }) },
    now: { q: now.q, s: now.s, ...(now.c === undefined ? {} : { c: now.c }) },
    roadRing: true,
  });
  return (
    `<section class="qs-road" data-qs-road aria-label="${esc(title)}"><div class="qs-road-side">${face}</div><div class="qs-road-main">` +
    `<h2>${esc(title)}</h2><output class="qs-sr" data-road="said"></output>` +
    `<div class="qs-road-row qs-road-axisrow">${axis({ ...props, baseline, now })}</div><ol class="qs-road-rows">${nowRow(now)}${rows.join('')}</ol>` +
    `${tableView(title, ['Fix', 'Ref', 'Quality', 'Speed', 'Consumption', 'Total'], table)}</div>${jsonBlock(data)}</section>`
  );
}
