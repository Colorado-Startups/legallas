// SPDX-License-Identifier: Apache-2.0
// Fills in who is signed in. Any page can read the result from window.legallasMe (or meCan in
// room-me.ts). html[data-role] and html[data-cannot] drive the role rules in header.css.
import { loadMe } from './room-me.ts';

void loadMe().then((me) => {
  if (!me) return;
  for (const el of document.querySelectorAll<HTMLElement>('[data-me-email]')) el.textContent = me.name ?? me.email;
  const root = document.documentElement;
  root.dataset.role = me.role;
  const cannot = Object.entries(me.can ?? {}).filter(([, allowed]) => allowed === false).map(([action]) => action);
  if (cannot.length > 0) root.dataset.cannot = cannot.join(' ');
  // The Proposals link stays hidden unless the room's proposals are on (an older Worker never says so).
  if (me.proposals) for (const link of document.querySelectorAll<HTMLElement>('[data-proposals-link]')) link.hidden = false;
  // The same for the company checklist.
  if (me.checklist) for (const link of document.querySelectorAll<HTMLElement>('[data-checklist-link]')) link.hidden = false;
});

export {};
