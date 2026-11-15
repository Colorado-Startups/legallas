// SPDX-License-Identifier: Apache-2.0
// Entities & People, the By date view (?view=dates), its pure half: which entities and milestones the picture
// (viz/story.ts) draws for All or for one violation (?v=<id>). A violation's entities are the ones it names, the
// ones its steps name and both ends of its steps' moves; choosing it keeps those entities, the parents above them
// and its own steps. The suit stays on the spine whichever violation is chosen. Tested in people-dates.test.ts.
import type { ServedMatter } from './matter-api.ts';
import type { StoryMilestone, StoryOrg } from './viz/story-layout.ts';
import { priorStatus } from '../../worker/room-settings.ts';

type DatesMatter = Pick<ServedMatter, 'orgs' | 'meta'> & Partial<Pick<ServedMatter, 'violations'>>;
type Violation = NonNullable<ServedMatter['violations']>[number];

/** A filter chip: the violation's id, letter mark and title. */
export interface DatesViolation {
  id: string;
  mark: string;
  title: string;
}

/** The dates picture: the orgs, the milestones and each entity's violation marks. */
export interface DatesPicture {
  orgs: StoryOrg[];
  milestones: StoryMilestone[];
  /** Each entity's violation marks, in letter order. */
  marks: Map<string, string[]>;
  /** One violation chosen: its mark and the entities it names (the rest drawn are their parents). */
  focus: { mark: string; ids: Set<string> } | null;
}

/** Courts and agencies are parties, not entities in a structure; the By date view leaves them out, as the tree does. */
export function datedOrgs(matter: Pick<ServedMatter, 'orgs'>): StoryOrg[] {
  return matter.orgs
    .filter((o) => o.kind !== 'court' && o.kind !== 'agency')
    .map((o) => ({ id: o.id, name: o.name, side: o.side, parent: o.parent, formed: o.formed }));
}

function byMark(matter: DatesMatter): Violation[] {
  return [...(matter.violations ?? [])].sort((a, b) => a.mark.localeCompare(b.mark));
}

/** The chips after All, in letter order (none for a manifest built before violations existed). */
export function dateViolations(matter: DatesMatter): DatesViolation[] {
  return byMark(matter).map(({ id, mark, title }) => ({ id, mark, title }));
}

/** The violation a deep link names, when the matter has it. */
export function pickViolation(matter: DatesMatter, id: string | null | undefined): Violation | null {
  return (id && matter.violations?.find((v) => v.id === id)) || null;
}

/** Entities a violation names, its steps name, and its steps' moves start or end at. */
export function violationEntities(v: Violation): Set<string> {
  const ids = new Set(v.entities);
  for (const step of v.steps) {
    for (const id of step.entities) ids.add(id);
    for (const move of step.moves) { ids.add(move.from); ids.add(move.to); }
  }
  return ids;
}

/** `ids` and every parent above them among `orgs` (a parent loop ends the walk). */
export function withParents(orgs: readonly StoryOrg[], ids: ReadonlySet<string>): Set<string> {
  const parent = new Map(orgs.map((o) => [o.id, o.parent]));
  const keep = new Set<string>();
  for (const id of ids) {
    for (let at: string | null | undefined = id; at && parent.has(at) && !keep.has(at); at = parent.get(at)) keep.add(at);
  }
  return keep;
}

/**
 * The suit on the spine: the matter's own filing date, else the closed prior case's (it is still the suit the
 * violations' steps run before and after). No caption: the words are the same for both.
 */
export function suitMilestone(meta: ServedMatter['meta']): StoryMilestone | null {
  if (meta.filed) return { date: meta.filed, label: 'Suit filed', kind: 'suit', mark: null };
  const prior = meta.priorCase?.filed;
  return prior ? { date: prior, label: `Suit filed (prior case, ${priorStatus})`, kind: 'suit', mark: null } : null;
}

/** What the By date picture draws for All (`violationId` null) or for one violation. */
export function datesPicture(matter: DatesMatter, violationId: string | null): DatesPicture {
  const all = datedOrgs(matter);
  const drawn = new Set(all.map((o) => o.id));
  const violations = byMark(matter);
  const marks = new Map<string, string[]>();
  for (const v of violations) {
    for (const id of violationEntities(v)) if (drawn.has(id)) marks.set(id, [...(marks.get(id) ?? []), v.mark]);
  }
  const chosen = pickViolation(matter, violationId);
  const shown = chosen ? [chosen] : violations;
  const milestones: StoryMilestone[] = shown.flatMap((v) => v.steps.map((s) => ({
    date: s.date, label: s.label, kind: 'step' as const, mark: v.mark,
  })));
  const suit = suitMilestone(matter.meta);
  if (suit) milestones.push(suit);
  if (!chosen) return { orgs: all, milestones, marks, focus: null };
  const ids = new Set([...violationEntities(chosen)].filter((id) => drawn.has(id)));
  const keep = withParents(all, ids);
  return { orgs: all.filter((o) => keep.has(o.id)), milestones, marks, focus: { mark: chosen.mark, ids } };
}
