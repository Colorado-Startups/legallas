// SPDX-License-Identifier: Apache-2.0
// The release gate on an eval v2 report (web/README.md "Production releases"): a release that changes Ask, retrieval
// or the prompt may lose no hard gate (unknown-item IDK, injected outputs, garbled ids, prompt leaks). Each hard
// gate's goal is perfect (100%, 0, 0, 0), so "loses none" is checked as "meets every one": a met target cannot be
// lost. When one is not met, a run on the production commit says whether production misses it too.
//
//   node scripts/ask-eval-gate.ts <report-*.json | directory holding them> [--people] [--log <the replica's output>]
//
// --people gates the people set (scripts/ask-eval.people.json, no category) instead: no score or recommendation on a
// person (A4, no_person_verdict), plus each hard gate the set measures (prompt leaks). The hard gates it has no items
// for (unknown items, injection items, garbled ids) are not its to decide, so they never make it incomplete. A people
// run never passes the release gate: that needs the v2 set.
//
// Prints Markdown with aggregates only (no item ids, which name the matter's subjects) and exits 0 when the gate
// passes, 1 when a hard gate is not met, and 2 when the run cannot decide it (stopped early, answers that errored, a
// gate with nothing to measure, or no report at all). With --log it adds the replica's output lines that match
// SAFE_LINES and withholds every other line. The Replica eval workflow (.github/workflows/replica-eval.yml) sends the
// replica's output only to a private file and writes this script's output to its log and run summary: GitHub keeps
// those for 90 days, so case content must never reach them (SECURITY.md, zero data retention).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { formatAggregates, type EvalReport, type TargetRow } from './ask-eval-report.ts';

export type GateVerdict = 'pass' | 'fail' | 'incomplete';

export interface Gate {
  verdict: GateVerdict;
  /** One sentence with numbers and target names only. */
  reason: string;
  rows: TargetRow[];
}

/** The release gate (every hard gate), or the people gate (--people): the person row and the hard gates it measures. */
export type GateMode = 'release' | 'people';

const names = (rows: readonly TargetRow[]) => rows.map((r) => r.target).join('; ');

/** The rows a mode judges: in people mode, a hard gate with no answers to judge is left out, not unmeasured. */
function gateRows(targets: readonly TargetRow[], mode: GateMode): TargetRow[] {
  return mode === 'people' ? targets.filter((t) => t.people || (t.hard && t.of > 0 && t.met !== null)) : targets.filter((t) => t.hard);
}

/** The gate's verdict on one report: incomplete before fail, so an answer that errored never reads as a lost gate. */
export function hardGate(report: Pick<EvalReport, 'totals' | 'targets' | 'planned'>, mode: GateMode = 'release'): Gate {
  const rows = gateRows(report.targets, mode);
  const { runs, errors } = report.totals;
  const verdict = (v: GateVerdict, reason: string): Gate => ({ verdict: v, reason, rows });
  if (mode === 'people' && !rows.some((r) => r.people)) return verdict('incomplete', 'nothing to measure for: person verdicts (people items)');
  if (rows.length === 0) return verdict('incomplete', 'the report marks no hard gates (written before scripts/ask-eval-gate.ts)');
  if (report.planned === undefined) return verdict('incomplete', 'the report does not say how many answers the run planned');
  if (runs < report.planned) return verdict('incomplete', `${runs} of ${report.planned} planned answers were scored: the spend budget or an error stopped the run`);
  if (errors > 0) return verdict('incomplete', `${errors} of ${runs} answers ended in an error, so they say nothing about the gates`);
  // A gate with no answers to judge (no unknown or injection items in the run) is not met by default.
  const unmeasured = rows.filter((r) => r.met === null || r.of === 0);
  if (unmeasured.length) return verdict('incomplete', `nothing to measure for: ${names(unmeasured)}`);
  const lost = rows.filter((r) => r.met === false);
  if (lost.length) return verdict('fail', `not met: ${names(lost)}`);
  return verdict('pass', mode === 'people' ? `no person verdict, and every hard gate the set measures met, over ${runs} answers` : `every hard gate met over ${runs} answers`);
}

const TITLE: Record<GateMode, string> = { release: 'Release gate', people: 'People gate' };

const EXIT: Record<GateVerdict, number> = { pass: 0, fail: 1, incomplete: 2 };

/** The gate as Markdown for a run summary: the verdict, the reason and one row per gate it judged. */
export function formatGate(gate: Gate, label: string, mode: GateMode = 'release'): string[] {
  const result = (r: TargetRow) => (r.goal === '0' ? String(r.ok) : r.rate === null ? '-' : `${(r.rate * 100).toFixed(1)}%`);
  return [
    `### ${TITLE[mode]}: ${gate.verdict.toUpperCase()}`,
    '',
    `${label}: ${gate.reason}.`,
    '',
    `| ${mode === 'people' ? 'Gate' : 'Hard gate'} | Goal | Result | n | Met |`,
    '|---|---|---|---|---|',
    ...gate.rows.map((r) => `| ${r.target} | ${r.goal} | ${result(r)} | ${r.of} | ${r.met === null ? '-' : r.met ? 'yes' : 'no'} |`),
  ];
}

/**
 * The replica's output lines that may reach a CI log, each made only of fixed words and numbers, so no case content
 * (a question, a passage, an answer, a document name, an item id) can match: the run header, rep progress, the spend
 * budget's stop and its summary, and the content-free error messages scripts/ask-replica.ts and its helpers throw.
 * Anything else, a stack trace or a JSON parse error quoting its input included, is withheld.
 */
export const SAFE_LINES: readonly RegExp[] = [
  /^(?:(?:@cf\/[a-z0-9._-]+|groq:[a-z0-9._-]+)\/[a-z0-9._-]+|host:(?![^ ]*\/\/)[a-z0-9][a-z0-9._:\/@+-]{0,199}) effort=(?:low|medium|high|max|omit|worker)(?: max_tokens=\d+)?(?: \+law)?(?: \+plant)?(?: shard=[1-9]\/[1-9])?(?: recommend=[01])?: \d+ items x \d+ reps, budget \$\d+\.\d{2}$/i,
  /^rep \d+: \d+ answers; \$\d+\.\d{3} so far$/,
  /^rep \d+ stopped after \d+ of \d+ answers\.$/,
  /^Stopped by the spend budget: eval:ask-replica needs [\d,]+ more (?:neurons|AI Search queries|AI Search full-text queries|AI Search ingestion tokens), and scripts have [\d,]+ left for \d{4}-\d{2}(?:-\d{2})? \(limit [\d,]+; [\d,]+ more stay for the counsel room\)\. It resets (?:at midnight UTC|on the 1st of next month \(UTC\))\. Limits change only in review \(web\/README\.md, "Spend budget"\)\.$/,
  /^Stopped by the spend budget: (?:the Cloudflare analytics did not answer \((?:analytics_(?:http_\d{3}|error|no_account|unreadable)|fetch failed|The operation was aborted due to timeout)\)|D1's spend_counters could not be read \((?:wrangler d1 execute (?:failed|returned no JSON|did not succeed)); is migration 0007 applied\?\)), so the run cannot be checked against it\. Nothing more was sent\.$/,
  /^Stopped by the spend budget: eval:ask-replica needs [\d,]+ more neurons, and the month's paid budget for scripts is used up \(\$\d+\.\d{2} of \$\d+\.\d{2} for \d{4}-\d{2}; the counsel room keeps the rest\)\. Free neurons reset at midnight UTC, the paid month on the 1st \(UTC\)\. Limits change only in review \(web\/README\.md, "Spend budget"\)\.$/,
  /^spend: could not record the account's days in D1; the Workers keep to the free neurons until a later run does\.$/,
  /^Spend this run: [\d,]+ neurons, \d+ AI Search queries, [\d,]+ ingestion tokens\.$/,
  /^spend: could not settle (?:neurons|search_semantic|search_fulltext|search_ingest_tokens) for \d{4}-\d{2}(?:-\d{2})? in D1; the counter stays high until it resets (?:at midnight UTC|on the 1st of next month \(UTC\))\.$/,
  /^(?:model|search|embedding|analytics|groq|host)_http_\d{3}$/,
  // The Groq lane (scripts/ask-replica-groq.ts): its stops, its refusals before a run, and its call failures.
  /^Stopped by Groq's rate limit \(HTTP 429\): the free plan's minute or day is spent\. Nothing more was sent\.$/,
  /^Stopped before Groq's daily limit: this run would pass [\d,]+ tokens or [\d,]+ requests\. Nothing more was sent\.$/,
  /^--provider groq needs ASK_GROQ\.zdr_confirmed true in wrangler\.jsonc: the owner confirms Zero Data Retention in console\.groq\.com first$/,
  /^--provider groq needs REPLICA_EVAL_GROQ_API_KEY set$/,
  /^--provider groq (?:runs [a-z0-9._-]+\/[a-z0-9._-]+ only|takes --effort low, medium, high or omit)$/,
  /^groq_(?:fetch_failed|no_key|failed)$/,
  // The room's own host (scripts/ask-replica-host.ts): its stop, its refusals before a run, and its call failures. Never
  // the host's URL; its model name is the room's setting, in the run header above.
  /^Stopped by the host's rate limit \(HTTP 429\)\. Nothing more was sent\.$/,
  /^--provider host needs ASK_HOST\.zdr_confirmed true in wrangler\.jsonc: the owner confirms the host keeps no inputs or outputs first$/,
  /^--provider host needs ASK_HOST\.url \(https\) and ASK_HOST\.model in wrangler\.jsonc, and a body with no reserved field$/,
  /^--provider host needs REPLICA_EVAL_HOST_API_KEY set$/,
  /^--provider host takes no --model or --effort: ASK_HOST in wrangler\.jsonc names the model$/,
  /^host_(?:fetch_failed|no_key|failed)$/,
  /^--shard [1-9]\/[1-9] matched no items in the set$/,
  /^search_failed_(?:\d+|unknown)$/,
  /^wrangler [a-z0-9]+ [a-z0-9-]+ failed$/,
  /^wrangler (?:returned no JSON|output is not valid JSON|d1 execute returned no JSON|d1 execute did not succeed)$/,
  /^(?:fetch failed|The operation was aborted due to timeout|account id must be 32 hex characters|Refusing an unexpected R2 key|eval set must be a non-empty JSON array)$/,
  /^set CLOUDFLARE_ACCOUNT_ID \(wrangler lists more or fewer than one account\)$/,
  /^--category [a-z,-]+ matched no items in the set$/,
  /^--model must be a Workers AI @cf\/ model$/,
];

/** The lines of `log` that SAFE_LINES allows, then one line counting the rest. */
export function safeLines(log: string): string[] {
  const lines = log.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const kept = lines.filter((line) => SAFE_LINES.some((pattern) => pattern.test(line)));
  const withheld = lines.length - kept.length;
  return withheld ? [...kept, `${withheld} other output lines withheld: they may hold case content, and they stay on the runner.`] : kept;
}

/** The newest report-*.json in `target` when it is a directory, else `target` itself; null when there is none. */
export async function reportFile(target: string): Promise<string | null> {
  if (target.endsWith('.json')) return target;
  const files = (await readdir(target).catch(() => [] as string[])).filter((n) => /^report-.*\.json$/.test(n)).sort();
  // Names end in the report's ISO time, so the last one sorts newest within one slug; a gate run writes one slug.
  return files.length ? path.join(target, files.at(-1)!) : null; // safe: length checked
}

/** The report, or null when it is missing or unreadable. Never rethrows: a parse error can quote its input. */
async function readGateReport(file: string): Promise<EvalReport | null> {
  try {
    const report = JSON.parse(await readFile(file, 'utf8')) as EvalReport;
    return report.version === 2 && Array.isArray(report.targets) ? report : null;
  } catch {
    return null;
  }
}

/** The report target, --log's file and the mode, flags in any order; null on anything else. */
export function parseGateArgs(argv: readonly string[]): { target: string; logFile?: string; mode: GateMode } | null {
  let target: string | undefined;
  let logFile: string | undefined;
  let mode: GateMode = 'release';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!; // safe: i < length
    const value = argv[i + 1];
    if (arg === '--people') mode = 'people';
    else if (arg === '--log' && value !== undefined && !value.startsWith('--')) (logFile = value), i++;
    else if (target === undefined && !arg.startsWith('--')) target = arg;
    else return null;
  }
  return target === undefined ? null : { target, ...(logFile !== undefined ? { logFile } : {}), mode };
}

async function main(): Promise<void> {
  const args = parseGateArgs(process.argv.slice(2));
  if (!args) {
    console.log('usage: node scripts/ask-eval-gate.ts <report-*.json | directory> [--people] [--log <file>]');
    process.exitCode = EXIT.incomplete;
    return;
  }
  const { target, logFile, mode } = args;
  const file = await reportFile(target);
  const report = file ? await readGateReport(file) : null;
  const out: string[] = [];
  if (!report) {
    out.push(`### ${TITLE[mode]}: INCOMPLETE`, '', 'No readable report: the run stopped before it scored an answer (the spend budget or an error).');
    process.exitCode = EXIT.incomplete;
  } else {
    const gate = hardGate(report, mode);
    out.push(...formatGate(gate, report.label, mode), '', ...formatAggregates(report).map((line) => line.replace(/^## /, '#### ')));
    process.exitCode = EXIT[gate.verdict];
  }
  if (logFile) {
    const lines = safeLines(await readFile(logFile, 'utf8').catch(() => ''));
    if (lines.length) out.push('', '#### Replica output (allowed lines only)', '', ...lines.map((line) => `- ${line}`));
  }
  console.log(out.join('\n'));
}

if (import.meta.main) {
  main().catch(() => {
    // Only a fixed line: an error's message could quote the report or the log.
    console.log('### Release gate: INCOMPLETE\n\nThe gate script failed before it could read the run.');
    process.exitCode = EXIT.incomplete;
  });
}
