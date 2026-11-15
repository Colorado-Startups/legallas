// SPDX-License-Identifier: Apache-2.0
// The words and rows the checklist page and the Overview's card share. Words follow docs/legal/product-notices.md, A1: what
// startups commonly keep, never what a reader needs. Every value goes in as text (dom-el.ts). The rows' shape is
// checklist-rows.ts, which the Worker also draws the Overview's card from (worker/overview-checklist.ts).
import type { ChecklistStatus, ServedDate, SignedState, StageSummary } from '../../worker/checklist.ts';
import { dateRowWith, stageRowWith, type Make } from './checklist-rows.ts';
import { el } from './dom-el.ts';

export { companyLine, formingLine, monthName } from './checklist-rows.ts';

/** The label shown for each checklist status. */
export const STATUS_LABELS: Readonly<Record<ChecklistStatus, string>> = {
  missing: 'Missing',
  check: 'To check',
  in_place: 'In place',
  if_applies: 'If it applies',
  not_applicable: "Doesn't apply",
  not_yet: 'Not yet',
};

/** The label shown for each signature state. */
export const SIGNED_LABELS: Readonly<Record<SignedState, string>> = {
  yes: 'Signed',
  no: 'Not signed yet',
  not_needed: 'No signature needed',
};

const make: Make<HTMLElement> = (tag, attrs, ...children) => el(tag as keyof HTMLElementTagNameMap, attrs, ...children);

/** Draws one stage as a list row. */
export const stageRow = (stage: StageSummary): HTMLLIElement => stageRowWith(make, stage) as HTMLLIElement;

/** One date. `withTitle` names its item, for a list from many items; `withBasis` says what it was worked out from. */
export const dateRow = (date: ServedDate, options: { withTitle: boolean; withBasis: boolean }): HTMLLIElement => dateRowWith(make, date, options) as HTMLLIElement;
