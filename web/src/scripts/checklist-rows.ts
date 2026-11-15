// SPDX-License-Identifier: Apache-2.0
// The checklist's lines and rows with no DOM, so the Worker can draw them too. `make` builds an element: dom-el.ts's el in the
// browser (checklist-parts.ts), worker/overview-checklist.ts's escaped HTML in the Worker. One shape for both, so the
// Overview's card the Worker draws is the card checklist-card.ts draws. Words follow docs/legal/product-notices.md, A1.
import type { DateState, ServedDate, StageSummary } from '../../worker/checklist.ts';

/** A child of a built row: an element, text, or nothing. */
export type RowChild<T> = T | string | null | undefined | false;
/** Builds one element. Strings are text, never markup; a T is an element `make` built. */
export type Make<T> = (tag: string, attrs: Record<string, string | undefined>, ...children: RowChild<T>[]) => T;

const DATE_LABELS: Readonly<Record<DateState, string>> = { done: 'Done', check: 'Check who filed', late: 'Filed late', passed: 'Date passed', soon: 'Soon', upcoming: 'Coming up' };

const done = (stage: StageSummary) => stage.in_place;
const open = (stage: StageSummary) => stage.in_place + stage.check + stage.missing;

/** The line a founder reads first. */
export function formingLine(stages: readonly StageSummary[]): string {
  const forming = stages.filter((stage) => stage.id === 'pre-formation' || stage.id === 'formation');
  const sum = (count: (stage: StageSummary) => number) => forming.reduce((total, stage) => total + count(stage), 0);
  return `Forming the company: ${sum(done)} of ${sum(open)} in place.`;
}

/** A month's name from its number, 1 to 12. */
export const monthName = (month: number): string => new Date(Date.UTC(2000, month - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });

/** The company's facts as a line, saying plainly what the room hasn't set. */
export function companyLine({ entityLabel, formationDate, reportMonth }: { entityLabel: string | null; formationDate: string | null; reportMonth?: number | null }): string {
  const month = reportMonth ? `; Colorado report month ${monthName(reportMonth)}` : '';
  return `${entityLabel ?? 'No entity type set, so every item shows'}; ${formationDate ? `formed ${formationDate}` : 'no formation date set'}${month}.`;
}

/** Builds one stage's list row with the given element builder. */
export function stageRowWith<T>(make: Make<T>, stage: StageSummary): T {
  const label = stage.reached && open(stage) > 0 ? `${done(stage)} of ${open(stage)}` : 'Later';
  return make(
    'li',
    { class: `cl-stage${stage.reached ? '' : ' cl-stage--later'}` },
    make('span', { class: 't-small' }, stage.label),
    make('progress', { value: String(done(stage)), max: String(Math.max(open(stage), 1)), 'aria-label': `${stage.label}: ${label}` }),
    make('span', { class: 't-small cl-mono' }, label),
  );
}

/** One date. `withTitle` names its item, for a list from many items; `withBasis` says what it was worked out from. */
export function dateRowWith<T>(make: Make<T>, date: ServedDate, { withTitle, withBasis }: { withTitle: boolean; withBasis: boolean }): T {
  const kind = date.state === 'passed' || date.state === 'late' ? ' c-chip--privileged' : date.state === 'done' ? ' c-chip--counsel' : '';
  return make(
    'li',
    { class: 'cl-date' },
    make(
      'span',
      { class: 'cl-date__when' },
      make('span', { class: 't-small cl-mono' }, date.opens ? `${date.opens} to ${date.date}` : date.date),
      make('span', { class: `c-chip${kind}` }, DATE_LABELS[date.state]),
    ),
    withTitle ? make('span', { class: 't-small' }, make('a', { href: `/checklist/#${encodeURIComponent(date.itemId)}` }, date.title)) : null,
    withBasis ? make('span', { class: 't-caption cl-item__where' }, date.basis) : null,
  );
}
