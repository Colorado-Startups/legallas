// SPDX-License-Identifier: Apache-2.0
// The Code page's docs lane: `node quality-speed/pages/code/collect/docs.ts --out <file>`. Code documentation (every `.md`
// file and code comment) is part of Code (the owner, 2026-11-09), so these metrics moved here from the Documentation page.
// Their checks are that page's modules, imported, never copied; its questions.json and not-in-tree.json stay its inputs.
// It also scores every tracked file on Q, S and C into $DETAIL_DIR/page/tree.json, the page's tree. A file's findings
// are its doc findings plus the code findings of the nightly lane's last run (its facts, read beside this lane's); with
// none yet, no tree is written and the page shows it missing. Git alone, no packages, so it needs no install.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { type Corpus, loadCorpus } from '../../repo-documentation/collect/corpus.ts';
import { runDrill } from '../../repo-documentation/collect/drill.ts';
import { type Findings, findings } from '../../repo-documentation/collect/findings.ts';
import { INPUTS } from '../../repo-documentation/collect/inputs.ts';
import { docLag, type Episode, LagUnavailable } from '../../repo-documentation/collect/lag.ts';
import { loadQuestions } from '../../repo-documentation/collect/questions.ts';
import { percentile, reachAll } from '../../repo-documentation/collect/reach.ts';
import { longShare, type Sentence, sentences, SENTENCE_LIMIT } from '../../repo-documentation/collect/readability.ts';
import { type SymbolRow, symbolRows } from '../../repo-documentation/collect/symbols.ts';
import { buildRecords, checkRecords, laneIds, readManifest, type Measurement } from './records.ts';
import { type FileRow, outsideCode, scoreFile } from './tree.ts';

const DOCS_CONFIG = resolve(import.meta.dirname, '../../repo-documentation');
/** The replay of main gets this long, inside the Linux lane's 10 minutes; past it doc lag reads missing. */
const LAG_BUDGET_MS = 6 * 60_000;
const round = (n: number) => Math.round(n * 100) / 100;

interface NightlyFacts {
  shapes?: { longFunctions?: { file: string }[]; longFiles?: { file: string }[]; escapes?: { file: string; count: number }[] };
  deadCode?: { file: string }[];
}

/** Findings per file: the doc findings, plus the code findings the nightly lane kept. */
export function findingCounts(f: Pick<Findings, 'links' | 'names'>, sents: Sentence[], syms: SymbolRow[], nightly: NightlyFacts): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (file: string, n = 1) => counts.set(file, (counts.get(file) ?? 0) + n);
  for (const x of [...f.links, ...f.names]) add(x.path);
  for (const s of sents) if (s.words > SENTENCE_LIMIT) add(s.path);
  for (const s of syms) if (!s.documented) add(s.path);
  for (const x of [...(nightly.shapes?.longFunctions ?? []), ...(nightly.shapes?.longFiles ?? []), ...(nightly.deadCode ?? [])]) add(x.file);
  for (const e of nightly.shapes?.escapes ?? []) add(e.file, e.count);
  return counts;
}

/** Every tracked text file outside this site, scored. A file holding a NUL byte is binary and left out. */
export function treeRows(root: string, files: string[], counts: Map<string, number>): FileRow[] {
  return files.flatMap((path) => {
    if (outsideCode(path) || !existsSync(join(root, path))) return [];
    const text = readFileSync(join(root, path), 'utf8');
    return text.includes('\0') ? [] : [scoreFile(path, text, counts.get(path) ?? 0)];
  });
}

/** The lag cache in $DETAIL_DIR/facts, seeded from this lane's last copy, else the Documentation page's, so a first run is warm. */
function lagCache(env: NodeJS.ProcessEnv): string | undefined {
  if (!env.DETAIL_DIR) return undefined;
  const dest = join(env.DETAIL_DIR, 'facts', 'lag-cache.json');
  mkdirSync(dirname(dest), { recursive: true });
  const seeds = env.PREV_DIR ? [join(env.PREV_DIR, 'facts/lag-cache.json'), join(env.PREV_DIR, '../../repo-documentation/daily/facts/lag-cache.json'), join(env.PREV_DIR, '../../documentation/daily/facts/lag-cache.json')] : [];
  const seed = seeds.find((p) => existsSync(p));
  if (seed) copyFileSync(seed, dest);
  return dest;
}

/** The seven docs readings, before the contract's checks. Doc lag is null when the replay could not finish. */
export function measure(root: string, c: Corpus, f: Findings, sents: Sentence[], syms: SymbolRow[], now: string, cache?: string): { measured: Map<string, Measurement>; lag: Episode[] | null } {
  const questions = loadQuestions(join(DOCS_CONFIG, 'questions.json'));
  const minutes = reachAll(c, questions).map((r) => Math.min(r.minutes ?? INPUTS.unreached_minutes, INPUTS.unreached_minutes));
  const internal = [...c.docs.values()].reduce((n, d) => n + d.links.filter((l) => !/^[a-z][a-z0-9+.-]*:/i.test(l.target)).length, 0);
  const scanned = c.docs.size + new Set(c.comments.map((cm) => cm.path)).size;
  let lag: Episode[] | null = null;
  try {
    lag = docLag(root, 'HEAD', DOCS_CONFIG, now, cache, Date.now() + LAG_BUDGET_MS);
  } catch (e) {
    if (!(e instanceof LagUnavailable)) throw e;
    console.error(`doc lag: ${e.message}, so it reads missing`);
  }
  const m = (value: number, sampleSize: number): Measurement => ({ value, time: now, sampleSize });
  const measured = new Map<string, Measurement>([
    ['broken_internal_links', m(f.links.length, internal)],
    ['dead_names', m(f.names.length, scanned)],
    ['public_symbols_documented', m(round((100 * syms.filter((s) => s.documented).length) / syms.length), syms.length)],
    ['long_sentence_share', m(round(100 * longShare(sents)), sents.length)],
    ['reading_minutes_p90', m(round(percentile(minutes, 90) ?? INPUTS.unreached_minutes), questions.length)],
    ['lag_drill', m(runDrill() ? 1 : 0, 1)],
  ]);
  if (lag?.length) measured.set('doc_lag_hours_p90', m(round(percentile(lag.map((e) => e.hours), 90) ?? 0), lag.length));
  return { measured, lag };
}

async function main() {
  const i = process.argv.indexOf('--out');
  const outFile = i >= 0 ? process.argv[i + 1] : undefined;
  if (!outFile) throw new Error('usage: docs.ts --out <file>');
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const run = process.env.GITHUB_RUN_ID ? `https://github.com/Colorado-Startups/legallas/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  const manifest = readManifest(readFileSync(join(root, 'quality-speed/pages/code/manifest.json'), 'utf8'));
  const now = new Date();
  const at = `${now.toISOString().slice(0, 19)}Z`;
  const c = loadCorpus(root);
  const f = findings(c, DOCS_CONFIG);
  const sents = sentences(c);
  const syms = symbolRows(c);
  const { measured, lag } = measure(root, c, f, sents, syms, at, lagCache(process.env));
  const records = buildRecords(manifest, laneIds(manifest, 'docs'), measured, run, now).map((r) =>
    // No episode in the window: no_events, which reads 100 only while lag_drill is at goal.
    r.id === 'doc_lag_hours_p90' && lag?.length === 0 && run ? { ...r, status: 'no_events' as const, measured_at: at, source_url: run, sample_size: 0 } : r,
  );
  checkRecords(records, manifest, now);
  writeFileSync(outFile, `${JSON.stringify(records, null, 2)}\n`);
  for (const r of records) console.log(`${r.status.padEnd(9)} ${r.id} ${r.value ?? ''}`);
  const nightly = process.env.PREV_DIR ? join(process.env.PREV_DIR, '../nightly/facts/details.json') : '';
  if (!process.env.DETAIL_DIR || !existsSync(nightly)) return console.log('tree: no nightly facts yet, so no tree');
  const facts = JSON.parse(readFileSync(nightly, 'utf8')) as NightlyFacts;
  const rows = treeRows(root, c.files, findingCounts(f, sents, syms, facts));
  mkdirSync(join(process.env.DETAIL_DIR, 'page'), { recursive: true });
  writeFileSync(join(process.env.DETAIL_DIR, 'page/tree.json'), JSON.stringify({ files: rows }));
  console.log(`tree: ${rows.length} files`);
}

if (import.meta.main) await main();
