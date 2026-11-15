// SPDX-License-Identifier: Apache-2.0
// Research mode's panel (plan D10 to D12), mounted into the Ask page or the drawer the first time a reader picks
// Research. Loaded with import(), so it and the agent's client (research-transport.ts) never count against a
// page's eager budget. Quick Ask's history and code are untouched; this panel has its own log.
//
// A research turn is drawn by chat-render.ts like any answer, so its cites open the exhibit pane exactly as quick
// Ask's do (the page-wide link handler, or the drawer's `onCite`). Above each answer a counts line says what the
// agent did ("Searched 3 times, read 12 pages"); the status line speaks only at the start and at the end.
import { answerStatus } from './chat-client.ts';
import { paintTurn, turnView, wireCites, type Cite, type TurnView } from './chat-render.ts';
import type { CompanionEvent } from './companion-contract.ts';
import { glyphWhile, headerGlyph, type GlyphHost } from './glyph.ts';
import {
  askResearch, progressText, RESEARCH_STATUS, ResearchError, researchMessage, THREAD_ID, touchThread,
  type ResearchTransport, type ResearchTurn, type ThreadSummary,
} from './research-client.ts';
import { recordsCardNode } from './records-card.ts';
import { recordsCards } from './records-card-model.ts';
import { RESEARCH_LOAD_FAILED } from './research-mode.ts';
import { threadList, type ThreadList } from './research-threads.ts';
import { loadTransport } from './research-transport.ts';
import '../styles/research.css';

/** Callbacks the research panel uses to report status to the page. */
export interface PanelHooks {
  /** The polite status line (role=status). */
  status(text: string): void;
  /** The quiet line beside the companion or under the drawer title. */
  note?(text: string): void;
  companion?(event: CompanionEvent): void;
  /** A glyph to follow the request besides the header's (the drawer's, or the phone avatar's). */
  glyph?: GlyphHost | null;
  /** Takes plain cite clicks (the drawer); without it the page-wide exhibit handler does. */
  onCite?(cite: Cite): void;
  onFocusCite?(cite: Cite | null): void;
  /** A question that got no answer at all goes back in the box. */
  restore?(question: string): void;
  /** The open thread changed (null for a new one). */
  current?(id: string | null): void;
  focusInput?(): void;
}

/** The research panel's handle: show it, hide it and open a saved thread. */
export interface ResearchPanel {
  /** Shows the panel, loading the client and the saved threads on first use; opens `thread` when given. */
  show(thread?: string | null): Promise<void>;
  hide(): void;
  ask(question: string): Promise<void>;
  /** Starts a new thread: the log clears and the next question opens a thread. */
  fresh(): void;
  busy(): boolean;
}

type ResearchView = TurnView & { steps: HTMLParagraphElement };

const NOT_AVAILABLE = 'research_unavailable';

/** The turn's public-records cards, right after the answer, drawn once (a repaint replaces them). */
function paintRecords(view: ResearchView, turn: ResearchTurn): void {
  view.root.querySelector(':scope > .rec-cards')?.remove();
  const cards = recordsCards(turn.records);
  if (cards.length === 0) return;
  const box = document.createElement('div');
  box.className = 'rec-cards';
  box.append(...cards.map(recordsCardNode));
  view.answer.after(box);
}

/** A turn's view with the counts line between the question and the answer. */
function researchView(question: string): ResearchView {
  const view = turnView(question);
  const steps = document.createElement('p');
  steps.className = 'ask-steps t-small';
  view.root.insertBefore(steps, view.answer);
  return { ...view, steps };
}

function paintSaved(view: ResearchView, turn: ResearchTurn): void {
  paintTurn(view, turn, true);
  paintRecords(view, turn);
  view.steps.textContent = turn.failed && !turn.answer ? 'No answer was saved for this question.' : progressText(turn.steps);
}

interface State {
  transport: ResearchTransport | null;
  /** The load of the client and the threads under way or done; later shows wait on the same one. A failed load is
      never kept, so the next show or question tries again. */
  loading: Promise<void> | null;
  /** Loads of the client that failed on this page; after the second, the reader is asked to reload. */
  failures: number;
  threads: ThreadSummary[];
  current: string | null;
  busy: boolean;
}

/** One mounted panel: its state, its host's hooks, the open thread's log and the thread list. */
interface Ctx {
  state: State;
  hooks: PanelHooks;
  log: HTMLOListElement;
  list: ThreadList;
}

function errorOf(err: unknown): string {
  return err instanceof ResearchError ? err.code : NOT_AVAILABLE;
}

/** Marks `id` as the open thread (null for a new one) in the list and tells the host. */
function choose(ctx: Ctx, id: string | null): void {
  ctx.state.current = id;
  ctx.list.paint(ctx.state.threads, id);
  ctx.hooks.current?.(id);
}

async function openThread(ctx: Ctx, id: string): Promise<void> {
  const { state, hooks } = ctx;
  if (state.busy || !state.transport) return;
  try {
    const turns = await state.transport.open(id);
    ctx.log.replaceChildren(...turns.map((turn) => {
      const view = researchView(turn.question);
      paintSaved(view, turn);
      return view.root;
    }));
    choose(ctx, id);
    hooks.status('');
  } catch (err) {
    if (errorOf(err) === 'thread_missing') {
      state.threads = state.threads.filter((t) => t.id !== id);
      ctx.list.paint(state.threads, state.current);
    }
    hooks.status(researchMessage(errorOf(err)));
  }
}

/** Deletes a thread in the room; one already gone counts as deleted. Focus moves to the list. */
async function removeThread(ctx: Ctx, id: string): Promise<boolean> {
  const { state, hooks } = ctx;
  if (state.busy || !state.transport) return false;
  try {
    await state.transport.remove(id);
  } catch (err) {
    if (errorOf(err) !== 'thread_missing') {
      hooks.status(researchMessage(errorOf(err)));
      return false;
    }
  }
  state.threads = state.threads.filter((t) => t.id !== id);
  if (state.current === id) {
    ctx.log.replaceChildren();
    choose(ctx, null);
  } else ctx.list.paint(state.threads, state.current);
  hooks.status('Thread deleted.');
  ctx.list.focus();
  return true;
}

function freshThread(ctx: Ctx): void {
  if (ctx.state.busy) return;
  ctx.log.replaceChildren();
  choose(ctx, null);
  ctx.hooks.note?.('');
  ctx.hooks.focusInput?.();
}

/** What to say when the agent's client did not load: try again in a minute, and after a second miss, reload. */
function clientMissing(state: State): string {
  return state.failures > 1 ? RESEARCH_LOAD_FAILED : researchMessage(NOT_AVAILABLE);
}

/** Loads the agent's client and the saved threads, saying so in the list when either is missing. */
async function load(ctx: Ctx): Promise<void> {
  const { state, list } = ctx;
  list.message('Loading saved threads.');
  state.transport = await loadTransport().catch(() => null);
  if (!state.transport) {
    state.loading = null;
    state.failures += 1;
    return list.message(clientMissing(state));
  }
  try {
    state.threads = await state.transport.threads();
    list.paint(state.threads, state.current);
  } catch (err) {
    list.message(researchMessage(errorOf(err)));
  }
}

/** The panel inside `host`; `layout` decides whether the thread list starts open (page) or closed (drawer). */
export function mountResearch(host: HTMLElement, hooks: PanelHooks, layout: 'page' | 'drawer'): ResearchPanel {
  const log = document.createElement('ol');
  log.className = 'ask-log ask-research__log';
  log.setAttribute('aria-label', 'Research thread');
  wireCites(log, { onOpen: hooks.onCite, onFocus: hooks.onFocusCite });
  const state: State = { transport: null, loading: null, failures: 0, threads: [], current: null, busy: false };
  // The list's hooks need ctx, so ctx gets its list right after.
  const ctx = { state, hooks, log } as Omit<Ctx, 'list'> as Ctx;
  ctx.list = threadList({
    open: (id) => void openThread(ctx, id),
    remove: (id) => removeThread(ctx, id),
    fresh: () => freshThread(ctx),
  }, layout === 'page');
  const root = document.createElement('div');
  root.className = 'ask-research';
  root.dataset.layout = layout;
  root.append(ctx.list.root, ctx.list.note, log);
  host.replaceChildren(root);
  return {
    async show(thread) {
      host.hidden = false;
      await (ctx.state.loading ??= load(ctx));
      // Research is off: the saved threads stay readable and deletable, and the reader is told why asking is not.
      if (ctx.state.transport?.readOnly) hooks.status(researchMessage('research_off'));
      if (thread && THREAD_ID.test(thread) && thread !== ctx.state.current) await openThread(ctx, thread);
    },
    hide() {
      host.hidden = true;
    },
    ask: (question) => ask(ctx, question),
    fresh: () => freshThread(ctx),
    busy: () => ctx.state.busy,
  };
}

/** Follows the request on the header's glyph and the host's: working, then done, or error for a failed turn. */
function followGlyphs(request: Promise<{ turn: ResearchTurn }>, extra: GlyphHost | null | undefined): void {
  const outcome = request.then(({ turn }) => (turn.failed ? Promise.reject(new Error('failed')) : turn));
  for (const glyph of [headerGlyph(), extra ?? null]) if (glyph) void glyphWhile(glyph, outcome).catch(() => undefined);
  outcome.catch(() => undefined);
}

/** One research question in the open thread (or a new one), drawn as it streams. */
async function ask(ctx: Ctx, question: string): Promise<void> {
  const { state, hooks } = ctx;
  if (state.busy) return;
  // A client that failed to load is tried again here, once per question.
  if (!state.transport) await (state.loading ??= load(ctx));
  if (!state.transport || state.transport.readOnly) {
    hooks.status(state.transport ? researchMessage('research_off') : clientMissing(state));
    hooks.restore?.(question);
    return;
  }
  state.busy = true;
  hooks.status(RESEARCH_STATUS);
  hooks.note?.('');
  hooks.companion?.({ type: 'send' });
  const view = researchView(question);
  view.root.dataset.state = 'pending';
  ctx.log.append(view.root);
  view.root.scrollIntoView({ block: 'nearest' });
  let frame = 0;
  const request = askResearch(state.transport, state.current, question, {
    progress(steps) {
      view.steps.textContent = progressText(steps);
      hooks.note?.(progressText(steps));
    },
    thread(named) {
      state.threads = touchThread(state.threads, { ...named, updatedAt: new Date().toISOString() });
      choose(ctx, named.id);
    },
    delta(turn) {
      hooks.companion?.({ type: 'delta' });
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        paintTurn(view, turn, false);
      });
    },
    error: (message) => hooks.status(message),
  });
  followGlyphs(request, hooks.glyph);
  const { turn, threadId } = await request;
  if (frame) cancelAnimationFrame(frame);
  state.busy = false;
  finish(ctx, view, turn, threadId);
}

/** Draws the finished turn, says so once, and moves its thread to the top of the list. */
function finish(ctx: Ctx, view: ResearchView, turn: ResearchTurn, threadId: string | null): void {
  const { state, hooks } = ctx;
  if (!turn.answer) {
    view.root.remove();
    hooks.companion?.({ type: 'error' });
    if (turn.failed) hooks.restore?.(turn.question);
    return;
  }
  paintSaved(view, turn);
  const counts = progressText(turn.steps);
  if (!turn.failed) hooks.status(counts ? `${answerStatus(turn)} ${counts}.` : answerStatus(turn));
  hooks.note?.(counts);
  hooks.companion?.(turn.failed ? { type: 'error' } : { type: 'done', dontKnow: turn.dontKnow });
  if (threadId) {
    state.threads = touchThread(state.threads, { id: threadId, title: '', updatedAt: new Date().toISOString() });
    ctx.list.paint(state.threads, state.current);
  }
}
