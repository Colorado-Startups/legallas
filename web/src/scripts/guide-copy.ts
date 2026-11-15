// SPDX-License-Identifier: Apache-2.0
// The Legallas guide's words (plan PR 5b): one plain sentence per page and two or three orders, each a question the
// reader can send to Ask. The copy here is generic; names and counts fill in at run time from GET /api/matter, so
// no matter name ever sits in source (the CI case-data guard). Pure, no DOM, pinned by guide-copy.test.ts.
//
// A text is a list of candidates: the first whose {placeholders} all have values wins. A briefing's last
// candidate has no placeholders, so a page always has one; an order whose candidates all miss is dropped.
import { GUIDE_PAGES, type GuidePage } from './guide-bus.ts';
import { priorStatus, regulatorOrders } from '../../worker/room-settings.ts';

/** The page keys are core (guide-bus.ts); re-exported for the guide's own modules. */
export { GUIDE_PAGES, type GuidePage };

/** Filled values by placeholder name; a missing or empty value leaves its candidates unused. */
export type GuideValues = Partial<Record<string, string>>;

/** One order button of the page guide: its label and the question Ask opens with. */
export interface GuideOrder {
  /** The button text: a noun or a plain verb, sentence case. */
  label: string;
  /** The question Ask opens with, as candidates. Never sent by the guide. */
  question: readonly string[];
}

/** The guide's words for a page: its brief lines and its orders. */
export interface GuideCopy {
  brief: readonly string[];
  orders: readonly GuideOrder[];
}

/** The guide's words for every page. */
export const GUIDE_COPY: Record<GuidePage, GuideCopy> = {
  overview: {
    brief: [
      'The case runs on {tracks}, built on {violations}; each card shows what is proved and what is still missing.',
      'Start here: what changed lately, the key documents, and where each part of the case stands.',
    ],
    orders: [
      { label: 'Summarize the case', question: ['Summarize this matter in five sentences, with cites.'] },
      { label: 'Recent events', question: ['What are the five most recent events in the record, with cites?'] },
      { label: 'Where to start', question: ['Which three documents should new counsel read first, and why?'] },
    ],
  },
  complaint: {
    brief: [
      'The complaint against {against} on one page: who is who, the dated steps, each count against its proof, and the hurdles.',
      'The complaint on one page: who is who, the dated steps, each count against its proof, and the hurdles.',
    ],
    orders: [
      {
        label: 'Who controls the entities',
        question: [
          'Who controls the entities in {complaintViolations}, according to the record?',
          'Who controls the entities at issue, according to the record?',
        ],
      },
      {
        label: 'Strongest proof',
        question: [
          'Which points against {against} have the strongest proof, with cites?',
          'Which points in the complaint have the strongest proof, with cites?',
        ],
      },
      { label: 'Gaps', question: ['Which points in the complaint are not yet supported by the record?'] },
    ],
  },
  regulator: {
    brief: [
      '{regulatorFilings} for the regulator, one tab each; every point to prove shows its proof or a gap.',
      'The regulator filings, one tab each; every point to prove shows its proof or a gap.',
    ],
    orders: [
      ...regulatorOrders,
      { label: 'Gaps', question: ['Which points in the regulator filings are not yet supported by the record?'] },
    ],
  },
  chronology: {
    brief: [
      '{events} from the record, oldest first; filter by violation and open any event for its cites.',
      'Dated events from the record, oldest first; filter by violation and open any event for its cites.',
    ],
    orders: [
      { label: 'Turning points', question: ['Which five events matter most to the case, and why, with cites?'] },
      { label: 'Earliest event', question: ['What is the earliest event in the record, and what does it show?'] },
    ],
  },
  people: {
    brief: [
      '{people} and {entities}; the structure view shows who controls what, and each profile lists its documents.',
      'People and entities; the structure view shows who controls what, and each profile lists its documents.',
    ],
    orders: [
      { label: 'Who controls what', question: ['Who controls each entity, according to the record, with cites?'] },
      { label: 'Roles over time', question: ["How did each person's role change over time, with cites?"] },
    ],
  },
  documents: {
    brief: ['Every document keeps a permanent control number; search, filter, or mark one Key for the team.'],
    orders: [
      { label: 'Best proof', question: ['Which documents best prove the main points of the case, with cites?'] },
      { label: 'Read first', question: ['Which documents should counsel read first, and why?'] },
    ],
  },
  binder: {
    brief: ['The visual binder: each page pictures part of the case and is built from the record.'],
    orders: [
      { label: 'Entity structure', question: ['Which documents show how the entities are structured, with cites?'] },
      { label: 'Money moved', question: ['Which payments and transfers does the record show, with cites?'] },
    ],
  },
  visual: {
    brief: ['One page of the visual binder; check its facts against the cited documents.'],
    orders: [
      {
        label: 'Check the facts',
        question: ['Which documents support the facts in {title}, with cites?', "Which documents support the binder's facts, with cites?"],
      },
    ],
  },
  doc: {
    brief: ['One document at its cited page; the facts beside it show where the case relies on it.'],
    orders: [
      { label: 'Summarize', question: ['Summarize {title} in three sentences, with cites.'] },
      { label: 'Where it matters', question: ['Which events and points rely on {title}?'] },
    ],
  },
  claims: {
    brief: [`The prior case, kept for history: the counts of the ${priorStatus} pleading and the proof gathered for each.`],
    orders: [
      { label: 'Prior counts', question: ['What did each count of the prior pleading allege, with cites?'] },
      {
        label: 'Proof that carries over',
        question: [
          'Which proof gathered for the prior counts also supports {violations}?',
          'Which proof gathered for the prior counts still matters, with cites?',
        ],
      },
    ],
  },
};

/** Whether a value is one of the guide pages. */
export function isGuidePage(value: unknown): value is GuidePage {
  return typeof value === 'string' && (GUIDE_PAGES as readonly string[]).includes(value);
}

const SLOT = /\{(\w+)\}/g;

/** The template with every {name} replaced, or null when any value is missing or empty. */
export function fill(template: string, values: GuideValues): string | null {
  let missing = false;
  const out = template.replace(SLOT, (_, name: string) => {
    const value = values[name];
    if (!value) missing = true;
    return value ?? '';
  });
  return missing ? null : out;
}

/** The first candidate that fills, or null. */
export function pick(candidates: readonly string[], values: GuideValues): string | null {
  for (const candidate of candidates) {
    const text = fill(candidate, values);
    if (text !== null) return text;
  }
  return null;
}

/** What the band shows for a page: the briefing and the orders that filled. */
export function briefingFor(page: GuidePage, values: GuideValues): { brief: string; orders: { label: string; question: string }[] } {
  const copy = GUIDE_COPY[page];
  const orders = copy.orders.flatMap((order) => {
    const question = pick(order.question, values);
    return question === null ? [] : [{ label: order.label, question }];
  });
  // safe: every briefing ends with a candidate that has no placeholders (pinned by the test).
  return { brief: pick(copy.brief, values) ?? copy.brief.at(-1)!, orders };
}

/** The matter fields the guide reads. Structural, so it holds both before and after tracks join the manifest. */
export interface GuideMatter {
  people?: readonly { id: string; name: string }[];
  orgs?: readonly { id: string; name: string }[];
  events?: readonly unknown[];
  tracks?: readonly { kind?: string; against?: readonly string[]; violations?: readonly string[] }[];
  violations?: readonly { id: string; mark?: string }[];
}

/** The most names a list may hold before the guide stops naming them. */
const MAX_NAMES = 3;
/** The longest value placed in a sentence. */
const MAX_VALUE = 120;

/** Control characters out, whitespace collapsed, capped; empty when nothing is left. */
function clean(text: unknown): string {
  if (typeof text !== 'string') return '';
  const flat = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > MAX_VALUE ? '' : flat;
}

/** "1 track", "12 dated events": numerals, as the room's own counts read ("40 events, 6 organizations"). */
export function count(n: number, one: string, many: string): string {
  if (!Number.isInteger(n) || n <= 0) return '';
  return `${n} ${n === 1 ? one : many}`;
}

/** "A", "A and B", "A, B and C"; empty for none, more than MAX_NAMES, or any blank (a partial list misleads). */
export function listOf(names: readonly string[]): string {
  if (names.length === 0 || names.length > MAX_NAMES || names.some((name) => !name)) return '';
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** "violation C", "violations A and C": marks as one phrase; empty when any mark is missing. */
function violationsPhrase(marks: readonly string[]): string {
  const list = listOf(marks);
  return list ? `${marks.length === 1 ? 'violation' : 'violations'} ${list}` : '';
}

/**
 * The values the copy fills from: counts, violation marks and the names the complaint is against, from the served
 * matter (null before one is published), plus the page's own title for doc and visual pages.
 */
export function guideValues(matter: GuideMatter | null, page: { title?: string } = {}): GuideValues {
  const names = new Map<string, string>();
  for (const entry of [...(matter?.people ?? []), ...(matter?.orgs ?? [])]) names.set(entry.id, clean(entry.name));
  const marks = new Map<string, string>();
  for (const v of matter?.violations ?? []) if (/^[A-Z]$/.test(v.mark ?? '')) marks.set(v.id, v.mark as string);
  const tracks = matter?.tracks ?? [];
  const complaint = tracks.find((track) => track.kind === 'complaint');
  const regulator = tracks.filter((track) => track.kind === 'regulator').length;
  return {
    tracks: count(tracks.length, 'track', 'tracks'),
    violations: violationsPhrase([...marks.values()]),
    complaintViolations: violationsPhrase((complaint?.violations ?? []).map((id) => marks.get(id) ?? '')),
    against: listOf((complaint?.against ?? []).map((id) => names.get(id) ?? '')),
    regulatorFilings: count(regulator, 'filing', 'filings'),
    events: count(matter?.events?.length ?? 0, 'dated event', 'dated events'),
    people: count(matter?.people?.length ?? 0, 'person', 'people'),
    entities: count(matter?.orgs?.length ?? 0, 'entity', 'entities'),
    title: clean(page.title),
  };
}
