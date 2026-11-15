// SPDX-License-Identifier: Apache-2.0
// legallas_case_overview's checklist section: the company checklist (worker/checklist.ts, docs/checklist/baseline.toml)
// as the room's /checklist/ page shows it to the caller's role. One entry per item: its status, each due date with its
// state and how it was worked out, what a complete copy looks like while the item is still open, and the documents
// matched to it as cites. Listed only while the room's CHECKLIST_ENABLED is "1" (overview.ts inputSchemaFor). A connected
// AI reads it here and proposes a change with legallas_propose_checklist.
import { buildChecklist, checklistEnabled, type ChecklistStatus, type ServedItem } from '../../worker/checklist.ts';
import { readMatches, readNotApplicable } from '../../worker/checklist-store.ts';
import { readCompany } from '../../worker/company-settings.ts';
import { ROOM_ORIGIN, type ToolContext } from '../contract.ts';
import { caseField, docLink, formatControl } from '../format.ts';

/** The room's page for one item: /checklist/ opens the item its hash names (src/scripts/checklist.ts openLinked). */
export function checklistLink(id: string): string {
  return `${ROOM_ORIGIN}/checklist/#${encodeURIComponent(id)}`;
}

/**
 * The calendar day at `now` in the room's TIME_ZONE, UTC when unset or unknown: worker/routes/checklist.ts roomToday's
 * rule (overview-checklist.test.ts holds them equal), so a date reads as passed on the same day here as in the room.
 */
export function roomDay(timeZone: string | undefined, now: Date): string {
  const day = (zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  try {
    return day(timeZone || 'UTC');
  } catch {
    return day('UTC');
  }
}

/** Statuses a match can no longer change: the entry leaves out what a complete copy looks like. */
const SETTLED: ReadonlySet<ChecklistStatus> = new Set(['in_place', 'not_applicable']);

/**
 * One item. A due date's basis can name a matched document, so it is judged like any field a document's author controls
 * (format.ts caseField). A match whose file left the room is not a cite: the room shows it, this leaves it out.
 */
export function checklistEntry(item: ServedItem, prefix: string | undefined): Record<string, unknown> {
  return {
    id: item.id,
    title: item.title,
    stage: item.stage,
    status: item.status,
    due: item.dates.map((d) => ({ date: d.date, ...(d.opens ? { opens: d.opens } : {}), state: d.state, basis: caseField(d.basis) })),
    ...(item.dateHint ? { dateHint: item.dateHint } : {}),
    ...(SETTLED.has(item.status) ? {} : { evidence: item.evidence }),
    cites: item.matches
      .filter((match) => match.href !== null)
      .map((match) => ({
        control: formatControl(prefix, match.control),
        doc: match.documentId,
        link: docLink(match.documentId),
        ...(match.signed ? { signed: match.signed } : {}),
        ...(match.date ? { date: match.date } : {}),
      })),
    link: checklistLink(item.id),
  };
}

/** Every item as the caller's role sees it, in the list's order; null while the room's checklist is off. */
export async function checklistEntries(ctx: ToolContext): Promise<Record<string, unknown>[] | null> {
  if (!checklistEnabled(ctx.env)) return null;
  // The company's facts as the room owner last set them on /checklist/, so the AI's dates match the page's.
  const [matches, notApplicable, company] = await Promise.all([readMatches(ctx.env.DB, ctx.member.role), readNotApplicable(ctx.env.DB), readCompany(ctx.env.DB)]);
  const view = buildChecklist(company, matches, notApplicable, roomDay(ctx.env.TIME_ZONE, ctx.now));
  return view.items.map((item) => checklistEntry(item, ctx.env.CONTROL_PREFIX));
}
