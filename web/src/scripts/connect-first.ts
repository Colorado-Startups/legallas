// SPDX-License-Identifier: Apache-2.0
// Step 1 on the Overview: connect your own AI (components/ConnectFirst.astro). Loaded on demand by the panel's own
// small script once /api/me says the member may connect, so the Overview's eager script stays inside R20. The panel
// is drawn by the page in the default order and held invisible (aria-busy) at its final size; this module puts the
// cards in the member's order, shows one line instead once their AI is connected, and reveals it, so nothing moves.
// The order comes from the counsel email's link (/?ai=claude, /?ai=copilot,harvey), kept in this browser; which
// names count is in connect-order.ts.
import { AI_APPS, cardOrder, chosenOrder, ORDER_KEY, ORDER_PARAM, parseOrder, type AiApp } from './connect-order.ts';
import type { AiStatus } from './room-me.ts';
import { instanceName } from './room-names.ts';
import { mcpHost } from '../../worker/room-settings.ts';
import { appLabel, ORDER_COOKIE } from '../../worker/ai-label.ts';

export { AI_APPS, cardOrder, ORDER_KEY, ORDER_PARAM, parseOrder, type AiApp };

/** legallas-mcp and the resource an AI app adds (mcp/contract.ts MCP_ORIGIN and MCP_RESOURCE; a test pins both). */
export const MCP_ORIGIN = `https://${mcpHost}`;
/** The MCP resource URL that a member's AI app connects to. */
export const MCP_RESOURCE = `${MCP_ORIGIN}/mcp`;

/**
 * Claude's add-connector dialog filled in with the room's name and the resource (pinned to mcp/pages/connect.ts
 * CLAUDE_ADD_URL for the default name, Legallas).
 */
export const CLAUDE_ADD = `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent(instanceName())}&connectorUrl=${encodeURIComponent(MCP_RESOURCE)}`;
/** The /connect sections that hold each tool's admin steps and the Email your IT team buttons. */
export const COPILOT_STEPS = `${MCP_ORIGIN}/connect#copilot`;
/** The connect page anchor that holds the steps for Harvey. */
export const HARVEY_STEPS = `${MCP_ORIGIN}/connect#harvey`;
/** Where a member sees and disconnects their AI apps. */
export const MANAGE_URL = `${MCP_ORIGIN}/connections`;

/** One card on the panel: who does it and how long, and where its one action goes. */
export interface AiCard {
  app: AiApp;
  name: string;
  who: string;
  action: string;
  href: string;
  /** The forest button, for the path a lawyer finishes alone. */
  primary?: boolean;
  /** Opens in a new tab, so the room stays open behind it. */
  newTab?: boolean;
}

/** The cards in AI_APPS order. A new app is one entry here and one name in AI_APPS. */
export const AI_CARDS: readonly AiCard[] = [
  { app: 'claude', name: 'Claude', who: 'You, about 2 minutes', action: 'Add to Claude', href: CLAUDE_ADD, primary: true, newTab: true },
  {
    app: 'copilot',
    name: 'Microsoft 365 Copilot',
    who: `Your IT team adds ${instanceName()} once; then it is in Outlook, Teams and Word`,
    action: 'Steps for your IT team',
    href: COPILOT_STEPS,
  },
  { app: 'harvey', name: 'Harvey', who: 'Your Harvey admin turns it on once', action: 'Steps for your admin', href: HARVEY_STEPS },
];

/** The panel's two shapes: the cards, or the one "Connected" line. */
export type Shape = 'open' | 'connected';

/** The height the panel holds for one load after it shrinks (connect-first.css). */
export const HOLD_PROPERTY = '--ov-ai-hold';
/** What names the panel: the "Step 1" heading, or the Connected line (the heading is not shown then). */
export const TITLE_ID = 'ov-ai-title';
/** The element id of the one-line status of the member's AI. */
export const LINE_ID = 'ov-ai-line';

/** One line once the member's own AI is connected (GET /api/me/ai); an unknown answer keeps the cards. */
export function shapeFor(ai: AiStatus | null): Shape {
  return ai?.connected === true ? 'connected' : 'open';
}

export { appLabel };

/** Storage that may be blocked or absent (private windows, strict settings): every read and write can fail. */
export interface KeptOrder {
  read(): string | null;
  write(value: string): void;
}

const browserStorage: KeptOrder = {
  read: () => {
    try {
      return localStorage.getItem(ORDER_KEY);
    } catch {
      return null;
    }
  },
  write: (value) => {
    try {
      localStorage.setItem(ORDER_KEY, value);
    } catch {
      /* not kept: the default order next time */
    }
  },
};

/**
 * The order to show: the link's when it names one of ours (kept for later visits), else the kept one. The parameter
 * leaves the address bar either way, so a copied or bookmarked room link never carries it.
 */
export function takeOrder(location: Location, history: History, kept: KeptOrder = browserStorage): AiApp[] {
  const url = new URL(location.href);
  const link = url.searchParams.get(ORDER_PARAM);
  const named = chosenOrder(link, kept.read());
  const fromLink = parseOrder(link);
  if (url.searchParams.has(ORDER_PARAM)) {
    url.searchParams.delete(ORDER_PARAM);
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }
  if (fromLink) kept.write(fromLink.join(','));
  return cardOrder(named);
}

/** Whether `order` is other than the default, so the Worker must leave the panel held for this browser (ORDER_COOKIE). */
export function isCustomOrder(order: readonly AiApp[]): boolean {
  return order.some((app, i) => app !== AI_APPS[i]);
}

/** Puts the cards in the member's order (takeOrder), and tells the Worker when this browser keeps its own. */
export function orderCards(root: HTMLElement): void {
  const list = root.querySelector('[data-ov-ai-cards]');
  const order = takeOrder(window.location, window.history);
  for (const app of order) {
    const card = list?.querySelector(`[data-ai="${app}"]`);
    if (card) list?.append(card);
  }
  if (isCustomOrder(order) && typeof document !== 'undefined') document.cookie = `${ORDER_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
}

/** Puts the cards in `order`, fills in the connected line, sets the shape and reveals the panel. Returns the shape. */
export function mountConnectFirst(root: HTMLElement, ai: AiStatus | null): Shape {
  orderCards(root);
  const shape = shapeFor(ai);
  // Laid out as the cards (the first load after connecting, or a new browser) but connected: the box keeps that
  // height for this load, so the page below stays put. The panel's script remembers the shape for the next load.
  if (shape === 'connected' && root.dataset.state === 'open') {
    root.style.setProperty(HOLD_PROPERTY, `${root.getBoundingClientRect().height}px`);
  }
  const via = root.querySelector('[data-ov-ai-via]');
  if (via) via.textContent = appLabel(ai?.via);
  root.dataset.state = shape;
  root.setAttribute('aria-labelledby', shape === 'connected' ? LINE_ID : TITLE_ID);
  root.removeAttribute('aria-busy');
  return shape;
}
