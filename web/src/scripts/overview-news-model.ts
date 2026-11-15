// SPDX-License-Identifier: Apache-2.0
// Card P1a: the Overview's "Since your last visit" and Key documents, as pure functions over the API responses.
// No DOM here, so node --test covers it (overview-news-model.test.ts); overview-news-feed.ts draws the result.
import type { FolderNode } from './files-api.ts';

/** A document as GET /api/documents lists it after migration 0003 (worker/files-catalog.ts ListedDocument). */
export interface NewsDoc {
  id: string;
  name: string;
  kind: string;
  pages: number | null;
  updated_at: string;
  source: string;
  control_seq: number | null;
  key_at: string | null;
}

/** One row of GET /api/comments (worker/comments.ts FeedComment). */
export interface FeedComment {
  id: string;
  document_id: string;
  /** The thread's top-level comment; null on a top-level comment (R44). */
  parent_id?: string | null;
  /** The page the thread is anchored to, if any. */
  page?: number | null;
  /** With open=1: the newest created_at in the thread, and how many replies it has. */
  last_activity_at?: string;
  reply_count?: number;
  document_name: string;
  control_seq: number | null;
  author_name: string;
  created_at: string;
  resolved_at: string | null;
  excerpt: string;
}

/** One row of GET /api/uploads. */
export interface CounselUpload {
  id: string;
  name: string;
  kind: string;
  size: number;
  uploaded_at: string;
  uploaded_by: string | null;
  uploader_name: string | null;
  pulled: boolean;
}

// The visit rule moved to overview-news-visit.ts, which the Worker shares (POST /api/seen); kept here for importers.
export { FIRST_VISIT_DAYS, VISIT_GAP_MS, VISIT_KEY, newsCutoff, nextVisit, parseVisit, type Visit } from './overview-news-visit.ts';

/** Every file in the tree, folder guides excluded. */
export function flattenTree(root: FolderNode): NewsDoc[] {
  const out: NewsDoc[] = [];
  const walk = (node: FolderNode) => {
    for (const file of node.files) out.push(file as unknown as NewsDoc);
    for (const child of node.folders) walk(child);
  };
  walk(root);
  return out;
}

const newestFirst = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

/** Mirrored documents added or changed after the cutoff, newest first. Counsel uploads have their own column. */
export function newDocuments(docs: readonly NewsDoc[], cutoff: string): NewsDoc[] {
  return docs
    .filter((doc) => doc.source !== 'counsel' && doc.updated_at > cutoff)
    .sort((a, b) => newestFirst(a.updated_at, b.updated_at));
}

/** Counsel uploads after the cutoff, newest first. */
export function newUploads(uploads: readonly CounselUpload[], cutoff: string): CounselUpload[] {
  return uploads.filter((upload) => upload.uploaded_at > cutoff).sort((a, b) => newestFirst(a.uploaded_at, b.uploaded_at));
}

/** The `legallas:key` event detail the exhibit pane sends after a Key change. */
export interface KeyChange {
  id: string;
  key_at: string | null;
}

/** Applies a Key change to the listed documents; false when the event is malformed or names no listed document. */
export function applyKey(docs: NewsDoc[], change: unknown): boolean {
  const detail = change as Partial<KeyChange> | null;
  if (!detail || typeof detail.id !== 'string' || !(detail.key_at === null || typeof detail.key_at === 'string')) return false;
  const doc = docs.find((d) => d.id === detail.id);
  if (!doc) return false;
  doc.key_at = detail.key_at;
  return true;
}

/** Documents marked Key, in control-number order (unnumbered last, then by name). */
export function keyDocuments(docs: readonly NewsDoc[]): NewsDoc[] {
  const seq = (doc: NewsDoc) => doc.control_seq ?? Number.MAX_SAFE_INTEGER;
  return docs.filter((doc) => doc.key_at).sort((a, b) => seq(a) - seq(b) || a.name.localeCompare(b.name));
}

/** When a thread last moved: its newest reply, or the comment itself. */
export function lastActivity(thread: FeedComment): string {
  return thread.last_activity_at ?? thread.created_at;
}

/** Open discussions: unresolved top-level comments (threads), most recent activity first (R44). */
export function openThreads(comments: readonly FeedComment[]): FeedComment[] {
  return comments
    .filter((comment) => !comment.parent_id && !comment.resolved_at)
    .sort((a, b) => newestFirst(lastActivity(a), lastActivity(b)));
}

/** "214 pp.", "1 p.", or '' when the page count is unknown. */
export function pagesText(pages: number | null | undefined): string {
  if (typeof pages !== 'number' || !Number.isInteger(pages) || pages < 1) return '';
  return pages === 1 ? '1 p.' : `${pages} pp.`;
}

/** The local calendar day of an instant as a partial ISO date ("2026-09-24"), for formatPartialDate. */
export function localDay(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
