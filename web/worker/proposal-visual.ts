// SPDX-License-Identifier: Apache-2.0
// A visual saved by a member's AI (docs/design/propose-and-approve.md, "Visuals"). The AI sends a self-contained HTML
// page it built (a kit's grid, board or chronology, or a Claude artifact) with legallas_propose_draft `visual: true`;
// the member approves it in the room; it lands in the binder.
//
// | Step | What holds |
// |---|---|
// | Propose | A draft_document proposal with the HTML as its body, so every proposal rule and limit holds, plus one proposal_visuals row (migration 0027). Counsel's saves are privileged unless the AI says otherwise |
// | Review | The page as it would land, prepared on the fly, in the sandboxed frame |
// | Approve | worker/visualprep.ts prepares it (bridge, no network, room /doc/ links become cites) and the page is written once, in the approving batch, only when the approval took effect |
// | Binder | /api/visuals adds the section SAVED_SECTION while PROPOSALS_ENABLED is "1". Never a document: not in the index, Ask or an AI's reads |
import { CONTROL_PREFIX_FALLBACK } from '../src/scripts/control-prefix.ts';
import { canPerform, isRoomReader } from './auth.ts';
import type { Role } from './env.ts';
import { NOT_HIDDEN_SQL } from './files-catalog.ts';
import { privilegeFilter } from './privilege.ts';
import { STORED_NAME } from './stored-name.ts';
import { prepareVisual, type ResolveCite } from './visualprep.ts';
import type { RoomBinder, RoomSection, RoomVisual } from './visuals.ts';

/** The largest prepared page, matching migration 0027's CHECK. */
export const VISUAL_PAGE_MAX = 120_000;

/** The binder section saved visuals land in. Has a "_", which a manifest slug never has (worker/visuals.ts). */
export const SAVED_SECTION = 'ai_saved';

/** Saved visuals the binder lists, newest first. */
export const SAVED_LIMIT = 100;

/** The binder slug of one saved visual. */
export function savedSlug(id: string): string {
  return `ai_${id}`;
}

/** Where the room's frame loads one visual proposal: its preview while pending, its page once approved. */
export function visualSrc(id: string): string {
  return `/api/proposals/${encodeURIComponent(id)}/visual`;
}

/** Whether a save is privileged when the AI does not say: counsel's work product is, the owner's is not. */
export function privilegedByDefault(role: Role): boolean {
  return role !== 'owner';
}

/** The room a page is prepared for: its host (links to it are the room's own) and its control prefix. */
export interface VisualRoom {
  host: string;
  prefix: string;
}

export function visualRoom(env: { CONTROL_PREFIX?: string }, url: URL): VisualRoom {
  const prefix = env.CONTROL_PREFIX ?? '';
  return { host: url.host, prefix: /^[A-Z]{2,6}$/.test(prefix) ? prefix : CONTROL_PREFIX_FALLBACK };
}

// The query before id= is bounded, so a page of repeated "/doc/?" scans in linear time, not quadratic.
const DOC_ID = /\/doc\/?\?(?:[^"'<>\s#]{0,512}?&(?:amp;)?)?id=([A-Za-z0-9_-]{1,64})/g;
const MAX_LINKED = 500;

/** The document ids a page links to through the room's /doc/ page, once each, at most MAX_LINKED. */
export function linkedDocumentIds(html: string): string[] {
  const ids = new Set<string>();
  for (const match of html.matchAll(DOC_ID)) {
    ids.add(match[1]!);
    if (ids.size >= MAX_LINKED) break;
  }
  return [...ids];
}

/** Turns a link to this room's /doc/ page (absolute or relative) into "<prefix>-000412@3", for a numbered document. */
export function docCites(room: VisualRoom, seqById: ReadonlyMap<string, number>): ResolveCite {
  return (href) => {
    let url: URL;
    try {
      url = new URL(href, `https://${room.host}/`);
    } catch {
      return null;
    }
    if (url.host !== room.host || !/^\/doc\/?$/.test(url.pathname)) return null;
    const seq = seqById.get(url.searchParams.get('id') ?? '');
    if (!seq) return null;
    const page = Number(/^#page=(\d{1,5})$/.exec(url.hash)?.[1] ?? url.searchParams.get('page') ?? '');
    return `${room.prefix}-${String(seq).padStart(6, '0')}${Number.isInteger(page) && page > 0 ? `@${page}` : ''}`;
  };
}

/**
 * The page the room serves for proposal `id`'s HTML, prepared for a viewer with `role`: cites only to numbered documents
 * that role may see. Null when the prepared page is over VISUAL_PAGE_MAX.
 */
export async function prepareProposedVisual(db: D1Database, role: Role, html: string, id: string, room: VisualRoom): Promise<string | null> {
  const ids = linkedDocumentIds(html);
  const seqById = new Map<string, number>();
  if (ids.length) {
    const { results } = await db
      .prepare(
        'SELECT id, control_seq FROM documents WHERE id IN (SELECT value FROM json_each(?1)) AND control_seq IS NOT NULL ' +
          `AND removed_at IS NULL AND ${NOT_HIDDEN_SQL}${privilegeFilter(role)}`,
      )
      .bind(JSON.stringify(ids))
      .all<{ id: string; control_seq: number }>();
    for (const row of results) seqById.set(row.id, row.control_seq);
  }
  const { html: page } = prepareVisual(html, { artifact: id, path: 'index.html' }, () => null, STORED_NAME, docCites(room, seqById));
  return page.length <= VISUAL_PAGE_MAX ? page : null;
}

/** The approving batch's write: the prepared page, once, only when this decision's UPDATE took effect. */
export function visualApply(db: D1Database, id: string, decision: string, page: string): D1PreparedStatement {
  return db
    .prepare('UPDATE proposal_visuals SET page = ?3 WHERE proposal_id = ?1 AND page IS NULL AND EXISTS (SELECT 1 FROM proposals WHERE id = ?1 AND decision_id = ?2)')
    .bind(id, decision, page);
}

/**
 * The approved, prepared saved visuals `role` may see: all of them for a role with viewPrivileged; otherwise those not
 * privileged that cite no privileged document. A room guest sees none.
 */
function savedWhere(role: Role): string | null {
  if (isRoomReader(role) || !canPerform(role, 'view')) return null;
  const privileged = canPerform(role, 'viewPrivileged')
    ? ''
    : " AND v.privileged = 0 AND NOT EXISTS (SELECT 1 FROM proposal_sources s JOIN documents d ON d.id = s.document_id WHERE s.proposal_id = p.id AND d.path LIKE '%privileged%')";
  return `p.status = 'approved' AND v.page IS NOT NULL${privileged}`;
}

/** One saved visual as the binder lists it. */
export interface SavedVisual {
  id: string;
  title: string;
  proposed_by: string;
  via: string | null;
  decided_at: string;
  privileged: boolean;
}

export async function savedVisuals(db: D1Database, role: Role): Promise<SavedVisual[]> {
  const where = savedWhere(role);
  if (!where) return [];
  const { results } = await db
    .prepare(
      'SELECT p.id, coalesce(p.final_title, p.title) AS title, p.proposed_by, p.via, p.decided_at, v.privileged ' +
        `FROM proposal_visuals v JOIN proposals p ON p.id = v.proposal_id WHERE ${where} ORDER BY p.decided_at DESC, p.id LIMIT ${SAVED_LIMIT}`,
    )
    .all<Omit<SavedVisual, 'privileged'> & { privileged: number }>();
  return results.map((row) => ({ ...row, privileged: row.privileged === 1 }));
}

/** The approved page of saved visual `id`, if `role` may see it in the binder; else null. */
export async function savedPage(db: D1Database, role: Role, id: string): Promise<string | null> {
  const where = savedWhere(role);
  if (!where) return null;
  const row = await db
    .prepare(`SELECT v.page FROM proposal_visuals v JOIN proposals p ON p.id = v.proposal_id WHERE v.proposal_id = ?1 AND ${where}`)
    .bind(id)
    .first<{ page: string }>();
  return row?.page ?? null;
}

const SECTION: Omit<RoomSection, 'visuals'> = {
  slug: SAVED_SECTION,
  label: 'AI',
  title: 'Saved by AI',
  summary: 'Work products a member’s AI saved and that member approved.',
  accent: 'ink',
  icon: 'quill',
};

/** The binder with the saved visuals as its last section; unchanged when there are none. */
export function withSaved(binder: RoomBinder, saved: readonly SavedVisual[]): RoomBinder {
  if (saved.length === 0) return binder;
  const visuals: RoomVisual[] = saved.map((v) => ({
    slug: savedSlug(v.id),
    id: v.id,
    section: SAVED_SECTION,
    title: v.title,
    summary: `${v.privileged ? 'Marked privileged. ' : ''}Saved by ${v.proposed_by}${v.via ? ` through ${v.via}` : ''}, ${v.decided_at.slice(0, 10)}.`,
    overview: false,
    src: visualSrc(v.id),
    privileged: v.privileged,
  }));
  return {
    sections: [...binder.sections, { ...SECTION, visuals: visuals.map((v) => v.slug) }],
    visuals: [...binder.visuals, ...visuals],
  };
}
