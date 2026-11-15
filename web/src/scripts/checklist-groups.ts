// SPDX-License-Identifier: Apache-2.0
// How the checklist page groups its items, and what each status means. Pure, so a test can read it. The words follow
// docs/legal/product-notices.md, A1: what companies commonly keep, never what a reader needs; they match the "Questions for
// your lawyer" text (worker/checklist-questions.ts).
import type { ChecklistStatus, ChecklistView, ServedItem } from '../../worker/checklist.ts';

/** How checklist items are grouped: by stage or by relationship. */
export type Grouping = 'stage' | 'relationship';

/** The grouping choices, with the label shown for each. */
export const GROUPINGS: readonly { id: Grouping; label: string }[] = [
  { id: 'stage', label: 'By stage' },
  { id: 'relationship', label: 'By relationship' },
];

/** The grouping a link asks for; anything else is the stage view, the page's first. */
export function groupingOf(param: string | null): Grouping {
  return param === 'relationship' ? 'relationship' : 'stage';
}

/** What each status says, one line each. */
export const STATUS_MEANINGS: Readonly<Record<ChecklistStatus, string>> = {
  missing: 'Companies commonly have this by now, and nothing in the room is matched to it.',
  check: 'A document is matched, and nobody has said it is signed.',
  in_place: 'A document is matched, and someone has said it is signed or needs no signature.',
  if_applies: 'Only some companies keep this. Whether it applies is for you and your lawyer.',
  not_applicable: 'Someone in the room said this does not apply to this company.',
  not_yet: 'Companies commonly reach this at a later stage.',
};

/** One group of checklist items, with its label and whether it opens on its own. */
export interface Group {
  id: string;
  label: string;
  /** Opens on its own: a stage the company has reached, or a relationship with an item that is not "not yet". */
  active: boolean;
  items: ServedItem[];
}

/** `items` in groups, in the list's own order; a group with none is left out. */
export function groupItems(view: ChecklistView, items: readonly ServedItem[], grouping: Grouping): Group[] {
  const groups: Group[] =
    grouping === 'stage'
      ? view.stages.map((stage) => ({ id: stage.id, label: stage.label, active: stage.reached, items: items.filter((item) => item.stage === stage.id) }))
      : view.relationships.map((each) => {
          const held = items.filter((item) => item.relationship === each.id);
          return { id: each.id, label: each.label, active: held.some((item) => item.status !== 'not_yet'), items: held };
        });
  return groups.filter((group) => group.items.length > 0);
}
