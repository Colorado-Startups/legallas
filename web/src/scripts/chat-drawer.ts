// SPDX-License-Identifier: Apache-2.0
// The Ask drawer (card P7; DESIGN.md "Drawer"): a modal dialog at the right edge, a full-screen sheet below
// 64rem, mounted into Room.astro's [data-ask-drawer]. Loaded on first use by ask-drawer.ts.
//
// It shares history with the Ask page through chat-store.ts: earlier questions sit collapsed above the latest
// one. Focus starts in the question box, Tab stays inside, Esc closes and returns focus to the trigger. No
// companion here; the head shows the small Legallas (F8's glyph, R68) at 24px, which follows the request
// alongside the header's. A cite closes the drawer, then opens the exhibit pane (R66), so they never
// stack; the pane's "Back to question" reopens the drawer, and Esc or Close returns focus to the header's
// Ask button.
//
// Research mode (plan D10): when GET /api/research says research is on (or, while it is off, the member has saved
// threads), a Quick / Research switch sits above the question box. Research loads research-panel.ts with import() into
// the body, in place of the quick history, until Quick is chosen again; "Open as page" then opens /ask in Research on
// the same thread.
import { answerStatus, askTracked, ERRORS, MAX_CHARS, questionToRestore, READING_STATUS } from './chat-client.ts';
import { cleanQuestion } from './ask-drawer.ts';
import { openCite, paintTurn, turnView, warmPdfCites, wireCites, type Cite, type TurnView } from './chat-render.ts';
import { loadHistory, saveHistory, type Turn } from './chat-store.ts';
import type { ResearchPanel } from './research-panel.ts';
import { buildModeSwitch, RESEARCH_LOAD_FAILED, researchAvailability, wireModeSwitch, type AskMode, type ModeSwitch } from './research-mode.ts';
import { COMPACT_LABEL } from '../../worker/product-notices.ts';
import '../styles/ask-drawer.css';
import '../styles/research-mode.css';

const SVG = 'http://www.w3.org/2000/svg';
const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

interface Drawer {
  mount: HTMLElement;
  dialog: HTMLElement;
  log: HTMLOListElement;
  earlier: HTMLDetailsElement;
  earlierLog: HTMLOListElement;
  note: HTMLElement;
  glyph: HTMLElement;
  input: HTMLTextAreaElement;
  send: HTMLButtonElement;
  status: HTMLElement;
  page: HTMLAnchorElement;
  modes: HTMLElement;
  research: HTMLElement;
}

let drawer: Drawer | null = null;
let returnTo: HTMLElement | null = null;
let busy = false;
let mode: AskMode = 'quick';
let modes: ModeSwitch | null = null;
let panel: Promise<ResearchPanel> | null = null;
/** The open research thread, for "Open as page". */
let thread: string | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A 16px line icon: the close cross. */
function closeIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M3.5 3.5l9 9m0-9l-9 9');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  svg.append(path);
  return svg;
}

function head(): { node: HTMLElement; note: HTMLElement; glyph: HTMLElement; page: HTMLAnchorElement } {
  const node = el('div', 'c-drawer__head');
  const glyph = el('span', 'ask-drawer__glyph');
  glyph.setAttribute('aria-hidden', 'true');
  // The 24px miniature from Room.astro's template (build-time markup, no page or model text), cloned, never parsed.
  const art = document.querySelector<HTMLTemplateElement>('template[data-glyph-template]');
  if (art) glyph.append(art.content.cloneNode(true));
  const titles = el('div', 'ask-drawer__titles');
  const title = el('h2', 'c-drawer__title', 'Ask');
  title.id = 'ask-drawer-title';
  const note = el('p', 'ask-drawer__note t-caption');
  titles.append(title, note);
  titles.append(el('p', 'ask-drawer__note t-caption', COMPACT_LABEL));
  const esc = el('kbd', 'c-kbd', 'Esc');
  esc.setAttribute('aria-hidden', 'true');
  const page = el('a', 'ask-drawer__page t-small', 'Open as page');
  page.href = '/ask';
  const close = el('button', 'c-button c-button--quiet ask-drawer__close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.append(closeIcon());
  close.addEventListener('click', () => closeDrawer());
  node.append(glyph, titles, esc, page, close);
  return { node, note, glyph, page };
}

function foot(): { node: HTMLElement; input: HTMLTextAreaElement; send: HTMLButtonElement; status: HTMLElement; modes: HTMLElement } {
  const node = el('div', 'c-drawer__foot ask-drawer__foot');
  const form = el('form', 'ask-drawer__form');
  const label = el('label', 'u-vh', 'Your question');
  label.htmlFor = 'ask-drawer-input';
  const input = el('textarea', 'c-input ask-drawer__input');
  input.id = 'ask-drawer-input';
  input.rows = 1;
  input.maxLength = MAX_CHARS;
  input.required = true;
  input.placeholder = 'Ask about a person, a date, a payment or a document';
  const send = el('button', 'c-button c-button--primary', 'Ask');
  send.type = 'submit';
  form.append(label, input, send);
  const status = el('p', 'ask-drawer__status t-small');
  status.setAttribute('role', 'status');
  const hint = el('p', 'ask-drawer__hint t-caption', 'Citations open the cited page. Esc closes.');
  const modes = buildModeSwitch();
  node.append(modes, form, status, hint);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (busy || !question) return;
    if ([...question].length > MAX_CHARS) return void (status.textContent = ERRORS.question_too_long!);
    input.value = '';
    void (mode === 'research' ? askResearch(question) : ask(question));
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  return { node, input, send, status, modes };
}

function build(mount: HTMLElement): Drawer {
  const scrim = el('div', 'ask-drawer__scrim');
  scrim.addEventListener('click', () => closeDrawer());
  const dialog = el('div', 'c-drawer ask-drawer');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'ask-drawer-title');
  const top = head();
  const body = el('div', 'c-drawer__body ask-drawer__body');
  const earlier = el('details', 'ask-drawer__earlier');
  earlier.hidden = true;
  const earlierLog = el('ol', 'ask-log');
  earlier.append(el('summary', 't-small'), earlierLog);
  const log = el('ol', 'ask-log');
  log.setAttribute('aria-label', 'Conversation');
  const research = el('div');
  research.hidden = true;
  body.append(earlier, log, research);
  wireCites(body, { onOpen: openFromDrawer });
  const bottom = foot();
  dialog.append(top.node, body, bottom.node);
  dialog.addEventListener('keydown', trapKeys);
  mount.replaceChildren(scrim, dialog);
  return { mount, dialog, log, earlier, earlierLog, note: top.note, glyph: top.glyph, page: top.page, research, ...bottom };
}

/** A cite in the drawer (quick or research): the drawer closes, then the exhibit pane opens (R66). */
function openFromDrawer(cite: Cite): void {
  const ask = document.querySelector<HTMLElement>('[data-ask-open]');
  closeDrawer(false);
  // Esc or Close on the pane returns focus to the header Ask button; Back to question reopens the drawer.
  openCite(cite.id, cite.page, cite.quote, ask, { label: 'Back to question', reopen: () => void openDrawer(ask) });
}

function trapKeys(event: KeyboardEvent): void {
  if (!drawer) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeDrawer();
    return;
  }
  if (event.key !== 'Tab') return;
  const items = [...drawer.dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.offsetParent !== null);
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function setInert(inert: boolean): void {
  if (!drawer) return;
  for (const child of document.body.children) if (child !== drawer.mount && child instanceof HTMLElement) child.inert = inert;
}

/** Draws `older` collapsed under "Earlier questions" and `latest` (if any) open below it. */
function paintHistory(d: Drawer, older: readonly Turn[], latest: Turn | null): void {
  d.earlierLog.replaceChildren();
  for (const turn of older) {
    const view = turnView(turn.question);
    paintTurn(view, turn, true);
    d.earlierLog.append(view.root);
  }
  d.earlier.hidden = older.length === 0;
  const summary = d.earlier.querySelector('summary');
  if (summary) summary.textContent = `Earlier questions: ${older.length}`;
  d.log.replaceChildren();
  if (latest) {
    const view = turnView(latest.question);
    paintTurn(view, latest, true);
    warmPdfCites(view.root);
    d.log.append(view.root);
  }
}

function setNote(d: Drawer, note: string): void {
  d.note.textContent = note;
}

async function ask(question: string): Promise<void> {
  const d = drawer;
  if (!d) return;
  busy = true;
  d.send.disabled = true;
  d.status.textContent = READING_STATUS;
  setNote(d, 'Reading the record');
  const me = await (window.legallasMe ?? Promise.resolve(null));
  const turns = me ? await loadHistory(me.email) : [];
  paintHistory(d, turns, null);
  const view: TurnView = turnView(question);
  view.root.dataset.state = 'pending';
  d.log.replaceChildren(view.root);
  let documents = 0;
  const hooks = {
    reading: (n: number, pages: number) => {
      documents = n;
      setNote(d, `Reading ${n === 1 ? '1 document' : `${n} documents`}, ${pages === 1 ? '1 page' : `${pages} pages`}`);
    },
    delta: (current: Turn) => paintTurn(view, current, false),
    error: (message: string) => (d.status.textContent = message),
  };
  const turn = await askTracked(question, hooks, d.glyph);
  busy = false;
  d.send.disabled = false;
  if (!turn.answer) {
    if (!turn.failed) d.status.textContent = '';
    view.root.remove();
    setNote(d, '');
    const again = questionToRestore(turn, d.input.value);
    if (again !== null) d.input.value = again;
    return;
  }
  paintTurn(view, turn, true);
  warmPdfCites(view.root);
  if (!turn.failed) d.status.textContent = answerStatus(turn);
  setNote(d, documents ? `Answered from ${documents === 1 ? '1 document' : `${documents} documents`}` : '');
  if (me) await saveHistory(me.email, [...turns, turn]);
}

/** The research panel in the drawer's body, loaded and mounted on first use. */
function drawerResearch(d: Drawer): Promise<ResearchPanel> {
  panel ??= import('./research-panel.ts').then(({ mountResearch }) =>
    mountResearch(d.research, {
      status: (text) => (d.status.textContent = text),
      note: (text) => setNote(d, text),
      glyph: d.glyph,
      onCite: openFromDrawer,
      restore(question) {
        if (!d.input.value.trim()) d.input.value = question;
      },
      current(id) {
        thread = id;
        pageLink(d);
      },
      focusInput: () => d.input.focus(),
    }, 'drawer'),
  );
  return panel;
}

/** The drawer's panel, or null after saying it did not load; the next use tries the import again. */
async function loadedPanel(d: Drawer): Promise<ResearchPanel | null> {
  try {
    return await drawerResearch(d);
  } catch {
    panel = null;
    d.status.textContent = RESEARCH_LOAD_FAILED;
    return null;
  }
}

async function askResearch(question: string): Promise<void> {
  const d = drawer;
  if (!d) return;
  busy = true;
  d.send.disabled = true;
  const research = await loadedPanel(d);
  if (research) await research.ask(question);
  else if (!d.input.value.trim()) d.input.value = question;
  busy = false;
  d.send.disabled = false;
}

/** "Open as page" keeps the mode, and in Research the open thread. */
function pageLink(d: Drawer): void {
  d.page.href = mode === 'research' ? `/ask?mode=research${thread ? `&thread=${encodeURIComponent(thread)}` : ''}` : '/ask';
}

/** Shows one mode's conversation in the body and hides the other's. */
async function setMode(d: Drawer, next: AskMode): Promise<void> {
  mode = next;
  const on = next === 'research';
  d.log.hidden = on;
  d.earlier.hidden = true;
  d.status.textContent = '';
  setNote(d, '');
  pageLink(d);
  if (on) return (await loadedPanel(d))?.show();
  void panel?.then((p) => p.hide(), () => undefined);
  const me = await (window.legallasMe ?? Promise.resolve(null));
  const turns = me ? await loadHistory(me.email) : [];
  if (!busy && mode === 'quick') paintHistory(d, turns.slice(0, -1), turns.at(-1) ?? null);
}

/**
 * Opens the drawer, building it on first use, with focus in the question box. A `question` fills the box first
 * (replacing a draft); it is never sent, the reader presses Ask.
 */
export async function openDrawer(trigger: HTMLElement | null, question?: string): Promise<void> {
  const mount = document.querySelector<HTMLElement>('[data-ask-drawer]');
  if (!mount) return;
  drawer ??= build(mount);
  returnTo = trigger;
  mount.hidden = false;
  setInert(true);
  document.querySelector<HTMLElement>('[data-ask-open]')?.setAttribute('aria-expanded', 'true');
  if (question !== undefined) drawer.input.value = cleanQuestion(question, MAX_CHARS);
  drawer.input.focus();
  drawer.input.setSelectionRange(drawer.input.value.length, drawer.input.value.length);
  if (busy) return;
  const me = await (window.legallasMe ?? Promise.resolve(null));
  const d = drawer;
  if (await researchAvailability()) modes ??= wireModeSwitch(d.modes, (next) => void setMode(d, next));
  if (mode === 'research') return (await loadedPanel(d))?.show();
  const turns = me ? await loadHistory(me.email) : [];
  paintHistory(d, turns.slice(0, -1), turns.at(-1) ?? null);
}

/** Closes the drawer and, unless something else takes focus next, returns it to whatever opened it. */
export function closeDrawer(restoreFocus = true): void {
  if (!drawer || drawer.mount.hidden) return;
  drawer.mount.hidden = true;
  setInert(false);
  document.querySelector<HTMLElement>('[data-ask-open]')?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) returnTo?.focus();
}
