// SPDX-License-Identifier: Apache-2.0
// What the Worker (overview-ai.ts) and the Overview AI panel's script (src/scripts/connect-first.ts) must agree on: the
// app name in the "Connected: ..." line, and how a browser says it keeps its own card order.

/** audit_log.via is a Claude client's verified domain, else the app's own name. */
export function appLabel(via: string | null | undefined): string {
  const name = (via ?? '').trim();
  if (/^claude\.(ai|com)$/i.test(name)) return 'Claude';
  return name || 'your AI';
}

/**
 * Set by the panel's script once this browser keeps a card order other than the default (a counsel link chose it). The
 * Worker then sends the Overview as built, so the script can reorder the cards while the panel is still held invisible:
 * reordering cards already on screen would be a layout shift. It holds no more than that the order is custom.
 */
export const ORDER_COOKIE = 'ai_order';

/** The link parameter that names a card order (src/scripts/connect-order.ts ORDER_PARAM). */
export const ORDER_PARAM = 'ai';
