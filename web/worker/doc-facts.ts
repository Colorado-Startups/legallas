// SPDX-License-Identifier: Apache-2.0
// Document facts: the part of the matter manifest (meta/matter.json, worker/matter-types.ts) the core room reads.
// That is each document's date, type, parties, summary and privilege, and the people and organizations its parties
// name. The litigation pack's parser (worker/matter.ts) validates the whole manifest with these same functions, in
// the same order, so for any manifest it accepts the facts are the same; the core reads only this part, so a room
// without the pack still dates, types and designates every document. Strict like matter.ts: unknown fields are
// dropped and anything malformed throws MatterError naming the field, never the value. Pure, like matter.ts, so the
// scripts can import it; reading the published file and serving it are in doc-facts-serve.ts.
import * as f from './matter-fields.ts';
import { MatterError } from './matter-fields.ts';
import { CONTACT_ROLES, MATTER_VERSION, ORG_KINDS, SIDES, type DocFacts, type MatterOrg, type MatterPerson } from './matter-types.ts';

export { MatterError } from './matter-fields.ts';

/** Limits of the fact sections; matter.ts spreads them into its own MAX and LEN. */
export const FACT_MAX = { orgs: 500, people: 1000, docs: 20_000, cites: 50 } as const;
export const FACT_LEN = { name: 200, type: 80, summary: 1200 } as const;
/** How far ahead of the Worker's clock a build may be stamped (clock skew between the Mac and Cloudflare). */
const SKEW_MS = 10 * 60 * 1000;

/** What the core reads from the manifest. */
export interface DocFactsManifest {
  orgs: MatterOrg[];
  people: MatterPerson[];
  docs: Record<string, DocFacts>;
}

/** The manifest's root object; any other version is refused. */
export function manifestRoot(raw: unknown): Record<string, unknown> {
  const root = f.record(raw, 'matter');
  if (root.version !== MATTER_VERSION) throw new MatterError(`matter.version must be ${MATTER_VERSION}`);
  return root;
}

/** meta.builtAt, refused when it is later than the Worker's clock (beyond small skew). Record dates are checked against its day. */
export function parseBuiltAt(raw: unknown, now: Date): string {
  const r = f.record(raw, 'meta');
  const builtAt = f.timestamp(r.builtAt, 'meta.builtAt');
  if (Date.parse(builtAt) > now.getTime() + SKEW_MS) throw new MatterError('meta.builtAt is later than the server clock');
  return builtAt;
}

function parseOrg(raw: unknown, i: number, buildDay: string): MatterOrg {
  const where = `orgs[${i}]`;
  const r = f.record(raw, where);
  return {
    id: f.id(r.id, `${where}.id`),
    name: f.text(r.name, `${where}.name`, FACT_LEN.name),
    kind: f.oneOf(r.kind, ORG_KINDS, `${where}.kind`),
    side: f.oneOf(r.side, SIDES, `${where}.side`),
    parent: f.optionalId(r.parent, `${where}.parent`),
    formed: f.optionalPastDate(r.formed, `${where}.formed`, buildDay),
    cites: f.cites(r.cites, `${where}.cites`, FACT_MAX.cites),
  };
}

function parsePerson(raw: unknown, i: number, orgs: Set<string>): MatterPerson {
  const where = `people[${i}]`;
  const r = f.record(raw, where);
  return {
    id: f.id(r.id, `${where}.id`),
    name: f.text(r.name, `${where}.name`, FACT_LEN.name),
    role: f.oneOf(r.role, CONTACT_ROLES, `${where}.role`),
    side: f.oneOf(r.side, SIDES, `${where}.side`),
    title: f.optionalText(r.title, `${where}.title`, FACT_LEN.name),
    orgs: f.refs(r.orgs, `${where}.orgs`, orgs),
    cites: f.cites(r.cites, `${where}.cites`, FACT_MAX.cites),
  };
}

/** The orgs and people, with the org ids and the party ids (orgs and people together, each id declared once). */
export interface Parties {
  orgs: MatterOrg[];
  people: MatterPerson[];
  orgIds: Set<string>;
  parties: Set<string>;
}

export function parseParties(root: Record<string, unknown>, buildDay: string): Parties {
  const orgs = f.list(root.orgs ?? [], 'orgs', FACT_MAX.orgs).map((o, i) => parseOrg(o, i, buildDay));
  const orgIds = f.uniqueIds(orgs, 'orgs');
  orgs.forEach((org, i) => {
    if (org.parent !== null && (org.parent === org.id || !orgIds.has(org.parent))) throw new MatterError(`orgs[${i}].parent must name another org`);
  });
  const people = f.list(root.people ?? [], 'people', FACT_MAX.people).map((p, i) => parsePerson(p, i, orgIds));
  const parties = f.uniqueIds(people, 'people', new Set(orgIds));
  return { orgs, people, orgIds, parties };
}

function parseDoc(raw: unknown, where: string, parties: Set<string>): DocFacts {
  const r = f.record(raw, where);
  return {
    date: f.optionalPartialDate(r.date, `${where}.date`),
    type: f.optionalText(r.type, `${where}.type`, FACT_LEN.type),
    from: f.refs(r.from, `${where}.from`, parties),
    to: f.refs(r.to, `${where}.to`, parties),
    summary: f.optionalText(r.summary, `${where}.summary`, FACT_LEN.summary),
    privileged: f.bool(r.privileged ?? false, `${where}.privileged`),
  };
}

export function parseDocs(raw: unknown, parties: Set<string>): Record<string, DocFacts> {
  const r = f.record(raw ?? {}, 'docs');
  const keys = Object.keys(r);
  if (keys.length > FACT_MAX.docs) throw new MatterError(`docs has more than ${FACT_MAX.docs} entries`);
  const docs: Record<string, DocFacts> = {};
  keys.forEach((key, i) => {
    const id = f.docId(key, `docs key ${i}`);
    if (id in docs) throw new MatterError(`docs key ${i} repeats a document`);
    docs[id] = parseDoc(r[key], `docs key ${i}`, parties);
  });
  return docs;
}

/** Validates the document facts and the parties they name. The rest of the manifest is not read. */
export function parseDocFacts(raw: unknown, now: Date): DocFactsManifest {
  const root = manifestRoot(raw);
  const buildDay = parseBuiltAt(root.meta, now).slice(0, 10);
  const { orgs, people, parties } = parseParties(root, buildDay);
  return { orgs, people, docs: parseDocs(root.docs, parties) };
}
