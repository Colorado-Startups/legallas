// SPDX-License-Identifier: Apache-2.0
// The discussion panel (CommentThread.astro; card P6). Each [data-comment-thread] loads its thread whenever its
// data-document-id is set or changes, so a page can fill the id in after reading its URL.
//
// Threads are one level deep (R44): a top-level comment with its replies, a Reply box while it is open, and
// Resolve on the top-level comment only (it covers the replies). Resolved threads fold under "N resolved". A
// comment may carry the page it was written on ("at page 3"); the composer tags new comments with the page in
// view when the page reports one (event `legallas:page`, detail {page}), and Clear page drops the tag. Whether
// the server threads is read from its response: rows without parent_id give flat threads, no Reply, no page tag.
//
// A page may hand the panel a control-number index (event `legallas:controls`, detail Map<number, id>) so cites
// written in a comment ("DOE-000233 at 1") link: to the page in view for this document, or to the exhibit pane
// (loaded on first use) for any other.
//
// Comments are plain text: every value from the server goes in as a text node (through el(), which appends
// strings as text). Nothing is parsed as HTML or Markdown.
import { el } from './dom-el.ts';
import { groupThreads, initials, type ThreadComment } from './comment-threads.ts';
import { findCites } from './doc-nav.ts';
import { docHref, docTarget } from './files-api.ts';
import { formatDateTime } from './files-format.ts';
import { controlPrefix } from './doc-facts.ts';
import { meCan } from './room-me.ts';

const MAX_COMMENT = 10_000;
const WARN_AT = 9_000;

interface Thread {
  comments: ThreadComment[];
  can: { comment: boolean; resolve: boolean };
}

const MESSAGES: Record<string, string> = {
  empty_comment: 'Write something before posting.',
  comment_too_long: `Comments can be up to ${MAX_COMMENT.toLocaleString('en-US')} characters.`,
  invalid_comment: 'That comment has characters the room cannot store; retype it and try again.',
  pii_in_comment: 'Comments cannot hold a Social Security number; take it out and post again.',
  invalid_parent: 'That thread is no longer open for replies.',
  invalid_page: 'That page is not in this document.',
  not_top_level: 'Only a whole thread can be resolved.',
  not_found: 'This file is no longer in the room.',
  forbidden: 'You cannot do that in this room.',
};

/** "Oct. 6, 2026, 3:14 PM" in the reader's time zone (Q2's formatter), with the UTC instant as the title. */
function time(iso: string): HTMLTimeElement {
  const node = el('time', { datetime: iso, title: `${iso.replace('T', ' ').slice(0, 19)} UTC` });
  node.textContent = formatDateTime(iso);
  return node;
}

function characters(text: string): number {
  return [...text].length;
}

async function call<T>(url: string, init?: RequestInit): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, { credentials: 'same-origin', ...init });
    const body = (await response.json().catch(() => ({}))) as T & { error?: string };
    return response.ok ? { ok: true, value: body } : { ok: false, error: body.error ?? `http_${response.status}` };
  } catch {
    return { ok: false, error: 'network' };
  }
}

function message(error: string, fallback: string): string {
  return MESSAGES[error] ?? fallback;
}

/** Plain clicks on a cite to another document open it in the exhibit pane, which loads on first use. */
function openInPane(event: MouseEvent): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a[data-exhibit]');
  const target = link ? docTarget(link.getAttribute('href') ?? '', location.href) : null;
  if (!link || !target) return;
  event.preventDefault();
  void import('./exhibit-pane.ts').then(({ openExhibit }) => openExhibit({ ...target, opener: link }));
}

class CommentPanel {
  private readonly root: HTMLElement;
  private readonly parts: Record<'list' | 'empty' | 'resolved' | 'resolvedLabel' | 'resolvedList' | 'status' | 'count' | 'remaining' | 'error' | 'label' | 'clear', HTMLElement>;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLTextAreaElement;
  private documentId: string | null = null;
  private comments: ThreadComment[] = [];
  private controls: ReadonlyMap<number, string> = new Map();
  private page: number | null = null;
  private pageCleared = false;
  private threaded = false;
  private can = { comment: false, resolve: false };
  private loads = 0;

  constructor(root: HTMLElement) {
    const part = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-comments-${name}]`)!; // safe: CommentThread.astro renders every part
    this.root = root;
    this.parts = {
      list: part('list'), empty: part('empty'), resolved: part('resolved'), resolvedLabel: part('resolved-label'),
      resolvedList: part('resolved-list'), status: part('status'), count: part('count'), remaining: part('remaining'),
      error: part('error'), label: part('label'), clear: part('clear'),
    };
    this.form = part<HTMLFormElement>('form');
    this.input = part<HTMLTextAreaElement>('input');

    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.post();
    });
    this.input.addEventListener('input', () => this.updateRemaining());
    root.addEventListener('click', openInPane);
    root.addEventListener('legallas:controls', (event) => {
      this.controls = (event as CustomEvent<ReadonlyMap<number, string>>).detail;
      if (this.comments.length > 0) this.render();
    });
    root.addEventListener('legallas:page', (event) => {
      const page = (event as CustomEvent<{ page: number | null }>).detail.page;
      this.page = Number.isInteger(page) && page! > 0 ? page : null; // safe: checked as an integer
      this.pageCleared = false;
      this.updateLabel();
    });
    this.parts.clear.addEventListener('click', () => {
      this.pageCleared = true;
      this.updateLabel();
      this.input.focus();
    });
    new MutationObserver(() => this.sync()).observe(root, { attributes: true, attributeFilter: ['data-document-id'] });
    this.sync();
  }

  /** The page a new comment is tagged with: the page in view, unless cleared or the server does not thread. */
  private tagPage(): number | null {
    return this.threaded && !this.pageCleared ? this.page : null;
  }

  private updateLabel(): void {
    const page = this.tagPage();
    const label = page ? `New comment on page ${page}` : 'New comment';
    this.parts.label.textContent = label;
    this.input.setAttribute('aria-label', label);
    this.parts.clear.hidden = page === null;
  }

  private sync(): void {
    const id = this.root.dataset.documentId?.trim() || null;
    if (id === this.documentId) return;
    this.documentId = id;
    if (id) void this.load(id);
  }

  private url(): string {
    return `/api/documents/${encodeURIComponent(this.documentId ?? '')}/comments`;
  }

  private async load(id: string): Promise<void> {
    const load = ++this.loads;
    // A member who may not read comments never sees the panel, so do not ask for the thread at all.
    if (!(await meCan('readComments'))) return;
    this.parts.status.textContent = 'Opening the discussion.';
    const result = await call<Thread>(this.url());
    if (load !== this.loads || id !== this.documentId) return; // a newer document took over
    if (!result.ok) {
      for (const hide of [this.parts.list, this.parts.empty, this.parts.resolved, this.form]) hide.hidden = true;
      this.parts.status.textContent = message(result.error, 'The discussion did not load; reload the page to try again.');
      return;
    }
    this.parts.status.textContent = '';
    this.comments = result.value.comments;
    this.threaded = this.comments.length === 0 || this.comments.some((c) => 'parent_id' in c);
    this.can = result.value.can;
    this.updateLabel();
    this.form.hidden = !this.can.comment;
    this.render();
  }

  private render(): void {
    const threads = groupThreads(this.comments);
    const open = threads.filter((t) => t.head.resolved_at === null);
    const resolved = threads.filter((t) => t.head.resolved_at !== null);
    const { list, empty, resolvedList, resolvedLabel, count } = this.parts;
    list.replaceChildren(...open.map((t) => this.thread(t.head, t.replies)));
    resolvedList.replaceChildren(...resolved.map((t) => this.thread(t.head, t.replies)));
    list.hidden = open.length === 0;
    empty.hidden = threads.length > 0;
    this.parts.resolved.hidden = resolved.length === 0;
    resolvedLabel.textContent = `${resolved.length} resolved`;
    count.textContent = threads.length === 0 ? '' : `${open.length} open, ${resolved.length} resolved`;
  }

  /** The comment text as nodes: plain text, with each known cite turned into a cite chip. */
  private bodyNodes(text: string): (string | HTMLElement)[] {
    const nodes: (string | HTMLElement)[] = [];
    let at = 0;
    for (const cite of findCites(text, controlPrefix())) {
      const id = this.controls.get(cite.control);
      if (!id) continue;
      const here = id === this.documentId;
      const href = here ? `#page=${cite.page ?? 1}` : docHref(id, cite.page);
      const link = el('a', { class: 'c-cite', href, 'data-exhibit': here ? undefined : '' }, text.slice(cite.start, cite.end));
      nodes.push(text.slice(at, cite.start), link);
      at = cite.end;
    }
    nodes.push(text.slice(at));
    return nodes.filter((node) => node !== '');
  }

  private byline(comment: ThreadComment, reply: boolean): HTMLElement {
    const author = comment.author_name ?? comment.author_email;
    const when = el('span', { class: 'doc-comment-when' }, time(comment.created_at));
    if (comment.page) when.append(', ', el('a', { href: `#page=${comment.page}` }, `at page ${comment.page}`));
    return el(
      'div',
      { class: reply ? 'doc-comment-head doc-comment-head--reply' : 'doc-comment-head' },
      el('span', { class: 'doc-comment-avatar', 'aria-hidden': 'true' }, initials(author)),
      el('p', { class: 'doc-comment-who' }, el('span', { class: 'doc-comment-author' }, author), when),
    );
  }

  private thread(head: ThreadComment, replies: ThreadComment[]): HTMLLIElement {
    const resolved = head.resolved_at !== null;
    const top = this.byline(head, false);
    if (this.can.resolve) {
      const button = el('button', { type: 'button', class: 'c-button c-button--quiet' }, resolved ? 'Reopen' : 'Resolve');
      button.addEventListener('click', () => void this.toggle(head, button));
      top.append(button);
    }
    const item = el(
      'li',
      { class: 'doc-comment', 'data-comment-id': head.id, 'data-state': resolved ? 'resolved' : 'open' },
      top,
      el('p', { class: 'doc-comment-body' }, ...this.bodyNodes(head.body)),
    );
    if (replies.length > 0) {
      item.append(el('ol', { class: 'doc-replies' }, ...replies.map((reply) =>
        el('li', { class: 'doc-reply', 'data-comment-id': reply.id }, this.byline(reply, true),
          el('p', { class: 'doc-comment-body' }, ...this.bodyNodes(reply.body))))));
    }
    if (resolved) {
      const by = head.resolved_by_name ?? head.resolved_by ?? 'a member';
      item.append(el('p', { class: 'doc-comment-state' }, `Resolved by ${by}, `, time(head.resolved_at!))); // safe: resolved
    } else if (this.can.comment && this.threaded) {
      item.append(this.replyForm(head));
    }
    return item;
  }

  private replyForm(head: ThreadComment): HTMLFormElement {
    const author = head.author_name ?? head.author_email;
    const input = el('textarea', { class: 'c-input', rows: '1', placeholder: 'Reply', 'aria-label': `Reply to ${author}` });
    const button = el('button', { type: 'submit', class: 'c-button' }, 'Reply');
    const error = el('p', { class: 'doc-discuss-error', role: 'alert', hidden: '' });
    const form = el('form', { class: 'doc-reply-form', novalidate: '' }, input, button, error);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.send(input, button, error, head.id);
    });
    return form;
  }

  private updateRemaining(): void {
    const used = characters(this.input.value.trim());
    const left = MAX_COMMENT - used;
    this.parts.remaining.textContent = used >= WARN_AT ? `${left.toLocaleString('en-US')} characters left.` : '';
    this.input.setAttribute('aria-invalid', String(left < 0));
  }

  private post(): Promise<void> {
    const button = this.form.querySelector<HTMLButtonElement>('button[type="submit"]')!; // safe: in the component
    return this.send(this.input, button, this.parts.error, null);
  }

  /** Posts a new thread (parentId null, tagged with the page in view) or a reply to `parentId`. */
  private async send(input: HTMLTextAreaElement, button: HTMLButtonElement, error: HTMLElement, parentId: string | null): Promise<void> {
    const show = (text: string) => {
      error.textContent = text;
      error.hidden = text === '';
    };
    const body = input.value.trim();
    if (!body) return show(MESSAGES.empty_comment!);
    if (characters(body) > MAX_COMMENT) return show(MESSAGES.comment_too_long!);
    button.disabled = true;
    show('');
    const page = this.tagPage();
    const anchor = parentId ? { parentId } : page ? { page } : {};
    const result = await call<{ comment: ThreadComment }>(this.url(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, ...anchor }),
    });
    button.disabled = false;
    if (!result.ok) return show(message(result.error, 'Your comment was not posted; try again.'));
    this.comments.push(result.value.comment);
    input.value = '';
    if (!parentId) this.updateRemaining();
    this.render();
    this.parts.status.textContent = parentId ? 'Reply posted.' : 'Comment posted.';
    if (parentId) this.root.querySelector<HTMLTextAreaElement>(`[data-comment-id="${CSS.escape(parentId)}"] textarea`)?.focus();
  }

  private async toggle(head: ThreadComment, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    const resolved = head.resolved_at === null;
    const result = await call<{ comment: ThreadComment }>(`/api/comments/${encodeURIComponent(head.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved }),
    });
    if (!result.ok) {
      button.disabled = false;
      this.parts.status.textContent = message(result.error, 'That change was not saved; try again.');
      return;
    }
    // Resolution belongs to the thread: the replies carry their top-level comment's state.
    const { resolved_at, resolved_by, resolved_by_name } = result.value.comment;
    this.comments = this.comments.map((c) =>
      c.id === head.id || c.parent_id === head.id ? { ...c, resolved_at, resolved_by, resolved_by_name } : c);
    this.render();
    this.parts.status.textContent = resolved ? 'Thread resolved.' : 'Thread reopened.';
    // A resolved thread folds away, so focus stays on the fold's summary; a reopened one keeps its button.
    if (resolved && !(this.parts.resolved as HTMLDetailsElement).open) this.parts.resolvedLabel.focus();
    else this.root.querySelector<HTMLButtonElement>(`[data-comment-id="${CSS.escape(head.id)}"] > .doc-comment-head button`)?.focus();
  }
}

for (const root of document.querySelectorAll<HTMLElement>('[data-comment-thread]')) new CommentPanel(root);

export {};
