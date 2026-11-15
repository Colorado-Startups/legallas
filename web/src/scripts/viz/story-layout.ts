// SPDX-License-Identifier: Apache-2.0
// The By date picture's pure half (viz/story.ts draws it; Entities & People, ?view=dates). Entities are laid out
// by the date each was formed, earliest first, one row per date, with the matter's milestones (a violation's steps,
// the suit) as rows on the same spine. Entities formed on the same day share a row, so a batch reads as a batch;
// a milestone on a formation date shares that row. Entities the record does not date come last. No DOM, so
// story-layout.test.ts runs it under node --test.

import type { Side } from '../../../worker/matter-types.ts';

/** What the picture reads from an organization. */
export interface StoryOrg {
  id: string;
  name: string;
  side: Side;
  parent: string | null;
  formed?: string | null;
}

/** A dated line on the spine: a violation's step (with its letter mark) or the suit. */
export interface StoryMilestone {
  date: string;
  /** One line, the milestone's conclusion ("Commissary formed", "Suit filed"). */
  label: string;
  kind: 'step' | 'suit';
  /** The violation's letter mark, for a step. */
  mark: string | null;
}

/** One dated row of the entity story: the date, and the entities formed on it. */
export interface StoryRow {
  /** The date as the record writes it ("2024", "2024-01", "2024-01-01"); null for the undated row, always last. */
  date: string | null;
  /** Entities formed on this date, parents before the entities under them, then by name. */
  orgs: string[];
  /** Indexes of the milestones dated here, in the order given. */
  milestones: number[];
}

const DATE = /^(\d{4})(?:-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?)?$/;

/** The first day a partial date covers, as a full ISO date. */
function startOf(d: string): string {
  return d.length === 4 ? `${d}-01-01` : d.length === 7 ? `${d}-01` : d;
}

/** A partial ISO date the picture can place, else null ("2025-13", "", "soon" are unplaceable). */
export function placeable(date: string | null | undefined): string | null {
  return typeof date === 'string' && DATE.test(date) ? date : null;
}

/**
 * Orders partial dates by the day each one starts ("2024" starts on 2024-01-01). On the same start the more
 * precise date leads, so "2024-01-01" sits before "2024": a year alone does not say it came first.
 */
export function compareDates(a: string, b: string): number {
  const sa = startOf(a);
  const sb = startOf(b);
  if (sa !== sb) return sa < sb ? -1 : 1;
  return b.length - a.length;
}

/** How far down its own parent chain an org sits among `orgs` (0 for one whose parent is not drawn). */
function depthOf(id: string, byId: Map<string, StoryOrg>): number {
  const seen = new Set([id]);
  let depth = 0;
  for (let at = byId.get(id)?.parent ?? null; at !== null && byId.has(at) && !seen.has(at); at = byId.get(at)?.parent ?? null) {
    seen.add(at);
    depth += 1;
  }
  return depth;
}

/** True when at least one org has a formation date the picture can place. */
export function anyDated(orgs: readonly StoryOrg[]): boolean {
  return orgs.some((o) => placeable(o.formed) !== null);
}

/** The rows, earliest first, with the undated entities last. Every placeable milestone gets a row, entities or not. */
export function storyRows(orgs: readonly StoryOrg[], milestones: readonly StoryMilestone[]): StoryRow[] {
  const byId = new Map(orgs.map((o) => [o.id, o]));
  const rows = new Map<string | null, StoryRow>();
  const row = (date: string | null): StoryRow => {
    let r = rows.get(date);
    if (!r) rows.set(date, (r = { date, orgs: [], milestones: [] }));
    return r;
  };
  const ordered = [...byId.values()].sort((a, b) => depthOf(a.id, byId) - depthOf(b.id, byId)
    || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  for (const org of ordered) row(placeable(org.formed)).orgs.push(org.id);
  milestones.forEach((m, i) => {
    const date = placeable(m.date);
    if (date !== null) row(date).milestones.push(i);
  });
  return [...rows.values()].sort((a, b) => {
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return compareDates(a.date, b.date);
  });
}
