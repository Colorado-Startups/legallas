// SPDX-License-Identifier: Apache-2.0
// Card F4. The R5 helpers, the keyword flags, the diff and the review page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Matter } from '../../worker/matter-types.ts';
import { assemble } from './build.ts';
import { CATALOG_REL, parseCatalog } from './catalog.ts';
import { excludeEvents, exclusions, isWorkProduct, keywordFlags, tally } from './checks.ts';
import { diffMatter, formatDiff } from './diff.ts';
import { loadFragments } from './fragments.ts';
import { REPORT_CSP, escapeHtml, formatCents, marked, renderReport } from './report.ts';
import { loadResolver } from './resolve.ts';
import { FRAGMENTS, NOW, SOURCE_ROOT, fakeD1 } from './testkit.ts';

async function fixture() {
  const catalog = parseCatalog(await readFile(path.join(SOURCE_ROOT, CATALOG_REL), 'utf8'), SOURCE_ROOT);
  const { matter, info } = assemble(catalog, await loadFragments(FRAGMENTS), await loadResolver(fakeD1(), SOURCE_ROOT), NOW);
  assert.ok(matter);
  return { matter, info };
}

test('isWorkProduct: analysis folders, WP filename markers and model-like types', () => {
  assert.equal(isWorkProduct('10-Lawyer-Analysis/Maps/Map.md', null), true);
  assert.equal(isWorkProduct('x/Claim_Chart__WP__20130312.xlsx', null), true);
  assert.equal(isWorkProduct('x/Work Product/a.pdf', null), true);
  assert.equal(isWorkProduct('06-Cap-Table/Bank_Statement_BS__20120730.pdf', 'Bank Statement'), false);
  assert.equal(isWorkProduct('06-Cap-Table/a.xlsx', 'Damages model'), true);
  assert.equal(isWorkProduct(null, 'Valuation'), true);
  assert.equal(isWorkProduct(null, null), false);
  assert.equal(isWorkProduct(null, 'Claim Chart (work product)'), true);
});

test('exclusions: the publish gate finds every kind in a manifest', async () => {
  const { matter } = await fixture();
  assert.deepEqual(exclusions(matter, new Map()), []);
  const bad = structuredClone(matter) as Matter;
  bad.events[0].date = '2027-01-01';
  bad.people[0].cites = [];
  bad.money[0].cites = [{ doc: '00000000-0000-4000-8000-000000000007', page: null }];
  assert.deepEqual(exclusions(bad, new Map([['00000000-0000-4000-8000-000000000007', '10-Lawyer-Analysis/x.xlsx']])).map((x) => x.rule), [
    'future-event', 'money-cites-work-product', 'no-cite',
  ]);
});

test('excludeEvents: deadlines and anything after the build day, partial dates by their first day', () => {
  const events = [
    { id: 'a', date: '2026-10-01', type: 'order' },
    { id: 'b', date: '2026-10', type: 'order' },
    { id: 'c', date: '2026-10-06', type: 'order' },
    { id: 'd', date: '2027', type: 'order' },
    { id: 'e', date: '2012', type: 'deadline' },
  ];
  const { kept, out } = excludeEvents(events, '2026-10-01');
  assert.deepEqual(kept.map((e) => e.id), ['a', 'b']);
  assert.deepEqual(out.map((x) => x.rule), ['future-event', 'future-event', 'deadline-event']);
});

test('keywordFlags: every keyword, in every prose field, with its location; ids and dates are skipped', async () => {
  const { matter } = await fixture();
  const flags = keywordFlags(matter);
  // The fixture email summary mentions an offer.
  assert.deepEqual(flags.map((f) => f.keyword), ['offer']);
  assert.match(flags[0].where, /^docs:00000000-0000-4000-8000-000000000003\.summary$/);
  const probe = structuredClone(matter) as Matter;
  probe.events[0].summary = 'Moe floats a settlement under rule 408; final wages due; the repurchase deadline; a damages model; a stock valuation; NPV.';
  probe.events[0].id = 'offer-408';
  const keywords = [...tally(keywordFlags(probe), (f) => f.keyword).keys()];
  assert.deepEqual(keywords, ['settlement', '408', 'due', 'deadline', 'damages model', 'valuation', 'NPV', 'offer']);
  // A statement's source kind and dates are identifiers; its note is prose and still read.
  const statement = { held: true, since: null, until: null, asOf: '2013-02-14', basis: 'settlement' as const, share: null, direct: null, note: null, cites: matter.links[0].cites };
  const quiet = structuredClone(matter) as Matter;
  quiet.links[0].statements = [statement];
  assert.deepEqual(keywordFlags(quiet).map((f) => f.keyword), ['offer']);
  quiet.links[0].statements = [{ ...statement, note: 'Rule 408 letter from Moe.' }];
  assert.deepEqual(keywordFlags(quiet).map((f) => f.keyword), ['408', 'offer']);
});

test('diffMatter: counts per list against the published manifest', async () => {
  const { matter } = await fixture();
  const none = diffMatter(null, matter);
  assert.deepEqual(none.events, { added: 2, removed: 0, changed: 0, unchanged: 0 });
  assert.deepEqual(none.meta, { added: 1, removed: 0, changed: 0, unchanged: 0 });
  const next = structuredClone(matter) as Matter;
  next.meta.builtAt = '2026-10-06T00:00:00.000Z';
  next.events[0].title = 'Changed';
  next.people.pop();
  next.links.push({ from: 'p-doe', to: 'org-harbor', label: 'member of', cites: [] });
  const d = diffMatter(matter, next);
  assert.deepEqual(d.meta, { added: 0, removed: 0, changed: 0, unchanged: 1 });
  assert.deepEqual(d.events, { added: 0, removed: 0, changed: 1, unchanged: 1 });
  assert.deepEqual(d.people, { added: 0, removed: 1, changed: 0, unchanged: 1 });
  assert.deepEqual(d.links, { added: 1, removed: 0, changed: 0, unchanged: 1 });
  const text = formatDiff(d, true);
  assert.match(text, /events\s+\+0\s+-0\s+~1\s+=1/);
  assert.doesNotMatch(text, /Changed|Roe|Doe/);
});

test('report: every entry and cite, escaped, keywords marked, no scripts or remote assets', async () => {
  const { matter, info } = await fixture();
  matter.people[0].name = '<script>alert(1)</script>';
  const html = renderReport(matter, info, 'a'.repeat(64));
  for (const entry of [...matter.events, ...matter.people, ...matter.orgs, ...matter.claims, ...matter.money]) assert.ok(html.includes(entry.id));
  // A section per track and per violation, with their points, steps and figures.
  for (const entry of [...matter.tracks, ...matter.violations]) assert.ok(html.includes(entry.id));
  for (const id of ['pt-0001', 'st-0001', 'fig-0001']) assert.ok(html.includes(id), id);
  assert.ok(html.includes('<h2>Tracks</h2>') && html.includes('<h2>Violations</h2>'));
  assert.ok(html.indexOf('<h2>Tracks</h2>') < html.indexOf('<h2>Claims</h2>'), 'tracks ahead of the prior counts');
  assert.ok(html.includes('01-Corporate-Records/Stock_Agreement_SA__20110607__Harbor-Labs__Countersigned.pdf at 3'));
  assert.ok(html.includes('(Signature page.)'));
  assert.ok(html.includes('$17,634.20'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.doesNotMatch(html, /<script|src=|href=|@import|url\(/i);
  assert.match(html, /an <mark>offer<\/mark> to buy/);
});

test('report: each link statement shows held or denied, its dates, its source kind, share and cites', async () => {
  const { matter, info } = await fixture();
  matter.links[0].statements = [
    { held: true, since: '2011-06', until: null, asOf: '2012-03-27', basis: 'document', share: null, direct: null, note: 'Board packet naming the officers.', cites: matter.links[0].cites },
    { held: false, since: null, until: null, asOf: '2013-04-30', basis: 'pleadingTheirs', share: null, direct: null, note: null, cites: matter.links[0].cites },
  ];
  const html = renderReport(matter, info, 'a'.repeat(64));
  assert.ok(html.includes('<th>Statements</th>'));
  assert.ok(html.includes('held; 2011-06 to open; as of 2012-03-27; document'));
  assert.ok(html.includes('denied; dates not stated; as of 2013-04-30; pleadingTheirs'));
  assert.ok(html.includes('Board packet naming the officers.'));
});

test('report: a violation with a contrast lists both sides with date, speaker, quote and cites', async () => {
  const { matter, info } = await fixture();
  const cites = matter.violations[0].cites;
  matter.violations[0].contrast = [
    { heading: 'Letter to the team', date: '2012-05-11', speaker: 'p-roe', quote: 'The <board> voted unanimously.', cites },
    { heading: 'Minutes show', date: '2012-05-09', speaker: null, quote: 'Vote: 2 to 1.', cites },
  ];
  const html = renderReport(matter, info, 'a'.repeat(64));
  assert.ok(html.includes('<th>Side</th><th>Date</th><th>Speaker</th><th>Quote</th><th>Cites</th>'));
  assert.ok(html.includes('The &lt;board&gt; voted unanimously.'));
  assert.ok(html.includes('<span class="mono">2012-05-09</span>'));
});

test('report: a track brief and its counts are listed for review, an element with no point flagged; step notes and figure groups show', async () => {
  const { matter, info } = await fixture();
  const cites = matter.violations[0].cites;
  const track = matter.tracks.find((t) => t.points.length > 0)!;
  track.brief = {
    line: 'The board removed its <CEO> on two days of notice.',
    cast: [{ id: 'p-roe', role: 'CTO', via: 'org-harbor' }],
    hurdles: [{ id: 'h-1', title: 'Card charges', text: 'Roe says the card charges were cause for the removal.', cites }],
    dates: [{ date: '2012-07-02', text: 'Final wages due on the second.', cites }],
    exhibits: [{ cite: cites[0]!, proves: 'The stock agreement binds the company.' }],
    drafts: [{ label: 'Draft complaint', doc: cites[0]!.doc }],
  };
  track.counts = [{ id: 'cnt-1', title: 'Breach', against: ['p-roe'], basis: 'The stock agreement', kind: 'derivative', elements: [
    { id: 'el-1', text: 'The company bought back vested shares.', points: [track.points[0]!.id] }, { id: 'el-2', text: 'Harm to the holder.', points: [] },
  ] }];
  matter.violations[0].steps[0]!.note = 'Why the step matters.';
  matter.violations[0].figures[0]!.group = 'Before suit';
  const html = renderReport(matter, info, 'a'.repeat(64));
  assert.ok(html.includes('<h4>Brief</h4><p>The board removed its &lt;CEO&gt; on two days of notice.</p>'));
  assert.ok(html.includes('<th>Cast</th><th>Role</th><th>Through</th>'));
  assert.ok(html.includes('<td>h-1: Card charges</td>'));
  assert.ok(html.includes('Final wages <mark>due</mark> on the second.'), 'brief text gets the keyword flags');
  assert.ok(html.includes('<th>Key exhibit</th><th>Proves</th>'));
  assert.ok(html.includes(`<td>Draft complaint</td><td><span class="mono">${info.paths[cites[0]!.doc]}</span></td>`));
  assert.ok(html.includes('<h4>Counts</h4>'));
  assert.ok(html.includes('<td>derivative</td>'));
  assert.ok(html.includes(`el-1: The company bought back vested shares. (${track.points[0]!.id})`));
  assert.ok(html.includes('el-2: Harm to the holder. (<span class="bad">no point</span>)'));
  assert.ok(html.includes('<td>Why the step matters.</td>'));
  assert.ok(html.includes('<th>Figure</th><th>Group</th>'));
  assert.ok(html.includes('<td>Before suit</td>'));
});

test('report helpers', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(marked('A settlement offer'), 'A <mark>settlement</mark> <mark>offer</mark>');
  assert.equal(formatCents(123456789), '$1,234,567.89');
  assert.equal(formatCents(-5), '-$0.05');
});

test('report: its own content security policy blocks scripts and off-site requests, and pins the style', async () => {
  const { matter, info } = await fixture();
  for (const html of [renderReport(matter, info, null), renderReport(null, info, null)]) {
    const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
    assert.ok(meta, 'policy meta present');
    assert.ok(html.indexOf(meta[0]) < html.indexOf('<style>'), 'policy ahead of the style block');
    const policy = meta[1];
    assert.equal(policy, REPORT_CSP);
    for (const rule of ["default-src 'none'", "img-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(policy.includes(rule), rule);
    assert.doesNotMatch(policy, /unsafe-|script-src|https?:|\*/);
    const style = html.match(/<style>([\s\S]*?)<\/style>/);
    assert.ok(style);
    const hash = createHash('sha256').update(style[1]).digest('base64');
    assert.ok(policy.includes(`style-src 'sha256-${hash}'`), 'style hash matches the page');
  }
});
