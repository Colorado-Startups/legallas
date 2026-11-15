// SPDX-License-Identifier: Apache-2.0
// Card F4. Assembles the manifest: catalog facts, filename facts, fragments, then cite resolution, validation
// and the checks. `assemble` is pure (tests drive it with fixtures); `buildFromDisk` reads the inputs.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MATTER_VERSION, type DocFacts, type Matter, type MatterMeta, type PriorCase } from '../../worker/matter-types.ts';
import { CATALOG_REL, isPrivileged, normalizeCatalogPath, parseCatalog, parseFilename, type CatalogNote, type CatalogResult, type InternalNote } from './catalog.ts';
import { excludeEvents, excludeMoney, keywordFlags, type Exclusion, type Flag } from './checks.ts';
import { isEmpty, loadFragments, mergeFragments, type Draft, type Entry, type LoadedFragment } from './fragments.ts';
import { matterPaths } from './paths.ts';
import { CiteResolution, type Resolver, type Unresolved } from './resolve.ts';
import { validateMatter } from './validate.ts';

/** Information about a build: when it ran and its counts. */
export interface BuildInfo {
  builtAt: string;
  counts: Record<string, number>;
  /** Cites whose path is not a live mirror document; dropped from the manifest. */
  unresolved: Unresolved[];
  /** Fragment docs entries whose path is not a live mirror document. */
  unresolvedDocs: string[];
  catalog: { rows: number; skipped: number; notInRoom: number } | null;
  /** Catalog summaries that carry internal notes (catalog.ts INTERNAL_NOTES and the room's own). Flagged for review; never a problem. */
  catalogNotes: CatalogNote[];
  /** Fragment and shape problems. Any problem fails `check`. */
  problems: string[];
  /** parseMatter's refusal (it names a field, never a value), or null when the manifest is valid. */
  validation: string | null;
  exclusions: Exclusion[];
  flags: Flag[];
  /** documents.path by documents.id for every id the manifest mentions, for the report. */
  paths: Record<string, string>;
}

/** The result of a build: the matter, or null when the draft was refused. */
export interface Built {
  /** Null when parseMatter refuses the draft; info.validation says why. */
  matter: Matter | null;
  info: BuildInfo;
}

const DOC_FIELDS: Record<keyof DocFacts, (value: unknown) => boolean> = {
  date: (v) => v === null || (typeof v === 'string' && /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(v)),
  type: (v) => v === null || typeof v === 'string',
  from: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  to: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  summary: (v) => v === null || typeof v === 'string',
  privileged: (v) => typeof v === 'boolean',
};

/** Facts the filename convention and the folder names give for every live mirror document. */
function filenameDocs(resolver: Resolver): Map<string, DocFacts> {
  const docs = new Map<string, DocFacts>();
  for (const [docPath, id] of resolver.ids) {
    const { type, date } = parseFilename(docPath);
    const privileged = isPrivileged('', docPath);
    if (type || date || privileged) docs.set(id, { date, type, from: [], to: [], summary: null, privileged });
  }
  return docs;
}

/** Catalog rows layered over filename facts: the catalog fills what the filename did not give. */
function catalogDocs(resolver: Resolver, catalog: CatalogResult | null, docs: Map<string, DocFacts>): number {
  let notInRoom = 0;
  for (const [docPath, facts] of catalog?.docs ?? []) {
    const id = resolver.ids.get(docPath);
    if (!id) { notInRoom += 1; continue; }
    const base = docs.get(id);
    docs.set(id, base ? fill(base, facts as unknown as Entry) : facts);
  }
  return notInRoom;
}

/** Fills only the empty fields of `base`. Privilege only ever turns on. */
function fill(base: DocFacts, extra: Entry): DocFacts {
  const out: Record<string, unknown> = { ...base };
  for (const [field, value] of Object.entries(extra)) {
    if (field === 'privileged') out.privileged = base.privileged || value === true;
    else if (isEmpty(out[field])) out[field] = value;
  }
  return out as unknown as DocFacts;
}

function fragmentDocs(draft: Draft, resolver: Resolver, docs: Map<string, DocFacts>, info: BuildInfo): void {
  for (const [rawPath, facts] of draft.docs) {
    const docPath = normalizeCatalogPath(rawPath, resolver.sourceRoot);
    const id = docPath ? resolver.ids.get(docPath) : undefined;
    if (!id || !docPath) { info.unresolvedDocs.push(rawPath); continue; }
    const bad = Object.entries(facts).filter(([field, value]) => !(field in DOC_FIELDS) || !DOC_FIELDS[field as keyof DocFacts](value));
    if (bad.length > 0) { info.problems.push(`docs entry for ${id}: bad field(s) ${bad.map(([f]) => f).join(', ')}`); continue; }
    const base = docs.get(id) ?? { date: null, type: null, from: [], to: [], summary: null, privileged: isPrivileged('', docPath) };
    docs.set(id, fill(base, facts));
  }
}

/** The case fields a header and a prior case share, with the pleading's path cite resolved. */
function buildCase(fields: Record<string, unknown>, res: CiteResolution, where: string): PriorCase {
  const pleading = fields.operativePleading as Entry | null | undefined;
  const cite = pleading ? res.cite(pleading.cite, `${where}:operativePleading`) : null;
  return {
    caption: (fields.caption as string | undefined) ?? '',
    court: (fields.court as string | undefined) ?? '',
    caseNumber: (fields.caseNumber as string | null | undefined) ?? null,
    division: (fields.division as string | null | undefined) ?? null,
    judge: (fields.judge as string | null | undefined) ?? null,
    filed: (fields.filed as string | null | undefined) ?? null,
    operativePleading: pleading && cite ? ({ ...pleading, cite } as unknown as PriorCase['operativePleading']) : null,
  };
}

function buildMeta(draft: Draft, res: CiteResolution, now: Date): MatterMeta {
  const meta = draft.meta as Record<string, unknown>;
  const prior = meta.priorCase as Record<string, unknown> | null | undefined;
  return {
    ...buildCase(meta, res, 'meta'),
    ...(prior ? { priorCase: buildCase(prior, res, 'meta:priorCase') } : {}),
    definedTerms: (draft.meta.definedTerms ?? []).map((term, i) => {
      const { cite: raw, ...rest } = term as unknown as Entry & { term: string; means: string };
      const cite = raw ? res.cite(raw, `meta:definedTerms[${i}]`) : null;
      return (cite ? { ...rest, cite } : rest) as unknown as MatterMeta['definedTerms'][number];
    }),
    builtAt: now.toISOString(),
  };
}

const byKey = (...keys: string[]) => (a: Entry, b: Entry) => {
  for (const key of keys) {
    const x = a[key] as string | number;
    const y = b[key] as string | number;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
};

function sortedRecord<T>(map: Map<string, T>): Record<string, T> {
  return Object.fromEntries([...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Ids of the entries an exclusion removed. */
function excludedIds(all: readonly Entry[], kept: readonly Entry[]): Set<unknown> {
  const keptIds = new Set(kept.map((e) => e.id));
  return new Set(all.map((e) => e.id).filter((id) => !keptIds.has(id)));
}

/** A violation without the excluded events and money it named, so an exclusion is listed rather than refused. */
function withoutIds(events: ReadonlySet<unknown>, money: ReadonlySet<unknown>): (violation: Entry) => Entry {
  const prune = (value: unknown, gone: ReadonlySet<unknown>) => (Array.isArray(value) ? value.filter((id) => !gone.has(id)) : value);
  return (violation) => ({ ...violation, events: prune(violation.events, events), money: prune(violation.money, money) });
}

function newInfo(catalog: CatalogResult | null, draft: Draft, res: CiteResolution, now: Date): BuildInfo {
  return {
    builtAt: now.toISOString(), counts: {}, unresolved: res.unresolved, unresolvedDocs: [], problems: draft.problems, validation: null,
    catalog: catalog ? { rows: catalog.rows, skipped: catalog.skipped, notInRoom: 0 } : null, catalogNotes: catalog?.notes ?? [],
    exclusions: [], flags: [], paths: {},
  };
}

/**
 * Builds the manifest from parsed inputs. Excluded events and money are removed before validation and listed,
 * so one excluded entry never blocks the review; a draft parseMatter still refuses comes back with matter null.
 */
export function assemble(catalog: CatalogResult | null, fragments: readonly LoadedFragment[], resolver: Resolver, now: Date): Built {
  const draft = mergeFragments(fragments);
  const res = new CiteResolution(resolver);
  const info = newInfo(catalog, draft, res, now);
  const docMap = filenameDocs(resolver);
  if (info.catalog) info.catalog.notInRoom = catalogDocs(resolver, catalog, docMap);
  fragmentDocs(draft, resolver, docMap, info);
  const docs = sortedRecord(docMap);
  const at = (list: string) => (entry: Entry, index: number) => `${list}:${typeof entry.id === 'string' ? entry.id : index}`;
  const lists = draft.lists;
  const meta = buildMeta(draft, res, now);
  const events = excludeEvents(lists.events.map((e, i) => res.entry(e, at('events')(e, i))).sort(byKey('date', 'id')), meta.builtAt.slice(0, 10));
  const money = excludeMoney(lists.money.map((e, i) => res.entry(e, at('money')(e, i))).sort(byKey('date', 'id')), docs, resolver.paths);
  const withoutExcluded = withoutIds(excludedIds(lists.events, events.kept), excludedIds(lists.money, money.kept));
  const raw = {
    version: MATTER_VERSION,
    meta,
    // Complaint before regulator, then by id; violations by mark.
    tracks: lists.tracks.map((e, i) => res.track(e, at('tracks')(e, i))).sort(byKey('kind', 'id')),
    violations: lists.violations.map((e, i) => withoutExcluded(res.violation(e, at('violations')(e, i)))).sort(byKey('mark', 'id')),
    events: events.kept,
    people: lists.people.map((e, i) => res.entry(e, at('people')(e, i))).sort(byKey('id')),
    orgs: lists.orgs.map((e, i) => res.entry(e, at('orgs')(e, i))).sort(byKey('id')),
    links: lists.links.map((e, i) => res.link(e, at('links')(e, i))),
    claims: lists.claims.map((e, i) => res.claim(e, at('claims')(e, i))).sort(byKey('count', 'id')),
    money: money.kept,
    docs,
  };
  info.exclusions = [...events.out, ...money.out];
  info.problems.push(...res.problems);
  const { matter, error } = validateMatter(raw, now);
  info.validation = error;
  for (const id of [...res.cited, ...Object.keys(docs)]) info.paths[id] = resolver.paths.get(id) ?? '';
  info.counts = countsOf(matter ?? (raw as unknown as Matter));
  if (matter) info.flags = keywordFlags(matter);
  return { matter, info };
}

/** Counts the entries in each list of the matter. */
export function countsOf(matter: Matter): Record<string, number> {
  return {
    tracks: matter.tracks.length, violations: matter.violations.length,
    events: matter.events.length, people: matter.people.length, orgs: matter.orgs.length, links: matter.links.length,
    claims: matter.claims.length, money: matter.money.length, docs: Object.keys(matter.docs).length, definedTerms: matter.meta.definedTerms.length,
  };
}

/** The manifest's exact bytes: stable key order from assembly, two-space indent, trailing newline. */
export function serialize(matter: Matter): string {
  return `${JSON.stringify(matter, null, 2)}\n`;
}

/** Reads the catalog (required) and the fragments from disk, then assembles. roomNotes come from the room config. */
export async function buildFromDisk(sourceRoot: string, cacheDir: string, resolver: Resolver, now: Date, roomNotes: readonly InternalNote[] = []): Promise<Built> {
  let text: string;
  try {
    text = await readFile(path.join(sourceRoot, CATALOG_REL), 'utf8');
  } catch {
    throw new Error(`Missing ${CATALOG_REL} under sourceRoot`);
  }
  const catalog = parseCatalog(text, sourceRoot, roomNotes);
  const fragments = await loadFragments(matterPaths(cacheDir).fragments);
  return assemble(catalog, fragments, resolver, now);
}
