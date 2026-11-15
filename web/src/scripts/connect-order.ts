// SPDX-License-Identifier: Apache-2.0

/** The room's stored name as a literal (worker/stored-name.ts): the minified key stays one, and a stored key can be read. */
declare const ROOM_STORED_NAME: string | undefined;
// Which cards the Overview's Step 1 panel shows, and in what order (scripts/connect-first.ts). The order comes from
// the counsel email's link (/?ai=claude, /?ai=copilot,harvey), kept in this browser.

/** Every name the link may carry, in the default order. */
export const AI_APPS = ['claude', 'copilot', 'harvey'] as const;
/** One of the AI apps the connect page covers. */
export type AiApp = (typeof AI_APPS)[number];

/** The query parameter the counsel emails set, and where this browser keeps the order it named. */
export { ORDER_PARAM } from '../../worker/ai-label.ts';
/** The local-storage key that holds the AI order a counsel email named. */
export const ORDER_KEY = `${typeof ROOM_STORED_NAME === 'string' ? ROOM_STORED_NAME : 'legallas'}.connect-first.order`;
/** A longer value is not one of ours: the three names and two commas are 20 characters. */
const MAX_ORDER = 64;

/** The names in `raw` that are ours, in its order and once each; null when it names none (or is not ours at all). */
export function parseOrder(raw: string | null | undefined): AiApp[] | null {
  if (!raw || raw.length > MAX_ORDER) return null;
  const named: AiApp[] = [];
  for (const part of raw.split(',')) {
    const name = part.trim().toLowerCase();
    if ((AI_APPS as readonly string[]).includes(name) && !named.includes(name as AiApp)) named.push(name as AiApp);
  }
  return named.length > 0 ? named : null;
}

/** This visit's names: the link's when it names one of ours, else the kept ones; null when neither does. */
export function chosenOrder(fromLink: string | null | undefined, kept: string | null | undefined): AiApp[] | null {
  return parseOrder(fromLink) ?? parseOrder(kept);
}

/** Every card, the named ones first, then the rest in the default order. */
export function cardOrder(named: readonly AiApp[] | null): AiApp[] {
  const first = named ?? [];
  return [...first, ...AI_APPS.filter((app) => !first.includes(app))];
}
