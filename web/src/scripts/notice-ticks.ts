// SPDX-License-Identifier: Apache-2.0
// The Activity page's Full notice panel (A3): each member, the last version of the full notice they ticked, when, and
// whether that is the current version. GET /api/activity/notice answers the owner only; anyone else sees no panel.
import type { NoticeTick } from '../../worker/notice-gate.ts';
import { formatWhen, tickStatus } from './activity-model.ts';
import { el } from './dom-el.ts';

async function load(): Promise<void> {
  const panel = document.querySelector<HTMLElement>('[data-notice-panel]');
  const rows = document.querySelector<HTMLElement>('[data-notice-rows]');
  const current = document.querySelector<HTMLElement>('[data-notice-current]');
  if (!panel || !rows || !current) return;
  let body: { current: string; members: NoticeTick[] } | null = null;
  try {
    const response = await fetch('/api/activity/notice', { credentials: 'same-origin' });
    if (response.ok) body = (await response.json()) as { current: string; members: NoticeTick[] };
  } catch {
    // No panel: the ledger above stands on its own.
  }
  if (!body) return;
  current.textContent = body.current;
  rows.replaceChildren(
    ...body.members.map((tick) =>
      el(
        'tr',
        {},
        el('td', {}, tick.name ? `${tick.name} (${tick.email})` : tick.email),
        el('td', { class: 'u-mono' }, tick.version ?? ''),
        el('td', { class: 'u-mono' }, tick.ticked_at ? formatWhen(new Date(tick.ticked_at)) : ''),
        el('td', {}, tickStatus(tick)),
      ),
    ),
  );
  panel.hidden = false;
}

void load();
