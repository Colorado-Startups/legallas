// SPDX-License-Identifier: Apache-2.0
// One short, working example per component, on invented numbers. Copy the call you need into your page. The tests
// render all of these, so what's here stays correct. `galleryPage()` puts them on one page for a CI screenshot:
//   node quality-speed/core/charts/examples/gallery.ts out.html

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bullets, dataTable, dayStrip, dotMatrix, filmstrip, fmtDate, heatLegend, heatmap, historyRows, markKey, meter, metricBullet, metricTile, missingTile,
  pictogram, ring, ringGrid, roadTo100, sketch, sparkline, statTile, tileRow, timeline, trend,
} from '../index.ts';
import { totalOf } from '../index.ts';
import type { MetricLike, RingProps, TimelineRow } from '../index.ts';

/** A metric as the contract has it, to show the adapters. A real page gets these from its manifest and metrics files. */
const METRIC: MetricLike = {
  lens: 'speed',
  unit: 'ms',
  floor: 3000,
  goal: 500,
  value: 840,
  stage: 'lab',
  measured_at: '2026-11-02T06:17:00Z',
  source_url: 'https://github.com/Colorado-Startups/legallas/actions/runs/1001',
};

const HISTORY: TimelineRow[] = [
  { t: '2026-10-30', rings: { code: { q: 40, s: 31, total: 37 } } },
  { t: '2026-10-31', rings: { code: { q: 55, s: 42, total: 50 } } },
  { t: '2026-11-01', rings: { code: { q: 66, s: 52, total: 61 } } },
  { t: '2026-11-02', rings: { code: { q: 72, s: 58, total: 67 } } },
];

/** An invented score for a home page section, varied by position. */
function section(label: string, index: number): RingProps {
  const q = 30 + ((index * 17) % 70);
  const s = 25 + ((index * 23) % 75);
  return { id: label, label, q, s, total: totalOf(q, s), href: '#section' };
}

export const EXAMPLES: { name: string; html: string }[] = [
  { name: 'ring', html: ring({ id: 'code', q: 72, s: 58, total: 67, size: 'lg', label: 'Code', href: '#code', baseline: { q: 40, s: 31 } }) },
  { name: 'ring, no data', html: ring({ q: null, s: null, total: null, size: 'md', label: 'Projects' }) },
  { name: 'ring, at goal', html: ring({ q: 100, s: 100, total: 100, size: 'md', label: 'Settings' }) },
  {
    name: 'ringGrid',
    html: ringGrid({ id: 'data-room', q: 38, s: 55, total: 43, label: 'Data room', href: '#data-room' }, [
      { label: 'Product', rings: [section('Sync', 1), section('Templates', 2)] },
      { label: 'Repo', rings: [section('Code', 3), section('Testing', 4), section('Pull requests', 5)] },
      { label: 'Law', rings: [section('Colorado business law', 6), section('Delaware tax law', 7)] },
    ]),
  },
  { name: 'timeline', html: timeline({ main: 'code', history: HISTORY }) },
  { name: 'timeline, loading a long history on the first drag', html: timeline({ main: 'code', history: HISTORY, src: 'history.json' }) },
  {
    name: 'historyRows',
    html: timeline({
      main: 'code',
      history: historyRows([
        { at: '2026-11-01T06:17:00Z', page: 'code', quality: 66, speed: 52, total: 61 },
        { at: '2026-11-02T06:17:00Z', page: 'code', quality: 72, speed: 58, total: 67 },
      ]),
    }),
  },
  {
    name: 'bullets',
    html: bullets('Speed against goal', [
      { label: 'Search', value: 840, unit: 'ms', floor: 3000, goal: 500, baseline: 1900, lens: 'speed', time: '2026-11-02', stage: 'lab' },
      { label: 'Coverage', value: 72, unit: 'percent', floor: 0, goal: 90, lens: 'quality', time: '2026-11-02', stage: 'lab' },
      { label: 'Time to fix', value: null, unit: 'days', floor: 30, goal: 1, status: 'no_events', lens: 'speed', time: '2026-11-02', stage: 'lab' },
      { label: 'Sync', value: null, unit: 'minutes', floor: 30, goal: 1, status: 'missing', lens: 'speed' },
    ]),
  },
  { name: 'metricBullet', html: bullets('From a contract metric', [metricBullet(METRIC, 'Search', { reading: 'measured', baseline: 1900 })]) },
  {
    name: 'trend',
    html: trend({
      label: 'Coverage',
      unit: 'percent',
      goal: 90,
      baseline: 41,
      lens: 'quality',
      stage: 'lab',
      points: [
        { t: '2026-10-30', v: 41 },
        { t: '2026-10-31', v: 55 },
        { t: '2026-11-01', v: 62 },
        { t: '2026-11-02', v: 72 },
      ],
    }),
  },
  { name: 'trend, too few runs', html: trend({ label: 'Lead time', points: [{ t: '2026-11-02', v: 3 }] }) },
  {
    name: 'heatmap',
    html:
      `<div id="forming"></div>` +
      heatmap({
        title: 'Forming',
        note: '40%',
        rows: [{ id: 'founder', label: 'Founder' }, { id: 'investor', label: 'Investor' }],
        cols: [{ id: 'find', label: 'Find it fast', short: 'Find' }, { id: 'trust', label: 'Answers you can trust', short: 'Trust' }],
        cells: [
          { row: 'founder', col: 'find', score: 71, href: '#journey-founder-find' },
          { row: 'founder', col: 'trust', score: 0, href: '#journey-founder-trust' },
          { row: 'investor', col: 'find', score: null, excluded: true },
          { row: 'investor', col: 'trust', score: null },
        ],
      }) + heatLegend(),
  },
  {
    name: 'filmstrip',
    html: filmstrip({
      id: 'journey-founder-find',
      title: 'Founder, Find it fast',
      score: 71,
      budgetMs: 2500,
      time: '2026-11-02',
      stage: 'lab',
      open: true,
      back: '#forming',
      frames: [
        { label: 'Search', sketch: 'search', ms: 240, budgetMs: 300 },
        { label: 'Open', sketch: 'document', ms: 1400, budgetMs: 900 },
        { label: 'Cited page', sketch: 'citation', state: 'stop', ref: '#18' },
      ],
    }),
  },
  {
    name: 'filmstrip, closed until a heatmap cell links to it',
    html: filmstrip({
      id: 'journey-founder-trust',
      title: 'Founder, Answers you can trust',
      score: 0,
      back: '#forming',
      frames: [{ label: 'Ask', sketch: 'ask', ms: 120, budgetMs: 200 }, { label: 'Answer', sketch: 'answer', state: 'stop' }],
    }),
  },
  {
    name: 'roadTo100',
    html: roadTo100({
      baseline: { q: 40, s: 31, total: 37 },
      now: { q: 72, s: 58, total: 67 },
      fixes: [
        { id: 'tests', label: 'Tests', ref: '#17', q: 18, s: 12 },
        { id: 'build', label: 'Build', q: 4, s: 22 },
      ],
    }),
  },
  {
    name: 'dataTable',
    html: dataTable({
      caption: 'Every metric',
      columns: [
        { key: 'metric', label: 'Metric' },
        { key: 'value', label: 'Value', type: 'num', unitKey: 'unit' },
        { key: 'score', label: 'Score', type: 'score' },
        { key: 'status', label: 'State', type: 'status' },
      ],
      linkKey: 'run',
      rows: [
        { metric: 'Search', value: 840, unit: 'ms', score: 62, status: 'ok', run: 'https://github.com/Colorado-Startups/legallas/actions/runs/1001' },
        { metric: 'Coverage', value: 72, unit: 'percent', score: 80, status: 'ok' },
        { metric: 'Sync', value: null, unit: 'minutes', score: 0, status: 'missing' },
      ],
    }),
  },
  {
    name: 'statTile',
    html: tileRow([
      statTile({ label: 'Coverage', value: 72, unit: 'percent', delta: 6, spark: [41, 55, 62, 72], lens: 'quality', time: '2026-11-02', stage: 'lab' }),
      statTile({ label: 'Build', value: 240, unit: 'seconds', delta: 30, better: 'down', lens: 'speed', time: '2026-11-02', stage: 'live' }),
      statTile({ label: 'Alerts', value: null, status: 'no_events', time: '2026-11-02', stage: 'lab' }),
      missingTile({ label: 'Mutation score', status: 'stale' }),
      metricTile(METRIC, 'Search', { reading: 'too_few_samples' }),
    ]),
  },
  { name: 'sparkline', html: sparkline([3, 5, 4, 7, 9]) },
  { name: 'pictogram', html: pictogram({ label: 'Agreements', total: 36, filled: 19 }) },
  {
    name: 'dotMatrix',
    html: dotMatrix({ caption: 'Who can reach what', rows: ['Founder', 'Investor'], cols: ['Document', 'Log'], states: [['pass', 'pass'], ['fail', 'na']] }),
  },
  { name: 'meter', html: meter({ label: 'CI allowance', value: 13, limit: 300, unit: 'usd' }) + meter({ label: 'Mac share', value: 92, limit: 100, unit: 'percent' }) },
  {
    name: 'dayStrip',
    html: dayStrip({ label: 'Main stayed green', days: [{ t: '2026-10-30', state: 'ok' }, { t: '2026-10-31', state: 'fail' }, { t: '2026-11-01', state: 'none' }, { t: '2026-11-02', state: 'ok' }] }),
  },
  { name: 'markKey', html: markKey() },
  { name: 'sketch', html: `<div class="qs-shot">${sketch('checklist')}</div>` },
];

const here = dirname(fileURLToPath(import.meta.url));

/** All the examples as one page, for looking at them together. */
export function galleryPage(): string {
  const css = readFileSync(join(here, '..', 'charts.css'), 'utf8');
  const js = readFileSync(join(here, '..', 'charts.js'), 'utf8');
  const cards = EXAMPLES.map((e) => `<section><h2>${e.name}</h2>${e.html}</section>`).join('');
  const page = 'body{margin:0;padding:1rem;color:var(--qs-ink);background:var(--qs-page);font-family:var(--qs-sans)}main{display:grid;gap:2rem;max-width:64rem;margin:auto}h2{font-size:.8125rem;color:var(--qs-ink-3)}';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Chart kit</title><style>${css}${page}</style></head><body><main>${cards}</main><script type="module">${js}</script></body></html>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2]) {
  writeFileSync(process.argv[2], galleryPage());
  writeFileSync(join(dirname(process.argv[2]), 'history.json'), JSON.stringify(HISTORY.map((row) => ({ label: fmtDate(row.t), rings: row.rings }))));
}
