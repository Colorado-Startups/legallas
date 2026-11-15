// SPDX-License-Identifier: Apache-2.0
// The Overview below the case header: the violations over time (overview-case-ribbon.ts) into
// [data-overview-ribbon]. The chronology, people, claims and binder each have their own page now, so the Overview
// no longer repeats them. Data: GET /api/matter. The block carries its own heading and count, and says in one
// sentence when its part has not been built.
import '../styles/overview-case.css';
import '../styles/overview-case-reserve.css';
import { initExhibitLinks } from './exhibit-pane.ts';
import { pageMatter } from './matter-api.ts';
import { emptyState } from './overview-case-dom.ts';
import { ribbonBlock } from './overview-case-ribbon.ts';
import { settle } from './page-load.ts';

function fill(root: HTMLElement, content: HTMLElement): void {
  root.replaceChildren(content);
  root.removeAttribute('aria-busy');
}

/** The fetch or the drawing can fail; either way the band says so in one sentence, never stays empty and busy. */
async function start(): Promise<void> {
  const ribbon = document.querySelector<HTMLElement>('[data-overview-ribbon]');
  if (!ribbon) return;
  ribbon.setAttribute('aria-busy', 'true');
  // One sentence, once: the header above already reports a failure to the guide, so no failed() here.
  await settle((state) => {
    if (state === 'error') fill(ribbon, emptyState('The case picture could not load; reload the page to try again.'));
  }, async () => {
    initExhibitLinks();
    fill(ribbon, ribbonBlock(await pageMatter()));
    return 'ready';
  });
}

void start();
