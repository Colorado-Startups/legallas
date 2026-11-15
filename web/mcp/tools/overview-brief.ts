// SPDX-License-Identifier: Apache-2.0
// legallas_case_overview's tracks section (owner: session 2a): each track with its points to prove and their proof,
// that proof grouped per violation, its counts, and for a track with a brief the whole brief as the room's track
// page shows it: the theory, the cast, hurdles, dates to confirm, key exhibits and drafts. Every cite is structured
// (control, doc, page, link) and every free text field is case data.
import type { ProofItem, ProofStrength, ServedCite, ServedMatter } from '../../worker/matter-types.ts';
import { docLink, formatControl } from '../format.ts';
import { citeRenderer, proofEntry, prose, type Render } from './overview-text.ts';

type ServedTrack = ServedMatter['tracks'][number];
type ServedBrief = NonNullable<ServedTrack['brief']>;

/** What a track entry looks up outside the track: names, marks and how to render a cite. */
export interface TrackLookup {
  cite: Render;
  prefix: string | undefined;
  /** Person and org names by id, for the cast. */
  parties: ReadonlyMap<string, string>;
  /** Live document names by documents.id, for the drafts. */
  docNames: ReadonlyMap<string, string>;
  /** Violation marks ("A") by id. */
  marks: ReadonlyMap<string, string>;
}

/** Builds the helpers that render a track's cites for the overview. */
export function trackLookup(served: ServedMatter, docNames: ReadonlyMap<string, string>, prefix: string | undefined): TrackLookup {
  return {
    cite: citeRenderer(prefix),
    prefix,
    parties: new Map([...served.people, ...served.orgs].map((p) => [p.id, p.name])),
    docNames,
    marks: new Map(served.violations.map((v) => [v.id, v.mark])),
  };
}

const RANK: Record<ProofStrength, number> = { direct: 3, corroborating: 2, circumstantial: 1, gap: 0 };

/** A point's strongest proof, as the room's proof checklist ranks it; a point with none is a gap. */
function strongest(proof: readonly ProofItem<ServedCite>[]): ProofStrength {
  return proof.reduce<ProofStrength>((best, p) => (RANK[p.strength] > RANK[best] ? p.strength : best), 'gap');
}

/**
 * The track's points per violation, in the track's order: each point's id and strongest proof, and how many are
 * gaps. The points themselves (text, authority and every proof cite) are the entry's `points`.
 */
function proofByViolation(track: ServedTrack, marks: ReadonlyMap<string, string>) {
  const ids = [...new Set([...track.violations, ...track.points.map((p) => p.violation)])];
  return ids.map((violation) => {
    const points = track.points.filter((p) => p.violation === violation).map((p) => ({ id: p.id, strength: strongest(p.proof) }));
    return { violation, mark: marks.get(violation) ?? null, points, gaps: points.filter((p) => p.strength === 'gap').length };
  });
}

/** A brief, whole: the line, cast, hurdles, dates, key exhibits (each a structured cite) and drafts (each a document). */
function briefEntry(brief: ServedBrief, look: TrackLookup) {
  const { cite } = look;
  return {
    line: prose(brief.line),
    cast: brief.cast.map((c) => ({ id: c.id, name: look.parties.get(c.id) ?? null, role: prose(c.role), via: c.via })),
    hurdles: brief.hurdles.map((h) => ({ id: h.id, title: prose(h.title), text: prose(h.text), cites: h.cites.map(cite) })),
    dates: brief.dates.map((d) => ({ date: d.date, text: prose(d.text), cites: d.cites.map(cite) })),
    exhibits: brief.exhibits.map((x) => ({ proves: prose(x.proves), cite: cite(x.cite) })),
    drafts: brief.drafts.map((d) => ({
      label: prose(d.label), title: look.docNames.get(d.doc) ?? null, control: formatControl(look.prefix, d.control), doc: d.doc, link: docLink(d.doc),
    })),
  };
}

/** Builds the overview entry for one track, using the lookup to render its cites. */
export function trackEntry(track: ServedTrack, look: TrackLookup) {
  const { cite } = look;
  return {
    id: track.id,
    kind: track.kind,
    title: prose(track.title),
    forum: prose(track.forum),
    against: track.against,
    violations: track.violations,
    points: track.points.map((p) => ({
      id: p.id, violation: p.violation, text: prose(p.text), authority: prose(p.authority), proof: p.proof.map((x) => proofEntry(x, cite)),
    })),
    proofByViolation: proofByViolation(track, look.marks),
    // Absent keys stay absent, so a track without a brief or counts reads as it always has.
    ...(track.brief ? { brief: briefEntry(track.brief, look) } : {}),
    // Each count's elements name the points above that meet them.
    ...(track.counts ? {
      counts: track.counts.map((c) => ({
        id: c.id, title: prose(c.title), kind: c.kind, against: c.against, basis: prose(c.basis),
        elements: c.elements.map((el) => ({ id: el.id, text: prose(el.text), points: el.points })),
      })),
    } : {}),
  };
}
