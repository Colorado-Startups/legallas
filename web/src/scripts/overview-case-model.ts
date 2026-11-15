// SPDX-License-Identifier: Apache-2.0
// Card P1b (Overview, case picture). The pure half of the Overview's case blocks: counts for the headings,
// the strongest proof per element or point and the party index. No DOM, so
// overview-case-model.test.ts runs it under node --test.
import type { PartialDate, ProofStrength, ServedMatter, Side } from '../../worker/matter-types.ts';
import { formatPartialDate } from './matter-api.ts';
import { currentPleading } from '../../worker/room-settings.ts';

type Claim = ServedMatter['claims'][number];
type Element = Claim['elements'][number];
type Proof = Element['proof'][number];

/** A party on the overview, with its side. */
export interface Party {
  id: string;
  name: string;
  side: Side;
  kind: 'person' | 'org';
}

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/**
 * The Overview's heading. With a complaint track the new case leads: its title is the caption, and the line above
 * it names the deliverables ("Current complaint", "Two regulator filings"). Without tracks the closed pleading's
 * caption and court line stay, as before the refocus.
 */
export function caseHeading(
  matter: Pick<ServedMatter, 'meta' | 'tracks'>, courtParts: readonly string[],
): { caption: string; line: string[] } {
  const complaint = matter.tracks.find((track) => track.kind === 'complaint');
  if (!complaint) return { caption: matter.meta.caption, line: [...courtParts] };
  const filings = matter.tracks.filter((track) => track.kind === 'regulator').length;
  const word = capitalize(NUMBER_WORDS[filings] ?? String(filings));
  const line = [`${capitalize(currentPleading)} complaint`];
  if (filings > 0) line.push(`${word} regulator ${filings === 1 ? 'filing' : 'filings'}`);
  return { caption: complaint.title, line };
}

/** "1 event", "41 events". */
/** Counts a noun, with an optional plural form: "1 event", "2 events". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** People and organizations by id, for names and sides. */
export function partyIndex(matter: Pick<ServedMatter, 'people' | 'orgs'>): Map<string, Party> {
  const index = new Map<string, Party>();
  for (const p of matter.people) index.set(p.id, { id: p.id, name: p.name, side: p.side, kind: 'person' });
  for (const o of matter.orgs) index.set(o.id, { id: o.id, name: o.name, side: o.side, kind: 'org' });
  return index;
}

const RANK: Record<ProofStrength, number> = { direct: 3, corroborating: 2, circumstantial: 1, gap: 0 };

/** The strongest proof for an element, the one its ring shows. An element with no proof is a gap. */
export function strongestProof(element: Pick<Element, 'proof'>): { strength: ProofStrength; proof: Proof | null } {
  let best: Proof | null = null;
  for (const proof of element.proof) {
    if (proof.strength === 'gap') continue;
    if (!best || RANK[proof.strength] > RANK[best.strength]) best = proof;
  }
  return best ? { strength: best.strength, proof: best } : { strength: 'gap', proof: element.proof[0] ?? null };
}

/** "41 events, Mar. 2019 to Sept. 2026" for the Chronology heading. */
export function eventsSummary(events: readonly { date: PartialDate }[]): string {
  const months = events.map((e) => e.date.slice(0, 7)).filter((d) => /^\d{4}(-\d{2})?$/.test(d)).sort();
  const count = plural(events.length, 'event');
  if (!months.length) return count;
  const first = formatPartialDate(months[0]);
  const last = formatPartialDate(months[months.length - 1]);
  return first === last ? `${count}, ${first}` : `${count}, ${first} to ${last}`;
}

/** Capitalize the first letter, for a name that opens a sentence or a cell: "The Company". */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
