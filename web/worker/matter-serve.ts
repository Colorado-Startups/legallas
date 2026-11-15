// SPDX-License-Identifier: Apache-2.0
// The serving filter for GET /api/matter: a pure function from the validated manifest and the room's live
// documents to what a member sees. Cites to removed (or never synced) documents are dropped, an entry left with
// no cite is dropped with them (the meta block and tracks excepted), references to dropped entries are pruned so
// every id in the response resolves, and each cite gains its document's control number (null before migration
// 0003). The orgs, people and document facts are served by the core's worker/doc-facts-serve.ts, with the helpers
// below.
import { cited, keep, keepOne, serveCite, serveDocs, serveParties, type LiveDocs } from './doc-facts-serve.ts';
import { isWorkProductType } from './matter.ts';
import type { Matter, MatterMeta, ProofItem, ServedCite, ServedMatter } from './matter-types.ts';

export type { LiveDocs } from './doc-facts-serve.ts';

/** Proof items whose cite is live, served; an element or point left with none reads as a gap. */
function serveProof(proof: readonly ProofItem[], live: LiveDocs): ProofItem<ServedCite>[] {
  return proof.flatMap((p) => {
    const cite = serveCite(p.cite, live);
    return cite ? [{ ...p, cite }] : [];
  });
}

/** A pleading whose document is live in the room, with its served cite; null when the document is not. */
function servePleading(pleading: MatterMeta['operativePleading'], live: LiveDocs): ServedMatter['meta']['operativePleading'] {
  const cite = pleading && serveCite(pleading.cite, live);
  return pleading && cite ? { title: pleading.title, cite } : null;
}

/**
 * A violation's contrast, served: each side keeps its live cites and a speaker still in the room (else null). A
 * side left with no live cite drops the whole contrast, since one side alone is no contrast.
 */
function serveContrast(contrast: Matter['violations'][number]['contrast'], live: LiveDocs, parties: ReadonlySet<string>): Pick<ServedMatter['violations'][number], 'contrast'> {
  if (!contrast) return {};
  const sides = cited(contrast, live).map((side) => ({ ...side, speaker: keepOne(side.speaker, parties) }));
  return sides.length === 2 ? { contrast: [sides[0]!, sides[1]!] } : {};
}

type Track = Matter['tracks'][number];
type ServedTrack = ServedMatter['tracks'][number];

/**
 * A track's brief, served: cast entries still in the room (a `via` org that left reads as null), hurdles and dates
 * with their live cites (one left with none is dropped), exhibits whose page is live, and drafts whose document is
 * live, with its control number. The line always stays.
 */
function serveBrief(brief: Track['brief'], live: LiveDocs, parties: ReadonlySet<string>, orgIds: ReadonlySet<string>): Pick<ServedTrack, 'brief'> {
  if (!brief) return {};
  return {
    brief: {
      line: brief.line,
      cast: brief.cast.filter((c) => parties.has(c.id)).map((c) => ({ ...c, via: keepOne(c.via, orgIds) })),
      hurdles: cited(brief.hurdles, live),
      dates: cited(brief.dates, live),
      exhibits: brief.exhibits.flatMap((x) => {
        const cite = serveCite(x.cite, live);
        return cite ? [{ ...x, cite }] : [];
      }),
      drafts: brief.drafts.flatMap((d) => (live.has(d.doc) ? [{ ...d, control: live.get(d.doc) ?? null }] : [])),
    },
  };
}

/** A track's counts, served: each count stays, losing parties and points that no longer resolve (an element left with none reads as a gap). */
function serveCounts(counts: Track['counts'], parties: ReadonlySet<string>, points: ReadonlySet<string>): Pick<ServedTrack, 'counts'> {
  if (!counts) return {};
  return {
    counts: counts.map((count) => ({
      ...count,
      against: keep(count.against, parties),
      elements: count.elements.map((el) => ({ ...el, points: keep(el.points, points) })),
    })),
  };
}

/** What a member sees of the manifest, given the documents that are live in the room right now. */
export function serveMatter(matter: Matter, live: LiveDocs): ServedMatter {
  const definedTerms = matter.meta.definedTerms.map(({ cite, ...term }) => {
    const served = cite ? serveCite(cite, live) : null;
    return served ? { ...term, cite: served } : term;
  });
  const { priorCase: prior, ...header } = matter.meta;
  const meta = {
    ...header,
    definedTerms,
    operativePleading: servePleading(matter.meta.operativePleading, live),
    ...(prior ? { priorCase: { ...prior, operativePleading: servePleading(prior.operativePleading, live) } } : {}),
  };

  const { orgs, people, orgIds, parties } = serveParties(matter, live);

  const claims = cited(matter.claims, live).map((claim) => ({
    ...claim,
    against: keep(claim.against, parties),
    elements: claim.elements.map((el) => ({ ...el, proof: serveProof(el.proof, live) })),
  }));
  const claimIds = new Set(claims.map((c) => c.id));

  const events = cited(matter.events, live).map((e) => ({ ...e, actors: keep(e.actors, parties), claims: keep(e.claims, claimIds) }));
  // A statement keeps its live cites; one left with none is dropped, and a link left with none loses the key.
  const links = cited(matter.links, live).filter((l) => parties.has(l.from) && parties.has(l.to)).map(({ statements, ...link }) => {
    const kept = cited(statements ?? [], live);
    return kept.length ? { ...link, statements: kept } : link;
  });
  const docs = serveDocs(matter.docs, live, parties);
  // The parser refused money cited only to work product; dropping cites must not leave such an entry behind.
  const money = cited(matter.money, live)
    .filter((m) => !m.cites.every((c) => isWorkProductType(matter.docs[c.doc]?.type ?? null)))
    .map((m) => ({ ...m, from: keepOne(m.from, parties), to: keepOne(m.to, parties) }));

  const eventIds = new Set(events.map((e) => e.id));
  const moneyIds = new Set(money.map((m) => m.id));
  const violations = cited(matter.violations, live).map(({ contrast, ...v }) => ({
    ...v,
    ...serveContrast(contrast, live, parties),
    actors: keep(v.actors, parties),
    entities: keep(v.entities, orgIds),
    events: keep(v.events, eventIds),
    money: keep(v.money, moneyIds),
    steps: cited(v.steps, live).map((step) => ({
      ...step,
      entities: keep(step.entities, orgIds),
      moves: step.moves.filter((move) => orgIds.has(move.from) && orgIds.has(move.to)),
    })),
    figures: cited(v.figures, live),
  }));
  const violationIds = new Set(violations.map((v) => v.id));
  // A track has no cites of its own: it stays, losing only what no longer resolves.
  const tracks = matter.tracks.map(({ brief, counts, ...track }) => {
    const points = track.points
      .filter((point) => violationIds.has(point.violation))
      .map((point) => ({ ...point, proof: serveProof(point.proof, live) }));
    return {
      ...track,
      against: keep(track.against, parties),
      violations: keep(track.violations, violationIds),
      points,
      ...serveBrief(brief, live, parties, orgIds),
      ...serveCounts(counts, parties, new Set(points.map((p) => p.id))),
    };
  });

  return { version: matter.version, meta, tracks, violations, events, people, orgs, links, claims, money, docs };
}
