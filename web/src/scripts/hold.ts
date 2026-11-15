// SPDX-License-Identifier: Apache-2.0
// The hold screen (src/pages/hold/index.astro): whether a legal hold is on, its custodians with the unacknowledged ones
// flagged, and one form per step, each posting its fields to its data-hold-post path. textContent only.
import type { Custodian } from '../../worker/hold.ts';
import { holdOnLine } from '../../worker/hold.ts';
import { el } from './dom-el.ts';
import { ROOM_FETCH_HEADERS, showSessionEnded } from './session-ended.ts';

interface HoldView {
  hold: { started_at: string; started_by: string; case_number: string | null } | null;
  custodians: Custodian[];
  notice: string;
}

const part = <T extends HTMLElement = HTMLElement>(name: string) => document.querySelector<T>(`[data-hold-${name}]`)!; // safe: index.astro renders every part
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

/** One custodian's line: who, then each recorded step, or the flag. */
function custodianLine(c: Custodian): string {
  const who = c.name ? `${c.name} (${c.email})` : c.email;
  const notified = c.notified_at ? `notified ${day(c.notified_at)}` : 'not notified yet';
  const ack = c.unacknowledged ? 'NOT ACKNOWLEDGED' : `acknowledged ${day(c.acknowledged_at)}`;
  const reminded = c.last_reminded_at ? `, last reminded ${day(c.last_reminded_at)}` : '';
  return `${who}: ${notified}, ${ack}${reminded}`;
}

function render(view: HoldView): void {
  const { hold } = view;
  part('state').textContent = hold
    ? `${holdOnLine(day(hold.started_at))} Started by ${hold.started_by}${hold.case_number ? `, case ${hold.case_number}` : ''}.`
    : 'No legal hold is on.';
  part('off').hidden = hold !== null;
  part('on').hidden = hold === null;
  part('notice').textContent = view.notice;
  part('custodians').replaceChildren(...view.custodians.map((c) => el('li', c.unacknowledged ? { class: 'hold-flag' } : {}, custodianLine(c))));
}

async function load(): Promise<void> {
  const response = await fetch('/api/hold', { credentials: 'same-origin', headers: ROOM_FETCH_HEADERS });
  if (response.status === 401) return void showSessionEnded();
  if (response.ok) render((await response.json()) as HoldView);
}

for (const form of document.querySelectorAll<HTMLFormElement>('[data-hold-post]')) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const response = await fetch(form.dataset.holdPost!, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { ...ROOM_FETCH_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    if (response.status === 401) return void showSessionEnded();
    if (response.ok) form.reset();
    await load();
  });
}

void load();
