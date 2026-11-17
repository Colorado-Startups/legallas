// SPDX-License-Identifier: Apache-2.0
// One lane run for real against invented pages: good records land, bad ones drop, and a failure writes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectLane } from './collect.ts';

const MANIFEST = readFileSync(new URL('../contract/example/manifest.json', import.meta.url), 'utf8');
const LANE = { id: 'github', runner: 'linux', cadence: 'daily', collector: 'collect.ts' };
const RECORD = {
  id: 'line_coverage',
  page: 'code',
  value: 72.5,
  status: 'ok',
  stage: 'lab',
  measured_at: '2025-03-04T08:37:00Z',
  source_url: 'https://github.com/Colorado-Startups/legallas/actions/runs/1001',
  sample_size: 1,
};

/** A pages folder and an output folder, with this collector source for the `code` page. */
function setUp(source: string): { pagesDir: string; out: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'collect-test-'));
  const pagesDir = path.join(root, 'pages');
  mkdirSync(path.join(pagesDir, 'code'), { recursive: true });
  writeFileSync(path.join(pagesDir, 'code', 'manifest.json'), MANIFEST);
  writeFileSync(path.join(pagesDir, 'code', 'lanes.json'), JSON.stringify([LANE]));
  writeFileSync(path.join(pagesDir, 'code', 'collect.ts'), source);
  return { pagesDir, out: path.join(root, 'out') };
}

/** A collector that writes these records to the file named after --out. */
const writes = (records: unknown) =>
  `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv[process.argv.indexOf('--out') + 1], ${JSON.stringify(JSON.stringify(records))});\n`;

const landed = (out: string) => path.join(out, 'code', 'github.json');

test('good records land in the lane file', () => {
  const { pagesDir, out } = setUp(writes([RECORD]));
  assert.deepEqual(collectLane('code', 'github', out, pagesDir), []);
  assert.deepEqual(JSON.parse(readFileSync(landed(out), 'utf8')), [RECORD]);
  rmSync(path.dirname(out), { recursive: true });
});

test('a bad record is dropped and reported, and the good ones still land', () => {
  const { pagesDir, out } = setUp(writes([RECORD, { ...RECORD, id: 'not_on_the_list' }]));
  assert.deepEqual(collectLane('code', 'github', out, pagesDir), ['records[1]: id is not in the manifest']);
  assert.deepEqual(JSON.parse(readFileSync(landed(out), 'utf8')), [RECORD]);
  rmSync(path.dirname(out), { recursive: true });
});

test('a collector that fails writes nothing', () => {
  const { pagesDir, out } = setUp('process.exit(3);\n');
  assert.deepEqual(collectLane('code', 'github', out, pagesDir), ['the collector failed or timed out']);
  assert.equal(existsSync(landed(out)), false);
  rmSync(path.dirname(out), { recursive: true });
});

test('a collector that hangs is stopped and writes nothing', () => {
  const { pagesDir, out } = setUp('setTimeout(() => {}, 60_000);\n');
  assert.deepEqual(collectLane('code', 'github', out, pagesDir, 200), ['the collector failed or timed out']);
  assert.equal(existsSync(landed(out)), false);
  rmSync(path.dirname(out), { recursive: true });
});

test('a collector that writes no file or bad JSON writes nothing', () => {
  const silent = setUp('\n');
  assert.deepEqual(collectLane('code', 'github', silent.out, silent.pagesDir), ['the collector wrote no records']);
  rmSync(path.dirname(silent.out), { recursive: true });
  const garbled = setUp(`import { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv[process.argv.indexOf('--out') + 1], 'not json');\n`);
  assert.deepEqual(collectLane('code', 'github', garbled.out, garbled.pagesDir), ['the collector wrote invalid JSON']);
  assert.equal(existsSync(landed(garbled.out)), false);
  rmSync(path.dirname(garbled.out), { recursive: true });
});

test('the collector gets its args before --out, its folder and its last run', () => {
  const body = `import { writeFileSync } from 'node:fs';\nconst seen = { args: process.argv.slice(2, 3), detail: process.env.DETAIL_DIR.endsWith('code/github'), prev: process.env.PREV_DIR.endsWith('lanes/code/github') };\nif (seen.args[0] !== 'employment-law' || !seen.detail || !seen.prev) process.exit(9);\nwriteFileSync(process.argv[process.argv.indexOf('--out') + 1], '[]');\n`;
  const { pagesDir, out } = setUp(body);
  writeFileSync(path.join(pagesDir, 'code', 'lanes.json'), JSON.stringify([{ ...LANE, args: ['employment-law'] }]));
  assert.deepEqual(collectLane('code', 'github', out, pagesDir, 60_000, path.join(out, 'state-in')), []);
  rmSync(path.dirname(out), { recursive: true });
});

test('a lane the page does not declare does not run', () => {
  const { pagesDir, out } = setUp(writes([RECORD]));
  assert.deepEqual(collectLane('code', 'other', out, pagesDir), ['this lane is not declared']);
  rmSync(path.dirname(out), { recursive: true });
});

test('a private measurement goes out missing, and a page with private detail sends none', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'collect-private-'));
  const pagesDir = path.join(root, 'pages');
  mkdirSync(path.join(pagesDir, 'pull-requests'), { recursive: true });
  // The example list, renamed to the Pull requests page: one private measurement (review_tokens_p50), one public.
  const manifest = MANIFEST.replaceAll('"code"', '"pull-requests"').replace('"line_coverage"', '"review_tokens_p50"').replace('"functions_over_60_lines"', '"small_changes"');
  writeFileSync(path.join(pagesDir, 'pull-requests', 'manifest.json'), manifest);
  writeFileSync(path.join(pagesDir, 'pull-requests', 'lanes.json'), JSON.stringify([LANE]));
  const records = [
    { ...RECORD, id: 'review_tokens_p50', page: 'pull-requests', value: 0.42 },
    { ...RECORD, id: 'small_changes', page: 'pull-requests', value: 3 },
  ];
  const body = `import { mkdirSync, writeFileSync } from 'node:fs';\nmkdirSync(process.env.DETAIL_DIR + '/page', { recursive: true });\nwriteFileSync(process.env.DETAIL_DIR + '/page/rows.json', '[{"usd":1}]');\nwriteFileSync(process.argv[process.argv.indexOf('--out') + 1], ${JSON.stringify(JSON.stringify(records))});\n`;
  writeFileSync(path.join(pagesDir, 'pull-requests', 'collect.ts'), body);
  const out = path.join(root, 'out');
  assert.deepEqual(collectLane('pull-requests', 'github', out, pagesDir), []);
  const [usd, green] = JSON.parse(readFileSync(path.join(out, 'pull-requests', 'github.json'), 'utf8'));
  assert.deepEqual([usd.id, usd.value, usd.status, usd.measured_at], ['review_tokens_p50', null, 'missing', null]);
  assert.equal(green.value, 3);
  assert.equal(existsSync(path.join(out, 'pull-requests', 'github')), false, 'no detail folder');
  rmSync(root, { recursive: true });
});

test('a page with private detail sends none even when its collector fails', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'collect-private-fail-'));
  const pagesDir = path.join(root, 'pages');
  mkdirSync(path.join(pagesDir, 'pull-requests'), { recursive: true });
  writeFileSync(path.join(pagesDir, 'pull-requests', 'manifest.json'), MANIFEST.replaceAll('"code"', '"pull-requests"'));
  writeFileSync(path.join(pagesDir, 'pull-requests', 'lanes.json'), JSON.stringify([LANE]));
  const body = `import { mkdirSync, writeFileSync } from 'node:fs';\nmkdirSync(process.env.DETAIL_DIR + '/facts', { recursive: true });\nwriteFileSync(process.env.DETAIL_DIR + '/facts/facts.json', '{"review_tokens":[1]}');\nprocess.exit(3);\n`;
  writeFileSync(path.join(pagesDir, 'pull-requests', 'collect.ts'), body);
  const out = path.join(root, 'out');
  assert.deepEqual(collectLane('pull-requests', 'github', out, pagesDir), ['the collector failed or timed out']);
  assert.equal(existsSync(path.join(out, 'pull-requests', 'github')), false);
  rmSync(root, { recursive: true });
});
