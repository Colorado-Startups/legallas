// SPDX-License-Identifier: Apache-2.0
// Shared helpers for the chart kit: escaping, formats, icons, provenance and the table twin of a chart.

export type Lens = 'quality' | 'speed' | 'consumption';

/** The short name a lens's classes use: qs-fill-q, qs-fill-s, qs-fill-c. */
export const lensKey = (lens: Lens | undefined): 'q' | 's' | 'c' => (lens === 'speed' ? 's' : lens === 'consumption' ? 'c' : 'q');
/** The contract's statuses, plus the two readings scoring adds: too few samples, and a clean claim with no proof. */
export type Status = 'ok' | 'stale' | 'missing' | 'no_events' | 'few_samples' | 'no_proof';
export type Stage = 'lab' | 'live';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for HTML and SVG, in content and in attributes. */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** True for a real number. NaN and Infinity aren't measurements. */
export function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Keeps a number in range. Not a number goes to the low end, so it can never read as a good score. */
export function clamp(n: number, lo = 0, hi = 1): number {
  return Number.isNaN(n) ? lo : Math.min(hi, Math.max(lo, n));
}

/** A number with at most `digits` decimals and no trailing zeros. */
export function num(n: number, digits = 2): string {
  return String(Number(n.toFixed(digits)));
}

/** A 0 to 1 fraction as an SVG percentage, so marks stretch with the chart and text stays its own size. */
export function pct(fraction: number): string {
  return `${num((isNum(fraction) ? fraction : 0) * 100)}%`;
}

/**
 * Keeps in-page, relative and GitHub links. Anything else, such as `javascript:`, is dropped. So is a space, a control
 * character or a backslash anywhere, because browsers strip or rewrite those: `java<tab>script:` still runs and `/\\host` leaves the site.
 */
export function safeHref(href: string | undefined): string | null {
  if (!href || /[\x00-\x20\\]/.test(href)) return null;
  if (href.startsWith('#')) return href;
  if (/^https:\/\/github\.com\//.test(href)) return href;
  if (href.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  return href;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-11-02` or a full ISO time as `2 Nov`. Reads the date as written, so the output never depends on the machine. */
export function fmtDate(iso: string | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!match) return '';
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? ''}`.trim();
}

function grouped(n: number): string {
  const [whole = '0', fraction] = String(Math.abs(n)).split('.');
  const body = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}${body}${fraction ? `.${fraction}` : ''}`;
}

/** A count: 1,284 as written, compact from 10,000 up. */
export function fmtCount(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${num(n / 1_000_000, 1)}M`;
  if (abs >= 10_000) return `${num(n / 1_000, 1)}K`;
  return grouped(Number(num(n, 2)));
}

function fmtBytes(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${num(value / 1_000_000, 1)} MB`;
  if (Math.abs(value) >= 1_000) return `${num(value / 1_000, 0)} KB`;
  return `${num(value, 0)} B`;
}

/** A measured value in a unit from the metric contract. Milliseconds move to seconds at 1,000, bytes to KB and MB. */
export function fmtValue(value: number, unit = ''): string {
  if (!isNum(value)) return 'Missing';
  switch (unit) {
    case 'ms':
      return Math.abs(value) >= 1000 ? `${num(value / 1000, 1)} s` : `${num(value, 0)} ms`;
    case 'seconds':
      return `${num(value, 1)} s`;
    case 'minutes':
      return `${num(value, 1)} min`;
    case 'hours':
      return `${num(value, 1)} h`;
    case 'days':
      return `${num(value, 1)} d`;
    case 'percent':
      return `${num(value, 1)}%`;
    case 'bytes':
      return fmtBytes(value);
    case 'usd':
      return `$${grouped(Number(num(value, 2)))}`;
    case 'pass':
      return value >= 1 ? 'Pass' : 'Fail';
    case 'ratio':
      return num(value, 2);
    case 'per_week':
      return `${num(value, 1)}/wk`;
    case '':
    case 'score':
    case 'count':
      return fmtCount(value);
    default:
      return `${fmtCount(value)} ${unit}`;
  }
}

/** The six heat classes: 0 is the empty red tile, 5 is exactly 100. */
export function scoreBand(score: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (!isNum(score) || score <= 0) return 0;
  if (score < 25) return 1;
  if (score < 50) return 2;
  if (score < 75) return 3;
  if (score < 100) return 4;
  return 5;
}

const ICONS: Record<string, string> = {
  check: 'M3 8.5 6.5 12 13 4.5',
  x: 'M4 4l8 8M12 4l-8 8',
  alert: 'M8 2.5 14.5 13.5h-13ZM8 6.5v3.5M8 12v.01',
  lock: 'M4 7.5h8v6H4ZM5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5',
  lab: 'M6.5 2h3M7 2v4.5L3.5 12.5A1 1 0 0 0 4.4 14h7.2a1 1 0 0 0 .9-1.5L9 6.5V2M5.3 10h5.4',
  live: 'M8 8v.01M5 5a4.2 4.2 0 0 0 0 6M11 5a4.2 4.2 0 0 1 0 6M3 3a7 7 0 0 0 0 10M13 3a7 7 0 0 1 0 10',
  table: 'M2.5 3.5h11v9h-11ZM2.5 6.5h11M2.5 9.5h11M6.5 6.5v6',
  clock: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM8 5v3.2l2.2 1.3',
  doc: 'M4 1.5h5.5L12.5 4.5v10H4ZM9.5 1.5v3h3',
  person: 'M8 2.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM3 14c.6-3 2.5-4.5 5-4.5s4.4 1.5 5 4.5',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM10.5 10.5 14 14',
};

/** An icon's path, for drawing it inside another SVG. */
export function iconPath(name: string): string {
  return ICONS[name] ?? '';
}

/** A 16 px line icon. It never carries meaning alone, so it is hidden from screen readers. */
export function icon(name: string): string {
  return `<svg class="qs-i" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${iconPath(name)}"/></svg>`;
}

/** Text only a screen reader gets. */
export function sr(text: string): string {
  return `<span class="qs-sr">${esc(text)}</span>`;
}

/** When and how a number was measured: an icon for lab or live, and the date. */
export function provenance(time?: string, stage?: Stage): string {
  if (!time && !stage) return '';
  const date = fmtDate(time);
  const kind = stage === 'live' ? 'live' : 'lab';
  const when = date ? `<time datetime="${esc(time)}">${esc(date)}</time>` : '';
  const how = stage ? `${icon(kind)}${sr(`${kind === 'live' ? 'Live' : 'Lab'} measurement`)}` : '';
  return `<span class="qs-prov">${how}${when}</span>`;
}

/** The word for a score that isn't a measurement. */
export function statusWord(status: Status | undefined): string {
  if (status === 'stale') return 'Stale';
  if (status === 'few_samples') return 'Too few';
  if (status === 'no_proof') return 'No proof';
  if (status === 'missing') return 'Missing';
  return '';
}

/** True when a value must show as an empty red tile: it scores 0, whatever the last reading was. */
export function isEmptyStatus(status: Status | undefined, value?: number | null): boolean {
  if (status === 'no_events') return false;
  return status === 'missing' || status === 'stale' || status === 'few_samples' || status === 'no_proof' || !isNum(value);
}

/** The accessible twin of a chart: a table behind an icon, in native details so it works without a script. */
export function tableView(caption: string, head: string[], rows: (string | number)[][]): string {
  const th = head.map((h) => `<th scope="col">${esc(h)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${row.map((cell, i) => (i === 0 ? `<th scope="row">${esc(cell)}</th>` : `<td>${esc(cell)}</td>`)).join('')}</tr>`)
    .join('');
  return (
    `<details class="qs-tv"><summary>${icon('table')}${sr(`Table: ${caption}`)}</summary>` +
    `<div class="qs-scroll" tabindex="0" role="region" aria-label="${esc(caption)}"><table class="qs-table"><caption class="qs-sr">${esc(caption)}</caption><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div></details>`
  );
}

/** A JSON data block. Browsers don't run it, and `<` is escaped so the text can't close its own script tag. */
export function jsonBlock(data: unknown): string {
  return `<script type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}
