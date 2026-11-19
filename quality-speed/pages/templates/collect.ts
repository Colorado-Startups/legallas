// SPDX-License-Identifier: Apache-2.0
// The templates page's collector. Reads templates/, needed.json and the product notices, and writes metrics.json.
// Numbers only: no template text leaves this file. PLAN.md defines every check.
//
//   node quality-speed/pages/templates/collect.ts --out <file>
//
// The daily lane (lanes.json) runs it from the repository root. A reading needs the run that took it (the contract), so
// outside Actions set GITHUB_RUN_ID to look.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { MetricRecord } from '../../contract/format.ts';
import { laneRecord } from '../../core/lane/collect.ts';
import { isTemplateFile, templateParts, tokensOf } from '../../../web/worker/template-parts.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REPO_URL = 'https://github.com/Colorado-Startups/legallas';
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

export type FrontMatter = Record<string, string | string[] | Record<string, string>>;
export interface Doc {
  id: string;
  fm: FrontMatter | null;
  body: string;
}

/** The YAML subset the templates use: scalars, wrapped scalars, inline lists, and indented lists or maps. */
export function parseFrontMatter(text: string): { fm: FrontMatter; body: string } | null {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  const fm: FrontMatter = {};
  let key = '';
  for (const line of (m[1] ?? '').split('\n')) {
    const top = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (top) {
      key = top[1] ?? '';
      const v = (top[2] ?? '').trim();
      fm[key] = v.startsWith('[') && v.endsWith(']') ? v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean) : v;
      continue;
    }
    if (!key || !/^\s+\S/.test(line)) return null;
    const cur = fm[key];
    const item = /^\s+- (.*)$/.exec(line)?.[1];
    const [, name, desc] = /^\s+([A-Za-z0-9_]+):\s+(.*)$/.exec(line) ?? [];
    if (typeof cur === 'string' && cur !== '') fm[key] = `${cur} ${line.trim()}`;
    else if (item !== undefined && (cur === '' || Array.isArray(cur))) fm[key] = [...(Array.isArray(cur) ? cur : []), item.trim()];
    else if (name && desc !== undefined && (cur === '' || (typeof cur === 'object' && !Array.isArray(cur)))) fm[key] = { ...(cur as object), [name]: desc };
    else return null;
  }
  return { fm, body: text.slice(m[0].length) };
}

/** Every template legallas_template serves (web/worker/template-parts.ts isTemplateFile): not READMEs, the licence record or held-back/. */
export function loadDocs(dir = path.join(ROOT, 'templates')): Doc[] {
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(isTemplateFile).sort();
  return files.map((f) => {
    const parsed = parseFrontMatter(readFileSync(path.join(dir, f), 'utf8'));
    return { id: f.slice(0, -3).split(path.sep).join('/'), fm: parsed?.fm ?? null, body: parsed?.body ?? '' };
  });
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const list = (v: unknown): string[] => (Array.isArray(v) ? v : []);
const fieldNames = (v: unknown) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.keys(v) : []);
const dateOf = (fm: FrontMatter) => str(fm.date_checked) || str(fm.checked);
const flat = (s: string) => s.replace(/^>\s?/gm, '').replace(/\*\*/g, '').replace(/\s+/g, ' ');
const START = '<!-- TEMPLATE START -->';
const usesFields = (d: Doc) => d.body.includes(START) || d.body.includes('{{');

export function rightToShip(d: Doc, maySection: string): boolean {
  if (!d.fm) return false;
  const source = str(d.fm.source);
  const original =
    str(d.fm.licence).startsWith('CC0-1.0') &&
    /^Original (drafting|analysis) for Legallas\b/.test(source) &&
    !clauses(source).some((c) => unnegated(listJoin(c), ADAPTED));
  return original || maySection.includes(`(${d.id}.md)`);
}

export function fieldsWork(d: Doc): boolean {
  if (!d.fm) return false;
  const declared = new Set(fieldNames(d.fm.fields));
  const used = new Set([...d.body.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)].map((m) => m[1]));
  if (declared.size !== used.size || [...used].some((f) => !declared.has(f))) return false;
  const stack: string[] = [];
  for (const m of d.body.matchAll(/\[(END )?OPTION ([A-Z0-9]+)\b[^\]]*\]/g)) {
    if (!m[1]) stack.push(m[2] ?? '');
    else if (stack.pop() !== m[2]) return false;
  }
  if (stack.length) return false;
  const filled = d.body.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, 'x').replace(/\[(END )?OPTION [A-Z0-9]+\b[^\]]*\]/g, '');
  return !/\{\{|\}\}|\[(END )?OPTION/.test(filled);
}

/** The A2 short line and the A5 footer, read from the product notices so a change there reaches every check. */
export function notices(text = read('docs/legal/product-notices.md')) {
  const after = (heading: string) => /^> (.+)$/m.exec(text.slice(text.indexOf(heading)))?.[1] ?? '';
  return { short: after('## A2.'), footer: after('## A5.') };
}

const BANNED = [
  /\b(lawyer|attorney|law firm|counsel)s?[- ](reviewed|verified|approved|vetted)\b/i,
  /\b(reviewed|verified|approved|vetted) by (a |an |our |your )?(lawyer|attorney|law firm|counsel)/i,
  /\b(lawyer|attorney|law firm)s? (has|have) (reviewed|verified|approved|vetted)\b/i,
  /\blawyer[- ]grade\b/i,
  /\breplaces? (a|your) lawyer\b/i,
  /\bno need for a lawyer\b/i,
  /\bsaves? you legal fees\b/i,
  /\bpay less for lawyers\b/i,
  /\byour legal agent\b/i,
  /\bfor informational purposes only\b/i,
  /\bdoes not give legal advice\b/i,
];
const NEGATION = /\b(?:no|not|none|never|nothing)\b|n't\b/gi;
const ADAPTED = /\b(adapt\w*|cop(?:y|ied)|derived|based on|modified)\b/i;

/** Clauses end at a stop, colon, semicolon or "but". */
const clauses = (text: string) => flat(text).split(/[.!?:;]\s+|\s+but\s+/i);
/** Commas in a list ("a lawyer, attorney or law firm") don't break the phrase. */
const listJoin = (clause: string) => clause.replace(/,\s(?=[^,]*\s(?:or|and)\s)/g, ' ');
/** A phrase set off by two commas drops out, joining what it split ("a lawyer, hired last year, has"). */
const dropAside = (clause: string) => clause.replace(/,\s[^,]*,\s/g, ' ');

/** The most words a negation reaches across to its phrase: "No real group's charter or membership agreement was read or adapted". */
const NEGATION_REACH = 10;
/** A new clause with its own subject ends a negation's reach: "Nothing to sign yet and our attorney approved it". */
const NEW_CLAUSE = /\b(?:and|or|yet|so)\s+(?:our|the|a|an|this|that|these|those|it|its|we|they|he|she|i|you|your|his|her|their|my|someone)\b/i;

/** The pattern appears with no negation in its own clause just before it: none at all, or one cut off by a comma, a new clause or distance. */
function unnegated(clause: string, re: RegExp): boolean {
  const m = re.exec(clause);
  if (!m) return false;
  const before = clause.slice(0, m.index);
  const negation = [...before.matchAll(NEGATION)].pop();
  if (negation === undefined) return true;
  const gap = before.slice(negation.index + negation[0].length);
  return gap.includes(',') || NEW_CLAUSE.test(gap) || gap.trim().split(/\s+/).filter(Boolean).length > NEGATION_REACH;
}

/** A banned claim, unnegated, in a clause as written or with its asides dropped. */
export function bannedClaim(text: string): boolean {
  return clauses(text).some((c) => [listJoin(c), listJoin(dropAside(c))].some((form) => BANNED.some((re) => unnegated(form, re))));
}

/** Whether `text` holds `footer`, with any number where the footer says "version N". By position: the footer is never made into a pattern. */
function holdsFooter(text: string, footer: string): boolean {
  const cut = footer.indexOf('version N');
  if (cut === -1) return text.includes(footer);
  const before = `${footer.slice(0, cut)}version `;
  const after = footer.slice(cut + 'version N'.length);
  for (let at = text.indexOf(before); at !== -1; at = text.indexOf(before, at + 1)) {
    let end = at + before.length;
    while (/\d/.test(text[end] ?? '')) {
      end += 1;
      if (text.startsWith(after, end)) return true;
    }
  }
  return false;
}

export function wording(d: Doc, n: { short: string; footer: string }): boolean {
  if (!d.fm || !n.short || !n.footer) return false;
  const text = flat(d.body);
  if (!text.includes(flat(n.short)) || !text.includes('No lawyer has reviewed')) return false;
  if (usesFields(d)) {
    const footer = n.footer.replace('[ID]', d.id).replace('[version]', 'version N').replace('[date]', dateOf(d.fm));
    if (!holdsFooter(text, footer)) return false;
  }
  return !bannedClaim(d.body);
}

/** Colorado tax content: a citation to C.R.S. title 39 (taxation), or the Colorado composite return. */
const COLORADO_TAX = /C\.R\.S\. 39-|\[39-\d|Colorado composite return/;

/** Product notice A1: a template that shows Colorado tax law also says to have your own tax professional review it. */
export function taxLine(d: Doc): boolean {
  const text = flat(`${list(d.fm?.statutes).join(' ')} ${d.body}`);
  return !COLORADO_TAX.test(text) || /have your own tax professional review/i.test(text);
}

export interface Needed {
  id: string;
  path: string;
  templates: string[];
  gap?: string;
}

export function covered(item: Needed, ids: Set<string>): boolean {
  return item.templates.length > 0 && !item.gap && item.templates.every((t) => ids.has(t));
}

/** One render: the file read and parsed, every field filled with an invented sample value, option markers dropped. Null on failure. */
export function render(file: string): string | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const parsed = parseFrontMatter(text);
  if (!parsed) return null;
  const filled = parsed.body
    .replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, name: string) => `Sample ${name}`)
    .replace(/\[(END )?OPTION [A-Z0-9]+\b[^\]]*\]/g, '');
  return /\{\{|\}\}|\[(END )?OPTION/.test(filled) ? null : filled;
}

/** The 95th percentile, nearest rank. */
export function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? null;
}

/** Times a render of every template. One that fails to render makes the run's reading missing. */
export function renderMs(files: string[], clock = () => performance.now(), run = render) {
  const times: number[] = [];
  for (const file of files) {
    const start = clock();
    if (run(file) === null) return { value: null, sample: files.length };
    times.push(clock() - start);
  }
  const value = p95(times);
  return { value: value === null ? null : Math.round(value * 1000) / 1000, sample: times.length };
}

/**
 * The most tokens one legallas_template read returns: every template split as the tool splits it (templateParts), four
 * characters a token, as the data room counts them (data-room/lab/journeys.ts). The largest part of any template.
 */
export function partTokens(files: string[], readFile = (file: string) => readFileSync(file, 'utf8')) {
  const largest = files.map((file) => Math.max(0, ...templateParts(readFile(file)).map(tokensOf)));
  return { value: largest.length === 0 ? null : Math.max(...largest), sample: largest.length };
}

/** Every template's file path, the same set loadDocs() reads. */
export function templateFiles(dir = path.join(ROOT, 'templates')): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter(isTemplateFile)
    .sort()
    .map((f) => path.join(dir, f));
}

const percent = (pass: number, of: number) => (of === 0 ? null : Math.round((10_000 * pass) / of) / 100);

/** Every reading, plus the ids behind each, for the page's drill-down. */
export function collect() {
  const docs = loadDocs();
  const ids = new Set(docs.map((d) => d.id));
  const needed: Needed[] = JSON.parse(read('quality-speed/pages/templates/needed.json')).needed;
  const bundled = read('templates/bundled-forms.md');
  const maySection = bundled.slice(bundled.indexOf('## May ship'), bundled.indexOf('## ', bundled.indexOf('## May ship') + 3));
  const n = notices();
  const checks = docs.map((d) => ({
    id: d.id,
    right_to_ship: rightToShip(d, maySection),
    fields_work: usesFields(d) || !d.fm ? fieldsWork(d) : null,
    wording: wording(d, n),
  }));
  const share = (k: Exclude<keyof (typeof checks)[number], 'id'>) => {
    const rows = checks.filter((c) => c[k] !== null);
    return { value: percent(rows.filter((c) => c[k]).length, rows.length), sample: rows.length };
  };
  const coverage = needed.map((item) => covered(item, ids));
  const values = {
    coverage: { value: percent(coverage.filter(Boolean).length, coverage.length), sample: coverage.length },
    right_to_ship: share('right_to_ship'),
    fields_work: share('fields_work'),
    wording: share('wording'),
    fill_ms_p95: renderMs(templateFiles()),
    template_part_tokens_max: partTokens(templateFiles()),
  };
  return { values, checks };
}

/** The contract's records: a reading is `ok`, or `missing` when it couldn't be measured. */
export function records(values: ReturnType<typeof collect>['values'], now: Date, url: string): MetricRecord[] {
  const at = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return Object.entries(values).map(([id, { value, sample }]): MetricRecord =>
    value === null
      ? { id, page: 'templates', value: null, status: 'missing', stage: 'lab', measured_at: null, source_url: null, sample_size: null }
      : { id, page: 'templates', value, status: 'ok', stage: 'lab', measured_at: at, source_url: url, sample_size: sample },
  );
}

if (import.meta.main) {
  const run = process.env.GITHUB_RUN_ID ?? '';
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!/^[1-9]\d*$/.test(run) || !values.out) throw new Error('usage: GITHUB_RUN_ID=<run> collect.ts --out <file>');
  const now = new Date();
  const out = [...records(collect().values, now, `${REPO_URL}/actions/runs/${run}`), await laneRecord('templates')];
  writeFileSync(values.out, `${JSON.stringify(out, null, 2)}\n`);
}
