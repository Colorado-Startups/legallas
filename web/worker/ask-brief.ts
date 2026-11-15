// SPDX-License-Identifier: Apache-2.0
// The case picture Ask reads with every question: what the matter is now, the filings counsel is preparing
// with their points to prove and the proof behind each, and the prior case marked closed. Without it Ask sees
// only the passages it retrieves, and a record can be mostly a closed case, so it could describe that case as the
// current one and miss the Complaint guide's own questions (replica, 2026-10-02).
//
// Built from the published manifest (routes/matter.ts loadMatter, cached by etag). Proof tags name only live
// documents; a proof without a page is named, not tagged, because a cite needs a page.
import type { Matter, MatterTrack, ProofItem, TrackCount } from './matter-types.ts';
import type { CitableDoc } from './passages.ts';
import { neutralizeTags } from './prompt.ts';
import { speakersOf, type Speaker } from './speaker.ts';
import { priorStatus } from './room-settings.ts';

const MAX_NOTE = 160;

/** A brief's draft link that names the complaint itself ("Draft complaint"), not a demand letter or a memo. */
const COMPLAINT_DRAFT = /\bcomplaint\b/i;

/** The document of a complaint track's draft complaint (its brief's draft link), or null. */
export function draftComplaintDoc(track: MatterTrack): string | null {
  if (track.kind !== 'complaint') return null;
  return track.brief?.drafts.find((draft) => COMPLAINT_DRAFT.test(draft.label))?.doc ?? null;
}

/** Every document a track point's proof cites, then each draft complaint, once each, in manifest order. */
export function briefDocIds(matter: Pick<Matter, 'tracks'>): string[] {
  const ids = matter.tracks.flatMap((track) => track.points.flatMap((point) => point.proof.map((p) => p.cite.doc)));
  const drafts = matter.tracks.map(draftComplaintDoc).filter((id): id is string => id !== null);
  return [...new Set([...ids, ...drafts])];
}

/** A sentence's text without its closing period, so "et al." is not followed by a second one. */
function clause(text: string, max = 300): string {
  return line(text, max).replace(/\.$/, '');
}

/** One line of text: no line breaks, bounded, and no bracketed tag a model could copy as a cite (prompt.ts). */
function line(text: string, max = 300): string {
  const flat = neutralizeTags(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function proofText(proof: ProofItem, citable: ReadonlyMap<string, CitableDoc>): string | null {
  const doc = citable.get(proof.cite.doc);
  if (!doc) return null;
  const where = proof.cite.page === null ? `(${line(doc.name, 120)}, no page)` : `[doc:${doc.id} p:${proof.cite.page}]`;
  const note = proof.note ? ` ${line(proof.note, MAX_NOTE)}` : '';
  return `${proof.strength} ${where}${note}`;
}

/**
 * Whether the manifest records the matter's own complaint as filed: the matter header carries a filing date or a case
 * number. Before the current complaint is filed the header names the case counsel is preparing, with neither.
 */
export function complaintFiled(matter: Pick<Matter, 'meta'>): boolean {
  return matter.meta.filed !== null || Boolean(matter.meta.caseNumber);
}

const countsText = (n: number) => `${n} ${n === 1 ? 'count' : 'counts'}`;

/** The most characters the drafted count titles take on the status line; titles past it are counted, not named. */
const MAX_COUNT_TITLES = 800;

/**
 * The drafted counts' titles in manifest order, numbered, on one bounded line ("Counts in counsel's draft: (1) A; (2) B;
 * and 2 more."). A semicolon inside a title becomes a comma, so "; " only ever separates counts: with it kept, the model
 * split one title in two and miscounted, numbered or not (replica, 2026-10-07).
 */
export function countTitles(counts: readonly Pick<TrackCount, 'title'>[]): string {
  const titles = counts
    .map((count) => clause(count.title, 90).replace(/\s*;\s*/g, ', '))
    .filter(Boolean)
    .map((title, i) => `(${i + 1}) ${title}`);
  if (titles.length === 0) return '';
  const shown: string[] = [];
  let used = 0;
  for (const title of titles) {
    if (shown.length > 0 && used + title.length + 2 > MAX_COUNT_TITLES) break;
    shown.push(title);
    used += title.length + 2;
  }
  const more = titles.length - shown.length;
  return ` Counts in counsel's draft: ${shown.join('; ')}${more > 0 ? `; and ${more} more` : ''}.`;
}

/**
 * A complaint's status line, from the manifest: filed or not, and how many counts its draft pleads. Said outright, or
 * the model fills "what does it claim" from the closed pleading. The earlier "counsel decides its causes of action"
 * read as undecided: Ask answered that a complaint had no counts and cited only catalog rows (smoke test,
 * 2026-10-05). So the line says the draft pleads them, and tags the draft complaint (page 1, which a text document
 * always has) for the model to cite when retrieval misses it. With only the number, answers named the few counts
 * retrieval happened to find, so the line also names the drafted counts: titles only, in manifest order, on
 * one bounded line; elements and bases stay out..
 */
export function complaintStatus(track: MatterTrack, matter: Matter, citable: ReadonlyMap<string, CitableDoc>): string {
  const { meta } = matter;
  const n = (track.counts ?? []).length;
  if (complaintFiled(matter)) {
    const filed = `Filed${meta.filed ? ` ${meta.filed}` : ''}${meta.caseNumber ? ` (Case No. ${line(meta.caseNumber, 60)})` : ''}`;
    return n > 0 ? `${filed}; it pleads ${countsText(n)}.` : `${filed}; the case picture does not list its counts, so it claims only what the points below prove.`;
  }
  if (n === 0) return 'Not yet filed; its causes of action are not drafted yet (counsel decides them), so it claims only what the points below prove.';
  const draft = draftComplaintDoc(track);
  const tag = draft && citable.has(draft) ? ` [doc:${draft} p:1]` : '';
  return `Not yet filed. A draft complaint for counsel's review${tag} pleads ${countsText(n)}; it is not filed, and counsel may revise it.${countTitles(track.counts ?? [])}`;
}

function trackText(track: MatterTrack, n: number, total: number, matter: Matter, names: ReadonlyMap<string, string>, citable: ReadonlyMap<string, CitableDoc>): string {
  const marks = new Map(matter.violations.map((v) => [v.id, `${v.mark} (${line(v.title, 120)})`]));
  const against = track.against.map((id) => names.get(id)).filter(Boolean).join(', ') || 'not named';
  const rests = track.violations.map((id) => marks.get(id)).filter(Boolean).join('; ');
  const points = track.points.map((point) => {
    const proof = point.proof.map((p) => proofText(p, citable)).filter((p): p is string => p !== null);
    const mark = matter.violations.find((v) => v.id === point.violation)?.mark ?? '?';
    return `   - (${mark}) ${line(point.text)} Proof: ${proof.length > 0 ? proof.join('; ') : 'none in the room yet'}.`;
  });
  const status = track.kind === 'complaint' ? complaintStatus(track, matter, citable) : 'Not yet submitted; the points below are what it must show.';
  // Each filing is fenced by its own title: the model once gave one filing's respondents to another.
  const title = line(track.title, 120);
  return [
    `Filing ${n} of ${total}: ${title}`,
    `   Kind: ${track.kind}. Forum: ${line(track.forum, 120)}.`,
    `   Would name: ${against}.`,
    `   Rests on: ${rests || 'no violation listed'}.`,
    `   Status: ${status}`,
    '   Points to prove:',
    ...points,
    `(end of ${title})`,
  ].join('\n');
}

/**
 * The case picture as plain text, or null when the manifest has nothing to say about the matter. `citable` holds the
 * live documents the proof cites (retrieval.ts liveDocuments over briefDocIds); proof naming any other document is left out.
 */
export function caseBrief(matter: Matter, citable: ReadonlyMap<string, CitableDoc>): string | null {
  const { meta } = matter;
  const names = new Map<string, string>([...matter.people.map((p) => [p.id, p.name] as const), ...matter.orgs.map((o) => [o.id, o.name] as const)]);
  const parts: string[] = [];
  const court = [meta.court, meta.caseNumber ? `Case No. ${meta.caseNumber}` : null].filter(Boolean).join(', ');
  parts.push(`Matter now: ${clause(meta.caption)}${court ? ` (${line(court, 160)})` : ''}.`);
  if (matter.tracks.length > 0) {
    parts.push('Filings counsel is preparing:');
    matter.tracks.forEach((track, i) => parts.push(trackText(track, i + 1, matter.tracks.length, matter, names, citable)));
  }
  if (matter.violations.length > 0) {
    parts.push('Violations:');
    for (const v of matter.violations) parts.push(`- ${v.mark}: ${line(v.title, 120)}. ${line(v.summary)}`);
  }
  const prior = meta.priorCase;
  if (prior) {
    const facts = [prior.court, prior.caseNumber ? `Case No. ${prior.caseNumber}` : null, prior.judge, prior.operativePleading?.title].filter(Boolean);
    parts.push(
      `Prior case (${priorStatus}; history only, not being pursued): ${clause(prior.caption)}${facts.length > 0 ? `. ${line(facts.join(', '), 300)}` : ''}. ` +
        "Its pleading and counts are not the claims of the filings above.",
    );
  }
  return matter.tracks.length > 0 || prior ? parts.join('\n') : null;
}

/** D1 binds at most 100 parameters, so the live-document lookup goes in slices. */
const ID_SLICE = 90;

/**
 * The case picture and the live documents its proof tags may cite, or null when no manifest is published or it
 * cannot be read: Ask then answers from retrieved passages alone, as before. `speakers` are the manifest's writers by
 * kind (speaker.ts), which only the label guard reads: they never reach the prompt. Never throws.
 */
export async function matterBrief(
  load: () => Promise<Matter | null>,
  lookup: (ids: readonly string[]) => Promise<Map<string, CitableDoc>>,
): Promise<{ text: string; citable: Map<string, CitableDoc>; filed: boolean; speakers: Speaker[] } | null> {
  try {
    const matter = await load();
    if (!matter) return null;
    const ids = briefDocIds(matter);
    const citable = new Map<string, CitableDoc>();
    for (let i = 0; i < ids.length; i += ID_SLICE) for (const [id, doc] of await lookup(ids.slice(i, i + ID_SLICE))) citable.set(id, doc);
    const text = caseBrief(matter, citable);
    return text ? { text, citable, filed: complaintFiled(matter), speakers: speakersOf(matter) } : null;
  } catch (error) {
    // The name only: a manifest error message names a field, and Ask must not fail over it.
    console.error('ask_brief_failed', error instanceof Error ? error.name : typeof error);
    return null;
  }
}
