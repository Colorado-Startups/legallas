// SPDX-License-Identifier: Apache-2.0
// Card P4 (Claims & Proof, now the prior case). The page entry: loads the matter, then draws the three views of the
// counts (Matrix, By count, Table) and Money in the record. Counts appear as pleaded, with no status line. The page
// shell is static (claims/index.astro); everything matter-specific arrives from GET /api/matter at run time.

import { pageMatter, type ServedMatter } from './matter-api.ts';
import { settle, type LoadState } from './page-load.ts';
import { buildClaimsModel, type ClaimsModel } from './claims-model.ts';
import { renderMatrix } from './claims-matrix.ts';
import { renderGaps, showDetail } from './claims-aside.ts';
import { renderByCount, renderProofTable } from './claims-bycount.ts';
import { renderMoney } from './claims-money.ts';
import { priorStatus } from '../../worker/room-settings.ts';

type View = 'matrix' | 'count' | 'table';
const VIEWS: readonly View[] = ['matrix', 'count', 'table'];

function q<T extends HTMLElement>(hook: string): T | null {
  return document.querySelector<T>(`[data-claims-${hook}]`);
}

/** Phones start on By count; wider screens on the Matrix. A person's choice holds for the visit. */
function initialView(): View {
  try {
    const saved = sessionStorage.getItem('claims-view') as View | null;
    if (saved && VIEWS.includes(saved)) return saved;
  } catch {
    // Storage can be blocked; the width default still applies.
  }
  return matchMedia('(max-width: 48rem)').matches ? 'count' : 'matrix';
}

function setView(view: View, chosen = false): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-claims-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.claimsView === view));
  }
  for (const panel of document.querySelectorAll<HTMLElement>('[data-claims-panel]')) {
    panel.hidden = panel.dataset.claimsPanel !== view;
  }
  if (!chosen) return;
  try {
    sessionStorage.setItem('claims-view', view);
  } catch {
    // Not remembered; nothing else changes.
  }
}

function summary(model: ClaimsModel, matter: ServedMatter): void {
  const counts = model.claims.length;
  const gaps = model.gaps.length;
  const lead = q('lead');
  if (lead) {
    // The prior case: the pleading closed, so its counts are history, kept for reference (2026-10-02).
    const pleading = (matter.meta.priorCase ?? matter.meta).operativePleading?.title || 'complaint';
    const which = counts === 1 ? 'The count' : `The ${counts} counts`;
    lead.textContent = `${which} as pleaded in the ${priorStatus} ${pleading}, kept for reference.`;
  }
  const tally = q('tally');
  if (tally) {
    tally.textContent = `${counts} ${counts === 1 ? 'count' : 'counts'}, ${model.elementCount} `
      + `${model.elementCount === 1 ? 'element' : 'elements'}, ${gaps} ${gaps === 1 ? 'gap' : 'gaps'}`;
  }
}

function draw(matter: ServedMatter): void {
  const model = buildClaimsModel(matter);
  summary(model, matter);
  const detail = q('detail');
  const matrix = q('matrix');
  if (matrix && detail) {
    showDetail(detail, null);
    renderMatrix(matrix, model, matter, (selection) => showDetail(detail, selection));
  }
  const gaps = q('gaps');
  if (gaps) renderGaps(gaps, model);
  const count = q('bycount');
  if (count) renderByCount(count, model, matter);
  const table = q('table');
  if (table) renderProofTable(table, model);
  const money = q('money');
  if (money && renderMoney(money, matter)) money.closest<HTMLElement>('[data-claims-money-section]')?.removeAttribute('hidden');
}

function showState(state: LoadState): void {
  q('loading')?.setAttribute('hidden', '');
  for (const ready of document.querySelectorAll<HTMLElement>('[data-claims-ready]')) ready.hidden = state !== 'ready';
  const empty = q('empty');
  if (empty) empty.hidden = state !== 'empty';
  const error = q('error');
  if (error) error.hidden = state !== 'error';
}

/** Every step can fail (the fetch, the data, a part that throws while drawing); each one ends on the error line. */
async function main(): Promise<void> {
  await settle(showState, async () => {
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-claims-view]')) {
      button.addEventListener('click', () => setView(button.dataset.claimsView as View, true));
    }
    const matter = await pageMatter();
    if (!matter || matter.claims.length === 0) return 'empty';
    // On screen before drawing, as before; a part that throws still ends on the error line.
    showState('ready');
    setView(initialView());
    draw(matter);
    return 'ready';
  });
}

void main();
