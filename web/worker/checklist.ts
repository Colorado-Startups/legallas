// SPDX-License-Identifier: Apache-2.0
// The company checklist (docs/checklist/baseline.toml) as one company sees it: each item's status, what's missing, and
// which dates follow from its own facts. Pure, so the page and the pack share one answer. Off unless the room sets
// CHECKLIST_ENABLED to "1"; with it off the room serves no route and touches no table (migration 0016).
//
// - A status never says a company needs something. `missing` means companies commonly have this by the stage this one has
//   reached, and nothing in the room is matched to it.
// - The stage comes from the data: the furthest stage with a matched document, never before formation, so a founder on day
//   one isn't told 60 things are missing.
// - A date is arithmetic on a date someone entered or the formation date, and says what it was worked out from.
import { BASELINE } from './checklist-baseline.ts';
import type { ChecklistDue, ChecklistItem, ChecklistSource } from './checklist-types.ts';
import { displayFolder } from './files-catalog.ts';

export interface ChecklistSetting {
  CHECKLIST_ENABLED?: string;
}

export function checklistEnabled(env: ChecklistSetting): boolean {
  return env.CHECKLIST_ENABLED === '1';
}

export type ChecklistStatus = 'in_place' | 'check' | 'missing' | 'if_applies' | 'not_applicable' | 'not_yet';
export type SignedState = 'yes' | 'no' | 'not_needed';
export type DateState = 'done' | 'check' | 'late' | 'passed' | 'soon' | 'upcoming';

const SIGNED_STATES: readonly SignedState[] = ['yes', 'no', 'not_needed'];
const SOON_DAYS = 30;
const SUMMARY_DATES = 5;
const ONGOING = 'ongoing';
/** What the form asks for when an item has no date of its own to name. */
const DEFAULT_DATE_LABEL = 'Date on the document';
const FILED_LABEL = 'Date filed';

/** A match joined to its document (checklist-store.ts). */
export interface MatchRow {
  id: string;
  item_id: string;
  document_id: string;
  name: string;
  folder: string;
  source: string;
  control_seq: number | null;
  removed_at: string | null;
  signed: SignedState | null;
  doc_date: string | null;
  next_date: string | null;
  parties: string | null;
  amount: string | null;
  matched_by: string;
}

export interface NotApplicableRow {
  item_id: string;
  decided_by: string;
}

/** The company's own facts, from the room's settings (worker/company-settings.ts). Null when unset, or not one the list can use. */
export interface CompanyFacts {
  entityType: string | null;
  formationDate: string | null;
  /** The Colorado periodic report month on the state's record, 1 to 12. Left out or null: worked out from the formation date where the room can. */
  reportMonth?: number | null;
}

/** A month's name, for a report month in words. */
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/** True for a whole month number, 1 to 12. */
export function isMonth(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12;
}

export interface ServedMatch {
  id: string;
  documentId: string;
  /** Where it lives: the path inside the company's folder, which is also where the room shows it. */
  where: string;
  /** The room's link to the document. Null when the file has left the folder, and then the match doesn't count. */
  href: string | null;
  control: number | null;
  signed: SignedState | null;
  date: string | null;
  nextDate: string | null;
  parties: string | null;
  amount: string | null;
  matchedBy: string;
}

export interface ServedDate {
  itemId: string;
  title: string;
  date: string;
  /** The first day a window is open, when the date closes one. */
  opens: string | null;
  state: DateState;
  /** What the date was worked out from, in words. */
  basis: string;
}

export interface ServedItem {
  id: string;
  title: string;
  stage: string;
  stageLabel: string;
  relationship: string;
  relationshipLabel: string;
  status: ChecklistStatus;
  repeats: string | null;
  deadline: string | null;
  note: string | null;
  appliesWhen: string | null;
  why: string;
  evidence: string;
  providedBy: string[];
  sources: ChecklistSource[];
  /** The templates that fit this company's entity type, or every one while it isn't set. */
  templates: { title: string; href: string; source: string; version: string | null; lawChecked: string; writtenFor: string[] }[];
  matches: ServedMatch[];
  dates: ServedDate[];
  /** What's needed before the room can work out this item's date, or null. */
  dateHint: string | null;
  /** What a match's date means for this item, in the words the form uses, because a rule counts from it. */
  dateLabel: string;
}

export type ChecklistCounts = Record<ChecklistStatus, number>;

export interface StageSummary extends ChecklistCounts {
  id: string;
  label: string;
  /** False for a stage later than this company has reached. */
  reached: boolean;
}

export interface ChecklistView {
  notice: string;
  templateNotice: string;
  templateCardNotice: string;
  templateLicenceNotice: string;
  status: string;
  drafted: string;
  scope: string;
  today: string;
  entityLabel: string | null;
  formationDate: string | null;
  /** The Colorado periodic report month the owner set, 1 to 12, or null. */
  reportMonth: number | null;
  /** The stages reached so far, by name. */
  reachedStageLabels: string[];
  counts: ChecklistCounts;
  stages: StageSummary[];
  /** The relationships in the list's own order, for grouping. */
  relationships: { id: string; label: string }[];
  items: ServedItem[];
  /** Every date, soonest first. */
  dates: ServedDate[];
}

export type ChecklistSummary = Pick<ChecklistView, 'notice' | 'status' | 'entityLabel' | 'formationDate' | 'reportMonth' | 'stages'> & { nextDates: ServedDate[] };

const DAY = /^(19|20)\d{2}-\d{2}-\d{2}$/;
const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day));
const toDay = (date: Date) => date.toISOString().slice(0, 10);

/** True for a real calendar day in YYYY-MM-DD. */
export function isDay(text: unknown): text is string {
  return typeof text === 'string' && DAY.test(text) && !Number.isNaN(Date.parse(text)) && toDay(new Date(text)) === text;
}

function addDays(day: string, days: number): string {
  const date = new Date(day);
  date.setUTCDate(date.getUTCDate() + days);
  return toDay(date);
}

/** Months later, on the same day of the month, or that month's last day when it has no such day. */
function addMonths(day: string, months: number): string {
  const date = new Date(day);
  const last = utc(date.getUTCFullYear(), date.getUTCMonth() + months + 1, 0);
  return toDay(utc(last.getUTCFullYear(), last.getUTCMonth(), Math.min(date.getUTCDate(), last.getUTCDate())));
}

/** The company's facts from the room's settings. A value the list can't use counts as unset. */
export function companyFacts(raw: CompanyFacts): Required<CompanyFacts> {
  return {
    entityType: raw.entityType !== null && BASELINE.vocabulary.entity_types.includes(raw.entityType) ? raw.entityType : null,
    formationDate: isDay(raw.formationDate) ? raw.formationDate : null,
    reportMonth: isMonth(raw.reportMonth) ? raw.reportMonth : null,
  };
}

export function itemExists(id: string): boolean {
  return BASELINE.items.some((item) => item.id === id);
}

// Control characters, Unicode line separators and text-direction overrides, so a name can't be made to read as something else.
const CLEAN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/** One line of a person's text, or null when empty; undefined when it isn't text or is too long. */
function factText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const text = value.replace(CLEAN, ' ').replace(/ {2,}/g, ' ').trim();
  return text === '' ? null : text.length <= max ? text : undefined;
}

function factDay(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  return isDay(value) ? value : undefined;
}

export interface MatchFacts {
  signed: SignedState | null;
  date: string | null;
  nextDate: string | null;
  parties: string | null;
  amount: string | null;
}

export interface MatchInput {
  itemId: string;
  documentId: string;
  /** Only the facts the person sent. One left out keeps what's on record; one sent empty clears it. */
  facts: Partial<MatchFacts>;
}

/** The body of a match, checked. Names the first field it can't use. A date filed can't be later than tomorrow; a transfer or a sale can be planned. */
export function parseMatchInput(raw: Record<string, unknown>, today: string): { ok: true; value: MatchInput } | { ok: false; field: string } {
  const { itemId, documentId } = raw;
  if (typeof itemId !== 'string' || !itemExists(itemId)) return { ok: false, field: 'itemId' };
  if (typeof documentId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(documentId)) return { ok: false, field: 'documentId' };
  const facts: Partial<MatchFacts> = {};
  if ('signed' in raw) {
    const signed = raw.signed || null;
    if (signed !== null && !SIGNED_STATES.includes(signed as SignedState)) return { ok: false, field: 'signed' };
    facts.signed = signed as SignedState | null;
  }
  if ('date' in raw) {
    const date = factDay(raw.date);
    const filed = BASELINE.items.find((item) => item.id === itemId)?.date_label === FILED_LABEL;
    if (date === undefined || (filed && date !== null && date > addDays(today, 1))) return { ok: false, field: 'date' };
    facts.date = date;
  }
  if ('nextDate' in raw) {
    const nextDate = factDay(raw.nextDate);
    if (nextDate === undefined) return { ok: false, field: 'nextDate' };
    facts.nextDate = nextDate;
  }
  if ('parties' in raw) {
    const parties = factText(raw.parties, 500);
    if (parties === undefined) return { ok: false, field: 'parties' };
    facts.parties = parties;
  }
  if ('amount' in raw) {
    const amount = factText(raw.amount, 100);
    if (amount === undefined) return { ok: false, field: 'amount' };
    facts.amount = amount;
  }
  return { ok: true, value: { itemId, documentId, facts } };
}

const inPlace = (match: MatchRow) => match.signed === 'yes' || match.signed === 'not_needed';

function dateState(date: string, today: string): DateState {
  if (date < today) return 'passed';
  return date <= addDays(today, SOON_DAYS) ? 'soon' : 'upcoming';
}

interface WorkedOut {
  dates: { date: string; opens: string | null; basis: string }[];
  hint: string | null;
  /** The first time a calendar rule falls due; before it, the item isn't a gap. */
  firstDue: string | null;
}

function afterDates(due: Extract<ChecklistDue, { kind: 'after' }>, live: ReadonlyMap<string, readonly MatchRow[]>, titles: ReadonlyMap<string, string>): WorkedOut {
  const sources = due.from.flatMap((id) => live.get(id) ?? []);
  const dated = sources.filter((match) => match.doc_date !== null).sort((a, b) => (a.doc_date as string).localeCompare(b.doc_date as string));
  if (dated.length === 0) {
    const undated = sources[0];
    return { dates: [], hint: undated ? `Add the date on ${titles.get(undated.item_id)} to work out this date.` : null, firstDue: null };
  }
  const firstOfEach = dated.filter((match, i) => dated.findIndex((other) => other.item_id === match.item_id) === i);
  const picked = due.pick === 'each' ? dated : due.pick === 'first-of-each' ? firstOfEach : dated.slice(-1);
  const dates = picked.map((match) => {
    const from = match.doc_date as string;
    const date = due.days !== undefined ? addDays(from, due.days) : addMonths(from, due.months as number);
    const length = due.days !== undefined ? `${due.days} days` : `${due.months} months`;
    return { date, opens: null, basis: `${length} after ${from}, ${due.what} (${match.name}).` };
  });
  return { dates, hint: null, firstDue: null };
}

/** The different dates this item's own filings carry. A form and its proof of mailing are one filing, not two. */
const filingDates = (held: readonly MatchRow[]) => [...new Set(held.filter((match) => inPlace(match) && match.doc_date !== null).map((match) => match.doc_date as string))].sort();

/** True when the room knows this report window's month: the owner set it, or a rule works it out from the formation date. */
function reportMonthKnown(due: Extract<ChecklistDue, { kind: 'report-window' }>, company: CompanyFacts): boolean {
  return isMonth(company.reportMonth) || (company.entityType !== null && due.entity_types.includes(company.entityType));
}

function workOutDue(item: ChecklistItem, company: CompanyFacts, today: string, live: ReadonlyMap<string, readonly MatchRow[]>, titles: ReadonlyMap<string, string>): WorkedOut {
  const due = item.due;
  const { formationDate } = company;
  const reportMonth = isMonth(company.reportMonth) ? company.reportMonth : null;
  if (!due) return { dates: [], hint: null, firstDue: null };
  if (due.kind === 'after') return afterDates(due, live, titles);
  if (due.kind === 'report-window' && !reportMonthKnown(due, company)) {
    return { dates: [], hint: 'The report month comes from the state record. The room owner can set it on the checklist page.', firstDue: null };
  }
  if (formationDate === null) return { dates: [], hint: 'Set the formation date on the checklist page to work out this date.', firstDue: null };
  const firstYear = Number(formationDate.slice(0, 4)) + 1;
  // The month the state's record names, when the owner set it; otherwise the formation month.
  const month = due.kind === 'report-window' && reportMonth !== null ? reportMonth - 1 : new Date(formationDate).getUTCMonth();
  /** One year's date, the first day a filing counts for it, and the window it closes, if any. */
  const occurrence = (year: number): { date: string; opens: string | null; countsFrom: string } => {
    if (due.kind === 'yearly') {
      const date = toDay(utc(year, due.month - 1, due.day));
      return { date, opens: null, countsFrom: addMonths(date, -6) };
    }
    const opens = toDay(utc(year, month - due.months_before, 1));
    return { date: toDay(utc(year, month + due.months_after + 1, 0)), opens, countsFrom: opens };
  };
  let year = Math.max(firstYear, Number(today.slice(0, 4)) - 1);
  while (occurrence(year).date < today) year += 1;
  // The last date that has passed, if nothing filed covers it, comes before the next one.
  const last = year > firstYear ? occurrence(year - 1) : null;
  const shown = last !== null && !filingDates(live.get(item.id) ?? []).some((day) => day >= last.countsFrom) ? last : occurrence(year);
  const basis = due.kind === 'yearly'
    ? `Every year, starting the calendar year after the company formed on ${formationDate}.`
    : reportMonth !== null
      ? `Worked out from the report month set for this room, ${MONTH_NAMES[reportMonth - 1]}, from the calendar year after the company formed on ${formationDate}.`
      : `Worked out from the formation date, ${formationDate}. The state's record decides the report month.`;
  return { dates: [{ date: shown.date, opens: shown.opens, basis }], hint: null, firstDue: occurrence(firstYear).date };
}

/** Where a match says a document lives. */
function serveMatch(row: MatchRow): ServedMatch {
  const folder = displayFolder(row);
  return {
    id: row.id,
    documentId: row.document_id,
    where: folder ? `${folder}/${row.name}` : row.name,
    href: row.removed_at === null ? `/doc/?id=${encodeURIComponent(row.document_id)}` : null,
    control: row.control_seq,
    signed: row.signed,
    date: row.doc_date,
    nextDate: row.next_date,
    parties: row.parties,
    amount: row.amount,
    matchedBy: row.matched_by,
  };
}

/** What the whole list knows about a company before it looks at any one item. */
interface Standing {
  company: CompanyFacts;
  today: string;
  /** Every match on record for an item, the removed ones too. */
  matches: readonly MatchRow[];
  /** The matches still in the room, by item. */
  live: ReadonlyMap<string, readonly MatchRow[]>;
  titles: ReadonlyMap<string, string>;
  saidNo: ReadonlySet<string>;
  reached: ReadonlySet<string>;
}

/**
 * The stages the company has reached. Each stage stands alone: a SAFE doesn't mean the company has hired. Only a document
 * someone said isn't signed keeps its stage closed: a date a founder may not need is safe, and a hidden one isn't. A priced
 * round is also a financing.
 */
function reachedStages(items: readonly ChecklistItem[], live: ReadonlyMap<string, readonly MatchRow[]>): Set<string> {
  const stageOf = new Map(items.map((item) => [item.id, item.stage]));
  const openedBy = [...live].filter(([, rows]) => rows.some((row) => row.signed !== 'no')).map(([id]) => stageOf.get(id) ?? '');
  return new Set(['pre-formation', 'formation', ...openedBy, ...(openedBy.includes('priced-round') ? ['first-financing'] : [])]);
}

function itemStatus(item: ChecklistItem, firstDue: string | null, s: Standing): ChecklistStatus {
  const { company, today } = s;
  const held = s.live.get(item.id) ?? [];
  if (held.length > 0) return held.some(inPlace) ? 'in_place' : 'check';
  if (s.saidNo.has(item.id)) return 'not_applicable';
  if (item.stage === ONGOING) {
    if (company.formationDate === null) return 'not_yet';
    // Not a gap until its first date passes, or, with no rule of its own, until the company has had a year.
    if (firstDue !== null ? firstDue > today : !item.due && addMonths(company.formationDate, 12) > today) return 'not_yet';
  } else if (!s.reached.has(item.stage)) {
    return 'not_yet';
  }
  // A rule that covers this entity type settles the condition: a Colorado company files the report. So does a report month
  // the owner set: a Delaware company with one has Colorado authority.
  const settled = item.due?.kind === 'report-window' && reportMonthKnown(item.due, company);
  if (item.applies_when && !settled) return 'if_applies';
  // With no entity type set, an item written for some types only can't be called a gap.
  return company.entityType === null && item.entity_types.length < BASELINE.vocabulary.entity_types.length ? 'if_applies' : 'missing';
}

/** A rule hanging on another item's documents is met by a filing, signed and dated, for each date, in order. */
const needsFiling = (item: ChecklistItem): boolean => item.due?.kind === 'after' && !item.due.from.includes(item.id);

/**
 * An item's dates by its rule. One filed after its date says so. One that repeats on its own documents or by the calendar
 * is never met: the next date moves on. With several people's dates, the room can't tell whose filing is whose, so it never
 * says done: a person checks.
 */
function ruleDated(item: ChecklistItem, title: string, ruleDates: readonly WorkedOut['dates'][number][], held: readonly MatchRow[], today: string): { dates: ServedDate[]; whose: boolean } {
  const whose = item.due?.kind === 'after' && item.due.pick === 'each' && ruleDates.length > 1;
  const filings = filingDates(held);
  const dates: ServedDate[] = [...ruleDates].sort((a, b) => a.date.localeCompare(b.date)).map((date, i) => {
    const filed = needsFiling(item) ? filings[i] : undefined;
    const state: DateState = filed === undefined ? dateState(date.date, today) : filed > date.date ? 'late' : whose ? 'check' : 'done';
    return { ...date, itemId: item.id, title, state, basis: state === 'late' ? `${date.basis} Filed ${filed}, after this date.` : date.basis };
  });
  return { dates, whose };
}

/** The dates a person entered by hand on a match. */
function handDated(item: ChecklistItem, title: string, held: readonly MatchRow[], today: string): ServedDate[] {
  return held.flatMap((match) => (match.next_date === null ? [] : [{ itemId: item.id, title, date: match.next_date, opens: null, state: dateState(match.next_date, today), basis: `Entered by hand on the match for ${match.name}.` }]));
}

/** The templates that fit this company's entity type, or every one while it isn't set. */
function serveTemplates(item: ChecklistItem, company: CompanyFacts): ServedItem['templates'] {
  const { labels } = BASELINE;
  return (item.templates ?? [])
    .filter((template) => company.entityType === null || template.entity_types.includes(company.entityType))
    .map((template) => ({
      title: template.title,
      href: `/templates/${template.path}`,
      source: template.source,
      version: template.version,
      lawChecked: template.law_checked,
      writtenFor: template.entity_types.map((word) => labels.entity_types[word] ?? word),
    }));
}

function serveItem(item: ChecklistItem, s: Standing): ServedItem {
  const { labels } = BASELINE;
  const title = s.titles.get(item.id) ?? item.title;
  const held = s.live.get(item.id) ?? [];
  const due = workOutDue(item, s.company, s.today, s.live, s.titles);
  const firstStatus = itemStatus(item, due.firstDue, s);
  // An item that doesn't apply shows no dates, and neither does one at a stage not reached. A yearly filing does, before
  // its first date: not a gap yet, but what a founder most wants to see coming.
  const showDates = firstStatus !== 'not_applicable' && (firstStatus !== 'not_yet' || item.stage === ONGOING);
  const { dates, whose } = ruleDated(item, title, showDates ? due.dates : [], held, s.today);
  // Signed isn't filed: until every date is met, the item still needs checking.
  const status = firstStatus === 'in_place' && needsFiling(item) && dates.some((date) => date.state !== 'done') ? 'check' : firstStatus;
  if (showDates) dates.push(...handDated(item, title, held, s.today));
  return {
    id: item.id,
    title,
    stage: item.stage,
    stageLabel: labels.stages[item.stage] ?? item.stage,
    relationship: item.relationship,
    relationshipLabel: labels.relationships[item.relationship] ?? item.relationship,
    status,
    repeats: item.repeats ?? null,
    deadline: item.deadline ?? null,
    note: item.note ?? null,
    appliesWhen: item.applies_when ?? null,
    why: item.why,
    evidence: item.evidence,
    providedBy: item.provided_by.map((word) => labels.providers[word] ?? word),
    sources: item.sources,
    templates: serveTemplates(item, s.company),
    // Every match on record, the removed ones too, so a file that left is visible rather than silently forgotten.
    matches: s.matches.filter((row) => row.item_id === item.id).map(serveMatch),
    dates,
    dateHint: whose && held.length > 0 ? "The room can't tell whose filing is whose. Check that each person has their own." : showDates ? due.hint : null,
    dateLabel: item.date_label ?? DEFAULT_DATE_LABEL,
  };
}

function countStatuses(list: readonly ServedItem[]): ChecklistCounts {
  return {
    in_place: list.filter((item) => item.status === 'in_place').length,
    check: list.filter((item) => item.status === 'check').length,
    missing: list.filter((item) => item.status === 'missing').length,
    if_applies: list.filter((item) => item.status === 'if_applies').length,
    not_applicable: list.filter((item) => item.status === 'not_applicable').length,
    not_yet: list.filter((item) => item.status === 'not_yet').length,
  };
}

/** The whole list as this company sees it. `today` is YYYY-MM-DD. */
export function buildChecklist(company: CompanyFacts, matches: readonly MatchRow[], notApplicable: readonly NotApplicableRow[], today: string): ChecklistView {
  const { labels, vocabulary } = BASELINE;
  const items = BASELINE.items.filter((item) => company.entityType === null || item.entity_types.includes(company.entityType));
  const titles = new Map(items.map((item) => [item.id, (company.entityType !== null && item.title_by_entity?.[company.entityType]) || item.title]));
  const live = new Map(items.map((item) => [item.id, matches.filter((row) => row.item_id === item.id && row.removed_at === null)]));
  const reached = reachedStages(items, live);
  const standing: Standing = { company, today, matches, live, titles, saidNo: new Set(notApplicable.map((row) => row.item_id)), reached };
  const served = items.map((item) => serveItem(item, standing));
  // The stages in time order, without `ongoing`, which runs beside them.
  const stages = vocabulary.stages.filter((stage) => stage !== ONGOING);
  return {
    notice: BASELINE.notice,
    templateNotice: BASELINE.template_notice,
    templateCardNotice: BASELINE.template_card_notice,
    templateLicenceNotice: BASELINE.template_licence_notice,
    status: BASELINE.status,
    drafted: BASELINE.drafted,
    scope: BASELINE.scope,
    today,
    entityLabel: company.entityType === null ? null : labels.entity_types[company.entityType] ?? company.entityType,
    formationDate: company.formationDate,
    reportMonth: isMonth(company.reportMonth) ? company.reportMonth : null,
    reachedStageLabels: stages.filter((stage) => reached.has(stage)).map((stage) => labels.stages[stage] ?? stage),
    counts: countStatuses(served),
    stages: vocabulary.stages.map((stage) => ({
      id: stage,
      label: labels.stages[stage] ?? stage,
      ...countStatuses(served.filter((item) => item.stage === stage)),
      reached: stage === ONGOING ? company.formationDate !== null : reached.has(stage),
    })),
    relationships: vocabulary.relationships.map((id) => ({ id, label: labels.relationships[id] ?? id })),
    items: served,
    dates: served.flatMap((item) => item.dates).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)),
  };
}

/** The small answer for a card on the Overview. */
export function checklistSummary(view: ChecklistView): ChecklistSummary {
  const { notice, status, entityLabel, formationDate, reportMonth, stages } = view;
  return { notice, status, entityLabel, formationDate, reportMonth, stages, nextDates: view.dates.filter((date) => date.state !== 'done').slice(0, SUMMARY_DATES) };
}
