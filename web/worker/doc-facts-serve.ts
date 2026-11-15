// SPDX-License-Identifier: Apache-2.0
// The published document facts (worker/doc-facts.ts), read from R2 and served: what a member sees of them, given
// the room's live documents. The litigation pack's matter-serve.ts serves the whole manifest with these same
// helpers. Cites to removed (or never synced) documents are dropped, a person or org left with no cite is dropped
// with them, a document keeps only the parties still served, and each document gains its control number (null
// before migration 0003).
import { parseDocFacts, type DocFactsManifest } from './doc-facts.ts';
import { MATTER_KEY, type Cite, type DocFacts, type ServedCite, type ServedDocFacts, type ServedMatter } from './matter-types.ts';

/** documents.id of every live document, mapped to its control_seq (null when unassigned or not migrated). */
export type LiveDocs = ReadonlyMap<string, number | null>;

export function serveCite(cite: Cite, live: LiveDocs): ServedCite | null {
  return live.has(cite.doc) ? { ...cite, control: live.get(cite.doc) ?? null } : null;
}

function serveCites(cites: readonly Cite[], live: LiveDocs): ServedCite[] {
  return cites.flatMap((c) => serveCite(c, live) ?? []);
}

/** Entries with at least one live cite, with their cites served. */
export function cited<T extends { cites: Cite[] }>(items: readonly T[], live: LiveDocs): (Omit<T, 'cites'> & { cites: ServedCite[] })[] {
  return items.flatMap((item) => {
    const cites = serveCites(item.cites, live);
    return cites.length ? [{ ...item, cites }] : [];
  });
}

export const keep = (ids: readonly string[], known: ReadonlySet<string>) => ids.filter((id) => known.has(id));
export const keepOne = (id: string | null, known: ReadonlySet<string>) => (id !== null && known.has(id) ? id : null);

/** Orgs and people with a live cite, each org's parent and each person's orgs kept only while served, and the ids served. */
export function serveParties(facts: Pick<DocFactsManifest, 'orgs' | 'people'>, live: LiveDocs) {
  const keptOrgs = cited(facts.orgs, live);
  const orgIds = new Set(keptOrgs.map((o) => o.id));
  const orgs = keptOrgs.map((o) => ({ ...o, parent: keepOne(o.parent, orgIds) }));
  const people = cited(facts.people, live).map((p) => ({ ...p, orgs: keep(p.orgs, orgIds) }));
  const parties = new Set([...orgIds, ...people.map((p) => p.id)]);
  return { orgs, people, orgIds, parties };
}

export function serveDocs(docs: Record<string, DocFacts>, live: LiveDocs, parties: ReadonlySet<string>): Record<string, ServedDocFacts> {
  const out: Record<string, ServedDocFacts> = {};
  for (const [id, facts] of Object.entries(docs)) {
    if (!live.has(id)) continue;
    out[id] = { ...facts, from: keep(facts.from, parties), to: keep(facts.to, parties), control: live.get(id) ?? null };
  }
  return out;
}

/** What a member sees of the document facts: the docs, people and orgs exactly as GET /api/matter serves them. */
export function serveDocFacts(facts: DocFactsManifest, live: LiveDocs): Pick<ServedMatter, 'docs' | 'people' | 'orgs'> {
  const { orgs, people, parties } = serveParties(facts, live);
  return { docs: serveDocs(facts.docs, live, parties), people, orgs };
}

let cached: { etag: string; facts: DocFactsManifest } | null = null;

/** Test support: forget the per-isolate cache. */
export function resetDocFactsCache(): void {
  cached = null;
}

/**
 * The published manifest's document facts, or null when none is published. The parse is cached per isolate by the
 * file's R2 etag (a conditional get skips the download when it has not changed). Throws MatterError or SyntaxError
 * on a bad file.
 */
export async function loadDocFacts(files: R2Bucket, now: Date): Promise<DocFactsManifest | null> {
  const held = cached;
  const object = await files.get(MATTER_KEY, held ? { onlyIf: { etagDoesNotMatch: held.etag } } : undefined);
  if (!object) {
    cached = null;
    return null;
  }
  // A failed precondition returns the object without a body: the cached parse is still current.
  if (held && !('body' in object)) return held.facts;
  const facts = parseDocFacts(JSON.parse(await (object as R2ObjectBody).text()), now);
  cached = { etag: object.etag, facts };
  return facts;
}
