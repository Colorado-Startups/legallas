// SPDX-License-Identifier: Apache-2.0
// Card F4. The GATE 1 review page: one self-contained HTML file (no scripts, no remote assets) listing every
// entry with its cites, the counts, the unresolved cites and the keyword flags. It holds case content, so it
// is written only to <cacheDir>/matter/build/ at mode 600 and never printed.
import { createHash } from 'node:crypto';
import type { Cite, Matter, MatterTrack, PriorCase, ProofItem, TrackBrief, ViolationFigure } from '../../worker/matter-types.ts';
import type { BuildInfo } from './build.ts';
import { KEYWORDS } from './checks.ts';
import { priorStatus } from '../../worker/room-settings.ts';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes a value for use in HTML text. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/** Escapes text and marks every keyword hit, so the owner sees why an entry was flagged. */
export function marked(value: unknown): string {
  let html = escapeHtml(value);
  for (const { pattern } of KEYWORDS) {
    html = html.replace(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`), (hit) => `<mark>${hit}</mark>`);
  }
  return html;
}

const STYLE = `
:root{color-scheme:light;--ink:#1A1F1C;--paper:#FAF7F0;--rule:#D9CFBB;--muted:#4A524D;--flag:#6B1E23;--tint:#F3E4E2}
body{margin:0 auto;max-width:72rem;padding:24px 16px;background:var(--paper);color:var(--ink);font:14px/1.5 system-ui,sans-serif}
h1,h2,h3{font-family:Georgia,serif;font-weight:600}h2{border-bottom:1px solid var(--rule);padding-bottom:4px;margin-top:2em}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--rule);padding:4px 8px;text-align:left;vertical-align:top}
th{font-variant:all-small-caps;letter-spacing:.04em;color:var(--muted)}code,.mono{font-family:ui-monospace,monospace;font-size:12px}
.cites{margin:0;padding-left:1.2em;color:var(--muted)}.bad{color:var(--flag);font-weight:600}mark{background:var(--tint);color:var(--flag)}
.ok{color:var(--muted)}ul.counts{columns:4;list-style:none;padding:0}
`;

interface Ctx {
  info: BuildInfo;
}

function citeList(ctx: Ctx, cites: readonly Cite[] | undefined): string {
  if (!cites || cites.length === 0) return '<span class="bad">no cite</span>';
  const items = cites.map((cite) => {
    const where = ctx.info.paths[cite.doc] || cite.doc;
    const page = cite.page === null ? '' : ` at ${escapeHtml(cite.page)}`;
    const note = (cite as Cite & { note?: string }).note;
    return `<li><span class="mono">${escapeHtml(where)}${page}</span>${note ? ` (${marked(note)})` : ''}</li>`;
  });
  return `<ul class="cites">${items.join('')}</ul>`;
}

function table(head: readonly string[], rows: readonly string[][]): string {
  if (rows.length === 0) return '<p class="ok">None.</p>';
  const th = head.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

function summarySection(info: BuildInfo, sha: string | null): string {
  const counts = Object.entries(info.counts).map(([k, v]) => `<li>${escapeHtml(k)}: <b>${escapeHtml(v)}</b></li>`).join('');
  const catalog = info.catalog
    ? `Catalog: ${escapeHtml(info.catalog.rows)} rows, ${escapeHtml(info.catalog.notInRoom)} not in the room, ${escapeHtml(info.catalog.skipped)} skipped.`
    : 'No catalog.';
  const built = sha ? `sha256 <code>${escapeHtml(sha)}</code>` : `<span class="bad">Refused: ${escapeHtml(info.validation)}</span>`;
  return `<p>Built ${escapeHtml(info.builtAt)}. ${built}</p>
<ul class="counts">${counts}</ul><p>${catalog}</p>
<p>Unresolved cites: <b class="${info.unresolved.length ? 'bad' : ''}">${info.unresolved.length}</b>.
Unresolved doc entries: <b class="${info.unresolvedDocs.length ? 'bad' : ''}">${info.unresolvedDocs.length}</b>.
Problems: <b class="${info.problems.length ? 'bad' : ''}">${info.problems.length}</b>.
Exclusions: <b class="${info.exclusions.length ? 'bad' : ''}">${info.exclusions.length}</b>.
Keyword flags: <b>${info.flags.length}</b>.
Catalog internal notes: <b>${info.catalogNotes.length}</b>.</p>`;
}

function issuesSection(info: BuildInfo): string {
  return [
    '<h2>Unresolved cites</h2>',
    table(['Where', 'Path', 'Page'], info.unresolved.map((u) => [escapeHtml(u.where), `<span class="mono">${escapeHtml(u.path)}</span>`, escapeHtml(u.page ?? '')])),
    '<h2>Unresolved doc entries</h2>',
    table(['Path'], info.unresolvedDocs.map((p) => [`<span class="mono">${escapeHtml(p)}</span>`])),
    '<h2>Problems</h2>',
    table(['Problem'], info.problems.map((p) => [escapeHtml(p)])),
    '<h2>Exclusions (R5)</h2>',
    table(['Rule', 'Where'], info.exclusions.map((e) => [escapeHtml(e.rule), escapeHtml(e.where)])),
    '<h2>Keyword flags</h2>',
    table(['Keyword', 'Where'], info.flags.map((f) => [escapeHtml(f.keyword), escapeHtml(f.where)])),
    '<h2>Catalog internal notes</h2>',
    '<p class="ok">Catalog summaries that carry a filing or process note. Flagged only: rewrite the summary in the catalog.</p>',
    table(['Note', 'Catalog row'], info.catalogNotes.map((n) => [escapeHtml(n.note), `<span class="mono">${escapeHtml(n.path)}</span>`])),
  ].join('\n');
}

function caseRows(ctx: Ctx, c: PriorCase): string[][] {
  return [
    ['Caption', marked(c.caption)], ['Court', marked(c.court)], ['Case number', marked(c.caseNumber)], ['Division', marked(c.division)], ['Judge', marked(c.judge)],
    ['Filed', escapeHtml(c.filed)],
    ['Operative pleading', c.operativePleading ? `${marked(c.operativePleading.title)}${citeList(ctx, [c.operativePleading.cite])}` : ''],
  ];
}

function metaSection(ctx: Ctx, matter: Matter): string {
  const m = matter.meta;
  const prior = m.priorCase ? `<h3>Prior case (${escapeHtml(priorStatus)})</h3>${table(['Field', 'Value'], caseRows(ctx, m.priorCase))}` : '';
  const terms = m.definedTerms.map((t) => [marked(t.term), marked(t.means)]);
  return `<h2>Matter</h2>${table(['Field', 'Value'], caseRows(ctx, m))}${prior}<h3>Defined terms</h3>${table(['Term', 'Means'], terms)}`;
}

/** Each statement about a link on its own line: held or denied, when, as of when, from what kind of source. */
function statementList(ctx: Ctx, link: Matter['links'][number]): string {
  return (link.statements ?? []).map((st) => {
    const span = st.since || st.until ? `${st.since ?? '?'} to ${st.until ?? 'open'}` : 'dates not stated';
    const share = st.share ? (st.share.min === st.share.max ? `${st.share.min}%` : `${st.share.min} to ${st.share.max}%`) : '';
    const how = st.direct === null ? '' : st.direct ? 'direct' : 'indirect';
    const facts = [st.held ? 'held' : 'denied', span, `as of ${st.asOf}`, st.basis, share, how].filter(Boolean);
    return `<span class="mono">${escapeHtml(facts.join('; '))}</span>${st.note ? `<br>${marked(st.note)}` : ''}<br>${citeList(ctx, st.cites)}`;
  }).join('<hr>');
}

function listSections(ctx: Ctx, matter: Matter): string {
  const ids = (xs: readonly string[] | null | undefined) => escapeHtml((xs ?? []).join(', '));
  return [
    '<h2>Events</h2>',
    table(['Id', 'Date', 'Type', 'Title and summary', 'Actors', 'Claims', 'Cites'], matter.events.map((e) => [
      escapeHtml(e.id), `<span class="mono">${escapeHtml(e.date)}</span>`, escapeHtml(e.type),
      `${marked(e.title)}${e.summary ? `<br>${marked(e.summary)}` : ''}`, ids(e.actors), ids(e.claims), citeList(ctx, e.cites),
    ])),
    '<h2>People</h2>',
    table(['Id', 'Name', 'Role', 'Side', 'Title', 'Orgs', 'Cites'], matter.people.map((p) => [
      escapeHtml(p.id), marked(p.name), escapeHtml(p.role), escapeHtml(p.side), marked(p.title), ids(p.orgs), citeList(ctx, p.cites),
    ])),
    '<h2>Organizations</h2>',
    table(['Id', 'Name', 'Kind', 'Side', 'Parent', 'Formed', 'Cites'], matter.orgs.map((o) => [
      escapeHtml(o.id), marked(o.name), escapeHtml(o.kind), escapeHtml(o.side), escapeHtml(o.parent),
      `<span class="mono">${escapeHtml(o.formed)}</span>`, citeList(ctx, o.cites),
    ])),
    '<h2>Links</h2>',
    table(['From', 'To', 'Label', 'Cites', 'Statements'], matter.links.map((l) => [
      escapeHtml(l.from), escapeHtml(l.to), marked(l.label), citeList(ctx, l.cites), statementList(ctx, l),
    ])),
    '<h2>Money in the record</h2>',
    table(['Id', 'Date', 'Amount', 'From', 'To', 'Label', 'Cites'], matter.money.map((m) => [
      escapeHtml(m.id), `<span class="mono">${escapeHtml(m.date)}</span>`, `<span class="mono">${escapeHtml(formatCents(m.amountCents))}</span>`,
      escapeHtml(m.from), escapeHtml(m.to), marked(m.label), citeList(ctx, m.cites),
    ])),
  ].join('\n');
}

/** Formats whole cents as dollars; a value that is not a whole number is returned as text. */
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) return String(cents);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

const proofCell = (ctx: Ctx, proof: readonly ProofItem[]) =>
  proof.length === 0
    ? '<span class="bad">no proof</span>'
    : proof.map((p) => `${escapeHtml(p.strength)}${p.note ? `: ${marked(p.note)}` : ''}${citeList(ctx, [p.cite])}`).join('');

function claimSection(ctx: Ctx, matter: Matter): string {
  const out = ['<h2>Claims</h2>'];
  if (matter.claims.length === 0) out.push('<p class="ok">None.</p>');
  for (const claim of matter.claims) {
    out.push(`<h3>Count ${escapeHtml(claim.count)}: ${marked(claim.label)} <span class="mono">(${escapeHtml(claim.id)}, ${escapeHtml(claim.type)})</span></h3>`);
    out.push(`<p>Against: ${escapeHtml(claim.against.join(', '))}</p>${citeList(ctx, claim.cites)}`);
    out.push(table(['Element', 'Authority', 'Proof'], claim.elements.map((el) => [
      `${escapeHtml(el.id)}: ${marked(el.text)}`, marked(el.authority), proofCell(ctx, el.proof),
    ])));
  }
  return out.join('\n');
}

/** A figure's value as the room shows it: dollars for usd, a plain count otherwise. */
function figureValue(value: number | null, unit: ViolationFigure['unit']): string {
  if (value === null) return '';
  return unit === 'usd' ? formatCents(value) : value.toLocaleString('en-US');
}

const mono = (value: unknown) => `<span class="mono">${escapeHtml(value)}</span>`;

/** A track's brief: the line, then cast, hurdles, dates, key exhibits and drafts, each as a table. */
function briefTables(ctx: Ctx, brief: TrackBrief): string {
  return [
    `<h4>Brief</h4><p>${marked(brief.line)}</p>`,
    table(['Cast', 'Role', 'Through'], brief.cast.map((c) => [escapeHtml(c.id), marked(c.role), escapeHtml(c.via)])),
    table(['Hurdle', 'Text', 'Cites'], brief.hurdles.map((h) => [`${escapeHtml(h.id)}: ${marked(h.title)}`, marked(h.text), citeList(ctx, h.cites)])),
    table(['Date to confirm', 'Text', 'Cites'], brief.dates.map((d) => [mono(d.date), marked(d.text), citeList(ctx, d.cites)])),
    table(['Key exhibit', 'Proves'], brief.exhibits.map((x) => [citeList(ctx, [x.cite]), marked(x.proves)])),
    table(['Draft', 'Document'], brief.drafts.map((d) => [marked(d.label), mono(ctx.info.paths[d.doc] || d.doc)])),
  ].join('\n');
}

/** A track's counts: kind, parties and basis, and each element with the points that meet it (none is flagged). */
function countTable(counts: NonNullable<MatterTrack['counts']>): string {
  return `<h4>Counts</h4>${table(['Count', 'Kind', 'Against', 'Basis', 'Elements'], counts.map((c) => [
    `${escapeHtml(c.id)}: ${marked(c.title)}`, escapeHtml(c.kind), escapeHtml(c.against.join(', ')), marked(c.basis),
    c.elements.map((el) => `${escapeHtml(el.id)}: ${marked(el.text)} (${el.points.length ? escapeHtml(el.points.join(', ')) : '<span class="bad">no point</span>'})`).join('<br>'),
  ]))}`;
}

/** One section per track: its forum, parties and violations, each point with its proof, then its brief and counts. */
function trackSection(ctx: Ctx, matter: Matter): string {
  const out = ['<h2>Tracks</h2>'];
  if (matter.tracks.length === 0) out.push('<p class="ok">None.</p>');
  for (const track of matter.tracks) {
    out.push(`<h3>${marked(track.title)} <span class="mono">(${escapeHtml(track.id)}, ${escapeHtml(track.kind)})</span></h3>`);
    out.push(`<p>Forum: ${marked(track.forum)}. Against: ${escapeHtml(track.against.join(', '))}. Violations: ${escapeHtml(track.violations.join(', '))}.</p>`);
    out.push(table(['Point', 'Violation', 'Authority', 'Proof'], track.points.map((p) => [
      `${escapeHtml(p.id)}: ${marked(p.text)}`, escapeHtml(p.violation), marked(p.authority), proofCell(ctx, p.proof),
    ])));
    if (track.brief) out.push(briefTables(ctx, track.brief));
    if (track.counts) out.push(countTable(track.counts));
  }
  return out.join('\n');
}

/** One section per violation: its summary and references, its steps, its contrast and its figures. */
function violationSection(ctx: Ctx, matter: Matter): string {
  const ids = (xs: readonly string[]) => escapeHtml(xs.join(', '));
  const out = ['<h2>Violations</h2>'];
  if (matter.violations.length === 0) out.push('<p class="ok">None.</p>');
  for (const v of matter.violations) {
    const period = `${v.period.from} to ${v.period.to ?? 'open'}`;
    out.push(`<h3>${escapeHtml(v.mark)}. ${marked(v.title)} <span class="mono">(${escapeHtml(v.id)}, ${escapeHtml(period)})</span></h3>`);
    out.push(`<p>${marked(v.summary)}</p>${citeList(ctx, v.cites)}`);
    out.push(table(['Actors', 'Entities', 'Events', 'Money'], [[ids(v.actors), ids(v.entities), ids(v.events), ids(v.money)]]));
    out.push(table(['Step', 'Date', 'Label', 'Note', 'Entities', 'Moves', 'Cites'], v.steps.map((st) => [
      escapeHtml(st.id), `<span class="mono">${escapeHtml(st.date)}</span>`, marked(st.label), marked(st.note), ids(st.entities),
      st.moves.map((m) => `${escapeHtml(m.from)} to ${escapeHtml(m.to)}: ${marked(m.label)}`).join('<br>'), citeList(ctx, st.cites),
    ])));
    if (v.contrast) {
      out.push(table(['Side', 'Date', 'Speaker', 'Quote', 'Cites'], v.contrast.map((side) => [
        marked(side.heading), `<span class="mono">${escapeHtml(side.date)}</span>`, escapeHtml(side.speaker), marked(side.quote), citeList(ctx, side.cites),
      ])));
    }
    out.push(table(['Figure', 'Group', 'Label', 'Value', 'Limit', 'Note', 'Cites'], v.figures.map((x) => [
      escapeHtml(x.id), marked(x.group), marked(x.label), `<span class="mono">${escapeHtml(figureValue(x.value, x.unit))}</span>`,
      `<span class="mono">${escapeHtml(figureValue(x.limit, x.unit))}</span>`, marked(x.note), citeList(ctx, x.cites),
    ])));
  }
  return out.join('\n');
}

function docsSection(ctx: Ctx, matter: Matter): string {
  const rows = Object.entries(matter.docs).map(([id, d]) => [
    `<span class="mono">${escapeHtml(ctx.info.paths[id] || id)}</span>`, `<span class="mono">${escapeHtml(d.date)}</span>`, marked(d.type),
    escapeHtml(d.from.join(', ')), escapeHtml(d.to.join(', ')), d.privileged ? '<span class="bad">privileged</span>' : '', marked(d.summary),
  ]);
  return `<h2>Documents</h2>${table(['Path', 'Date', 'Type', 'From', 'To', 'Privilege', 'Summary'], rows)}`;
}

/** A second lock behind escaping: the file opens from disk with no server headers, so it carries its own
 * policy. Nothing loads or runs; only this page's own style block, pinned by its hash. */
export const REPORT_CSP = [
  "default-src 'none'", `style-src 'sha256-${createHash('sha256').update(STYLE).digest('base64')}'`,
  "img-src 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ');

/** The whole review page. A refused build (matter null) shows its counts and issues only. */
export function renderReport(matter: Matter | null, info: BuildInfo, sha: string | null): string {
  const ctx: Ctx = { info };
  const entries = matter
    ? [
      metaSection(ctx, matter), trackSection(ctx, matter), violationSection(ctx, matter), listSections(ctx, matter),
      claimSection(ctx, matter), docsSection(ctx, matter),
    ].join('\n')
    : '<h2>Entries</h2><p class="bad">The build was refused, so there are no entries to review yet.</p>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Matter build report</title><style>${STYLE}</style></head>
<body><h1>Matter build report</h1>
${summarySection(info, sha)}
${issuesSection(info)}
${entries}
</body></html>
`;
}
