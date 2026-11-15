// SPDX-License-Identifier: Apache-2.0
// The home page's rings: the lead largest, then the rest in labeled groups that collapse with native details. Small
// rings stay three across at phone width. The groups come from the caller, so a new page needs no change here.

import { esc } from './svg.ts';
import { ring } from './ring.ts';
import type { RingProps } from './ring.ts';

export interface RingGroup {
  label: string;
  rings: RingProps[];
}

/** The lead ring and the groups of small rings. */
export function ringGrid(lead: RingProps, groups: RingGroup[]): string {
  const group = (g: RingGroup) =>
    `<details class="qs-home-group" open><summary><h2>${esc(g.label)}</h2> <span class="qs-home-count">${g.rings.length}</span></summary><div class="qs-home-rings">${g.rings.map((item) => ring({ ...item, size: 'sm' })).join('')}</div></details>`;
  return `<div class="qs-home"><div class="qs-home-lead">${ring({ ...lead, size: 'xl' })}</div><div class="qs-home-groups">${groups.map(group).join('')}</div></div>`;
}
