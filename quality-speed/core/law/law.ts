// SPDX-License-Identifier: Apache-2.0
// The law kit (README.md): what the product holds for one body, scored against that page's reviewed list. It reads
// repository files only: no network, no secret, no package. The metrics are defined in PLAN.md.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseLawEvalSet, type LawEvalItem } from '../../../web/scripts/law/eval-score.ts';
import { lawKey, type LawChunk } from '../../../web/worker/law-cite.ts';
import { DEFAULT_PASSAGES, lawResultOnce } from '../../../web/mcp/law-answer.ts';

export interface Flag {
  kind: 'deadline' | 'fee';
  /** The exact words, from the official source, that a document the need relies on must contain. */
  text: string;
}

export interface Need {
  id: string;
  path: string;
  need: string;
  source: string;
  checked: string | null;
  covered_by: string[];
  flags?: Flag[];
}

export interface NeedsList {
  needs: Need[];
  questions?: LawEvalItem[];
}

/** One document the product holds, reduced to what the metrics read. null: the metric doesn't apply to its kind. */
export interface Source {
  ref: string;
  checked: string | null;
  verified: boolean | null;
  fresh: boolean;
  rights: boolean | null;
  /** Lowercased, whitespace-folded text, searched for flags in templates and checklist items: a unit's is the plan's own note. */
  text: string;
}

export interface Holdings {
  sources: Map<string, Source>;
  /** Customer paths, from the plan's vocabulary. */
  paths: string[];
  /** Hosts the plan lists, which count as official beside any .gov host. */
  hosts: Set<string>;
  /** The day it was read, which a need's own `checked` date is measured from. */
  now: Date;
}

export interface Value {
  value: number | null;
  samples: number;
}

export const FRESH_DAYS = 365;
const DAY = 86_400_000;
const NEED_KEYS = new Set(['id', 'path', 'need', 'source', 'checked', 'covered_by', 'flags']);
const WORD = /^[a-z0-9]+$/;
const SLUG = /^[a-z0-9-]+$/;
/** Lowercase words joined by hyphens, checked a word at a time so no pattern repeats a repeat. */
const isId = (id: string) => id.split('-').every((word) => WORD.test(word));
/** `unit:<id>`, `item:<id>`, or `template:<folder>/<name>`. */
const isRef = (ref: string) => /^(?:unit|item):[a-z0-9.-]+$/.test(ref) || (ref.startsWith('template:') && ref.slice('template:'.length).split('/').every((part) => SLUG.test(part)));
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A flag's text is at least this many words, so a fragment such as "a" can't match any document. */
const FLAG_WORDS = 3;

/** Folds case, whitespace and Markdown emphasis, so a search matches the words, not the formatting. */
export const fold = (s: string) => s.replace(/[*_`>]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const SMALL = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = 'twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
const NUMBER_WORD = `(?:${[...SMALL, ...TENS, 'hundred', 'thousand'].join('|')})`;
const NUMBER_RUN = new RegExp(`\\b${NUMBER_WORD}(?:[ -]${NUMBER_WORD})*\\b`, 'g');

/** Numbers written in words as digits, so "three hundred days" in a statute matches "300 days" in a template. Folded text in. */
export function numerals(text: string): string {
  return text.replace(NUMBER_RUN, (run) => {
    let total = 0;
    let current = 0;
    for (const word of run.split(/[ -]/)) {
      if (word === 'hundred') current = (current || 1) * 100;
      else if (word === 'thousand') {
        total += (current || 1) * 1000;
        current = 0;
      } else current += SMALL.includes(word) ? SMALL.indexOf(word) : (TENS.indexOf(word) + 2) * 10;
    }
    return String(total + current);
  });
}

/** Each [[name]] table of a TOML file with its own sub-tables, as text. Enough for this repository's two lists. */
export function tables(toml: string, name: string): string[] {
  const out: string[][] = [];
  let open = false;
  for (const line of toml.split(/\r?\n/)) {
    const header = /^\[\[?([\w.-]+)\]\]?\s*$/.exec(line)?.[1];
    if (header === name) out.push([]);
    if (header !== undefined) open = header === name || (open && header.startsWith(`${name}.`));
    else if (open) out.at(-1)?.push(line);
  }
  return out.map((lines) => lines.join('\n'));
}

/** The first `key = "value"` line, or null. Top-level keys come before a table's sub-tables. Read a line at a time: the key is never made into a pattern. */
export function field(text: string, key: string): string | null {
  const start = `${key} = "`;
  const line = text.split(/[\n\r\u2028\u2029]/).find((l) => l.length > start.length && l.startsWith(start) && l.endsWith('"'));
  return line === undefined ? null : line.slice(start.length, -1);
}

/** True when `date` lies within FRESH_DAYS before `now`. */
export function freshDate(date: string | null, now: Date): boolean {
  if (!date || !DATE.test(date)) return false;
  const age = now.getTime() - Date.parse(`${date}T00:00:00Z`);
  return age >= 0 && age <= FRESH_DAYS * DAY;
}

/**
 * A unit is fresh when the plan was checked recently and its currency line is dated: it names a year no later than this
 * one, and none older than last year. A later year, such as an effective date to come, says nothing about the copy.
 */
export function freshUnit(asOf: string | null, checked: string | null, now: Date): boolean {
  const years = [...(asOf ?? '').matchAll(/\b(?:19|20)\d\d\b/g)].map((m) => Number(m[0])).filter((y) => y <= now.getUTCFullYear());
  return freshDate(checked, now) && years.length > 0 && Math.min(...years) >= now.getUTCFullYear() - 1;
}

/**
 * Opened on the official host: VERIFIED, or PARTIAL, read there only in part (the plan's `status` vocabulary). A PARTIAL
 * unit is honest coverage, so adding one never lowers `verified` (#871). SECONDARY and UNVERIFIED fail.
 */
export const unitVerified = (status: string | null) => status === 'VERIFIED' || status === 'PARTIAL';

/** Each install may fetch or link it by itself: no permission pending, and a machine may fetch what is stored whole. */
export const unitRights = (ship: string | null, take: string | null, fetch: string | null) =>
  ship !== null && take !== null && fetch !== null && ship !== 'after-permission' && !(take === 'whole' && (fetch === 'no' || fetch === 'browser-only'));

const read = (root: string, file: string) => readFileSync(path.join(root, file), 'utf8');

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? markdownFiles(path.join(dir, e.name)) : e.name.endsWith('.md') && e.name !== 'README.md' ? [path.join(dir, e.name)] : [],
  );
}

/**
 * Everything the product holds that a reviewed list can point at, keyed by reference. A unit counts only when a room built
 * with the defaults holds it: one with `flag = "next"` is built only in a room that opts in, so it isn't held.
 */
export function readHoldings(root: string, now: Date): Holdings {
  const plan = read(root, 'docs/design/law-pack-plan.toml');
  const preamble = (toml: string) => toml.slice(0, toml.search(/^\[/m));
  const planChecked = field(preamble(plan), 'checked');
  const fetchBy = new Map<string, string | null>();
  const hosts = new Set<string>();
  for (const host of tables(plan, 'host')) {
    fetchBy.set(field(host, 'id') ?? '', field(host, 'fetch'));
    for (const m of host.matchAll(/https:\/\/([a-z0-9.-]+)/g)) hosts.add(m[1]!);
  }
  const paths = [...(/^paths = \[(.*)\]$/m.exec(tables(plan, 'vocabulary')[0] ?? '')?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  const sources = new Map<string, Source>();
  for (const unit of tables(plan, 'unit')) {
    if (field(unit, 'flag') === 'next') continue;
    const ref = `unit:${field(unit, 'id')}`;
    sources.set(ref, {
      ref,
      checked: planChecked,
      verified: unitVerified(field(unit, 'status')),
      fresh: freshUnit(field(unit, 'as_of'), planChecked, now),
      rights: unitRights(field(unit, 'ship'), field(unit, 'take'), fetchBy.get(field(unit, 'host') ?? '') ?? null),
      text: fold(unit),
    });
  }
  const checklist = read(root, 'docs/checklist/baseline.toml');
  const drafted = field(preamble(checklist), 'drafted');
  for (const item of tables(checklist, 'item')) {
    const ref = `item:${field(item, 'id')}`;
    sources.set(ref, { ref, checked: drafted, verified: null, fresh: freshDate(drafted, now), rights: null, text: fold(item) });
  }
  const templates = path.join(root, 'templates');
  for (const file of markdownFiles(templates)) {
    const ref = `template:${path.relative(templates, file).replace(/\.md$/, '').split(path.sep).join('/')}`;
    const text = readFileSync(file, 'utf8');
    const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
    const checked = /^(?:date_checked|checked): (\d{4}-\d{2}-\d{2})\s*$/m.exec(front)?.[1] ?? null;
    sources.set(ref, { ref, checked, verified: null, fresh: freshDate(checked, now), rights: null, text: fold(text) });
  }
  return { sources, paths, hosts, now };
}

/** The reviewed list, checked. Throws with every problem found, so a page's own mistake fails its test. */
export function parseNeeds(raw: unknown, slug: string, holdings: Holdings): NeedsList {
  const errors: string[] = [];
  const list = raw as Partial<NeedsList>;
  if (typeof raw !== 'object' || raw === null || !Array.isArray(list.needs) || Object.keys(raw).some((k) => k !== 'needs' && k !== 'questions')) {
    throw new Error(`${slug}: needs.json holds only needs (a list) and questions`);
  }
  const ids = new Set<string>();
  for (const [i, entry] of list.needs.entries()) {
    const n = entry as Partial<Need>;
    const at = `${slug}: need ${typeof n.id === 'string' && isId(n.id) ? n.id : i}`;
    if (typeof entry !== 'object' || entry === null) {
      errors.push(`${at}: not an object`);
      continue;
    }
    for (const key of Object.keys(entry)) if (!NEED_KEYS.has(key)) errors.push(`${at}: unknown field`);
    if (typeof n.id !== 'string' || !isId(n.id) || ids.has(n.id)) errors.push(`${at}: id must be unique lowercase words joined by hyphens`);
    else ids.add(n.id);
    if (!holdings.paths.includes(n.path as string)) errors.push(`${at}: path is not in the plan's vocabulary`);
    if (typeof n.need !== 'string' || n.need.length === 0 || n.need.length > 60 || /\n/.test(n.need)) errors.push(`${at}: need is one line of at most 60 characters`);
    if (!officialSource(n.source, holdings.hosts)) errors.push(`${at}: source is not an https page on a .gov host or a plan host`);
    if (n.checked !== null && !(typeof n.checked === 'string' && DATE.test(n.checked))) errors.push(`${at}: checked is a date or null`);
    if (!Array.isArray(n.covered_by) || !n.covered_by.every((r) => typeof r === 'string' && isRef(r)) || new Set(n.covered_by).size !== n.covered_by.length) {
      errors.push(`${at}: covered_by is a list of distinct unit:, template: or item: references`);
    }
    const flagsOk = (f: unknown) => typeof f === 'object' && f !== null && Object.keys(f).every((k) => k === 'kind' || k === 'text') &&
      ((f as Flag).kind === 'deadline' || (f as Flag).kind === 'fee') && typeof (f as Flag).text === 'string' && fold((f as Flag).text).split(' ').filter(Boolean).length >= FLAG_WORDS;
    if (n.flags !== undefined && !(Array.isArray(n.flags) && n.flags.every(flagsOk))) errors.push(`${at}: each flag is a deadline or fee with its exact text, at least ${FLAG_WORDS} words`);
  }
  let questions: LawEvalItem[] | undefined;
  if (list.questions !== undefined) {
    try {
      questions = parseLawEvalSet(list.questions);
      const qids = questions.map((q) => q.id);
      if (qids.some((id) => !id.startsWith(`${slug}-`)) || new Set(qids).size !== qids.length) errors.push(`${slug}: question ids are distinct and start with ${slug}-`);
    } catch (error) {
      errors.push(`${slug}: questions: ${(error as Error).message}`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return { needs: list.needs as Need[], ...(questions ? { questions } : {}) };
}

function officialSource(url: unknown, hosts: Set<string>): boolean {
  try {
    const u = new URL(url as string);
    return u.protocol === 'https:' && !u.username && !u.port && (u.hostname.endsWith('.gov') || hosts.has(u.hostname));
  } catch {
    return false;
  }
}

const percent = (ok: number, of: number): Value => ({ value: of ? Math.floor((ok / of) * 10_000) / 100 : null, samples: of });
const share = (xs: readonly (boolean | null)[]): Value => {
  const applies = xs.filter((x) => x !== null);
  return percent(applies.filter(Boolean).length, applies.length);
};
/** True when every check that applies holds; null when none applies. */
const all = (xs: readonly (boolean | null)[]) => (xs.some((x) => x !== null) ? xs.every((x) => x !== false) : null);

/**
 * Each need against the holdings: what is held, the kit's metric values, and every gap as a fix. A need counts as held only
 * when its own source was checked within FRESH_DAYS, so the list can't vouch for a need nobody has opened. A flag is found
 * only in a template or checklist item, what a founder sees, never in the plan's note on a unit.
 */
export function assess(list: NeedsList, holdings: Holdings) {
  const rows = list.needs.map((n) => {
    const held = n.covered_by.flatMap((r) => holdings.sources.get(r) ?? []);
    const seen = held.filter((s) => !s.ref.startsWith('unit:'));
    const flags = (n.flags ?? []).map((f) => ({ ...f, found: seen.some((s) => numerals(s.text).includes(numerals(fold(f.text)))) }));
    return {
      id: n.id,
      path: n.path,
      need: n.need,
      covered: n.covered_by.length > 0 && held.length === n.covered_by.length && freshDate(n.checked, holdings.now),
      /** Its own source wasn't checked within FRESH_DAYS, so the fix is to open it again. */
      stale: !freshDate(n.checked, holdings.now),
      unresolved: n.covered_by.filter((r) => !holdings.sources.has(r)),
      flags,
      checks: {
        verified: all(held.map((s) => s.verified)),
        fresh: all(held.map((s) => s.fresh)),
        rights: all(held.map((s) => s.rights)),
        flags: all(flags.map((f) => f.found)),
      },
    };
  });
  const used = [...new Set(list.needs.flatMap((n) => n.covered_by))].flatMap((r) => holdings.sources.get(r) ?? []);
  const flags = rows.flatMap((r) => r.flags.map((f) => ({ need: r.id, ...f })));
  const values: Record<string, Value> = {
    coverage: percent(rows.filter((r) => r.covered).length, rows.length),
    verified: share(used.map((s) => s.verified)),
    fresh: share(used.map((s) => s.fresh)),
    rights: share(used.map((s) => s.rights)),
    flags: share(flags.map((f) => f.found)),
  };
  const gaps = (metric: 'verified' | 'fresh' | 'rights') => used.filter((s) => s[metric] === false).map((s) => ({ metric, what: s.ref, gain: 100 / values[metric]!.samples }));
  const fixes = [
    ...rows.filter((r) => !r.covered).map((r) => ({ metric: 'coverage', what: r.stale ? `${r.id} source` : r.id, gain: 100 / rows.length })),
    ...gaps('verified'),
    ...gaps('fresh'),
    ...gaps('rights'),
    ...flags.filter((f) => !f.found).map((f) => ({ metric: 'flags', what: `${f.need} ${f.kind}`, gain: 100 / flags.length })),
  ];
  const byPath = holdings.paths
    .map((p) => ({ path: p, held: rows.filter((r) => r.path === p && r.covered).length, listed: rows.filter((r) => r.path === p).length }))
    .filter((p) => p.listed > 0);
  const sources = used.map(({ text: _text, ...s }) => s);
  return { values, rows, sources, byPath, fixes };
}

/** What a law page draws, as the collector writes it to law.json beside the page. */
export type LawView = ReturnType<typeof assess>;

/** A question's newest turn with the model, as the collector carries it from day to day (facts/law-runs.json). */
export interface AnswerRun {
  id: string;
  /** The report's time. */
  at: string;
  /** Every run that time passed every check with an answer. */
  pass: boolean;
  /** Its runs that came back with an answer. */
  answered: number;
  /** What those runs cost, or null when the report kept no spend for them. */
  neurons: number | null;
}

/** Days a question's last answer still counts. The daily eval answers each question every 22 days or so (PLAN.md), so a missed turn is covered once. */
export const CARRY_DAYS = 60;

type ReportRow = { id?: unknown; answered?: unknown; neurons?: unknown; search_ms?: unknown; verdict?: unknown; result?: { answer?: unknown; error?: unknown } };

function evalReport(report: unknown): { at: string; neurons: unknown; rows: ReportRow[] } {
  const r = report as { at?: unknown; neurons?: unknown; rows?: unknown };
  if (typeof r !== 'object' || r === null || typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at)) || !Array.isArray(r.rows)) throw new Error('not a law eval report');
  return { at: r.at, neurons: r.neurons, rows: r.rows as ReportRow[] };
}

const hasAnswer = (row: ReportRow) => typeof row.result?.answer === 'string' && row.result.answer.trim() !== '';
/** A call that failed (a refused token, a timeout, a 5xx), not an answer the model gave: it says nothing of the question. */
const errored = (row: ReportRow) => !hasAnswer(row) && typeof row.result?.error === 'string' && row.result.error.trim() !== '';

/**
 * Each question the report put to the model. A row eval.ts marks `answered: false` was retrieved only, so it is no turn;
 * a report from before that mark counts every row, and a retrieval-only row then fails, as it always did. An errored row
 * is no turn either, so one bad call can't stand as a fail until the question's next slice: its last turn is kept.
 * A question's spend is its rows' own neurons, or, in an older report that kept one total, its share by answered rows.
 */
export function answerRuns(report: unknown): AnswerRun[] {
  const r = evalReport(report);
  const turns = r.rows.filter((row) => typeof row.id === 'string' && row.answered !== false && !errored(row));
  const answeredAll = turns.filter(hasAnswer).length;
  const total = typeof r.neurons === 'number' && Number.isFinite(r.neurons) && r.neurons > 0 ? r.neurons : null;
  const byId = new Map<string, ReportRow[]>();
  for (const row of turns) byId.set(row.id as string, [...(byId.get(row.id as string) ?? []), row]);
  return [...byId].map(([id, rows]) => {
    const answered = rows.filter(hasAnswer).length;
    const own = rows.every((row) => typeof row.neurons === 'number' && Number.isFinite(row.neurons) && row.neurons >= 0);
    const neurons = own ? rows.reduce((sum, row) => sum + (row.neurons as number), 0) : total !== null && answeredAll ? (total * answered) / answeredAll : null;
    return { id, at: r.at, pass: rows.every((row) => row.verdict === 'pass' && hasAnswer(row)), answered, neurons };
  });
}

function isRun(x: unknown): x is AnswerRun {
  const r = x as AnswerRun;
  return typeof r === 'object' && r !== null && typeof r.id === 'string' && typeof r.at === 'string' && !Number.isNaN(Date.parse(r.at)) &&
    typeof r.pass === 'boolean' && Number.isInteger(r.answered) && r.answered >= 0 && (r.neurons === null || (typeof r.neurons === 'number' && r.neurons >= 0));
}

/**
 * Each question's newest turn: today's report first, else the one carried from an earlier run, while it is under
 * CARRY_DAYS old and the question still on the page. `carried` is what the last run wrote, so anything unreadable in it
 * is dropped, never trusted.
 */
export function carryRuns(questions: readonly LawEvalItem[], fresh: readonly AnswerRun[], carried: unknown, now: Date): AnswerRun[] {
  const ids = new Set(questions.map((q) => q.id));
  const newest = new Map<string, AnswerRun>();
  for (const run of [...(Array.isArray(carried) ? carried.filter(isRun) : []), ...fresh]) {
    const age = now.getTime() - Date.parse(run.at);
    if (!ids.has(run.id) || age < 0 || age > CARRY_DAYS * DAY) continue;
    if (!newest.has(run.id) || Date.parse(newest.get(run.id)!.at) <= Date.parse(run.at)) newest.set(run.id, run);
  }
  return [...newest.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** The newest turn's time among `runs`, the time a reading over all of them was measured. */
const newestAt = (runs: readonly AnswerRun[]) => runs.map((r) => r.at).reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));

/**
 * The share of the page's questions whose newest turn passed: every run answered and passed every check. A question
 * with no turn in CARRY_DAYS fails. No turn at all reads missing.
 */
export function questionsPassed(questions: readonly LawEvalItem[], runs: readonly AnswerRun[]): Value & { at?: string } {
  const mine = runs.filter((r) => questions.some((q) => q.id === r.id));
  if (!mine.length) return { value: null, samples: 0 };
  return { ...percent(mine.filter((r) => r.pass).length, questions.length), samples: mine.length, at: newestAt(mine) };
}

/** Workers AI's price, $0.011 per 1,000 neurons (developers.cloudflare.com/workers-ai/platform/pricing), as eval.ts counts it. */
export const USD_PER_NEURON = 0.011 / 1000;

/**
 * What answering every one of the page's questions once costs on Workers AI, in dollars: the mean spend of its questions
 * whose newest turn came back with an answer and a spend, times its questions. The daily eval answers a slice a day, so
 * the mean stands in for the rest. No such turn reads missing: a retrieval-only report answers nothing, and 0 would read
 * as perfect.
 */
export function evalSpend(questions: readonly LawEvalItem[], runs: readonly AnswerRun[]): Value & { at?: string } {
  const costed = runs.filter((r) => questions.some((q) => q.id === r.id) && r.answered > 0 && r.neurons !== null && r.neurons > 0);
  if (!costed.length) return { value: null, samples: 0 };
  const mean = costed.reduce((sum, r) => sum + r.neurons!, 0) / costed.length;
  return { value: Math.round(mean * questions.length * USD_PER_NEURON * 1e6) / 1e6, samples: costed.length, at: newestAt(costed) };
}

/**
 * The page's law searches, 95th percentile in milliseconds over a law eval report's runs: each run's retrieval as eval.ts
 * times it (`search_ms`, the embedding call included). A page question with no timed run, skipped at a spend stop or its
 * search failed, counts as wrong: slower than any, so a percentile that lands on one reads missing, never fast. A report
 * from before the timing reads missing.
 */
export function searchP95(questions: readonly LawEvalItem[], report: unknown): Value & { at: string } {
  const r = evalReport(report);
  if (!r.rows.some((row) => typeof row === 'object' && row !== null && 'search_ms' in row)) return { value: null, samples: 0, at: r.at };
  const ids = new Set(questions.map((q) => q.id));
  const rows = r.rows.filter((row) => ids.has(row.id as string));
  const timed = (row: ReportRow) => typeof row.search_ms === 'number' && Number.isFinite(row.search_ms) && row.search_ms >= 0;
  const untimed = rows.filter((row) => !timed(row)).length + questions.filter((q) => !rows.some((row) => row.id === q.id)).length;
  const times = [...rows.filter(timed).map((row) => row.search_ms as number).sort((a, b) => a - b), ...Array<number>(untimed).fill(Infinity)];
  if (!times.length) return { value: null, samples: 0, at: r.at };
  const p95 = times[Math.ceil(0.95 * times.length) - 1]!;
  return { value: Number.isFinite(p95) ? p95 : null, samples: times.length, at: r.at };
}

/** One law passage: its catalog entry and its part's text. */
export type LawPassage = LawChunk & { text: string };

// legallas_search_law's answer is built by web/mcp/law-answer.ts, the file the tool itself uses: one shape, once as text.
/** Passages in an answer when the AI gives no limit. */
export const TOOL_PASSAGES = DEFAULT_PASSAGES;

/** The tool's answer as a client gets it: the JSON once, as text, within one answer's characters. */
export const toolAnswer = lawResultOnce;

/** Characters over four, as the data room counts a tool result (pages/data-room/lab/journeys.ts tokensOf). */
const tokensOf = (text: string) => Math.ceil(text.length / 4);

/**
 * A built law library, `<law folder>/out` as web/scripts/law/build.ts writes it: each passage by chunk id, or null when
 * the catalog or the part isn't there. A folder with no catalog finds nothing, so what it would measure reads missing.
 */
export function lawLibrary(dir: string): (id: string) => LawPassage | null {
  const out = path.join(dir, 'out');
  let chunks: LawChunk[] = [];
  try {
    chunks = (JSON.parse(readFileSync(path.join(out, 'catalog.json'), 'utf8')) as { chunks?: LawChunk[] }).chunks ?? [];
  } catch {
    return () => null;
  }
  const byId = new Map(chunks.map((c) => [c.id, c]));
  return (id) => {
    const entry = byId.get(id);
    try {
      return entry ? { ...entry, text: readFileSync(path.join(out, lawKey(entry)), 'utf8') } : null;
    } catch {
      return null;
    }
  };
}

/**
 * The tokens in the law tool's answers to the page's questions, 95th percentile over a law eval report's runs. A run's
 * retrieval is the tool's: the same search, so its first TOOL_PASSAGES passages are what the tool sends with no limit.
 * A run that retrieved nothing is skipped: Ask's relevance floor may have closed, and the tool has none. So is one whose
 * passage the library no longer holds, rebuilt since the report. A retrieval-only report counts: the answer needs no model.
 */
export function lookupTokens(questions: readonly LawEvalItem[], report: unknown, library: (id: string) => LawPassage | null): Value & { at: string } {
  const r = report as { at?: unknown; rows?: unknown };
  if (typeof r !== 'object' || r === null || typeof r.at !== 'string' || !Array.isArray(r.rows)) throw new Error('not a law eval report');
  const ids = new Set(questions.map((q) => q.id));
  const tokens: number[] = [];
  for (const row of r.rows as { id?: unknown; result?: { retrieved?: unknown } }[]) {
    const retrieved = row.result?.retrieved;
    if (!ids.has(row.id as string) || !Array.isArray(retrieved) || retrieved.length === 0) continue;
    const passages = retrieved.slice(0, TOOL_PASSAGES).map((id) => (typeof id === 'string' ? library(id) : null));
    if (passages.every((p) => p !== null)) tokens.push(tokensOf(JSON.stringify(toolAnswer(passages as LawPassage[]))));
  }
  tokens.sort((a, b) => a - b);
  return { value: tokens.length ? tokens[Math.ceil(0.95 * tokens.length) - 1]! : null, samples: tokens.length, at: r.at };
}

/** The repository root, from this file's place in it. */
export const ROOT = path.resolve(import.meta.dirname, '../../..');

/** Everything a law page draws, from its folder's needs.json. */
export function lawView(slug: string, now = new Date(), root = ROOT) {
  const holdings = readHoldings(root, now);
  const list = parseNeeds(JSON.parse(read(root, `quality-speed/pages/${slug}/needs.json`)), slug, holdings);
  return { list, ...assess(list, holdings) };
}
