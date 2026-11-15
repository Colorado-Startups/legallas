// SPDX-License-Identifier: Apache-2.0
// Step 1 on the Overview (connect-first.ts, components/ConnectFirst.astro): the Add to Claude link is the /connect
// page's own, the email link's ?ai= order is checked, kept and dropped from the address bar, and the panel shows
// its cards or one Connected line; every card that links to /connect lands on a section that page has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONNECT_PATH, MCP_ORIGIN as CONTRACT_ORIGIN, MCP_RESOURCE as CONTRACT_RESOURCE } from '../../mcp/contract.ts';
import { CLAUDE_ADD_URL, renderConnectPage } from '../../mcp/pages/connect.ts';
import {
  AI_APPS, AI_CARDS, appLabel, cardOrder, CLAUDE_ADD, COPILOT_STEPS, HARVEY_STEPS, HOLD_PROPERTY, LINE_ID,
  MANAGE_URL, MCP_ORIGIN, MCP_RESOURCE, mountConnectFirst, ORDER_KEY, parseOrder, shapeFor, takeOrder, TITLE_ID,
  type KeptOrder, type Shape,
} from './connect-first.ts';
import { chosenOrder } from './connect-order.ts';
import { loadAi, type AiStatus } from './room-me.ts';

const SRC = join(import.meta.dirname, '..');

test('Add to Claude is exactly the /connect page link, built from the MCP resource', () => {
  assert.equal(MCP_ORIGIN, CONTRACT_ORIGIN);
  assert.equal(MCP_RESOURCE, CONTRACT_RESOURCE);
  assert.equal(CLAUDE_ADD, CLAUDE_ADD_URL);
  assert.equal(new URL(CLAUDE_ADD).searchParams.get('connectorUrl'), MCP_RESOURCE);
});

test('the Copilot and Harvey cards land on their own sections of /connect', () => {
  assert.equal(COPILOT_STEPS, `${CONTRACT_ORIGIN}${CONNECT_PATH}#copilot`);
  assert.equal(HARVEY_STEPS, `${CONTRACT_ORIGIN}${CONNECT_PATH}#harvey`);
  const page = renderConnectPage();
  for (const id of ['copilot', 'harvey']) assert.match(page, new RegExp(`<section[^>]*\\bid="${id}"`), `/connect#${id}`);
  assert.equal(MANAGE_URL, `${CONTRACT_ORIGIN}/connections`);
});

test('the cards say who does it and how long, with one action each; only Claude is a new tab and the primary', () => {
  const byApp = Object.fromEntries(AI_CARDS.map((card) => [card.app, card]));
  assert.deepEqual(byApp.claude, { app: 'claude', name: 'Claude', who: 'You, about 2 minutes', action: 'Add to Claude', href: CLAUDE_ADD, primary: true, newTab: true });
  assert.equal(byApp.copilot?.name, 'Microsoft 365 Copilot');
  assert.equal(byApp.copilot?.who, 'Your IT team adds Legallas once; then it is in Outlook, Teams and Word');
  assert.equal(byApp.copilot?.href, COPILOT_STEPS);
  assert.equal(byApp.harvey?.who, 'Your Harvey admin turns it on once');
  assert.equal(byApp.harvey?.href, HARVEY_STEPS);
  for (const card of AI_CARDS.filter((c) => c.app !== 'claude')) assert.ok(!card.primary && !card.newTab, card.app);
  for (const card of AI_CARDS) assert.doesNotMatch(card.href, /^mailto:/i, `${card.app}: the Email buttons live on /connect`);
});

test('parseOrder keeps our names, in the link\'s order and once each, and nothing else', () => {
  assert.deepEqual(parseOrder('claude'), ['claude']);
  assert.deepEqual(parseOrder('copilot,harvey'), ['copilot', 'harvey']);
  assert.deepEqual(parseOrder(' Harvey , COPILOT '), ['harvey', 'copilot']);
  assert.deepEqual(parseOrder('harvey,harvey,claude'), ['harvey', 'claude']);
  assert.deepEqual(parseOrder('claude,chatgpt'), ['claude']);
  for (const none of [null, undefined, '', ',', 'chatgpt', 'claude'.padEnd(65, ' ')]) assert.equal(parseOrder(none), null, String(none));
});

test('cardOrder shows every card, the named ones first, the rest in the default order', () => {
  assert.deepEqual(AI_APPS, ['claude', 'copilot', 'harvey']);
  assert.deepEqual(cardOrder(null), ['claude', 'copilot', 'harvey']);
  assert.deepEqual(cardOrder(['claude']), ['claude', 'copilot', 'harvey']);
  assert.deepEqual(cardOrder(['copilot', 'harvey']), ['copilot', 'harvey', 'claude']);
  assert.deepEqual(cardOrder(['harvey']), ['harvey', 'claude', 'copilot']);
});

/** A browser address bar and history: replaceState records the URLs it was given. */
function addressBar(href: string) {
  const location = { href } as Location;
  const replaced: string[] = [];
  const history = { state: null, replaceState: (_state: unknown, _title: string, url: string) => replaced.push(url) } as unknown as History;
  return { location, history, replaced };
}

function memory(initial: string | null = null): KeptOrder & { value: string | null } {
  return {
    value: initial,
    read() {
      return this.value;
    },
    write(value) {
      this.value = value;
    },
  };
}

test('takeOrder: the email link sets the order, keeps it for later visits and leaves the address bar', () => {
  const kept = memory();
  const first = addressBar('https://legallas.example/?ai=copilot,harvey');
  assert.deepEqual(takeOrder(first.location, first.history, kept), ['copilot', 'harvey', 'claude']);
  assert.deepEqual(first.replaced, ['/']);
  assert.equal(kept.value, 'copilot,harvey');

  const later = addressBar('https://legallas.example/');
  assert.deepEqual(takeOrder(later.location, later.history, kept), ['copilot', 'harvey', 'claude']);
  assert.deepEqual(later.replaced, [], 'nothing to drop');

  const relinked = addressBar('https://legallas.example/?ai=claude');
  assert.deepEqual(takeOrder(relinked.location, relinked.history, kept), ['claude', 'copilot', 'harvey']);
  assert.equal(kept.value, 'claude', 'a newer link replaces the kept order');
});

test('takeOrder: a value that is not ours is dropped from the address bar and changes nothing', () => {
  const kept = memory('harvey');
  const bar = addressBar('https://legallas.example/?x=1&ai=%3Cscript%3E#keys');
  assert.deepEqual(takeOrder(bar.location, bar.history, kept), ['harvey', 'claude', 'copilot']);
  assert.deepEqual(bar.replaced, ['/?x=1#keys'], 'other parameters and the hash stay');
  assert.equal(kept.value, 'harvey');

  const tampered = memory('claude;evil');
  const plain = addressBar('https://legallas.example/');
  assert.deepEqual(takeOrder(plain.location, plain.history, tampered), ['claude', 'copilot', 'harvey']);
});

/** Swaps globalThis.localStorage for the test (Node has none without --localstorage-file). */
function withStorage(storage: unknown, run: () => void): void {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try {
    run();
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
}

test('takeOrder: blocked storage never throws; the link still orders this visit', () => {
  const blocked = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  withStorage(blocked, () => {
    const bar = addressBar('https://legallas.example/?ai=harvey');
    assert.deepEqual(takeOrder(bar.location, bar.history), ['harvey', 'claude', 'copilot']);
    const plain = addressBar('https://legallas.example/');
    assert.deepEqual(takeOrder(plain.location, plain.history), ['claude', 'copilot', 'harvey']);
  });

  const saved = new Map<string, string>();
  withStorage({ getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v) }, () => {
    const bar = addressBar('https://legallas.example/?ai=copilot');
    takeOrder(bar.location, bar.history);
    assert.deepEqual([...saved], [[ORDER_KEY, 'copilot']]);
  });
});

test('shapeFor: one line only when /api/me/ai says this member\'s AI is connected', () => {
  assert.equal(shapeFor({ connected: true, via: 'claude.ai', at: '2026-10-20T12:00:00.000Z' }), 'connected');
  assert.equal(shapeFor({ connected: false, via: null, at: null }), 'open');
  assert.equal(shapeFor(null), 'open', 'no answer, or an older Worker without /api/me/ai');
});

test('loadAi asks /api/me/ai with a timeout; an older Worker, an error or a failed request is null', async (t) => {
  const ai: AiStatus = { connected: true, via: 'Harvey', at: '2026-10-20T12:00:00.000Z' };
  const answers: (() => Promise<Response>)[] = [
    async () => Response.json({ ai }),
    async () => new Response('not found', { status: 404 }),
    async () => Response.json({}),
    async () => {
      throw new TypeError('offline');
    },
  ];
  const seen: { url: string; signal: unknown }[] = [];
  t.mock.method(globalThis, 'fetch', (input: unknown, init?: RequestInit) => (seen.push({ url: String(input), signal: init?.signal }), answers.shift()!()));
  assert.deepEqual(await loadAi(), ai);
  for (let i = 0; i < 3; i++) assert.equal(await loadAi(), null);
  assert.ok(seen.every((s) => s.url === '/api/me/ai' && s.signal instanceof AbortSignal), 'same origin, with a timeout signal');
});

test('appLabel names Claude by its domain and any other app by its own name', () => {
  assert.equal(appLabel('claude.ai'), 'Claude');
  assert.equal(appLabel('Claude.com'), 'Claude');
  assert.equal(appLabel('Harvey'), 'Harvey');
  assert.equal(appLabel(' Microsoft 365 Copilot '), 'Microsoft 365 Copilot');
  for (const none of [null, undefined, '', '  ']) assert.equal(appLabel(none), 'your AI');
});

/**
 * Just enough DOM for mountConnectFirst: a card list whose append() moves a card to the end, the via slot, and a
 * root laid out in `laidOut` (the shape this browser saw last) whose style records custom properties.
 */
function panel(laidOut: Shape = 'open', drawn: readonly string[] = ['claude', 'copilot', 'harvey']) {
  const cards = new Map(drawn.map((app) => [app, { app }]));
  const list = {
    order: [...drawn],
    cards,
    querySelector(selector: string) {
      const app = /data-ai="(\w+)"/.exec(selector)?.[1];
      return app && this.order.includes(app) ? cards.get(app)! : null;
    },
    append(card: { app: string }) {
      this.order = [...this.order.filter((a) => a !== card.app), card.app];
    },
  };
  const via = { textContent: '' };
  const attrs = new Map([['aria-busy', 'true']]);
  const style = new Map<string, string>();
  const root = {
    dataset: { state: laidOut } as Record<string, string>,
    style: { setProperty: (name: string, value: string) => style.set(name, value) },
    getBoundingClientRect: () => ({ height: laidOut === 'open' ? 251.5 : 24 }),
    querySelector: (selector: string) => (selector === '[data-ov-ai-cards]' ? list : selector === '[data-ov-ai-via]' ? via : null),
    removeAttribute: (name: string) => attrs.delete(name),
    setAttribute: (name: string, value: string) => attrs.set(name, value),
  };
  return { root: root as unknown as HTMLElement, list, via, attrs, style, dataset: root.dataset };
}

test('mountConnectFirst orders the cards, names the app, reveals the panel in its shape and holds a shrink once', () => {
  const bar = addressBar('https://legallas.example/?ai=copilot,harvey');
  const before = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: { location: bar.location, history: bar.history }, configurable: true, writable: true });
  try {
    withStorage(undefined, () => {
      const open = panel();
      assert.equal(mountConnectFirst(open.root, null), 'open');
      assert.deepEqual(open.list.order, ['copilot', 'harvey', 'claude']);
      assert.equal(open.dataset.state, 'open');
      assert.equal(open.attrs.has('aria-busy'), false, 'revealed');
      assert.equal(open.style.size, 0, 'nothing to hold');
      assert.equal(open.attrs.get('aria-labelledby'), TITLE_ID, 'named by the Step 1 heading');

      const connected: AiStatus = { connected: true, via: 'claude.ai', at: '2026-10-20T12:00:00.000Z' };
      const justConnected = panel('open');
      assert.equal(mountConnectFirst(justConnected.root, connected), 'connected');
      assert.equal(justConnected.via.textContent, 'Claude');
      assert.equal(justConnected.dataset.state, 'connected');
      assert.equal(justConnected.attrs.get('aria-labelledby'), LINE_ID, 'the heading is hidden: named by the line');
      assert.deepEqual([...justConnected.style], [[HOLD_PROPERTY, '251.5px']], 'laid out as cards: keeps that height this load');

      const stillConnected = panel('connected');
      assert.equal(mountConnectFirst(stillConnected.root, connected), 'connected');
      assert.equal(stillConnected.style.size, 0, 'laid out as the line already: nothing to hold');

      const disconnected = panel('connected');
      assert.equal(mountConnectFirst(disconnected.root, null), 'open', 'kept as the line, now not connected');
      assert.equal(disconnected.dataset.state, 'open');
      assert.equal(disconnected.attrs.get('aria-labelledby'), TITLE_ID);
    });
  } finally {
    if (before) Object.defineProperty(globalThis, 'window', before);
    else delete (globalThis as { window?: unknown }).window;
  }
});

test('with no script at all, the hold on the panel and the page below lapses by itself within 2 s', () => {
  const css = readFileSync(join(SRC, 'styles/connect-first.css'), 'utf8');
  const held = /\.ov-ai\[aria-busy='true'\],\s*\.ov-ai\[aria-busy='true'\]:not\(\[data-state='open'\]\) ~ \* \{([^}]*)\}/.exec(css);
  assert.ok(held, 'the panel and everything after it are held by one rule');
  const body = held[1]!;
  assert.match(body, /visibility: hidden;/);
  const failsafe = /animation: ov-ai-failsafe 0s linear (\d+(?:\.\d+)?)s forwards;/.exec(body);
  assert.ok(failsafe, 'both held selectors carry the failsafe');
  assert.ok(Number(failsafe[1]) > 0 && Number(failsafe[1]) <= 2, `lapses within 2 s, not ${failsafe[1]} s`);
  assert.match(css, /@keyframes ov-ai-failsafe \{\s*to \{\s*visibility: visible;\s*\}\s*\}/, 'the step shows them');
  assert.doesNotMatch(css, /prefers-reduced-motion/, 'a visibility step, not motion: nothing may switch it off');
});

test('the panel is drawn first on the Overview, in the default order, with no mailto copies', () => {
  const overview = readFileSync(join(SRC, 'pages/index.astro'), 'utf8');
  const body = overview.slice(overview.indexOf('<Room'));
  assert.match(body, /^<Room[^>]*>\s*<ConnectFirst \/>/, 'Step 1 comes before the case header');

  const component = readFileSync(join(SRC, 'components/ConnectFirst.astro'), 'utf8');
  assert.match(component, /AI_CARDS\.map\(\(card\) =>/, 'the cards come from AI_CARDS, so a new app is one entry');
  assert.deepEqual(AI_CARDS.map((card) => card.app), [...AI_APPS], 'no script: the default order');
  assert.match(component, /data-state="unset" aria-busy="true"/, 'held invisible until laid out and ordered');
  for (const id of [TITLE_ID, LINE_ID]) assert.match(component, new RegExp(`\\bid="${id}"`), `aria-labelledby can name #${id}`);
  assert.match(component, /target=\{card\.newTab \? '_blank' : undefined\}\s*rel=\{card\.newTab \? 'noopener noreferrer' : undefined\}/, 'a new tab never keeps an opener');
  assert.doesNotMatch(component, /mailto:/i);
  assert.match(component, /\bimport\('\.\.\/scripts\/connect-first\.ts'\)/, 'the module loads on demand');
  assert.match(component, /const ai = loadAi\(\);/, '/api/me/ai is asked alongside /api/me, not after it');
});

test('every Overview card that links to /connect lands on a section the page has, and Google is on neither', () => {
  const page = renderConnectPage();
  assert.deepEqual(AI_CARDS.map((card) => card.app), [...AI_APPS]);
  for (const card of AI_CARDS) {
    const url = new URL(card.href);
    if (url.origin !== CONTRACT_ORIGIN || url.pathname !== CONNECT_PATH) continue;
    assert.match(page, new RegExp(`<section[^>]*\\bid="${url.hash.slice(1)}"`), card.href);
  }
  // The only closed models the room connects are Claude, Copilot and Harvey (2026-10-31): no Google section or card.
  assert.doesNotMatch(page, /\bid="google"|Gemini/);
  assert.equal(parseOrder('google'), null, 'an old ?ai=google link names no card');
});

test('chosenOrder is takeOrder\'s choice: the link when it names one of ours, else the kept order', () => {
  assert.deepEqual(chosenOrder('harvey', 'claude'), ['harvey']);
  assert.deepEqual(chosenOrder('<script>', 'copilot,harvey'), ['copilot', 'harvey']);
  assert.deepEqual(chosenOrder(null, 'harvey'), ['harvey']);
  assert.equal(chosenOrder(null, null), null);
  assert.equal(chosenOrder('chatgpt', 'claude;evil'), null);
  for (const [link, kept] of [['harvey', null], ['claude', 'copilot'], [null, 'harvey'], ['x', 'copilot']] as const) {
    const bar = addressBar(link ? `https://legallas.example/?ai=${link}` : 'https://legallas.example/');
    assert.deepEqual(takeOrder(bar.location, bar.history, memory(kept)), cardOrder(chosenOrder(link, kept)), `${link} ${kept}`);
  }
});

test('the page draws every card, and the eager script holds no order logic: the panel module orders them', () => {
  const component = readFileSync(join(SRC, 'components/ConnectFirst.astro'), 'utf8');
  assert.match(component, /<li class="ov-ai__card" data-ai=\{card\.app\}>/);
  assert.doesNotMatch(component, /data-opt-in|hidden=\{/);
  const script = component.slice(component.indexOf('<script>'));
  assert.doesNotMatch(script, /from '\.\.\/scripts\/connect-(?:first|order)\.ts'/, 'the panel module still loads on demand only');
});

test('only an order other than the default is custom, which keeps the Worker from shaping the panel (#204)', async () => {
  const { isCustomOrder } = await import('./connect-first.ts');
  assert.equal(isCustomOrder(['claude', 'copilot', 'harvey']), false);
  assert.equal(isCustomOrder(['harvey', 'claude', 'copilot']), true);
  assert.equal(isCustomOrder(['claude', 'harvey', 'copilot']), true);
});
