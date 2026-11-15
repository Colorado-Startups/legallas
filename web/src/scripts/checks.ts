// SPDX-License-Identifier: Apache-2.0
// The public-records approval page (src/pages/checks/index.astro): reads the request id from the URL, loads
// /api/checks/:id and posts the member's decision. Renders with textContent and el() only. Pure helpers are in
// checks-model.ts, tested in node.
import { el } from './dom-el.ts';
import { checkIdFrom, kindWords, stateSentence, type CheckView } from './checks-model.ts';
import { ROOM_FETCH_HEADERS, showSessionEnded } from './session-ended.ts';

const part = <T extends Element = HTMLElement>(name: string) => document.querySelector<T>(`[data-check-${name}]`)!; // safe: index.astro renders every part
const panel = part('panel');
const missing = part('missing');
const status = part('status');
const actions = part('actions');
const approve = part<HTMLButtonElement>('approve');
const decline = part<HTMLButtonElement>('decline');

const id = checkIdFrom(location.search);
const path = id ? `/api/checks/${encodeURIComponent(id)}` : null;

function render(view: CheckView): void {
  part('via').textContent = view.via;
  part('name').textContent = view.name;
  part('kind').textContent = kindWords(view.kind);
  part('sends').replaceChildren(...view.sendsTo.map((s) => el('li', {}, `${s.source} (${s.operator}), at ${s.host}`)));
  part('hand').replaceChildren(...view.byHand.map((s) => el('li', {}, el('a', { href: s.link, rel: 'noopener noreferrer', target: '_blank' }, s.source))));
  status.textContent = stateSentence(view, new Date());
  actions.hidden = view.state !== 'pending';
  panel.hidden = false;
  missing.hidden = true;
}

function showMissing(): void {
  panel.hidden = true;
  missing.hidden = false;
}

async function load(): Promise<void> {
  if (!path) return showMissing();
  const response = await fetch(path, { credentials: 'same-origin', headers: ROOM_FETCH_HEADERS });
  if (response.status === 401) return void showSessionEnded();
  if (!response.ok) return showMissing();
  render((await response.json()) as CheckView);
}

async function decide(decision: 'approve' | 'decline'): Promise<void> {
  if (!path) return;
  approve.disabled = true;
  decline.disabled = true;
  status.textContent = decision === 'approve' ? 'Approving…' : 'Declining…';
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { ...ROOM_FETCH_HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ decision }),
  });
  approve.disabled = false;
  decline.disabled = false;
  if (response.status === 401) return void showSessionEnded();
  if (response.ok) return render((await response.json()) as CheckView);
  if (response.status === 409) return void load();
  status.textContent = 'That did not work. The request may have lapsed; ask your AI to run the check again.';
}

approve.addEventListener('click', () => void decide('approve'));
decline.addEventListener('click', () => void decide('decline'));
void load().catch(() => showMissing());
