// SPDX-License-Identifier: Apache-2.0
// The Overview's checklist card (components/ChecklistCard.astro). Any answer but a good one leaves it hidden: the checklist
// may be off, and the rest of the Overview doesn't depend on it.
import type { ChecklistSummary } from '../../worker/checklist.ts';
import { companyLine, dateRow, formingLine, stageRow } from './checklist-parts.ts';
import { ROOM_FETCH_HEADERS } from './session-ended.ts';

const card = document.querySelector<HTMLElement>('[data-checklist-card]');
const part = (name: string) => card?.querySelector<HTMLElement>(`[data-checklist-card-${name}]`);

async function load(): Promise<void> {
  const response = await fetch('/api/checklist/summary', { credentials: 'same-origin', headers: ROOM_FETCH_HEADERS });
  if (!response.ok || !card) return;
  const summary = (await response.json()) as ChecklistSummary;
  part('title')!.textContent = formingLine(summary.stages); // safe: ChecklistCard.astro renders every part
  part('company')!.textContent = companyLine(summary); // safe: as above
  part('stages')!.replaceChildren(...summary.stages.map(stageRow)); // safe: as above
  part('dates')!.replaceChildren(...summary.nextDates.map((date) => dateRow(date, { withTitle: true, withBasis: false }))); // safe: as above
  part('notice')!.textContent = `${summary.notice} ${summary.status}`; // safe: as above
  card.hidden = false;
}

void load().catch(() => undefined);
