// SPDX-License-Identifier: Apache-2.0
// The header's Account menu (R65; at every width since the owner's 2026-10-03 ruling). Who is signed in, Connect AI, the
// owner's Activity and Sign out sit in a native <details> beside Ask, so the bar holds only the brand, the six
// sections, Ask and the Account summary. <details> is closed from the first paint and opens with no script, so
// nothing in the header moves when /api/me answers, and Sign out works without this file.
//
// A disclosure, not an ARIA menu: the panel holds ordinary links in tab order, and <details> owns the open state
// ([open]) and Enter or Space on the summary. This adds only what <details> lacks, with the <details> element as
// the boundary: Escape closes it and returns focus to the summary, and a pointerdown or focus outside it closes it
// (so Shift+Tab back onto Ask closes it too).
function initAccount(): void {
  const menu = document.querySelector<HTMLDetailsElement>('details[data-account]');
  const summary = menu?.querySelector('summary');
  if (!menu || !summary) return;

  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !menu.open) return;
    // This Escape only closes the menu: the people page's document listener would also close an open profile.
    event.stopPropagation();
    menu.open = false;
    summary.focus();
  });
  document.addEventListener('pointerdown', (event) => {
    if (menu.open && !menu.contains(event.target as Node)) menu.open = false;
  });
  menu.addEventListener('focusout', (event) => {
    const next = event.relatedTarget as Node | null;
    if (menu.open && next && !menu.contains(next)) menu.open = false;
  });
}

initAccount();

export {};
