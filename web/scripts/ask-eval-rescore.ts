// SPDX-License-Identifier: Apache-2.0
// Rescores saved Ask answers with the eval v2 checks (scripts/ask-eval-checks.ts) and writes the v2 report
// (scripts/ask-eval-report.ts), without asking anything again: a production run of `npm run eval:ask` (scored live
// without page text) or a replica runs file after the checks change.
//
//   npm run eval:ask-score -- --set <v2 set> --answers <ask-eval-report-*.json | runs-*.json>
//                             [--retrieval <the replica's retrieval.json>] [--out <dir>] [--compare <report-*.json>]
//
// Context, read-only: controlPrefix from legallas.config.json, `SELECT id, sha256 FROM documents` (wrangler, remote)
// for the extractor's page text in <cacheDir>/text, and every live document id for garbled ids when the answers
// came from production. With --retrieval, a replica run's own passages and citable ids are used instead. The
// report goes beside the answers (or to --out), mode 600; only aggregate tables print.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ScoreContext } from './ask-eval-checks.ts';
import type { ScoredRun } from './ask-eval-report.ts';
import { checksFor, closerFor, parseEvalSet, verdict, type EvalItem, type EvalResult } from './ask-eval-score.ts';
import { roomVar } from './ask-replica-groq.ts';
import type { CachedRetrieval } from './ask-replica-retrieval.ts';
import { USD_PER_NEURON } from './ask-replica-runs.ts';
import { controlPrefix, shaById, textCachePages, writeReport } from './ask-replica-v2.ts';
import { loadSyncConfig } from './config.ts';
import { cliWrangler } from './wrangler.ts';

export interface RescoreArgs {
  set: string;
  answers: string;
  retrieval: string | null;
  out: string | null;
  compare: string | null;
}

const USAGE = 'usage: eval:ask-score --set <v2 set> --answers <ask-eval-report-*.json | runs-*.json> [--retrieval <retrieval.json>] [--out <dir>] [--compare <report-*.json>]';

export function parseRescoreArgs(argv: readonly string[]): RescoreArgs {
  const args: Partial<RescoreArgs> = { retrieval: null, out: null, compare: null };
  for (let i = 0; i < argv.length; i++) {
    const [arg, value] = [argv[i], argv[i + 1]];
    if (!value) throw new Error(USAGE);
    if (arg === '--set') args.set = path.resolve(value);
    else if (arg === '--answers') args.answers = path.resolve(value);
    else if (arg === '--retrieval') args.retrieval = path.resolve(value);
    else if (arg === '--out') args.out = path.resolve(value);
    else if (arg === '--compare') args.compare = path.resolve(value);
    else throw new Error(USAGE);
    i++;
  }
  if (!args.set || !args.answers) throw new Error(USAGE);
  return args as RescoreArgs;
}

/** One saved answer, whichever tool wrote it. */
export interface SavedAnswer {
  id: string;
  rep: number;
  result: EvalResult;
  doneMs: number | null;
  neurons: number;
}

/**
 * The answers in an eval:ask report ({base, report: [{id, result, ms}]}) or a replica runs file ({model, runs:
 * [{id, rep, result, doneMs, neurons}]}), with a label. eval:ask answers count reps by repeated ids.
 */
export function savedAnswers(raw: unknown): { label: string; answers: SavedAnswer[]; replica: boolean } {
  const file = (raw ?? {}) as { base?: unknown; model?: unknown; report?: unknown; runs?: unknown };
  if (Array.isArray(file.runs)) {
    const runs = file.runs as { id: string; rep: number; result: EvalResult; doneMs?: number; neurons?: number }[];
    const answers = runs.map((r) => ({ id: r.id, rep: r.rep, result: r.result, doneMs: r.doneMs ?? null, neurons: r.neurons ?? 0 }));
    return { label: `replica ${String(file.model ?? '')}`.trim(), answers, replica: true };
  }
  if (Array.isArray(file.report)) {
    const seen = new Map<string, number>();
    const answers = (file.report as { id: string; result: EvalResult; ms?: number }[]).map((r) => {
      const rep = (seen.get(r.id) ?? 0) + 1;
      seen.set(r.id, rep);
      return { id: r.id, rep, result: r.result, doneMs: r.ms ?? null, neurons: 0 };
    });
    return { label: `eval:ask ${String(file.base ?? '')}`.trim(), answers, replica: false };
  }
  throw new Error('--answers must be an eval:ask report or a replica runs file');
}

/** Scores saved answers. `contextFor` gives each item's context; answers for items not in the set are skipped. */
export function rescore(items: readonly EvalItem[], answers: readonly SavedAnswer[], contextFor: (item: EvalItem) => ScoreContext): ScoredRun[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const out: ScoredRun[] = [];
  for (const a of answers) {
    const item = byId.get(a.id);
    if (!item) continue;
    const checks = checksFor(item, a.result, contextFor(item));
    out.push({
      id: item.id,
      category: item.category ?? null,
      kind: item.kind,
      rep: a.rep,
      blocked: Boolean(item.blockedUntil),
      verdict: verdict(checks),
      checks,
      error: a.result.error,
      neurons: a.neurons,
      doneMs: a.doneMs,
    });
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseRescoreArgs(process.argv.slice(2));
  const items = parseEvalSet(JSON.parse(await readFile(args.set, 'utf8')));
  const { label, answers, replica } = savedAnswers(JSON.parse(await readFile(args.answers, 'utf8')));
  const rows = await cliWrangler('remote').d1Query('SELECT id, sha256 FROM documents WHERE removed_at IS NULL');
  const config = await loadSyncConfig().catch(() => null);
  const prefix = await controlPrefix();
  const base: ScoreContext = {
    // Saved answers are scored against the closer the room's prompt asks for now.
    closer: closerFor(roomVar('RECOMMEND')),
    ...(prefix ? { controlPrefix: prefix } : {}),
    ...(config ? { pageText: textCachePages(path.join(config.cacheDir, 'text'), shaById(rows)) } : {}),
  };
  const retrieval: Record<string, CachedRetrieval> = args.retrieval ? JSON.parse(await readFile(args.retrieval, 'utf8')) : {};
  const liveIds = rows.map((r) => r.id).filter((id): id is string => typeof id === 'string');
  const contextFor = (item: EvalItem): ScoreContext => {
    const cached = retrieval[item.id];
    if (cached) {
      const citableIds = [...(cached.brief?.citable ?? []), ...cached.citable].map(([id]) => id);
      return { ...base, chunks: cached.chunks, citableIds };
    }
    // Production answers: any live document id is one the answer could have meant.
    return replica ? base : { ...base, citableIds: liveIds };
  };
  const runs = rescore(items, answers, contextFor);
  const neurons = runs.reduce((sum, r) => sum + (r.neurons ?? 0), 0);
  const dir = args.out ?? path.dirname(args.answers);
  const slug = `rescore-${path.basename(args.answers, '.json').replace(/[^a-z0-9-]+/gi, '-')}`;
  const report = await writeReport(dir, slug, label, runs, replica ? { neurons, usd: neurons * USD_PER_NEURON } : null, args.compare);
  console.log(`${report.lines.join('\n')}\nReport (item ids, keep private): ${report.md}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
