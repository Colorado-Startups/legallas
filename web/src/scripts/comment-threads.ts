// SPDX-License-Identifier: Apache-2.0
// Comment threads as the discussion panel shows them (card P6; R44): pure helpers, no DOM.

/** A comment as GET /api/documents/:id/comments returns it. parent_id and page arrive with migration 0004. */
export interface ThreadComment {
  id: string;
  parent_id?: string | null;
  page?: number | null;
  author_email: string;
  author_name: string | null;
  body: string;
  created_at: string;
  /** For a reply, its thread's state: resolving the top-level comment covers the replies. */
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_by_name: string | null;
}

/** A comment thread: its first comment and the replies to it. */
export interface CommentThreadGroup {
  head: ThreadComment;
  replies: ThreadComment[];
}

/**
 * Top-level comments in order, each with its replies in order. A reply whose parent is missing (or a server
 * without threads, which sends no parent_id) stands as its own thread, so nothing is ever dropped.
 */
export function groupThreads(comments: readonly ThreadComment[]): CommentThreadGroup[] {
  const ids = new Set(comments.map((c) => c.id));
  const groups = new Map<string, CommentThreadGroup>();
  const order: CommentThreadGroup[] = [];
  for (const comment of comments) {
    const parent = comment.parent_id ?? null;
    if (parent && ids.has(parent) && parent !== comment.id) continue;
    const group = { head: comment, replies: [] };
    groups.set(comment.id, group);
    order.push(group);
  }
  for (const comment of comments) {
    const parent = comment.parent_id ?? null;
    if (parent && parent !== comment.id) groups.get(parent)?.replies.push(comment);
  }
  return order;
}

/** "MC" for Morgan Chen; the first two letters of the address when there is no name. */
export function initials(name: string): string {
  const words = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  const first = words[0] ?? '?';
  const last = words.at(-1) ?? '';
  const letters = words.length > 1 ? `${first.charAt(0)}${last.charAt(0)}` : first.slice(0, 2);
  return letters.toUpperCase();
}
