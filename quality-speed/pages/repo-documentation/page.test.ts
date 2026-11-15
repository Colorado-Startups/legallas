// SPDX-License-Identifier: Apache-2.0
// The page renders inside the build's word budget from invented records, every front-door item scores from its own
// metrics, a lens with no metric there is excluded, and the audit log's gap shows as missing, never a score.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { joinMetrics, validateManifest, validateRecords } from '../../contract/validate.ts';
import { countWords, MAX_WORDS } from '../../core/guard.ts';
import { scorePage } from '../../core/score.ts';
import { visualShare } from './collect/front.ts';
import { parseMarkdown } from './collect/corpus.ts';
import { aboutShare, viaPrShare } from './collect/github.ts';
import { ITEMS, itemCells, render } from './page.ts';

const manifest = validateManifest(JSON.parse(readFileSync(new URL('manifest.json', import.meta.url), 'utf8')), 'repo-documentation').value!;
const now = new Date('2026-11-09T07:00:00Z');
const run = 'https://github.com/Colorado-Startups/legallas/actions/runs/1001';
// Invented readings: most at goal, every fourth missing, so both the measured and the empty states render.
const raw = manifest.metrics.map((m, i) =>
  i % 4 === 1
    ? { id: m.id, page: 'repo-documentation', value: null, status: 'missing', stage: 'lab', measured_at: null, source_url: null, sample_size: null }
    : { id: m.id, page: 'repo-documentation', value: m.goal, status: 'ok', stage: 'lab', measured_at: '2026-11-09T06:00:00Z', source_url: run, sample_size: m.min_samples },
);
const records = validateRecords(raw, manifest, now).records;
const context = { score: scorePage('repo-documentation', manifest, records, now), metrics: joinMetrics(manifest, records), history: [], others: {}, detail: null };

test('the list is signed off and every invented record passes the contract', () => {
  assert.ok(manifest.signoff_comment);
  assert.equal(records.length, manifest.metrics.length);
});

test('the body stays well inside the word budget, with no inline style or handler', () => {
  const { body } = render(context);
  // The build adds the title and the ring around the body, so leave them room.
  assert.ok(countWords(body) <= MAX_WORDS - 10, `visible words: ${countWords(body)}`);
  assert.doesNotMatch(body, /\sstyle=|\son[a-z]+=/i);
});

test('every metric belongs to exactly one front-door item', () => {
  assert.deepEqual(ITEMS.flatMap((i) => i.metrics).sort(), manifest.metrics.map((m) => m.id).sort());
});

test('an item scores from its own metrics by weight; a lens with none is excluded; the audit gap reads missing', () => {
  const cells = itemCells([
    { id: 'readme_visual_share', lens: 'quality', weight: 3, score: 100 },
    { id: 'front_door_dead_names', lens: 'quality', weight: 1, score: 0 },
    { id: 'license_detected', lens: 'quality', weight: 1, score: 100 },
  ]);
  const at = (row: string, col: string) => cells.find((c) => c.row === row && c.col === col);
  assert.equal(at('readme', 'quality')?.score, 75);
  assert.equal(at('license', 'speed')?.excluded, true);
  assert.deepEqual(at('audit', 'quality'), { row: 'audit', col: 'quality', score: null });
  assert.equal(at('audit', 'speed')?.excluded, true);
});

test('visual share: tables, fences and images against paragraphs and lists; headings count as neither', () => {
  const doc = parseMarkdown('README.md', '# T\n\nOne line of prose.\n\n- a list item\n\n| a | b |\n|---|---|\n\n```mermaid\nflowchart LR\n```\n\n![d](d.svg)\n');
  // Visual: two table rows, one fence line, one image. Prose: a paragraph and a list item.
  assert.equal(visualShare(doc), (100 * 4) / 6);
});

test('About counts each field set, the website only when it answers; Activity counts commits merged into main', () => {
  assert.equal(aboutShare({ description: 'x', topics: [], homepage: 'https://a.test' }, false), 100 / 3);
  assert.equal(aboutShare({ description: 'x', topics: ['law'], homepage: 'https://a.test' }, true), 100);
  const commits = [
    { oid: 'a', prs: [{ merged: true, base: 'main' }] },
    { oid: 'b', prs: [] },
    { oid: 'c', prs: [{ merged: false, base: 'main' }] },
    { oid: 'd', prs: [{ merged: true, base: 'other' }] },
  ];
  assert.equal(viaPrShare(commits), 25);
});

test('a page with no signed-off list renders nothing', () => {
  const unsigned = { ...context, score: { ...context.score, has_list: false } };
  assert.equal(render(unsigned).body, '');
});
