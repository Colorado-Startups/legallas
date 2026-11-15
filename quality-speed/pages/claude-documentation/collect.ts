// SPDX-License-Identifier: Apache-2.0
// The Claude documentation page's collector, as core/collect.ts runs it: what Claude and other coding AIs read at start.
// Needs no token. The page's drill-downs go to $DETAIL_DIR/page/ (ids, paths and numbers only).
//
//   node quality-speed/pages/claude-documentation/collect.ts --out records.json [--run-url <a run link of this repository>]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MetricRecord } from '../../contract/format.ts';
import { claudeLoad, startLoad } from './load.ts';
import { checkQuestions, loadCorpus, loadQuestions } from './questions.ts';
import { EXPECTED, EXPECTED_BEFORE, parseExpected, SETTINGS, settingsReadings, type Version } from './settings.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PAGE = 'claude-documentation' as const;

const parse = (text: string | null): unknown => {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
};

function git(args: string[]): string | null {
  const out = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return out.status === 0 ? out.stdout : null;
}

/** Every commit that touched the settings or expected.json, at either of its places, newest first. */
function history(): Version[] {
  const log = git(['log', '--format=%H %cI', '--', SETTINGS, EXPECTED, EXPECTED_BEFORE]) ?? '';
  return log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha = '', at = ''] = line.split(' ');
      const show = (file: string) => parse(git(['show', `${sha}:${file}`]));
      return { at: new Date(at).toISOString(), expected: parseExpected(show(EXPECTED) ?? show(EXPECTED_BEFORE)), settings: show(SETTINGS) };
    });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: id } = process.env;
  const out = arg('--out');
  const sourceUrl = arg('--run-url') ?? (server && repo && id ? `${server}/${repo}/actions/runs/${id}` : undefined);
  const expected = parseExpected(parse(readFileSync(path.join(ROOT, EXPECTED), 'utf8')));
  if (!out || !sourceUrl || !expected) {
    console.error('usage: collect.ts --out <file> [--run-url <run link>], with an expected.json that passes its check');
    process.exit(1);
  }
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const ok = (id: string, value: number, n: number): MetricRecord => ({ id, page: PAGE, value, status: 'ok', stage: 'live', measured_at: now, source_url: sourceUrl, sample_size: n });
  const missing = (id: string): MetricRecord => ({ id, page: PAGE, value: null, status: 'missing', stage: 'live', measured_at: null, source_url: null, sample_size: null });

  const questions = loadQuestions(path.join(ROOT, 'quality-speed/pages/claude-documentation/questions.json'));
  const answers = checkQuestions(loadCorpus(ROOT), questions);
  const passed = answers.filter((a) => a.pass).length;
  const settingsFile = path.join(ROOT, SETTINGS);
  const s = settingsReadings(expected, parse(existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8') : null), history(), now);
  const start = startLoad(ROOT);
  const claude = claudeLoad(ROOT);

  const records: MetricRecord[] = [
    questions.length ? ok('questions_true', Math.round((10_000 * passed) / questions.length) / 100, questions.length) : missing('questions_true'),
    s.match ? ok('settings_match', s.match.value, s.match.n) : missing('settings_match'),
    s.deny ? ok('deny_rules_kept', s.deny.value, s.deny.n) : missing('deny_rules_kept'),
    s.open ? ok('drift_open_hours', s.open.hours, s.open.read) : missing('drift_open_hours'),
    start.length ? ok('start_tokens', start.reduce((n, f) => n + f.tokens, 0), start.length) : missing('start_tokens'),
    claude ? ok('startup_tokens', claude.tokens, claude.files.length) : missing('startup_tokens'),
  ];
  writeFileSync(out, `${JSON.stringify(records)}\n`);

  const detail = process.env.DETAIL_DIR ? path.join(process.env.DETAIL_DIR, 'page') : path.dirname(out);
  mkdirSync(detail, { recursive: true });
  const write = (name: string, value: unknown) => writeFileSync(path.join(detail, `${name}.json`), JSON.stringify(value));
  write('answers', answers.map((a) => ({ id: a.id, stated: a.stated, true: a.true, clean: a.conflicts === 0 })));
  write('load', [...start.map((f) => ({ ...f, part: 'start' })), ...(claude?.files ?? []).map((f) => ({ ...f, part: 'claude' }))]);
  write('rows', s.rows);
  for (const r of records) console.log(`${r.id}: ${r.status} ${r.value ?? ''}`);
}
