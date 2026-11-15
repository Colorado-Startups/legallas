// SPDX-License-Identifier: Apache-2.0
// The Ask Legallas eval: asks every question in an eval set through the real /api/ask, scores the streamed
// answers (scripts/ask-eval-score.ts) and writes a private report. Read-only for the room: each question
// counts against the asker's daily cap and adds one ai_question audit row, nothing else.
//
//   npm run eval:ask -- --example                       # dummy set against local dev (ASK_MOCK=1)
//   npm run eval:ask                                    # <cacheDir>/ask-eval.json against local dev
//   npm run eval:ask -- --production                    # the same set against room.example.com
//   npm run eval:ask -- --set <file> --base <url> --show [--out <dir>]
//   npm run eval:ask -- --set scripts/ask-eval.people.json --base <url>   # A4's guard on decisions about a person
//
// Production needs the owner's Access session: LEGALLAS_ACCESS_TOKEN from
// `cloudflared access login https://room.example.com` then `cloudflared access token -app=https://room.example.com`.
// The questions and answers are case content: they print only with --show, and the full report goes to
// <cacheDir> or --out (outside every repo, mode 600). Never commit a real eval set. A v2 set (scripts/ask-eval-checks.ts)
// is scored live without page text; `npm run eval:ask-score` rescores the report with it (scripts/ask-eval-rescore.ts).
// A question the burst limit refused (429 rate_limited, before the daily cap counts it) is asked again after the wait.
// Against anything but local dev, each question first checks the spend budget (scripts/spend-guard.ts lease.check): the
// room counts its own model calls and searches, so nothing is reserved, but the run stops while the scripts' headroom
// is still there for members. A room answer of ai_budget or search_budget stops the run too.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sseParser } from '../src/scripts/chat-sse.ts';
import { checksFor, closerFor, parseEvalSet, verdict, type EvalItem, type EvalResult, type Verdict } from './ask-eval-score.ts';
import { roomVar } from './ask-replica-groq.ts';
import { askQuestionWorst } from '../worker/budget.ts';
import { loadSyncConfig } from './config.ts';
import { configuredModel } from './law/eval.ts';
import { wranglerTokens } from './law/replica.ts';
import { accountId } from './mcp-replica.ts';
import { cloudflareLease, SpendStop } from './spend-guard.ts';
import { roomHost } from '../worker/room-settings.ts';

export const LOCAL_BASE = 'http://localhost:8789';
export const PRODUCTION_BASE = `https://${roomHost}`;
const EXAMPLE_SET = path.join(import.meta.dirname, 'ask-eval.example.json');
const REQUEST_TIMEOUT_MS = 180_000;

export interface EvalArgs {
  base: string;
  set: string | null;
  example: boolean;
  show: boolean;
  /** Where the report goes instead of <cacheDir>; set only by --out. */
  out?: string;
}

export function parseEvalArgs(argv: readonly string[]): EvalArgs {
  const args: EvalArgs = { base: LOCAL_BASE, set: null, example: false, show: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--production') args.base = PRODUCTION_BASE;
    else if (arg === '--example') args.example = true;
    else if (arg === '--show') args.show = true;
    else if (arg === '--base' && argv[i + 1]) args.base = argv[++i]!.replace(/\/+$/, '');
    else if (arg === '--set' && argv[i + 1]) args.set = argv[++i]!;
    else if (arg === '--out' && argv[i + 1]) args.out = path.resolve(argv[++i]!);
    else throw new Error('usage: eval:ask [--example | --set <file>] [--production | --base <url>] [--show] [--out <dir>]');
  }
  const { protocol, hostname } = new URL(args.base);
  const local = hostname === 'localhost' || hostname === '127.0.0.1';
  if (!local && protocol !== 'https:') throw new Error('a non-local --base must be https');
  if (args.example && !local) throw new Error('--example is dummy data for local dev only');
  return args;
}

/** The headers the room's own page sends. Access identity comes from a token, never a stored password. */
export function requestHeaders(base: string, accessToken: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Origin: new URL(base).origin,
    'Sec-Fetch-Site': 'same-origin',
  };
  if (accessToken) headers['cf-access-token'] = accessToken;
  return headers;
}

/** Turns a finished /api/ask response into an EvalResult. Error statuses carry their JSON error code. */
export async function readAnswer(response: Response): Promise<EvalResult> {
  const result: EvalResult = { status: response.status, answer: '', citations: [], dontKnow: null, error: null };
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown };
    result.error = typeof body.error === 'string' ? body.error : `http_${response.status}`;
    return result;
  }
  const parser = sseParser();
  const events = [...parser.push(await response.text()), ...parser.end()];
  for (const { event, data } of events) {
    const record = (data ?? {}) as Record<string, unknown>;
    if (event === 'delta' && typeof record.text === 'string') result.answer += record.text;
    else if (event === 'citations' && Array.isArray(record.citations)) {
      result.citations = record.citations as EvalResult['citations'];
      // Present only when law reached the answer (worker/ask-stream.ts), so a record answer reads as before.
      if (Array.isArray(record.law)) result.law = record.law as { id: string }[];
    } else if (event === 'done') {
      result.dontKnow = record.dontKnow === true;
      if (record.truncated === true) result.truncated = true;
    } else if (event === 'error') result.error = String(record.error ?? 'stream_error');
  }
  return result;
}

/** Waits before asking a question the burst limit refused (worker/burst.ts: 6 a minute, Retry-After 60). */
const RATE_LIMIT_WAIT_MS = 61_000;
const RATE_LIMIT_TRIES = 3;

/**
 * Asks once, and again after RATE_LIMIT_WAIT_MS while the answer is the burst limit's 429. That refusal comes
 * before the daily cap counts the question, so a retry spends nothing; any other outcome returns at once.
 */
export async function askPaced(once: () => Promise<EvalResult>, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<EvalResult> {
  let result = await once();
  for (let tries = 1; tries < RATE_LIMIT_TRIES && result.status === 429 && result.error === 'rate_limited'; tries++) {
    await wait(RATE_LIMIT_WAIT_MS);
    result = await once();
  }
  return result;
}

async function ask(base: string, headers: Record<string, string>, item: EvalItem): Promise<EvalResult> {
  try {
    const response = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ question: item.question }),
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      return { status: response.status, answer: '', citations: [], dontKnow: null, error: 'redirected_to_sign_in' };
    }
    return await readAnswer(response);
  } catch (error) {
    return { status: 0, answer: '', citations: [], dontKnow: null, error: error instanceof Error ? error.name : 'fetch_failed' };
  }
}

async function resolveSet(args: EvalArgs): Promise<{ file: string; cacheDir: string | null }> {
  if (args.example) return { file: EXAMPLE_SET, cacheDir: null };
  const config = await loadSyncConfig().catch(() => null);
  if (args.set) return { file: path.resolve(args.set), cacheDir: config?.cacheDir ?? null };
  if (!config) throw new Error('no legallas.config.json: pass --set <file> or --example');
  return { file: path.join(config.cacheDir, 'ask-eval.json'), cacheDir: config.cacheDir };
}

async function main(): Promise<void> {
  const args = parseEvalArgs(process.argv.slice(2));
  const { file, cacheDir } = await resolveSet(args);
  const items = parseEvalSet(JSON.parse(await readFile(file, 'utf8')));
  const token = process.env.LEGALLAS_ACCESS_TOKEN;
  if (args.base === PRODUCTION_BASE && !token) throw new Error('set LEGALLAS_ACCESS_TOKEN (see the header of scripts/ask-eval.ts)');
  const headers = requestHeaders(args.base, token);
  const { hostname } = new URL(args.base);
  const lease = hostname === 'localhost' || hostname === '127.0.0.1' ? null : cloudflareLease(await accountId(), wranglerTokens(), 'eval:ask');
  const worst = askQuestionWorst(configuredModel());

  console.log(`Asking ${items.length} questions at ${args.base} (each counts against today's question cap).`);
  const report: { id: string; kind: string; verdict: Verdict; failed: string[]; question: string; result: EvalResult; ms: number }[] = [];
  for (const item of items) {
    try {
      await lease?.check(worst);
    } catch (error) {
      if (!(error instanceof SpendStop)) throw error;
      console.log(error.message);
      break;
    }
    const started = Date.now();
    const result = await askPaced(() => ask(args.base, headers, item));
    const ms = Date.now() - started;
    const checks = checksFor(item, result, { closer: closerFor(roomVar('RECOMMEND')) });
    const outcome = verdict(checks);
    const failed = checks.filter((check) => !check.ok).map((check) => check.name + (check.soft ? ' (review)' : ''));
    report.push({ id: item.id, kind: item.kind, verdict: outcome, failed, question: item.question, result, ms });
    console.log(`${outcome.toUpperCase().padEnd(6)} ${item.id.padEnd(24)} ${failed.join(', ')}${result.error ? ` [${result.error}]` : ''}`);
    if (args.show) console.log(`  Q: ${item.question}\n  A: ${result.answer.replace(/\n/g, '\n     ')}\n`);
    if (result.error === 'daily_limit' || result.error === 'redirected_to_sign_in' || result.error === 'ai_budget' || result.error === 'search_budget') break;
  }

  const count = (v: Verdict) => report.filter((r) => r.verdict === v).length;
  console.log(`\n${count('pass')} pass, ${count('review')} review, ${count('fail')} fail of ${items.length}.`);
  const reportDir = args.out ?? cacheDir;
  if (reportDir) {
    await mkdir(reportDir, { recursive: true, mode: 0o700 });
    const out = path.join(reportDir, `ask-eval-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(out, JSON.stringify({ base: args.base, at: new Date().toISOString(), report }, null, 1), { mode: 0o600 });
    console.log(`Full report (case content, keep private): ${out}`);
  }
  if (args.base === PRODUCTION_BASE) {
    console.log('Manual check: AI Gateway "legallas" > Logs must still be empty after this run.');
  }
  process.exitCode = count('fail') > 0 ? 1 : 0;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
