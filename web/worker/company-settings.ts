// SPDX-License-Identifier: Apache-2.0
// The company's own facts, which pick the checklist's items and work out its dates (worker/checklist.ts): entity type,
// formation date and Colorado periodic report month. The room owner sets them on /checklist/ (routes/checklist.ts, auth.ts
// setCompany), with no redeploy. Until the first save, the room config's entityType and formationDate stand
// (room-settings.ts). Each save is a new row of company_settings (migration 0030), never changed: the newest is the
// setting, the rest say who set what, and when.
import { BASELINE } from './checklist-baseline.ts';
import { companyFacts, isDay, isMonth, type ChecklistView, type CompanyFacts } from './checklist.ts';
import { companyEntityType, companyFormationDate } from './room-settings.ts';

/** The three facts, each null while unset. */
export type CompanySettings = Required<CompanyFacts>;

/** The facts in force, and who saved them last and when: both null while they are still the room config's. */
export interface CompanyRecord extends CompanySettings {
  setBy: string | null;
  setAt: string | null;
}

/** What /api/checklist says about the company, for the page's form. */
export interface CompanyView extends CompanyRecord {
  /** Whether this member may change the facts (auth.ts setCompany): the room owner only. */
  editable: boolean;
  /** The entity types the list knows, in its own order. */
  entityTypes: { id: string; label: string }[];
}

/** What GET /api/checklist and PUT /api/checklist/company answer: the list, and the facts it was worked out from. */
export type ServedChecklist = ChecklistView & { company: CompanyView };

interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

/** The parts of D1 this file uses; D1Database fits. No Workers types, so the counsel pack's script check reads this file too. */
export interface CompanyDb {
  prepare(sql: string): Statement;
}

interface CompanyRow {
  entity_type: string | null;
  formation_date: string | null;
  report_month: number | null;
  set_by: string;
  set_at: string;
}

/** The newest save: the facts in force. scripts/counsel-pack-questions.ts reads the same row. */
export const NEWEST_COMPANY_SQL = 'SELECT entity_type, formation_date, report_month, set_by, set_at FROM company_settings ORDER BY id DESC LIMIT 1';

/** The room config's facts: what the room was built with. It has no report month. */
export function configuredCompany(): CompanySettings {
  return companyFacts({ entityType: companyEntityType, formationDate: companyFormationDate, reportMonth: null });
}

/** A saved row as the facts in force, or the room config's while nothing is saved. A value the list can't use counts as unset. */
export function companyRecord(row: CompanyRow | null): CompanyRecord {
  if (row === null) return { ...configuredCompany(), setBy: null, setAt: null };
  return {
    ...companyFacts({ entityType: row.entity_type, formationDate: row.formation_date, reportMonth: row.report_month }),
    setBy: row.set_by,
    setAt: row.set_at,
  };
}

/** The facts in force now. */
export async function readCompany(db: CompanyDb): Promise<CompanyRecord> {
  return companyRecord(await db.prepare(NEWEST_COMPANY_SQL).first<CompanyRow>());
}

/** The entity types for the form, in the list's order, with their labels. */
export function entityTypeOptions(): { id: string; label: string }[] {
  return BASELINE.vocabulary.entity_types.map((id) => ({ id, label: BASELINE.labels.entity_types[id] ?? id }));
}

function nextDay(day: string): string {
  const date = new Date(day);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * The body of a save, checked. Only the facts sent: one left out keeps what's in force, one sent empty or null clears it.
 * A formation date is a filing date, so it can't be later than tomorrow, as with a match's date filed. Names the first
 * field it can't use.
 */
export function parseCompanyInput(raw: Record<string, unknown>, today: string): { ok: true; value: Partial<CompanySettings> } | { ok: false; field: string } {
  const value: Partial<CompanySettings> = {};
  if ('entityType' in raw) {
    const entityType = raw.entityType ?? '';
    if (entityType === '') value.entityType = null;
    else if (typeof entityType === 'string' && BASELINE.vocabulary.entity_types.includes(entityType)) value.entityType = entityType;
    else return { ok: false, field: 'entityType' };
  }
  if ('formationDate' in raw) {
    const formationDate = raw.formationDate ?? '';
    if (formationDate === '') value.formationDate = null;
    else if (isDay(formationDate) && formationDate <= nextDay(today)) value.formationDate = formationDate;
    else return { ok: false, field: 'formationDate' };
  }
  if ('reportMonth' in raw) {
    const sent = raw.reportMonth ?? '';
    // A form's select sends text; a script may send the number.
    const month = typeof sent === 'string' && /^\d{1,2}$/.test(sent) ? Number(sent) : sent;
    if (month === '') value.reportMonth = null;
    else if (isMonth(month)) value.reportMonth = month;
    else return { ok: false, field: 'reportMonth' };
  }
  return { ok: true, value };
}

const same = (a: CompanySettings, b: CompanySettings) => a.entityType === b.entityType && a.formationDate === b.formationDate && a.reportMonth === b.reportMonth;

/**
 * Puts the facts sent on top of those in force and saves the result as a new row, written by `member`. The caller checks
 * the role. Saving what a saved row already says writes nothing, so a second press of Save adds no row; the first save
 * always writes, even of the room config's own values, so a later config change can't move them. Returns the facts in force.
 */
export async function saveCompany(db: CompanyDb, member: { email: string }, input: Partial<CompanySettings>, now: Date): Promise<CompanyRecord> {
  const current = await readCompany(db);
  const next: CompanySettings = {
    entityType: input.entityType !== undefined ? input.entityType : current.entityType,
    formationDate: input.formationDate !== undefined ? input.formationDate : current.formationDate,
    reportMonth: input.reportMonth !== undefined ? input.reportMonth : current.reportMonth,
  };
  if (current.setBy !== null && same(current, next)) return current;
  const at = now.toISOString();
  await db
    .prepare('INSERT INTO company_settings (entity_type, formation_date, report_month, set_by, set_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(next.entityType, next.formationDate, next.reportMonth, member.email, at)
    .run();
  return { ...next, setBy: member.email, setAt: at };
}
