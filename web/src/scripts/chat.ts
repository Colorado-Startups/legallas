// SPDX-License-Identifier: Apache-2.0
// The Ask page (card P7): sends the question in a POST body (chat-client.ts), streams the answer into the
// conversation (chat-render.ts) and keeps history only in this browser (chat-store.ts), shared with the drawer.
//
// The companion (chat-companion.ts) hears every real step: typing, sending, the retrieved count, streamed
// text, cite focus, and the verdict.
//
// Research mode (plan D10): when GET /api/research says research is on (or, while it is off, the member has saved
// threads to read or delete), the Quick / Research switch shows; Research loads
// research-panel.ts with import() into [data-research] and takes the question box until Quick is chosen again.
// Quick Ask's history, log and requests are untouched by it. /ask?mode=research[&thread=<id>] opens in Research.
import { answerStatus, askTracked, ERRORS, MAX_CHARS, questionToRestore, READING_STATUS } from './chat-client.ts';
import { companionView } from './chat-companion.ts';
import { paintTurn, turnView, warmPdfCites, wireCites, type TurnView } from './chat-render.ts';
import { clearHistory, loadHistory, saveHistory, type Turn } from './chat-store.ts';
import { controlPrefix, formatControl } from './matter-api.ts';
import type { ResearchPanel } from './research-panel.ts';
import { RESEARCH_LOAD_FAILED, researchAvailability, wireModeSwitch, type AskMode } from './research-mode.ts';
import { DOC_ID_SHAPE } from './sanitize.ts';
import '../styles/research-mode.css';

const q = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector);
const form = q<HTMLFormElement>('[data-chat-form]');
const input = q<HTMLTextAreaElement>('[data-chat-input]');
const log = q<HTMLOListElement>('[data-chat-log]');
const empty = q('[data-chat-empty]');
const status = q('[data-chat-status]');
const count = q('[data-chat-count]');
const clear = q<HTMLButtonElement>('[data-chat-clear]');
const fresh = q<HTMLButtonElement>('[data-chat-new]');
const companion = companionView(q('[data-companion]'));
const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]') ?? null;

let email: string | null = null;
let turns: Turn[] = [];
let busy = false;
let mode: AskMode = 'quick';
let research: Promise<ResearchPanel> | null = null;
/** The document a ?doc= link scoped the next question to (R57), shown as a chip above the box. */
let scope: { label: string; name: string } | null = null;
const STEM = 'What does this document show about ';

function say(message: string): void {
  if (status) status.textContent = message;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function appendTurn(question: string): TurnView {
  const view = turnView(question);
  log?.append(view.root);
  if (empty) empty.hidden = true;
  return view;
}

function showHistory(): void {
  log?.replaceChildren();
  const views = turns.map((turn) => {
    const view = appendTurn(turn.question);
    paintTurn(view, turn, true);
    return view;
  });
  const newest = views.at(-1);
  if (newest) warmPdfCites(newest.root);
  if (empty) empty.hidden = turns.length > 0;
  if (clear) clear.hidden = turns.length === 0;
}

async function ask(question: string): Promise<void> {
  busy = true;
  if (submit) submit.disabled = true;
  say(READING_STATUS);
  companion.send({ type: 'send' });
  companion.note('');
  const view = appendTurn(question);
  view.root.dataset.state = 'pending';
  view.root.scrollIntoView({ block: 'nearest' });
  let frame = 0;
  const hooks = {
    reading(documents: number, pages: number) {
      companion.send({ type: 'docs', count: documents });
      companion.note(`${plural(documents, 'document')}, ${plural(pages, 'page')}`);
    },
    delta(current: Turn) {
      companion.send({ type: 'delta' });
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        paintTurn(view, current, false);
      });
    },
    error: say,
  };
  // The header's small Legallas, and on a phone the one beside the question box, follow the request.
  const turn = await askTracked(question, hooks, companion.glyph);
  if (frame) cancelAnimationFrame(frame);
  busy = false;
  if (submit) submit.disabled = false;
  if (!turn.answer) {
    if (!turn.failed) say('');
    view.root.remove();
    const again = input ? questionToRestore(turn, input.value) : null;
    if (input && again !== null) {
      input.value = again;
      updateCount();
    }
    if (empty) empty.hidden = turns.length > 0;
    companion.send({ type: 'error' });
    return;
  }
  paintTurn(view, turn, true);
  warmPdfCites(view.root);
  if (!turn.failed) say(answerStatus(turn));
  companion.send(turn.failed ? { type: 'error' } : { type: 'done', dontKnow: turn.dontKnow });
  if (email) {
    turns.push(turn);
    await saveHistory(email, turns);
    if (clear) clear.hidden = false;
  }
}

/** The research panel, loaded and mounted on first use; it drives the same status line, companion and glyph. */
function researchPanel(): Promise<ResearchPanel> {
  const host = q('[data-research]');
  research ??= import('./research-panel.ts').then(({ mountResearch }) =>
    mountResearch(host!, { // safe: setMode only runs when the page has the research host
      status: say,
      note: (text) => companion.note(text),
      companion: (event) => companion.send(event),
      glyph: companion.glyph,
      onFocusCite: (cite) => companion.send({ type: 'cite', focused: cite !== null }),
      restore(question) {
        if (input && !input.value.trim()) {
          input.value = question;
          updateCount();
        }
      },
      focusInput: () => input?.focus(),
    }, 'page'),
  );
  return research;
}

/** The panel, or null after saying it did not load; the next use tries the import again. */
async function loadedPanel(): Promise<ResearchPanel | null> {
  try {
    return await researchPanel();
  } catch {
    research = null;
    say(RESEARCH_LOAD_FAILED);
    return null;
  }
}

async function askResearch(question: string): Promise<void> {
  busy = true;
  if (submit) submit.disabled = true;
  const panel = await loadedPanel();
  if (panel) await panel.ask(question);
  else if (input && !input.value.trim()) {
    input.value = question;
    updateCount();
  }
  busy = false;
  if (submit) submit.disabled = false;
}

/** Shows one mode's conversation and hides the other's; the first switch to Research loads the panel. */
async function setMode(next: AskMode, thread: string | null = null): Promise<void> {
  mode = next;
  const on = next === 'research';
  if (log) log.hidden = on;
  if (empty) empty.hidden = on || turns.length > 0;
  if (clear) clear.hidden = on || turns.length === 0;
  say('');
  companion.note('');
  if (on) await (await loadedPanel())?.show(thread);
  else void research?.then((panel) => panel.hide(), () => undefined);
}

/** Shows the switch when research is on for this member, and opens Research from /ask?mode=research[&thread=]. */
function wireResearch(params: URLSearchParams): void {
  const group = q('[data-ask-modes]');
  if (!group || !q('[data-research]')) return;
  let thread = params.get('mode') === 'research' ? params.get('thread') : null;
  const modes = wireModeSwitch(group, (next) => {
    void setMode(next, thread);
    thread = null;
  });
  q('[data-research-privacy]')?.removeAttribute('hidden');
  if (params.get('mode') !== 'research') return;
  // The mode leaves the address bar; ?q= and ?doc= stay for prefill.
  const rest = new URLSearchParams(window.location.search);
  rest.delete('mode');
  rest.delete('thread');
  history.replaceState(history.state, '', rest.toString() ? `${window.location.pathname}?${rest}` : window.location.pathname);
  modes.set('research');
}

function updateCount(): void {
  if (count && input) count.textContent = `${[...input.value].length} / ${MAX_CHARS}`;
}

function listen(): void {
  updateCount();
  companion.send({ type: 'typing', active: Boolean(input?.value.trim()) });
}

function wireForm(f: HTMLFormElement, field: HTMLTextAreaElement): void {
  field.addEventListener('input', listen);
  field.addEventListener('focus', () => companion.send({ type: 'greeted' }));
  field.addEventListener('blur', () => companion.send({ type: 'typing', active: false }));
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) f.requestSubmit();
  });
  f.addEventListener('submit', (event) => {
    event.preventDefault();
    const typed = field.value.trim();
    const question = scope ? `${scopeText(scope)} ${typed}` : typed;
    if (busy || !typed || (scope && typed === STEM.trim())) return;
    if ([...question].length > MAX_CHARS) return say(ERRORS.question_too_long!);
    field.value = '';
    updateCount();
    setScope(null);
    void (mode === 'research' ? askResearch(question) : ask(question));
  });
  fresh?.addEventListener('click', () => {
    if (mode === 'research') void research?.then((panel) => panel.fresh(), () => undefined);
    field.focus();
    field.scrollIntoView({ block: 'nearest' });
  });
  q('[data-chat-context-clear]')?.addEventListener('click', () => {
    setScope(null);
    if (field.value === STEM) field.value = '';
    updateCount();
    field.focus();
  });
  clear?.addEventListener('click', async () => {
    if (busy) return;
    await clearHistory();
    turns = [];
    showHistory();
    companion.note('');
    say('History cleared from this browser.');
  });
}

/** The words a scoped question starts with, so the model and the retrieval both know the document. */
function scopeText(s: { label: string; name: string }): string {
  return s.label === s.name ? `About ${s.name}:` : `About ${s.label} (${s.name}):`;
}

/** Shows or clears the "About DOE-000412" chip above the question box. */
function setScope(next: { label: string; name: string } | null): void {
  scope = next;
  const box = q('[data-chat-context]');
  const label = q('[data-chat-context-label]');
  if (label) label.textContent = next ? `About ${next.label}` : '';
  if (box) box.hidden = next === null;
}

/**
 * Prefills the question from /ask?q=<text>, or scopes it to /ask?doc=<id> with a chip and a neutral stem
 * (R57). Never sends; the lawyer presses Ask. The query is dropped so the text leaves the address bar.
 */
async function prefill(field: HTMLTextAreaElement): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q');
  const doc = params.get('doc');
  if (q === null && doc === null) return;
  history.replaceState(history.state, '', window.location.pathname);
  let text = (q ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  if (!text && doc && DOC_ID_SHAPE.test(doc)) {
    try {
      const res = await fetch(`/api/doc/${encodeURIComponent(doc)}`, { credentials: 'same-origin' });
      const meta = res.ok ? ((await res.json()) as { name?: unknown; control_seq?: unknown }) : null;
      const control = formatControl(controlPrefix(), typeof meta?.control_seq === 'number' ? meta.control_seq : null);
      const name = typeof meta?.name === 'string' ? meta.name.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200) : '';
      if (name) {
        setScope({ label: control || name, name });
        text = STEM;
      }
    } catch {
      // No scope; the box stays empty.
    }
  }
  field.value = [...text].slice(0, MAX_CHARS).join('');
  updateCount();
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
}

async function start(): Promise<void> {
  if (!form || !input || !log) return;
  wireCites(log, { onFocus: (cite) => companion.send({ type: 'cite', focused: cite !== null }) });
  const me = await (window.legallasMe ?? Promise.resolve(null));
  if (!me) {
    say('Your sign-in could not be confirmed; reload the page.');
    if (submit) submit.disabled = true;
    companion.send({ type: 'error' });
    return;
  }
  email = me.email;
  turns = await loadHistory(email);
  showHistory();
  // Someone with history has been greeted before; hello is for a first visit.
  if (turns.length) companion.send({ type: 'greeted' });
  wireForm(form, input);
  updateCount();
  const params = new URLSearchParams(window.location.search);
  void researchAvailability().then((shown) => shown && wireResearch(params));
  await prefill(input);
}

void start();
