// SPDX-License-Identifier: Apache-2.0
// The document page's pure helpers (card P6): the data-room index for the breadcrumb, Previous and Next within
// the folder, the exhibit facts from the matter, and the "cited in" line. No DOM, so node --test covers them.
import { buildIndex, findFolder as findIndexFolder } from './documents-table-data.ts';
import type { FolderNode, ListedDocument } from './files-api.ts';
import type { ServedMatter } from './doc-facts.ts';

/** One breadcrumb step: the folder path, its data-room index ("04", "04.2") and a readable name. */
export interface Crumb {
  path: string;
  index: string;
  name: string;
}

/** Where a document sits among its folder's files (name order, as the documents tree lists them). */
export interface FolderPlace {
  position: number;
  total: number;
  prev: ListedDocument | null;
  next: ListedDocument | null;
}

const TOP_PREFIX = /^(\d{2})(?:[-_ .]+|$)/;

/** "03-Kitchen-Records" is "Kitchen Records"; "from-counsel" is "From counsel". For folders the index does not list. */
export function folderName(segment: string): string {
  const name = segment.replace(TOP_PREFIX, '').replace(/[-_]+/g, ' ').trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : segment;
}

/**
 * The breadcrumb for `folder`, numbered and named exactly as the Documents index (P5a's buildIndex): top-level
 * folders keep their 00 to 09 prefix, subfolders count .1, .2 in name order. Browsing aid only, never cited. A
 * folder the tree does not list (or no tree yet) shows its name alone.
 */
export function crumbsFor(root: FolderNode | null, folder: string): Crumb[] {
  if (!folder) return [];
  const index = root ? buildIndex(root) : [];
  const parts = folder.split('/');
  return parts.map((part, depth) => {
    const path = parts.slice(0, depth + 1).join('/');
    const listed = findIndexFolder(index, path);
    if (listed) return { path, index: listed.number, name: listed.label };
    // Before the tree arrives a top-level folder still carries its own prefix; a subfolder's number needs the tree.
    return { path, index: depth === 0 ? (TOP_PREFIX.exec(part)?.[1] ?? '') : '', name: folderName(part) };
  });
}

/** The folder node at `path`, or null. '' is the root. */
export function findFolder(root: FolderNode | null, path: string): FolderNode | null {
  let node = root;
  if (!path) return node;
  const parts = path.split('/');
  for (let depth = 0; node && depth < parts.length; depth += 1) {
    const want = parts.slice(0, depth + 1).join('/');
    node = node.folders.find((child) => child.path === want) ?? null;
  }
  return node;
}

/** Previous and Next among the folder's files, or null when the document is not listed there. */
export function placeIn(folder: FolderNode | null, id: string): FolderPlace | null {
  const files = folder?.files ?? [];
  const at = files.findIndex((file) => file.id === id);
  if (at < 0) return null;
  return { position: at + 1, total: files.length, prev: files[at - 1] ?? null, next: files[at + 1] ?? null };
}

/** Every listed document's control number, for turning "DOE-000412 at 3" in a comment into a link. */
export function controlIndex(root: FolderNode | null): Map<number, string> {
  const map = new Map<number, string>();
  const add = (file: ListedDocument | null) => {
    if (file?.control_seq) map.set(file.control_seq, file.id);
  };
  const walk = (node: FolderNode) => {
    node.files.forEach(add);
    add(node.guide);
    node.folders.forEach(walk);
  };
  if (root) walk(root);
  return map;
}

const ROMAN: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

/** Counts are numbered as the pleading numbers them: 3 is "III". */
export function roman(n: number): string {
  let left = Math.floor(n);
  if (left < 1) return String(n);
  let out = '';
  for (const [value, mark] of ROMAN) {
    while (left >= value) {
      out += mark;
      left -= value;
    }
  }
  return out;
}

/** What "Cited in" reads: the violations and tracks first, then the events and the prior case's counts. */
type CitingMatter = Pick<ServedMatter, 'events' | 'claims' | 'violations' | 'tracks'>;

const cites = (item: { cites: readonly { doc: string }[] }, docId: string): boolean => item.cites.some((c) => c.doc === docId);

/** "A and C": a list joined the way the page reads it. */
function joined(items: readonly string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : (items[0] ?? '');
}

/**
 * The marks of the violations that rest on `docId`, in mark order: the violation's own cites, its steps and figures,
 * the events it lists, and the proof under any track point made for it.
 */
export function violationsCiting(matter: CitingMatter, docId: string): string[] {
  const citingEvents = new Set(matter.events.filter((event) => cites(event, docId)).map((event) => event.id));
  const proven = new Set(
    matter.tracks.flatMap((track) => track.points)
      .filter((point) => point.proof.some((item) => item.cite.doc === docId))
      .map((point) => point.violation),
  );
  return matter.violations
    .filter((v) =>
      cites(v, docId) || proven.has(v.id) ||
      v.steps.some((step) => cites(step, docId)) ||
      v.figures.some((figure) => cites(figure, docId)) ||
      v.events.some((id) => citingEvents.has(id)))
    .map((v) => v.mark)
    .sort()
    .filter((mark, i, all) => all.indexOf(mark) === i);
}

/**
 * Where `docId` is cited: the violations first, then the events, then the closed pleading's counts as the prior
 * case. "Violations A and C; 3 events; prior case Counts II, III and IV". '' when nothing cites it.
 */
export function citedIn(matter: CitingMatter, docId: string): string {
  const marks = violationsCiting(matter, docId);
  const events = matter.events.filter((event) => cites(event, docId)).length;
  const counts = matter.claims
    .filter((claim) =>
      claim.cites.some((cite) => cite.doc === docId) ||
      claim.elements.some((element) => element.proof.some((item) => item.cite.doc === docId)))
    .map((claim) => claim.count)
    .sort((a, b) => a - b)
    .filter((count, i, all) => all.indexOf(count) === i)
    .map(roman);
  const parts: string[] = [];
  if (marks.length) parts.push(`${marks.length === 1 ? 'Violation' : 'Violations'} ${joined(marks)}`);
  if (events > 0) parts.push(`${events} ${events === 1 ? 'event' : 'events'}`);
  if (counts.length) parts.push(`prior case ${counts.length === 1 ? 'Count' : 'Counts'} ${joined(counts)}`);
  return parts.join('; ');
}

/** Names for person and org ids, in order, skipping ids the matter does not list. */
export function namesFor(matter: Pick<ServedMatter, 'people' | 'orgs'>, ids: readonly string[]): string[] {
  const names = new Map<string, string>();
  for (const person of matter.people) names.set(person.id, person.name);
  for (const org of matter.orgs) names.set(org.id, org.name);
  return ids.map((id) => names.get(id)).filter((name): name is string => Boolean(name));
}

/** The parties line and its label: "From → to" with both sides, "From" or "To" with one; null with neither. */
export function fromTo(from: readonly string[], to: readonly string[]): { label: string; value: string } | null {
  const a = from.join(', ');
  const b = to.join(', ');
  if (a && b) return { label: 'From → to', value: `${a} → ${b}` };
  if (a) return { label: 'From', value: a };
  return b ? { label: 'To', value: b } : null;
}

/** A cite written in prose, such as "DOE-000412 at 3", found in plain text. */
export interface TextCite {
  start: number;
  end: number;
  control: number;
  page: number | null;
}

/** The `<prefix>-<6 digits>( at <page>)` cites in `text`, in order. */
export function findCites(text: string, prefix: string): TextCite[] {
  const pattern = new RegExp(`\\b${prefix}-(\\d{6})(?: at (\\d{1,5}))?\\b`, 'g');
  const found: TextCite[] = [];
  for (const match of text.matchAll(pattern)) {
    const page = match[2] ? Number(match[2]) : null;
    found.push({ start: match.index, end: match.index + match[0].length, control: Number(match[1]), page });
  }
  return found;
}
