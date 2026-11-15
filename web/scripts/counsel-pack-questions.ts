// SPDX-License-Identifier: Apache-2.0
// The optional "Questions for your lawyer" file of a counsel pack (`--questions`). The same text the room's download gives
// (worker/checklist-questions.ts), built from D1 rows the way the room reads them (worker/checklist-store.ts), so a firm that
// can't reach the room still gets the checklist's open points. Pure: the caller reads D1 and writes the file.
import { questionsPack } from '../worker/checklist-questions.ts';
import { buildChecklist, companyFacts, type CompanyFacts, type MatchRow, type NotApplicableRow, type SignedState } from '../worker/checklist.ts';
import { configuredCompany, NEWEST_COMPANY_SQL } from '../worker/company-settings.ts';
import { NOT_HIDDEN_SQL } from '../worker/files-catalog.ts';

/** Every match on a document in the room, the removed ones too, as the room reads them. */
export const PACK_MATCHES_SQL =
  'SELECT m.id, m.item_id, m.document_id, d.name, d.path, d.folder, d.source, d.control_seq, d.removed_at, ' +
  'm.signed, m.doc_date, m.next_date, m.parties, m.amount, m.matched_by ' +
  'FROM checklist_matches m JOIN documents d ON d.id = m.document_id ' +
  `WHERE d.${NOT_HIDDEN_SQL} ORDER BY m.matched_at, m.id;`;

export const PACK_NOT_APPLICABLE_SQL = 'SELECT item_id, decided_by FROM checklist_not_applicable;';

/** The company's facts as the room owner last set them (worker/company-settings.ts); none saved yet, the room config's. */
export const PACK_COMPANY_SQL = `${NEWEST_COMPANY_SQL};`;

const SIGNED: readonly string[] = ['yes', 'no', 'not_needed'];
const str = (raw: Record<string, unknown>, key: string): string | null => (typeof raw[key] === 'string' ? (raw[key] as string) : null);

/** A D1 row as a match, or null when malformed. Counsel may see every document (auth.ts viewPrivileged), so no path is left out; importing privilege.ts would pull Worker types into scripts. */
export function matchRow(raw: Record<string, unknown>): MatchRow | null {
  const [id, itemId, documentId, name, path, matchedBy] = ['id', 'item_id', 'document_id', 'name', 'path', 'matched_by'].map((key) => str(raw, key));
  if (id === null || itemId === null || documentId === null || name === null || path === null || matchedBy === null) return null;
  const signed = str(raw, 'signed');
  return {
    id,
    item_id: itemId,
    document_id: documentId,
    name,
    folder: str(raw, 'folder') ?? '',
    source: str(raw, 'source') ?? 'mirror',
    control_seq: typeof raw.control_seq === 'number' ? raw.control_seq : null,
    removed_at: str(raw, 'removed_at'),
    signed: signed !== null && SIGNED.includes(signed) ? (signed as SignedState) : null,
    doc_date: str(raw, 'doc_date'),
    next_date: str(raw, 'next_date'),
    parties: str(raw, 'parties'),
    amount: str(raw, 'amount'),
    matched_by: matchedBy,
  };
}

export function notApplicableRow(raw: Record<string, unknown>): NotApplicableRow | null {
  const itemId = str(raw, 'item_id');
  return itemId === null ? null : { item_id: itemId, decided_by: str(raw, 'decided_by') ?? '' };
}

/** The newest company_settings row as the facts in force, or the room config's while nothing is saved. A value the list can't use counts as unset. */
export function companyRow(rows: readonly Record<string, unknown>[]): Required<CompanyFacts> {
  const raw = rows[0];
  if (raw === undefined) return configuredCompany();
  return companyFacts({ entityType: str(raw, 'entity_type'), formationDate: str(raw, 'formation_date'), reportMonth: typeof raw.report_month === 'number' ? raw.report_month : null });
}

/** The file's text: `today` is YYYY-MM-DD, `prefix` the room's control prefix, `company` the PACK_COMPANY_SQL rows. */
export function questionsText(matches: readonly Record<string, unknown>[], notApplicable: readonly Record<string, unknown>[], today: string, prefix: string, company: readonly Record<string, unknown>[] = []): string {
  const view = buildChecklist(
    companyRow(company),
    matches.map(matchRow).filter((row): row is MatchRow => row !== null),
    notApplicable.map(notApplicableRow).filter((row): row is NotApplicableRow => row !== null),
    today,
  );
  return questionsPack(view, prefix);
}
