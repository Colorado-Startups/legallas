// SPDX-License-Identifier: Apache-2.0
// Checks the metric format. Only numbers, dates, ids and closed lists pass, so a title, a body or a document's text
// cannot reach the site. Errors name the field and the rule and never repeat the value: a rejected string could hold
// anything, and CI logs are kept for 90 days.
//
// The one exception to "only numbers, dates, ids and closed lists" is a page's reviewed ideal.json: short lines of
// plain words, dated public links, and no markup.
import {
  CHANGE_FIELDS,
  CHANGE_REASONS,
  DIRECTIONS,
  LENSES,
  REQUIRED_LENSES,
  STAGES,
  STATUSES,
  UNITS,
  type Change,
  type Group,
  type HistoryLine,
  type Ideal,
  type Manifest,
  type Metric,
  type MetricDef,
  type MetricRecord,
  type Unit,
} from './format.ts';
import { PAGES, REPO, type PageSlug } from './pages.ts';
import { wordsIn } from './words.ts';

/** Dots may separate parts, such as a room, a user and a goal. */
const ID = /^(?=.{1,120}$)[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REPO_URL = `https://github\\.com/Colorado-Startups/${REPO}`;
const SOURCE_URL = new RegExp(
  `^${REPO_URL}/(issues/[1-9]\\d*|pull/[1-9]\\d*|actions/runs/[1-9]\\d*(/job/[1-9]\\d*)?|commit/[0-9a-f]{40}|settings(/(actions|branches|pages|rules|security_analysis))?)$`,
);
const RUN_URL = new RegExp(`^${REPO_URL}/actions/runs/[1-9]\\d*(/job/[1-9]\\d*)?$`);

/** A heavy weight on an easy metric, or a long age limit, could hide a metric at 0 or an old reading. */
const MAX_WEIGHT = 100;
const MAX_AGE_HOURS = 24 * 90;
/** A drill proves detection works only while it's recent: monthly, with a month's longest run of days. */
const MAX_DRILL_AGE_HOURS = 24 * 31;
/** Runners' clocks differ a little. */
const CLOCK_SKEW_MS = 5 * 60_000;

/** A percent is 0 to 100 and a pass is 0 or 1, so 0.9 and 90 can't be confused at review. */
const fitsUnit = (unit: Unit, n: number) => n >= 0 && (unit !== 'percent' || n <= 100) && (unit !== 'pass' || n === 0 || n === 1);

const MANIFEST_KEYS = new Set(['page', 'signoff_comment', 'groups', 'metrics', 'changes']);
const GROUP_KEYS = new Set(['id', 'weight']);
const DEF_KEYS = new Set(['id', 'lens', 'unit', 'direction', 'floor', 'goal', 'weight', 'max_age_hours', 'min_samples', 'coverage_metric', 'group', 'goal_source']);
const IDEAL_KEYS = new Set(['ideal', 'sources', 'quality', 'speed', 'consumption']);
const SOURCE_KEYS = new Set(['title', 'url', 'date']);
const CHANGE_KEYS = new Set(['date', 'metric', 'field', 'from', 'to', 'reason', 'issue', 'signoff_comment']);
const RECORD_KEYS = new Set(['id', 'page', 'value', 'status', 'stage', 'measured_at', 'source_url', 'sample_size']);
// `capped` is a legacy key: lines written before the cap was removed still carry it, and it is ignored.
const HISTORY_KEYS = new Set(['at', 'page', 'quality', 'speed', 'consumption', 'total', 'capped']);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const positiveInteger = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

/** A real instant in UTC. The round trip refuses days that overflow, such as 31 February. */
export function isTime(v: unknown): v is string {
  if (typeof v !== 'string' || !TIME.test(v)) return false;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === v.slice(0, 19);
}

const isDate = (v: unknown): v is string => typeof v === 'string' && DATE.test(v) && isTime(`${v}T00:00:00Z`);

/**
 * A public document: https, a host name, no credentials, spaces or quotes, at most 300 characters. A query or fragment may
 * stay, because documentation pages anchor sections with them.
 */
export function isPublicUrl(v: unknown): v is string {
  // The host as written, plain ASCII labels only: no punycode, port, credentials or encoded text. The path, query and
  // fragment keep to URL-safe characters, so a link can't smuggle markup or a sentence.
  const match = typeof v === 'string' && v.length <= 300 ? /^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(\/[A-Za-z0-9._~\/%-]*)?(\?[A-Za-z0-9._~=&%-]*)?(#[A-Za-z0-9._~:-]*)?$/i.exec(v) : null;
  if (!match) return false;
  const host = (match[1] ?? '').toLowerCase();
  if (host.split('.').some((label) => label.startsWith('xn--') || label.startsWith('-') || label.endsWith('-'))) return false;
  try {
    const url = new URL(v as string);
    return url.hostname === host && url.port === '' && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** A source link: this repository's issue, pull request, run, commit or settings page, with no query or fragment. */
export const isSourceUrl = (v: unknown): v is string => typeof v === 'string' && SOURCE_URL.test(v);

/** Adds an error for each key outside the closed list, without naming it: a key could hold anything too. */
function checkKeys(where: string, value: Record<string, unknown>, keys: ReadonlySet<string>, errors: string[]): void {
  if (Object.keys(value).some((key) => !keys.has(key))) errors.push(`${where}: unknown field`);
}

function checkDef(where: string, value: unknown, errors: string[]): MetricDef | null {
  if (!isObject(value)) {
    errors.push(`${where}: not an object`);
    return null;
  }
  const before = errors.length;
  checkKeys(where, value, DEF_KEYS, errors);
  const v = value as unknown as MetricDef;
  if (typeof v.id !== 'string' || !ID.test(v.id)) errors.push(`${where}: id is not lowercase letters, digits, underscores and dots`);
  if (!isOneOf(LENSES, v.lens)) errors.push(`${where}: lens is not in the closed list`);
  if (!isOneOf(DIRECTIONS, v.direction)) errors.push(`${where}: direction is not in the closed list`);
  if (!isOneOf(UNITS, v.unit)) errors.push(`${where}: unit is not in the closed list`);
  else {
    for (const field of ['floor', 'goal'] as const) {
      if (!isNumber(v[field]) || !fitsUnit(v.unit, v[field])) errors.push(`${where}: ${field} is not a valid ${v.unit}`);
    }
  }
  if (isNumber(v.floor) && isNumber(v.goal)) {
    const ordered = v.direction === 'higher' ? v.goal > v.floor : v.goal < v.floor;
    if (!ordered) errors.push(`${where}: goal must be past floor in the direction`);
  }
  if (!positiveInteger(v.weight) || v.weight > MAX_WEIGHT) errors.push(`${where}: weight must be a whole number from 1 to ${MAX_WEIGHT}`);
  if (!positiveInteger(v.max_age_hours) || v.max_age_hours > MAX_AGE_HOURS) errors.push(`${where}: max_age_hours must be a whole number from 1 to ${MAX_AGE_HOURS}`);
  if (!positiveInteger(v.min_samples)) errors.push(`${where}: min_samples must be a whole number of at least 1`);
  for (const field of ['coverage_metric', 'group'] as const) {
    const ref = (value as Record<string, unknown>)[field];
    if (ref !== undefined && (typeof ref !== 'string' || !ID.test(ref))) errors.push(`${where}: ${field} is not an id`);
  }
  if (v.goal_source !== undefined && !isPublicUrl(v.goal_source)) errors.push(`${where}: goal_source is not a public https link`);
  return errors.length === before ? v : null;
}

function checkGroups(value: unknown, errors: string[]): Group[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 2) {
    errors.push('groups: needs at least two when present');
    return undefined;
  }
  const ids = new Set<string>();
  let sum = 0;
  value.forEach((group: unknown, i) => {
    const where = `groups[${i}]`;
    if (!isObject(group)) return void errors.push(`${where}: not an object`);
    checkKeys(where, group, GROUP_KEYS, errors);
    if (typeof group.id !== 'string' || !ID.test(group.id)) errors.push(`${where}: id is not an id`);
    else if (ids.has(group.id)) errors.push(`${where}: id repeats`);
    else ids.add(group.id);
    if (!positiveInteger(group.weight)) errors.push(`${where}: weight must be a whole number above 0`);
    else sum += group.weight;
  });
  if (sum !== 100) errors.push('groups: weights must add up to 100');
  return value as Group[];
}

function checkChange(where: string, value: unknown, errors: string[]): void {
  if (!isObject(value)) return void errors.push(`${where}: not an object`);
  checkKeys(where, value, CHANGE_KEYS, errors);
  const c = value as unknown as Change;
  if (!isDate(c.date)) errors.push(`${where}: date is not a calendar date`);
  if (typeof c.metric !== 'string' || !ID.test(c.metric)) errors.push(`${where}: metric is not an id`);
  if (!isOneOf(CHANGE_FIELDS, c.field)) errors.push(`${where}: field is not in the closed list`);
  if (!isOneOf(CHANGE_REASONS, c.reason)) errors.push(`${where}: reason is not in the closed list`);
  if (!positiveInteger(c.issue)) errors.push(`${where}: issue must be a number`);
  if (c.signoff_comment !== undefined && !positiveInteger(c.signoff_comment)) errors.push(`${where}: signoff_comment must be a comment id`);
  for (const side of ['from', 'to'] as const) {
    const v: unknown = c[side];
    const allowed = v === null || typeof v === 'boolean' || isNumber(v) || (typeof v === 'string' && ID.test(v));
    if (!allowed) errors.push(`${where}: ${side} must be a number, true or false, an id, or null`);
  }
}

/**
 * The rules across a whole list: unique ids, references that resolve, and, once signed off, every lens on the page and
 * in each group, and a goal source on every metric.
 */
function checkList(metrics: MetricDef[], groups: Group[] | undefined, signedOff: boolean, errors: string[]): void {
  const byId = new Map<string, MetricDef>();
  for (const m of metrics) {
    if (byId.has(m.id)) errors.push(`metrics: ${m.id} repeats`);
    byId.set(m.id, m);
  }
  const hasEvery = (list: MetricDef[]) => REQUIRED_LENSES.every((lens) => list.some((m) => m.lens === lens));
  if (signedOff && !hasEvery(metrics)) errors.push('metrics: needs at least one quality and one speed metric, and one consumption metric');
  const groupIds = new Set((groups ?? []).flatMap((g) => (isObject(g) && typeof g.id === 'string' && ID.test(g.id) ? [g.id] : [])));
  for (const m of metrics) {
    if (signedOff && m.goal_source === undefined) errors.push(`metrics: ${m.id} needs a goal_source`);
    if (m.coverage_metric !== undefined) {
      const proof = byId.get(m.coverage_metric);
      if (!proof) errors.push(`metrics: ${m.id} names a coverage metric that is not listed`);
      else if (proof.id === m.id) errors.push(`metrics: ${m.id} cannot be its own coverage metric`);
      else if (proof.coverage_metric !== undefined) errors.push(`metrics: ${m.id} names a coverage metric that may itself read no_events`);
      else if (proof.max_age_hours > MAX_DRILL_AGE_HOURS) errors.push(`metrics: ${m.id} names a coverage metric that may be over ${MAX_DRILL_AGE_HOURS} hours old`);
    }
    if (groups) {
      if (m.group === undefined || !groupIds.has(m.group)) errors.push(`metrics: ${m.id} needs a listed group`);
    } else if (m.group !== undefined) {
      errors.push(`metrics: ${m.id} has a group but the page has none`);
    }
  }
  for (const id of groupIds) {
    if (signedOff && !hasEvery(metrics.filter((m) => m.group === id))) errors.push(`groups: ${id} needs at least one quality and one speed metric, and one consumption metric`);
  }
}

export type Checked<T> = { value: T; errors: [] } | { value: null; errors: string[] };

/** Checks a parsed manifest.json. Pass the folder's slug so a file copied from another page fails. */
export function validateManifest(input: unknown, slug?: PageSlug): Checked<Manifest> {
  const errors: string[] = [];
  if (!isObject(input)) return { value: null, errors: ['manifest: not an object'] };
  checkKeys('manifest', input, MANIFEST_KEYS, errors);
  if (!isOneOf(PAGES, input.page)) errors.push('manifest: page is not in the closed list');
  else if (slug !== undefined && input.page !== slug) errors.push(`manifest: page does not match the folder ${slug}`);
  if (input.signoff_comment !== undefined && !positiveInteger(input.signoff_comment)) errors.push('manifest: signoff_comment must be a comment id');
  const groups = checkGroups(input.groups, errors);
  if (!Array.isArray(input.metrics)) errors.push('manifest: metrics must be a list');
  else {
    const defs = input.metrics.map((m: unknown, i) => checkDef(`metrics[${i}]`, m, errors));
    if (defs.every((d): d is MetricDef => d !== null)) checkList(defs, groups, input.signoff_comment !== undefined, errors);
  }
  if (!Array.isArray(input.changes)) errors.push('manifest: changes must be a list');
  else
    input.changes.forEach((c: unknown, i, all: unknown[]) => {
      checkChange(`changes[${i}]`, c, errors);
      // An addition goes from nothing to a metric that is on the list, or that a later entry retires: the log only grows.
      if (isObject(c) && c.field === 'added') {
        const listed = Array.isArray(input.metrics) && input.metrics.some((m: unknown) => isObject(m) && m.id === c.metric);
        const retired = all.slice(i + 1).some((later) => isObject(later) && later.metric === c.metric && later.field === 'retired');
        if (c.from !== null || c.to !== c.metric || !(listed || retired)) errors.push(`changes[${i}]: an added metric goes from null to its own id, and is on the list until an entry retires it`);
      }
    });
  return errors.length ? { value: null, errors } : { value: input as unknown as Manifest, errors: [] };
}

function checkRecord(where: string, r: MetricRecord, def: MetricDef, now: Date, errors: string[]): void {
  if (!isOneOf(STATUSES, r.status)) return void errors.push(`${where}: status is not in the closed list`);
  if (!isOneOf(STAGES, r.stage)) errors.push(`${where}: stage is not in the closed list`);
  const measured = r.status === 'ok' || r.status === 'no_events';
  if (r.measured_at !== null && !isTime(r.measured_at)) errors.push(`${where}: measured_at is not a UTC time`);
  else if (r.measured_at !== null && Date.parse(r.measured_at) > now.getTime() + CLOCK_SKEW_MS) errors.push(`${where}: measured_at is in the future, so it would never age`);
  if (r.source_url !== null && !isSourceUrl(r.source_url)) errors.push(`${where}: source_url is not an allowed link`);
  if (measured) {
    if (r.measured_at === null) errors.push(`${where}: ${r.status} needs measured_at`);
    if (r.source_url === null || !RUN_URL.test(r.source_url)) errors.push(`${where}: ${r.status} needs a run link, proving the measurement ran`);
  }
  if (r.sample_size !== null && (!Number.isInteger(r.sample_size) || r.sample_size < 0)) errors.push(`${where}: sample_size must be a whole number`);
  if (r.status === 'ok') {
    if (!isNumber(r.value)) errors.push(`${where}: ok needs a number`);
    else if (!fitsUnit(def.unit, r.value)) errors.push(`${where}: value is not a valid ${def.unit}`);
    if (r.sample_size === null) errors.push(`${where}: ok needs sample_size`);
  } else if (r.status === 'stale') {
    if (r.value !== null && (!isNumber(r.value) || !fitsUnit(def.unit, r.value))) errors.push(`${where}: value is not a valid ${def.unit}`);
    if (r.measured_at === null) errors.push(`${where}: stale needs measured_at`);
  } else if (r.value !== null) {
    errors.push(`${where}: ${r.status} must have a null value, so an error can't read as zero`);
  }
  if (r.status === 'no_events') {
    if (def.coverage_metric === undefined) errors.push(`${where}: no_events needs a coverage metric in the manifest`);
    if (r.sample_size !== 0) errors.push(`${where}: no_events must have sample_size 0`);
  }
}

/**
 * Checks a parsed metrics.json. A bad record is dropped and reported, so that metric reads as missing and scores 0
 * while the rest of the page still shows. A list with no sign-off takes no readings at all, so it can't score.
 */
export function validateRecords(input: unknown, manifest: Manifest, now = new Date()): { records: MetricRecord[]; errors: string[] } {
  if (!Array.isArray(input)) return { records: [], errors: ['metrics: must be a list'] };
  const defs = new Map(manifest.metrics.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const records: MetricRecord[] = [];
  const errors: string[] = [];
  input.forEach((item: unknown, i) => {
    const where = `records[${i}]`;
    if (!isObject(item)) return void errors.push(`${where}: not an object`);
    const before = errors.length;
    checkKeys(where, item, RECORD_KEYS, errors);
    for (const key of RECORD_KEYS) {
      if (!(key in item)) errors.push(`${where}: ${key} is required`);
    }
    if (errors.length > before) return;
    const r = item as unknown as MetricRecord;
    const def = typeof r.id === 'string' ? defs.get(r.id) : undefined;
    if (!def) return void errors.push(`${where}: id is not in the manifest`);
    if (r.page !== manifest.page) return void errors.push(`${where}: page does not match the manifest`);
    if (seen.has(r.id)) return void errors.push(`${where}: ${r.id} repeats`);
    checkRecord(where, r, def, now, errors);
    if (errors.length === before) {
      seen.add(r.id);
      records.push(r);
    }
  });
  return { records: manifest.signoff_comment === undefined ? [] : records, errors };
}

/** Every metric on the list, in the list's order. One with no record reads as missing, so nothing is ever skipped. */
export function joinMetrics(manifest: Manifest, records: readonly MetricRecord[]): Metric[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  return manifest.metrics.map((def) => {
    const r = byId.get(def.id);
    return {
      ...def,
      page: manifest.page,
      value: r?.value ?? null,
      status: r?.status ?? 'missing',
      stage: r?.stage ?? 'lab',
      measured_at: r?.measured_at ?? null,
      source_url: r?.source_url ?? null,
      sample_size: r?.sample_size ?? null,
    };
  });
}

/** Checks one line of the score history. */
export function validateHistoryLine(input: unknown): Checked<HistoryLine> {
  if (!isObject(input)) return { value: null, errors: ['history: not an object'] };
  const errors: string[] = [];
  checkKeys('history', input, HISTORY_KEYS, errors);
  const h = input as unknown as HistoryLine;
  if (!isTime(h.at)) errors.push('history: at is not a UTC time');
  if (!isOneOf(PAGES, h.page)) errors.push('history: page is not in the closed list');
  for (const field of ['quality', 'speed', 'consumption', 'total'] as const) {
    if (field === 'consumption' && h[field] === undefined) continue;
    const n = h[field] as number;
    if (!Number.isInteger(n) || n < 0 || n > 100) errors.push(`history: ${field} must be a whole number from 0 to 100`);
  }
  return errors.length ? { value: null, errors } : { value: h, errors: [] };
}

/**
 * Plain words a page can show: letters, digits, spaces and everyday punctuation. No markup characters, quotes or em
 * dashes, so the text can't carry HTML and can't hide a long run past the guard.
 */
const PLAIN = /^[A-Za-z0-9 ,.;:'()%/+?!-]+$/;
/** The guard's prose-run limit (`MAX_RUN_WORDS`), so a line shows as one run, never as prose. */
export const IDEAL_MAX_WORDS = 25;
/** Git Crafter's lengths: 300 characters for the ideal, 160 for each category's line. */
const IDEAL_MAX_CHARS = 300;
const LINE_MAX_CHARS = 160;
const TITLE_MAX_CHARS = 120;
const MAX_SOURCES = 5;

function checkLine(where: string, v: unknown, maxChars: number, errors: string[]): void {
  // No "://": a link in plain text would fail the guard's links-into-this-repository rule after review.
  if (typeof v !== 'string' || !PLAIN.test(v) || !/[A-Za-z]/.test(v) || v.trim() !== v || v.includes('://')) return void errors.push(`${where}: must be plain words`);
  if (v.length > maxChars) errors.push(`${where}: must be at most ${maxChars} characters`);
  if (wordsIn(v) > IDEAL_MAX_WORDS) errors.push(`${where}: must be at most ${IDEAL_MAX_WORDS} words`);
}

/**
 * Checks a parsed ideal.json, Git Crafter's `ideals/<tab>.json` shape. The ideal and each category's line are short plain
 * sentences; the sources are dated public links, none dated after `today`.
 */
export function validateIdeal(input: unknown, today = new Date()): Checked<Ideal> {
  if (!isObject(input)) return { value: null, errors: ['ideal: not an object'] };
  const errors: string[] = [];
  checkKeys('ideal', input, IDEAL_KEYS, errors);
  checkLine('ideal', input.ideal, IDEAL_MAX_CHARS, errors);
  for (const field of ['quality', 'speed', 'consumption'] as const) {
    if (input[field] !== undefined) checkLine(`ideal: ${field}`, input[field], LINE_MAX_CHARS, errors);
  }
  const sources = input.sources;
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > MAX_SOURCES) errors.push(`ideal: sources must list 1 to ${MAX_SOURCES} documents`);
  else {
    const latest = today.toISOString().slice(0, 10);
    sources.forEach((source: unknown, i) => {
      const where = `ideal: sources[${i}]`;
      if (!isObject(source)) return void errors.push(`${where}: not an object`);
      checkKeys(where, source, SOURCE_KEYS, errors);
      checkLine(`${where}: title`, source.title, TITLE_MAX_CHARS, errors);
      if (!isPublicUrl(source.url)) errors.push(`${where}: url is not a public https link`);
      if (!isDate(source.date)) errors.push(`${where}: date is not a calendar date`);
      else if (source.date > latest) errors.push(`${where}: date is after today`);
    });
  }
  return errors.length ? { value: null, errors } : { value: input as unknown as Ideal, errors: [] };
}
