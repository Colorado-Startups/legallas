// SPDX-License-Identifier: Apache-2.0
// Card F4. Loads the drafting cards' fragments (<cacheDir>/matter/fragments/*.json) and merges them into one
// path-keyed draft. Cites stay as {path, page, note?} here; resolve.ts turns them into documents.id cites.
// Problems name the fragment, the list and the entry id or index, never entry text.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { MatterFragment, MatterMeta } from '../../worker/matter-types.ts';

/** The lists a fragment may carry, in manifest order. */
export const LISTS = ['tracks', 'violations', 'events', 'people', 'orgs', 'links', 'claims', 'money'] as const;
/** The name of one manifest list. */
export type ListName = (typeof LISTS)[number];

/** One entry of a manifest list, as a loose object. */
export type Entry = Record<string, unknown>;

/** A fragment file loaded for the draft, named without its .json suffix. */
export interface LoadedFragment {
  /** The file name without .json. */
  name: string;
  fragment: MatterFragment;
}

/** The draft matter assembled from the fragments: its meta and its lists. */
export interface Draft {
  meta: Partial<Omit<MatterMeta, 'builtAt'>>;
  lists: Record<ListName, Entry[]>;
  /** Fragment doc facts by path, merged across fragments. */
  docs: Map<string, Entry>;
  /** Which fragment each entry came from, by "<list>:<id>" (links by index). */
  origin: Map<string, string>;
  problems: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads every *.json fragment in name order. A missing folder means no fragments. */
export async function loadFragments(dir: string): Promise<LoadedFragment[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const out: LoadedFragment[] = [];
  for (const file of names) {
    const name = file.slice(0, -'.json'.length);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
    } catch {
      throw new Error(`Fragment ${name}: not valid JSON`);
    }
    if (!isRecord(raw) || typeof raw.card !== 'string' || raw.card.trim() === '') throw new Error(`Fragment ${name}: needs a "card" string`);
    out.push({ name, fragment: raw as unknown as MatterFragment });
  }
  return out;
}

function mergeMeta(draft: Draft, name: string, meta: unknown): void {
  if (meta === undefined) return;
  if (!isRecord(meta)) { draft.problems.push(`${name}: meta must be an object`); return; }
  for (const [key, value] of Object.entries(meta)) {
    if (key === 'builtAt') { draft.problems.push(`${name}: meta.builtAt is set by the build`); continue; }
    if (key === 'definedTerms') {
      if (!Array.isArray(value)) { draft.problems.push(`${name}: meta.definedTerms must be a list`); continue; }
      const terms = (draft.meta.definedTerms ??= []);
      for (const term of value) {
        const existing = terms.find((t) => isRecord(term) && t.term === term.term);
        if (!existing) terms.push(term as never);
        else if (JSON.stringify(existing) !== JSON.stringify(term)) draft.problems.push(`${name}: meta.definedTerms conflicts with an earlier fragment`);
      }
      continue;
    }
    const current = (draft.meta as Record<string, unknown>)[key];
    if (current === undefined || current === null) (draft.meta as Record<string, unknown>)[key] = value;
    else if (value !== null && JSON.stringify(current) !== JSON.stringify(value)) draft.problems.push(`${name}: meta.${key} conflicts with an earlier fragment`);
  }
}

function mergeList(draft: Draft, name: string, list: ListName, value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) { draft.problems.push(`${name}: ${list} must be a list`); return; }
  value.forEach((entry, index) => {
    if (!isRecord(entry)) { draft.problems.push(`${name}: ${list}[${index}] must be an object`); return; }
    if (list === 'links') {
      const key = JSON.stringify([entry.from, entry.to, entry.label]);
      if (draft.lists.links.some((link) => JSON.stringify([link.from, link.to, link.label]) === key)) {
        draft.problems.push(`${name}: links[${index}] repeats an earlier link`);
        return;
      }
      draft.origin.set(`links:${draft.lists.links.length}`, name);
      draft.lists.links.push(entry);
      return;
    }
    const id = typeof entry.id === 'string' ? entry.id : null;
    if (!id) { draft.problems.push(`${name}: ${list}[${index}] has no id`); return; }
    const owner = draft.origin.get(`${list}:${id}`);
    if (owner && list === 'tracks' && isTrackSupplement(entry)) { supplementTrack(draft, name, id, entry); return; }
    if (owner) { draft.problems.push(`${name}: ${list} id ${id} is already used by ${owner}`); return; }
    draft.origin.set(`${list}:${id}`, name);
    draft.lists[list].push(entry);
  });
}

/** The fields a later fragment may add to a track an earlier fragment made. */
const TRACK_SUPPLEMENT = ['brief', 'counts'] as const;

/** A tracks entry that only adds a brief or counts: its id plus one or both of those fields, nothing else. */
function isTrackSupplement(entry: Entry): boolean {
  const keys = Object.keys(entry).filter((key) => key !== 'id');
  return keys.length > 0 && keys.every((key) => (TRACK_SUPPLEMENT as readonly string[]).includes(key));
}

/**
 * Adds a brief or counts to a track from an earlier fragment, so content cards need not edit the fragment that
 * made the track. A field the track already has is a problem, not a silent win.
 */
function supplementTrack(draft: Draft, name: string, id: string, entry: Entry): void {
  const index = draft.lists.tracks.findIndex((t) => t.id === id);
  for (const field of TRACK_SUPPLEMENT) {
    if (entry[field] === undefined) continue;
    const track = draft.lists.tracks[index]!; // safe: the origin map names this id, so the track is in the list
    const owner = draft.origin.get(`tracks:${id}/${field}`) ?? (track[field] === undefined ? null : draft.origin.get(`tracks:${id}`));
    if (owner) { draft.problems.push(`${name}: tracks id ${id} already has ${field} from ${owner}`); continue; }
    // A copy, so the earlier fragment's own object is left as loaded.
    draft.lists.tracks[index] = { ...track, [field]: entry[field] };
    draft.origin.set(`tracks:${id}/${field}`, name);
  }
}

function mergeDocs(draft: Draft, name: string, docs: unknown): void {
  if (docs === undefined) return;
  if (!isRecord(docs)) { draft.problems.push(`${name}: docs must be an object keyed by path`); return; }
  for (const [rawPath, facts] of Object.entries(docs)) {
    if (!isRecord(facts)) { draft.problems.push(`${name}: a docs entry must be an object`); continue; }
    const key = rawPath.normalize('NFC');
    const current = draft.docs.get(key) ?? {};
    // First fragment to fill a field wins; later fragments only fill what is still empty.
    for (const [field, value] of Object.entries(facts)) {
      if (isEmpty(current[field])) current[field] = value;
    }
    draft.docs.set(key, current);
  }
}

/** Empty means absent, null, '' or []. `false` is a value. */
export function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

/**
 * Merges fragments in the order given. Duplicate ids and conflicting meta become problems, not silent wins; a
 * tracks entry with only an id and a brief or counts adds them to the earlier fragment's track.
 */
export function mergeFragments(fragments: readonly LoadedFragment[]): Draft {
  const draft: Draft = {
    meta: {},
    lists: { tracks: [], violations: [], events: [], people: [], orgs: [], links: [], claims: [], money: [] },
    docs: new Map(),
    origin: new Map(),
    problems: [],
  };
  for (const { name, fragment } of fragments) {
    const record = fragment as unknown as Record<string, unknown>;
    const known = new Set<string>(['card', 'meta', 'docs', ...LISTS]);
    for (const key of Object.keys(record)) if (!known.has(key)) draft.problems.push(`${name}: unknown field ${key}`);
    mergeMeta(draft, name, record.meta);
    for (const list of LISTS) mergeList(draft, name, list, record[list]);
    mergeDocs(draft, name, record.docs);
  }
  return draft;
}
