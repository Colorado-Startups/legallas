// SPDX-License-Identifier: Apache-2.0
// Where counsel's approved drafts land (docs/design/propose-and-approve.md, Decision 3; card 6.2). Counsel has no company
// folder, so a draft counsel approves from their own AI becomes a counsel document in the room: a Markdown file under
// From counsel, as if counsel had uploaded it. Counsel's documents are never indexed, so Ask can't cite it as evidence,
// and the owner's sync brings it down to the inbox like any counsel upload.
import { draftText, type DraftRow } from './draft-text.ts';
import type { Member } from './env.ts';
import { NEXT_CONTROL_SEQ_SQL } from './files-catalog.ts';
import { sanitizeUploadName } from './files-upload.ts';

const MARKDOWN = 'text/markdown; charset=utf-8';

/** Stores counsel's own approved draft `id` as a counsel document. Nothing for anyone else's approval. */
export async function landCounselDraft(env: { DB: D1Database; FILES: R2Bucket }, approver: Member, id: string, now: Date): Promise<void> {
  if (approver.role !== 'counsel') return;
  // A visual lands in the binder instead (proposal-visual.ts), never as a document.
  const row = await env.DB.prepare(
    "SELECT * FROM proposals p WHERE id = ?1 AND kind = 'draft_document' AND status = 'approved' AND proposed_by = ?2 " +
      'AND NOT EXISTS (SELECT 1 FROM proposal_visuals v WHERE v.proposal_id = p.id)',
  )
    .bind(id, approver.email)
    .first<DraftRow>();
  if (!row) return;
  const bytes = new TextEncoder().encode(draftText(row));
  const name = sanitizeUploadName(`${row.final_title ?? row.title} (draft).md`) ?? 'Approved draft.md';
  const docId = crypto.randomUUID();
  const r2Key = crypto.randomUUID();
  await env.FILES.put(r2Key, bytes, { httpMetadata: { contentType: MARKDOWN } });
  try {
    await env.DB.prepare(
      'INSERT INTO documents (id, path, folder, name, kind, content_type, size, sha256, pages, r2_key, source, uploaded_by, updated_at, control_seq) ' +
        `VALUES (?1, ?2, ?3, ?4, 'markdown', ?5, ?6, ?7, NULL, ?8, 'counsel', ?9, ?10, ${NEXT_CONTROL_SEQ_SQL})`,
    )
      .bind(docId, `from-counsel/${docId}/${name}`, `from-counsel/${docId}`, name, MARKDOWN, bytes.byteLength, await sha256(bytes), r2Key, approver.email, now.toISOString())
      .run();
  } catch (error) {
    await env.FILES.delete(r2Key);
    throw error;
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
