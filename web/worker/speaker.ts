// SPDX-License-Identifier: Apache-2.0
// Who wrote a letter or an email, by kind of writer only: the other side's counsel, the other side, the client's
// counsel, the client, the court. Ask names that writer when it attributes a claim resting only on letters or emails
// (answer-shape.ts): a party's own letter is that party's statement, so it reads "According to a letter from the
// other side," never "the complaint alleges" (W7, 2026-10-05).
//
// The writers come from the published case picture: the manifest's people and organizations, each with a role and a
// side (matter-types.ts), never names in this code. An email names its writer in its From lines among the passages
// that reached the prompt; a plain letter (LTR, Letter) in its file name's Party segment
// (DocType__YYYYMMDD__Party__Qualifier). A demand, preservation or engagement letter's Party names its addressee or
// the firm engaged as often as its writer, so it gets none. A writer the manifest does not know, a surname that
// writers of two kinds share, or a thread whose From lines name writers of different kinds gives no speaker, and the
// claim reads "According to a letter," as before.
import type { Matter } from './matter-types.ts';

export type SpeakerKind = 'opposing-counsel' | 'opposing-party' | 'client-counsel' | 'client' | 'court';

export interface Speaker {
  /** Lowercase words that name the writer: a first and last name, a surname, or an organization's name. */
  key: string;
  kind: SpeakerKind;
}

const PHRASE: Record<SpeakerKind, string> = {
  'opposing-counsel': "the other side's counsel",
  'opposing-party': 'the other side',
  'client-counsel': "the client's counsel",
  client: 'the client',
  court: 'the court',
};

/** The words Ask uses for a kind of writer ("a letter from the other side's counsel"), or null. */
export function speakerPhrase(kind: SpeakerKind | null | undefined): string | null {
  return kind ? PHRASE[kind] : null;
}

function personKind(role: string, side: string): SpeakerKind | null {
  if (role === 'defenseCounsel') return 'opposing-counsel';
  if (role === 'plaintiffCounsel') return 'client-counsel';
  if (role === 'courtStaff' || side === 'court') return 'court';
  if (role === 'defendant' || side === 'defendant') return 'opposing-party';
  if (role === 'plaintiff' || side === 'client') return 'client';
  return null;
}

function orgKind(kind: string, side: string): SpeakerKind | null {
  if (side === 'court' || kind === 'court') return 'court';
  if (side === 'defendant') return kind === 'firm' ? 'opposing-counsel' : 'opposing-party';
  if (side === 'client') return kind === 'firm' ? 'client-counsel' : 'client';
  return null;
}

/** Lowercase ASCII letters and digits with single spaces, so names compare whatever their punctuation. */
export function foldName(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

const ORG_SUFFIX = /(?: (?:l l c|llc|l l p|llp|ltd|inc|l p|lp|pllc|p c|pc|co|corp|company|corporation))+$/;

/**
 * The writers the manifest knows. A key that writers of two kinds share (or a writer of no kind, such as a third
 * party) is dropped, so a shared surname never names the wrong side. Keys shorter than 4 letters are dropped too.
 */
export function speakersOf(matter: Pick<Matter, 'people' | 'orgs'>): Speaker[] {
  const kinds = new Map<string, Set<SpeakerKind | null>>();
  const add = (key: string, kind: SpeakerKind | null) => {
    if (key.length < 4) return;
    const set = kinds.get(key) ?? new Set();
    set.add(kind);
    kinds.set(key, set);
  };
  for (const person of matter.people) {
    const kind = personKind(person.role, person.side);
    const words = foldName(person.name).split(' ').filter((w) => w.length > 1);
    if (words.length >= 2) add(`${words[0]} ${words.at(-1)}`, kind);
    add(words.at(-1) ?? '', kind);
  }
  for (const org of matter.orgs) add(foldName(org.name).replace(ORG_SUFFIX, ''), orgKind(org.kind, org.side));
  return [...kinds].flatMap(([key, set]) => {
    const [only] = set;
    return set.size === 1 && only ? [{ key, kind: only }] : [];
  });
}

/** Kinds of the writers named in `text`. */
function kindsIn(text: string, speakers: readonly Speaker[]): Set<SpeakerKind> {
  const folded = ` ${foldName(text)} `;
  return new Set(speakers.filter((s) => folded.includes(` ${s.key} `)).map((s) => s.kind));
}

/** The writer of each From line: "From: Name <x>", "| **From** | Name <x> |", or a bare "From" line over the name. */
const FROM_LINES = [/^[ \t>*-]*(?:\*\*)?from(?:\*\*)?[ \t]*:(?:\*\*)?[ \t]*(.+)$/gim, /\|[ \t]*\*{0,2}from\*{0,2}[ \t]*\|[ \t]*([^|\n]+)/gi, /^[ \t]*from[ \t]*\n[ \t]*(.+)$/gim];

/** The display name of a From value: before an address in <> or (). */
const displayName = (value: string) => value.split(/[<(\[]/)[0] ?? '';

/** Plain letters, whose Party segment names their writer. */
const PLAIN_LETTER = /^(?:ltr|letter|letters|correspondence|corr)$/i;
const DATE_SEGMENT = /^\d{8}(?:-\d{8})?$/;

/**
 * The kind of writer of a letter or an email, or null when the passages and name do not settle it. `texts` are the
 * document's passages that reached the prompt.
 */
export function speakerOf(doc: { name: string; kind: 'letter' | 'email' }, texts: readonly string[], speakers: readonly Speaker[]): SpeakerKind | null {
  if (speakers.length === 0) return null;
  const found = new Set<SpeakerKind>();
  if (doc.kind === 'email') {
    for (const text of texts) for (const pattern of FROM_LINES) for (const match of text.matchAll(pattern)) for (const kind of kindsIn(displayName(match[1]!), speakers)) found.add(kind); // safe: each pattern has the group
  } else {
    const segments = doc.name.replace(/\.[A-Za-z0-9]{1,5}$/, '').split('__');
    if (!PLAIN_LETTER.test((segments[0] ?? '').replace(/_[A-Z]{2,6}$/, ''))) return null;
    const party = segments.slice(1).find((s) => !DATE_SEGMENT.test(s)) ?? '';
    for (const kind of kindsIn(party.replace(/[_-]+/g, ' '), speakers)) found.add(kind);
  }
  const [only] = found;
  return found.size === 1 && only ? only : null;
}
