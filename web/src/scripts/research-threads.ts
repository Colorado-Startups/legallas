// SPDX-License-Identifier: Apache-2.0
// The saved research threads (plan D12), as a list in the research panel: each row opens its thread and has a
// Delete that asks once more before it acts. Titles are text from the room, drawn with textContent only. Dates
// are ISO days in mono (DESIGN.md section 9). The list sits in a disclosure: open on the page, closed in the
// drawer, where room is short. The note on where threads live sits after the disclosure, so it shows even when the
// list is closed.
import { THREAD_TTL_DAYS } from '../../worker/agent/protocol.ts';
import { RESEARCH_COST, threadDate, type ThreadSummary } from './research-client.ts';

/** What the panel tells the reader about where threads live (plan D12, as the Ask page's privacy note says it). */
export const THREADS_NOTE = `Saved in this room on Cloudflare, only for you. Delete a thread at any time; the room deletes it ${THREAD_TTL_DAYS} days after its last question. Cloudflare's point-in-time recovery keeps deleted data for up to 30 days. A research question counts as ${RESEARCH_COST} toward today's question limit.`;
/** How long a pressed Delete waits for its confirming press. */
const CONFIRM_MS = 5000;

/** Callbacks of the thread list: open a thread and delete one. */
export interface ThreadListHooks {
  open(id: string): void;
  /** Deletes the thread; resolves true when it is gone. */
  remove(id: string): Promise<boolean>;
  /** Starts a new thread. */
  fresh(): void;
}

/** The saved-threads list: its disclosure root, and a note to place after it. */
export interface ThreadList {
  root: HTMLDetailsElement;
  /** THREADS_NOTE, for the panel to place after `root` (outside the disclosure, so it shows when the list is closed). */
  note: HTMLParagraphElement;
  /** Redraws the rows; `current` is the open thread (aria-current on its button). */
  paint(list: readonly ThreadSummary[], current: string | null): void;
  /** One sentence in place of the rows (loading, empty, failed); '' clears it. */
  message(text: string): void;
  /** Puts focus on the first row, or on New thread when there is none (after a delete takes the focused row). */
  focus(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The name a row goes by in labels: its title, or its date when the room gave none. */
function rowName(thread: ThreadSummary): string {
  return thread.title || `Thread of ${threadDate(thread.updatedAt)}`;
}

/** Delete, then "Confirm delete" for a few seconds; the second press deletes. Blur or the wait resets it. */
function deleteButton(thread: ThreadSummary, hooks: ThreadListHooks): HTMLButtonElement {
  const button = el('button', 'c-button c-button--quiet ask-thread__delete', 'Delete');
  button.type = 'button';
  const name = rowName(thread);
  let timer = 0;
  const reset = () => {
    clearTimeout(timer);
    button.dataset.state = 'idle';
    button.textContent = 'Delete';
    button.setAttribute('aria-label', `Delete thread: ${name}`);
  };
  reset();
  button.addEventListener('blur', reset);
  button.addEventListener('click', () => {
    if (button.dataset.state !== 'confirm') {
      button.dataset.state = 'confirm';
      button.textContent = 'Confirm delete';
      button.setAttribute('aria-label', `Confirm delete thread: ${name}`);
      timer = window.setTimeout(reset, CONFIRM_MS);
      return;
    }
    clearTimeout(timer);
    button.disabled = true;
    void hooks.remove(thread.id).then((gone) => {
      if (!gone) {
        button.disabled = false;
        reset();
      }
    });
  });
  return button;
}

function row(thread: ThreadSummary, current: string | null, hooks: ThreadListHooks): HTMLLIElement {
  const li = el('li', 'ask-thread');
  const open = el('button', 'ask-thread__open');
  open.type = 'button';
  if (thread.id === current) open.setAttribute('aria-current', 'true');
  open.dataset.threadOpen = '';
  const date = el('time', 'ask-thread__date t-mono', threadDate(thread.updatedAt));
  date.dateTime = thread.updatedAt;
  open.append(el('span', 'ask-thread__title', rowName(thread)), date);
  open.addEventListener('click', () => hooks.open(thread.id));
  li.append(open, deleteButton(thread, hooks));
  return li;
}

/** The thread list's disclosure, empty until painted. */
export function threadList(hooks: ThreadListHooks, open: boolean): ThreadList {
  const root = el('details', 'ask-threads');
  root.open = open;
  const summary = el('summary', 'ask-threads__summary t-small', 'Saved threads');
  const fresh = el('button', 'c-button ask-threads__new', 'New thread');
  fresh.type = 'button';
  fresh.addEventListener('click', () => hooks.fresh());
  const list = el('ol', 'ask-threads__list');
  list.setAttribute('aria-label', 'Saved threads');
  const message = el('p', 'ask-threads__message t-small');
  message.hidden = true;
  root.append(summary, fresh, message, list);
  return {
    root,
    note: el('p', 'ask-research__note t-caption', THREADS_NOTE),
    paint(threads, current) {
      summary.textContent = threads.length ? `Saved threads: ${threads.length}` : 'Saved threads';
      list.replaceChildren(...threads.map((thread) => row(thread, current, hooks)));
      message.textContent = threads.length ? '' : 'No saved threads yet.';
      message.hidden = threads.length > 0;
    },
    message(text) {
      message.textContent = text;
      message.hidden = !text;
    },
    focus() {
      (list.querySelector<HTMLButtonElement>('[data-thread-open]') ?? fresh).focus();
    },
  };
}
