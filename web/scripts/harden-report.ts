// SPDX-License-Identifier: Apache-2.0
// `npm run harden -- --report <file>`: one self-contained HTML page, no script, no external file. Pass and fail tiles,
// and the restore drill's age against its limit. It prints only what each row's title, status and detail say, which
// scripts/harden.ts keeps to counts, ages and settings: never a hostname, id or token.
import type { Row, Status } from './harden.ts';

const esc = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const LABEL: Record<Status, string> = { pass: 'Pass', drift: 'Drift', warn: 'Warn', error: 'Unreadable' };

export function reportHtml(rows: readonly Row[], now: number, drillMaxDays: number): string {
  const count = (status: Status) => rows.filter((r) => r.status === status).length;
  const tiles = rows
    .map((r) => `<li class="tile ${r.status}"><b>${esc(LABEL[r.status])}</b><h2>${esc(r.title)}</h2><p>${esc(r.detail)}</p>${r.status !== 'pass' && r.step ? `<p class="step">${esc(r.step)}</p>` : ''}</li>`)
    .join('\n');
  const drill = rows.find((r) => r.key === 'drill_age');
  const days = drill?.days;
  const bar =
    typeof days === 'number'
      ? `<figure><figcaption>Restore drill: ${days} of ${drillMaxDays} days</figcaption><div class="bar" role="img" aria-label="${days} of ${drillMaxDays} days"><span class="${days > drillMaxDays ? 'over' : ''}" style="width:${Math.min(100, Math.round((days / drillMaxDays) * 100))}%"></span></div></figure>`
      : `<figure><figcaption>Restore drill: ${esc(drill?.detail ?? 'not read')}</figcaption><div class="bar"><span class="over" style="width:100%"></span></div></figure>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Edge hardening</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#5c5c5c;--pass:#1d7a3a;--drift:#b42318;--warn:#a15c00;--error:#6941c6;--line:#e4e4e4}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#ececec;--muted:#a3a3a3;--pass:#4ade80;--drift:#f87171;--warn:#fbbf24;--error:#c4b5fd;--line:#2e2e2e}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
main{max-width:960px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}
.sum{color:var(--muted);margin:0 0 20px}
ul{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.tile{border:1px solid var(--line);border-left:6px solid;border-radius:8px;padding:12px}
.tile h2{font-size:15px;margin:4px 0}
.tile p{margin:0;color:var(--muted);font-size:13px}
.tile .step{margin-top:6px;color:var(--fg)}
.pass{border-left-color:var(--pass)}.pass b{color:var(--pass)}
.drift{border-left-color:var(--drift)}.drift b{color:var(--drift)}
.warn{border-left-color:var(--warn)}.warn b{color:var(--warn)}
.error{border-left-color:var(--error)}.error b{color:var(--error)}
figure{margin:24px 0 0}
.bar{height:14px;border-radius:7px;background:var(--line);overflow:hidden}
.bar span{display:block;height:100%;background:var(--pass)}
.bar span.over{background:var(--drift)}
</style>
</head>
<body>
<main>
<h1>Edge hardening</h1>
<p class="sum">${new Date(now).toISOString().slice(0, 10)}: ${count('pass')} pass, ${count('drift')} drift, ${count('warn')} warn, ${count('error')} unreadable</p>
<ul>
${tiles}
</ul>
${bar}
</main>
</body>
</html>
`;
}
