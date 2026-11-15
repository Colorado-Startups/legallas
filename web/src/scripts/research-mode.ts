// SPDX-License-Identifier: Apache-2.0
// The Quick / Research switch (plan D10), on the Ask page and in the drawer. Small on purpose: it is the only
// research code a page loads up front; the research panel (research-panel.ts) loads on the first switch.
//
// Quick stays the default on every page load. The switch shows when GET /api/research (worker/agent/protocol.ts
// ResearchStatus) says research is on for this member, over a transport this page speaks, in this page's protocol
// version. While the kill switch is off it still shows for a member who has saved threads, so they can be read and
// deleted (D12; the room keeps listing, reading and deleting open while it is off), but a question says research is
// off. A refusal, an older Worker or no answer hides it, and Ask is exactly as before. A radio group (DESIGN.md
// section 7, "Selection"): one tab stop, the arrows move the choice, Space or a click chooses. Its styles are
// research-mode.css, imported by chat.ts and chat-drawer.ts (not here, so node tests can import this file).
import {
  RESEARCH_MAX_QUESTION_CHARS, RESEARCH_PATHS, RESEARCH_PROTOCOL, RESEARCH_QUESTION_COST, type ResearchStatus,
} from '../../worker/agent/protocol.ts';
import { ROOM_FETCH_HEADERS, showSessionEnded } from './session-ended.ts';

/** How a question is asked: quick or research. */
export type AskMode = 'quick' | 'research';

/** Said when the research panel's own script fails to load (a dropped connection or a new release). */
export const RESEARCH_LOAD_FAILED = 'Research did not load; reload the page and try again.';

const LABELS: Record<AskMode, string> = { quick: 'Quick', research: 'Research' };
const MODES: readonly AskMode[] = ['quick', 'research'];

/**
 * The status from the wire in a shape this page reads, on or off; null for anything else (another protocol version,
 * a transport this page does not speak, or "on" with no transport).
 */
export function parseStatus(raw: unknown): ResearchStatus | null {
  const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  if (s.protocol !== RESEARCH_PROTOCOL || typeof s.enabled !== 'boolean') return null;
  const transport = s.transport === 'websocket' || s.transport === 'http' ? s.transport : null;
  if (transport === null && s.transport !== null && s.transport !== undefined) return null;
  if (s.enabled && transport === null) return null;
  const whole = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : fallback);
  return {
    protocol: RESEARCH_PROTOCOL,
    enabled: s.enabled,
    transport,
    questionCost: whole(s.questionCost, RESEARCH_QUESTION_COST),
    maxQuestionChars: whole(s.maxQuestionChars, RESEARCH_MAX_QUESTION_CHARS),
  };
}

/** The status from the wire when it says research is on in a shape this page reads; null otherwise. */
export function researchOn(raw: unknown): ResearchStatus | null {
  const status = parseStatus(raw);
  return status?.enabled ? status : null;
}

function roomGet(path: string): Promise<unknown> {
  return fetch(path, { credentials: 'same-origin', headers: ROOM_FETCH_HEADERS }).then((response) => {
    if (response.status === 401) showSessionEnded();
    return response.ok ? response.json() : null;
  });
}

let status: Promise<ResearchStatus | null> | null = null;

/** GET /api/research, once per page (the page and the drawer share it). Null when unknown or unreadable. */
export function researchStatus(): Promise<ResearchStatus | null> {
  status ??= roomGet(RESEARCH_PATHS.status).then(parseStatus, () => null);
  return status;
}

/** Whether the switch shows: research `on`, only `saved` threads to read and delete while it is off, or not at all. */
export type Availability = 'on' | 'saved' | null;

/**
 * What the room allows this member now. With research off, one GET of the thread list says whether there is anything
 * to read or delete; a member who may not ask is refused it, and sees no switch.
 */
export async function checkAvailability(current: ResearchStatus | null): Promise<Availability> {
  if (!current) return null;
  if (current.enabled) return 'on';
  const threads = await roomGet(RESEARCH_PATHS.threads).catch(() => null);
  return Array.isArray(threads) && threads.length > 0 ? 'saved' : null;
}

let availability: Promise<Availability> | null = null;

/** checkAvailability of this page's status, once per page. */
export function researchAvailability(): Promise<Availability> {
  availability ??= researchStatus().then(checkAvailability);
  return availability;
}

/** The mode a key moves to from `from`: any arrow flips between the two, Home and End go to the ends. */
export function modeKey(key: string, from: AskMode): AskMode | null {
  if (key === 'Home') return 'quick';
  if (key === 'End') return 'research';
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return from === 'quick' ? 'research' : 'quick';
  return null;
}

/** The quick or research switch: read the current mode and set it. */
export interface ModeSwitch {
  mode(): AskMode;
  /** Chooses `mode` as a click would, telling the listener; no-op when it is already chosen. */
  set(mode: AskMode): void;
}

/** The switch's markup, for the drawer (the page has the same markup in ask.astro). */
export function buildModeSwitch(): HTMLElement {
  const group = document.createElement('div');
  group.className = 'ask-mode';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Answer mode');
  group.hidden = true;
  for (const mode of MODES) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'c-button ask-mode__option';
    option.setAttribute('role', 'radio');
    option.dataset.askMode = mode;
    option.textContent = LABELS[mode];
    group.append(option);
  }
  return group;
}

/** Wires a switch's radios and shows it; `onChange` hears each new choice. Starts at Quick. */
export function wireModeSwitch(group: HTMLElement, onChange: (mode: AskMode) => void): ModeSwitch {
  const options = [...group.querySelectorAll<HTMLButtonElement>('[data-ask-mode]')];
  let current: AskMode = 'quick';
  const paint = () => {
    for (const option of options) {
      const on = option.dataset.askMode === current;
      option.setAttribute('aria-checked', String(on));
      option.tabIndex = on ? 0 : -1;
    }
  };
  const set = (mode: AskMode, focus = false) => {
    if (focus) options.find((o) => o.dataset.askMode === mode)?.focus();
    if (mode === current) return;
    current = mode;
    paint();
    onChange(mode);
  };
  for (const option of options) {
    option.addEventListener('click', () => set(option.dataset.askMode === 'research' ? 'research' : 'quick'));
  }
  group.addEventListener('keydown', (event) => {
    const next = event.metaKey || event.ctrlKey || event.altKey ? null : modeKey(event.key, current);
    if (next === null) return;
    event.preventDefault();
    set(next, true);
  });
  paint();
  group.hidden = false;
  return { mode: () => current, set: (mode) => set(mode) };
}
