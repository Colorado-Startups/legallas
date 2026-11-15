// SPDX-License-Identifier: Apache-2.0
//   node --test quality-speed/pages/templates/collect.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { laneRecord } from '../../core/lane/collect.ts';
import {
  bannedClaim, collect, taxLine, p95, render, renderMs, templateFiles, covered, fieldsWork, loadDocs, notices, parseFrontMatter, records, rightToShip,
  wording, type Doc,
} from './collect.ts';
import { partTokens } from './collect.ts';

const n = notices();
const START = '<!-- TEMPLATE START -->';
const END = '<!-- TEMPLATE END -->';
const footer = (id: string) => `Legallas template ${id} version 1. Law checked 2026-11-01. Not reviewed by a lawyer. Have your own lawyer review. Delete this line before signing.`;

/** A small template in the README's format, with invented facts. */
function sample(extra = ''): string {
  return `---
id: founders/sample
title: Sample
kind: template
path: startup-forms
level: [colorado]
entity: [colorado-corporation]
statutes:
  - C.R.S. 7-102-102
source: Original drafting for Legallas from the statutes listed,
  with nothing adapted.
licence: CC0-1.0
date_checked: 2026-11-01
fields:
  - COMPANY_NAME
${extra}---

# Sample

> ${n.short}
>
> No lawyer has reviewed this template.

## Before you use this

Use it for Harbor Labs.

## The document

${START}

{{COMPANY_NAME}} adopts this.

[OPTION A: One. Recommended.]
Text A.
[END OPTION A]
[OPTION B: Two.]
Text B.
[END OPTION B]

${footer('founders/sample')}

${END}

## Drafting notes

## What couldn't be checked

## Sources
`;
}
const doc = (text: string, id = 'founders/sample'): Doc => {
  const p = parseFrontMatter(text);
  return { id, fm: p?.fm ?? null, body: p?.body ?? '' };
};
const now = new Date('2026-11-02T00:00:00Z');

test('front matter: lists, inline lists, maps and wrapped values; anything else is null', () => {
  const fm = doc(sample()).fm!;
  assert.deepEqual(fm.level, ['colorado']);
  assert.deepEqual(fm.statutes, ['C.R.S. 7-102-102']);
  assert.match(String(fm.source), /listed, with nothing adapted\.$/);
  assert.deepEqual(parseFrontMatter('---\nfields:\n  company_name: The name\n---\nx')?.fm.fields, { company_name: 'The name' });
  assert.equal(parseFrontMatter('no front matter'), null);
  assert.equal(parseFrontMatter('---\n- stray\n---\n'), null);
});

test('the sample template passes every check', () => {
  const d = doc(sample());
  assert.equal(rightToShip(d, ''), true);
  assert.equal(fieldsWork(d), true);
  assert.equal(wording(d, n), true);
});

test('right to ship: a third-party licence fails unless the May ship table names the file', () => {
  const d = doc(sample().replace('licence: CC0-1.0', 'licence: CC BY-ND 4.0'));
  assert.equal(rightToShip(d, ''), false);
  assert.equal(rightToShip(d, '| [form](founders/sample.md) | CC BY-ND |'), true);
  assert.equal(rightToShip(d, '| [form](other/founders/sample.md) | CC BY-ND |'), false, 'a longer path is another file');
  assert.equal(rightToShip(d, '| founders/sample.md | CC BY-ND |'), false, 'only a link target counts');
  assert.equal(rightToShip(doc(sample().replace('source: Original drafting for Legallas', 'source: Adapted from the NVCA model form, not original drafting. Original drafting for Legallas')), ''), false);
  assert.equal(rightToShip(doc(sample().replace('from the statutes listed,', 'adapted from the NVCA model form,')), ''), false);
  assert.equal(rightToShip(doc(sample().replace('with nothing adapted.', 'No form was adapted. Model forms are linked, not copied or adapted.')), ''), true);
  assert.equal(rightToShip(doc(sample().replace('with nothing adapted.', 'No real group\'s charter or membership agreement was read or adapted.')), ''), true, 'a negation reaches its own clause');
  assert.equal(rightToShip(doc(sample().replace('with nothing adapted.', 'Nothing was paid and the text was copied.')), ''), false, 'a new clause ends the negation');
});

test('fields: undeclared, unused, malformed or unpaired options fail', () => {
  assert.equal(fieldsWork(doc(sample().replace('{{COMPANY_NAME}} adopts', '{{OTHER}} adopts'))), false);
  assert.equal(fieldsWork(doc(sample('  - UNUSED\n'))), false);
  assert.equal(fieldsWork(doc(sample().replace('{{COMPANY_NAME}}', '{{ COMPANY_NAME }}'))), false);
  assert.equal(fieldsWork(doc(sample().replace('[END OPTION B]', ''))), false);
  assert.equal(fieldsWork(doc(sample().replace('[END OPTION A]', '[END OPTION B]'))), false);
});

test('wording: no short line, no footer or a banned claim fails', () => {
  assert.equal(wording(doc(sample().replace(`> ${n.short}`, '')), n), false);
  assert.equal(wording(doc(sample().replace(footer('founders/sample'), '')), n), false);
  assert.equal(wording(doc(sample().replace('Use it for Harbor Labs.', 'A lawyer reviewed this template.')), n), false);
});

test('banned claims: negated sentences pass, every listed claim fails', () => {
  for (const ok of [
    'No lawyer has reviewed this template.', 'None of this replaces a lawyer.', 'Not reviewed by a lawyer.', 'Investors must be verified as accredited.',
    'The board meets in privileged session.', 'No lawyer, attorney or law firm has reviewed this template.', 'This template, not reviewed by a lawyer, is a draft.',
  ]) {
    assert.equal(bannedClaim(ok), false, ok);
  }
  for (const bad of [
    'This template is lawyer-reviewed.', 'Approved by an attorney.', 'A law firm has vetted it.', 'Lawyer-grade documents.',
    'It replaces a lawyer.', 'There is no need for a lawyer.', 'It saves you legal fees.', 'Pay less for lawyers.',
    'Meet your legal agent.', 'For informational purposes only.', 'It does not give legal advice.',
    'This is not a toy: a lawyer reviewed it.', "It isn't cheap, but a lawyer reviewed it.", 'Not a draft, approved by an attorney.',
    'Nothing to sign yet and our attorney approved it.',
    'Nothing here is final and the attorney approved it.', 'No drafts are left; our attorney approved it.', 'No one asked, yet a lawyer reviewed it.',
    'A lawyer, hired last year, has reviewed it.', 'Our attorney, Jane Doe, approved it.', 'This template, reviewed by a lawyer, is ready.',
  ]) {
    assert.equal(bannedClaim(bad), true, bad);
  }
});

test('coverage: a gap or a missing file is not covered', () => {
  const ids = new Set(['founders/sample']);
  assert.equal(covered({ id: 'a', path: 'startup-forms', templates: ['founders/sample'] }, ids), true);
  assert.equal(covered({ id: 'a', path: 'startup-forms', templates: ['founders/sample'], gap: 'colorado-llc' }, ids), false);
  assert.equal(covered({ id: 'a', path: 'startup-forms', templates: ['founders/missing'] }, ids), false);
  assert.equal(covered({ id: 'a', path: 'startup-forms', templates: [] }, ids), false);
});

test('needed.json: every baseline item once, closed lists, and every listed file exists', () => {
  const list = JSON.parse(readFileSync(new URL('needed.json', import.meta.url), 'utf8'));
  const all = [...list.needed, ...list.excluded].map((x: { id: string }) => x.id);
  assert.equal(new Set(all).size, all.length);
  const baseline = readFileSync(new URL('../../../docs/checklist/baseline.toml', import.meta.url), 'utf8');
  const items = [...baseline.matchAll(/\[\[item\]\]\nid = "([^"]+)"/g)].map((m) => m[1] ?? '');
  assert.ok(items.length >= 85);
  for (const id of items) assert.ok(all.includes(id), id);
  const paths = ['startup-forms', 'startup-raises', 'running-the-company', 'angels-invest', 'angels-create-groups', 'vcs-invest'];
  const why = ['not-prepare', 'search', 'account', 'record', 'third-party', 'payroll', 'practice', 'notices-bar'];
  const ids = new Set(loadDocs().map((d) => d.id));
  for (const x of list.needed) {
    assert.ok(paths.includes(x.path), x.id);
    for (const t of x.templates) assert.ok(ids.has(t), t);
  }
  for (const x of list.excluded) assert.ok(why.includes(x.why), x.id);
});

test('every template in the repository parses, so a parser fault cannot shrink a denominator', () => {
  for (const d of loadDocs()) assert.ok(d.fm, d.id);
});

test('records: a reading is ok with a link and a time, or missing with nulls', () => {
  const { values } = collect();
  const url = 'https://github.com/Colorado-Startups/legallas/actions/runs/1';
  const out = records(values, now, url);
  assert.equal(out.length, 6);
  const coverage = out.find((r) => r.id === 'coverage')!;
  assert.equal(coverage.status, 'ok');
  assert.equal(coverage.measured_at, '2026-11-02T00:00:00Z');
  assert.equal(coverage.source_url, url);
  assert.equal(out.find((r) => r.id === 'fill_ms_p95')?.status, 'ok');
  assert.equal(out.find((r) => r.id === 'fill_ms_p95')?.sample_size, templateFiles().length);
  const tokens = out.find((r) => r.id === 'template_part_tokens_max')!;
  assert.equal(tokens.sample_size, templateFiles().length);
  assert.ok(tokens.value !== null && tokens.value <= 10_000, `every template's largest part reads within the goal: ${tokens.value}`);
});

test('template_part_tokens_max: each template split as legallas_template splits it, characters over four, the largest part', () => {
  const texts: Record<string, string> = {
    // 50,000 characters, past 10,000 tokens: two parts at the heading, of 30,000 and 20,000 characters.
    split: `# A\n${'x'.repeat(29_995)}\n# B\n${'y'.repeat(19_995)}\n`,
    whole: 'x'.repeat(4001),
  };
  assert.deepEqual(partTokens(['split', 'whole'], (file) => texts[file]!), { value: 7500, sample: 2 });
  assert.deepEqual(partTokens(['whole'], (file) => texts[file]!), { value: 1001, sample: 1 });
  assert.deepEqual(partTokens([]), { value: null, sample: 0 });
});

test('fill_ms_p95: the 95th percentile of timed renders, nearest rank', () => {
  let t = 0;
  const steps = [5, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 200];
  let i = 0;
  const clock = () => t;
  const run = () => {
    t += steps[i++] ?? 0;
    return 'filled';
  };
  assert.deepEqual(renderMs(steps.map((_, n) => `f${n}`), clock, run), { value: 19, sample: 20 });
  assert.equal(p95([]), null);
  assert.equal(p95([3, 1, 2]), 3);
});

test('fill_ms_p95: one template that fails to render makes the run missing', () => {
  const run = (f: string) => (f === 'bad' ? null : 'filled');
  assert.deepEqual(renderMs(['a', 'bad', 'c'], () => 0, run), { value: null, sample: 3 });
  assert.equal(renderMs([], () => 0, run).value, null);
  const recs = records({ fill_ms_p95: renderMs(['bad'], () => 0, run) } as never, now, 'https://github.com/Colorado-Startups/legallas/actions/runs/1');
  assert.equal(recs[0]?.status, 'missing');
});

test('render: fields filled with invented values, markers gone; a broken file fails', () => {
  const files = templateFiles();
  // A floor, not an exact count: a pull request may add templates, and none may go missing.
  assert.ok(files.length >= 34, `${files.length} templates: one went missing`);
  for (const f of files) {
    const out = render(f);
    assert.ok(out !== null, f);
    assert.doesNotMatch(out, /\{\{|\[(END )?OPTION/);
  }
  assert.equal(render('/nonexistent/template.md'), null);
});

test('lane_minutes reads missing outside CI, never 0', async () => {
  const r = await laneRecord('templates', {});
  assert.equal(r.status, 'missing');
  assert.equal(r.value, null);
});

test('tax line: Colorado tax content carries "have your own tax professional review" (notice A1)', () => {
  const doc = (body: string, statutes: string[] = []): Doc => ({ id: 'x', fm: { statutes }, body });
  assert.equal(taxLine(doc('Delaware annual tax, 6 Del. C. 18-1107.')), true, 'no Colorado tax law: nothing to add');
  assert.equal(taxLine(doc('A credit ([C.R.S. 39-22-532][t39]).')), false);
  assert.equal(taxLine(doc('Notes.', ['C.R.S. 39-22-532 (credit)'])), false, 'a statute in the front matter counts');
  assert.equal(taxLine(doc('Tax setup: Colorado composite return.')), false);
  assert.equal(taxLine(doc('A credit ([39-22-532][t39]). Have your own tax\nprofessional review your claim.')), true, 'across a wrapped line');
});

/** Waiting on open pull request #588, which edits this file. */
const TAX_LINE_WAITING = new Set(['investors/groups/manager-annual-duties']);

test('every template with Colorado tax content carries the tax line', () => {
  const missing = loadDocs().filter((d) => !TAX_LINE_WAITING.has(d.id) && !taxLine(d)).map((d) => d.id);
  assert.deepEqual(missing, []);
});
