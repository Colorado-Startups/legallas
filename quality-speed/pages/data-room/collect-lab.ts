// SPDX-License-Identifier: Apache-2.0
// The Data room's lanes: each runs the sample room (lab/run.ts) for one room type, when it has journeys to time, and writes a record for the rows it
// measures. Numbers and ids leave here, never a question, a document name or a passage. It only runs in CI, because lab/run.ts
// refuses anywhere else. collect-forming.ts, collect-dispute.ts and collect-deal.ts are the lanes.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseTap, recordsOf, wordingBreaks, type LabReport } from './evaluate.ts';
import type { LabReport as WrittenReport } from './lab/report.ts';
import { laneOf, ROWS, type Lane, type ListRow } from './list.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const WEB = path.join(ROOT, 'web');

function runLab(work: string, record: string, only: readonly string[]): LabReport | null {
  const out = path.join(work, 'lab');
  const run = spawnSync(process.execPath, [path.join(HERE, 'lab/run.ts'), '--install', '--out', out, '--room', path.join(work, 'room'), '--record', record, '--only', only.join(',')], { cwd: ROOT, stdio: 'inherit' });
  const file = path.join(out, 'report.json');
  if (!existsSync(file)) return null;
  // Read as the lab's own type, so renaming a field this page reads fails the type check.
  const report = JSON.parse(readFileSync(file, 'utf8')) as WrittenReport;
  // The exit code has the last word, so a run that stopped after writing its report can't pass as one that finished.
  return { ...report, failed: report.failed || run.status !== 0 };
}

/** Each named test file on its own, so a result can't be credited to the wrong file. */
function runTests(rows: readonly ListRow[]): Map<string, { name: string; ok: boolean }[]> {
  const files = new Set(rows.flatMap((row) => ('test' in row.evidence ? [row.evidence.test] : [])));
  return new Map(
    [...files].map((file) => {
      const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.relative('web', file)], { cwd: WEB, encoding: 'utf8', maxBuffer: 1 << 26 });
      return [file, parseTap(run.stdout ?? '')];
    }),
  );
}

/** Built pages' text against the product's wording rules, or null with nothing built or no rules yet. */
function checkWording(): number | null {
  const dist = path.join(WEB, 'dist');
  const rules = path.join(HERE, 'gold/legal-wording.json');
  if (!existsSync(dist) || !existsSync(rules)) return null;
  const pages = (readdirSync(dist, { recursive: true }) as string[])
    .filter((name) => name.endsWith('.html'))
    .map((name) => ({ page: name, text: readFileSync(path.join(dist, name), 'utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') }));
  if (pages.length === 0) return null;
  const wording = JSON.parse(readFileSync(rules, 'utf8')) as {
    required: { id: string; text: string }[];
    banned: { surfaces: string[]; patterns: string[] }[];
  };
  const shortLine = wording.required.filter((r) => r.id === 'short-line').map((r) => r.text);
  const banned = wording.banned.filter((b) => b.surfaces.includes('all')).flatMap((b) => b.patterns).map((p) => new RegExp(p, 'i'));
  return wordingBreaks(pages, shortLine, banned);
}

/** Runs one lane: the journeys in `only` on the sample room for `record`, then the rows `laneOf` gives it. No journeys runs no lab. */
export function collect(lane: Lane, record: string, only: readonly string[]): void {
  const { values } = parseArgs({ options: { out: { type: 'string' } }, allowPositionals: true });
  if (!values.out) throw new Error('usage: <lane>.ts --out <file>');
  const report = only.length ? runLab(mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'data-room-')), record, only) : null;
  const rows = ROWS.filter((row) => laneOf(row.id) === lane);
  const records = recordsOf(rows, { report, tests: runTests(rows), wordingBreaks: report && !report.failed ? checkWording() : null, answers: {}, laneMinutes: only.length && (!report || report.failed) ? undefined : Math.round((performance.now() / 60000) * 10) / 10 }, {
    sourceUrl: `https://github.com/Colorado-Startups/legallas/actions/runs/${process.env.GITHUB_RUN_ID ?? ''}`,
    measuredAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    stage: 'lab',
  });
  writeFileSync(values.out, `${JSON.stringify(records)}\n`);
  console.log(`Data room, ${lane}: ${records.filter((r) => r.status === 'ok').length} of ${records.length} rows measured.`);
}
