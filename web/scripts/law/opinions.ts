// SPDX-License-Identifier: Apache-2.0
// Which writing an opinion part comes from (W4b, 2026-10-05). An opinion's text holds the opinion of the court and
// any concurrences and dissents; only the first states what the court held. The Caselaw Access Project marks each
// writing (`<article class="opinion" data-type="dissent">`) and names its author, but not always: one file keeps a
// dissent inside the majority's article under a heading ("JUSTICE X, dissenting."), and one marks a writing that
// concurs in part and dissents in part as a concurrence. So the writing's own words decide when they say which it
// is, and the build refuses a type it does not know rather than calling it the court's opinion.
import { isSeparateOpinion, type LawOpinion } from '../../worker/law-cite.ts';

/** A writing's kind and how a citation describes it: "dissenting", "concurring in the judgment". */
export interface Role {
  opinion: LawOpinion;
  role: string;
}

// The writing's own description, most specific first: "concurring in part and dissenting in part" before either.
const ROLES: readonly [RegExp, Role][] = [
  [/\bconcur(?:ring|s)? in part and dissent(?:ing|s)? in part\b/i, { opinion: 'concurrence-dissent', role: 'concurring in part and dissenting in part' }],
  [/\bdissenting\b/i, { opinion: 'dissent', role: 'dissenting' }],
  [/\bconcurring in the judgment\b/i, { opinion: 'concurrence', role: 'concurring in the judgment' }],
  [/\bspecially concurring\b/i, { opinion: 'concurrence', role: 'specially concurring' }],
  [/\bconcurring\b/i, { opinion: 'concurrence', role: 'concurring' }],
];

/** The role a writing's author line or opening words state, or null when they state none. */
export function roleOf(text: string): Role | null {
  return ROLES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

const CAP_TYPES: Record<string, Role> = {
  majority: { opinion: 'majority', role: 'opinion of the court' },
  concurrence: { opinion: 'concurrence', role: 'concurring' },
  dissent: { opinion: 'dissent', role: 'dissenting' },
  'concurring-in-part-and-dissenting-in-part': { opinion: 'concurrence-dissent', role: 'concurring in part and dissenting in part' },
};

/**
 * A CAP article's writing: its own words (author line, then the descriptor paragraph that may follow it) when they
 * name a separate writing, else CAP's data-type. Throws on a type this build does not know (a plurality, say), so
 * no writing is ever called the court's opinion by default.
 */
export function articleRole(type: string, stated: string): Role {
  const base = CAP_TYPES[type];
  if (!base) throw new Error(`unknown CAP opinion type "${type}"; decide how the library labels it`);
  return roleOf(stated) ?? base;
}

/** A paragraph that is only a role ("dissenting.", "concurring in part and dissenting in part:"), as CAP splits it. */
export function isDescriptor(text: string): boolean {
  return text.length < 60 && /^[\s(]*(?:specially )?(?:concurring|dissenting)\b[^.:]*[.:)]*\s*$/i.test(text);
}

const TITLE = String.raw`(?:mr\.\s+)?(?:chief\s+)?(?:justice|judge)`;
const HEADING = new RegExp(String.raw`^(?:${TITLE}\s+)?([\p{L}][\p{L}.'’ -]{1,40}?),?\s+(?:(?:chief\s+)?(?:justice|judge),?\s+)?((?:specially\s+)?(?:concurring|dissenting)[\p{L} ]{0,50}?)\s*[.:]?$`, 'iu');

/**
 * A paragraph that opens a separate writing inside another's article: "JUSTICE ÉCLAIR, dissenting." The name must
 * have a word in capitals, as reporters print judges' names there, so a sentence of the opinion never matches.
 */
export function headingOf(text: string): (Role & { judge: string | null }) | null {
  if (text.length > 120) return null;
  const match = HEADING.exec(text.trim());
  if (!match || !/\b\p{Lu}{2,}\b/u.test(match[1]!)) return null;
  const role = roleOf(match[2]!);
  return role ? { ...role, judge: judgeName(text) } : null;
}

/** "ÉCLAIR" to "Éclair", "O'FABLE" to "O'Fable"; mixed case and initials stay as written. */
function nameCase(word: string): string {
  if (word !== word.toUpperCase() || word.replace(/[^\p{L}]/gu, '').length < 2) return word;
  return word.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase());
}

/**
 * A writing's author as citations name one: "Fable, J.", "Other, C.J.", from the reporter's author line in any of
 * its forms ("Justice FABLE,", "OTHER, Chief Justice,", "Opinion by JUDGE THIRD", "JUSTICE ÉCLAIR delivered
 * the Opinion of the Court."). Null for "PER CURIAM" or a line it cannot read.
 */
export function judgeName(raw: string): string | null {
  if (/per curiam/i.test(raw)) return null;
  let text = raw
    .replace(/\*/g, ' ')
    .replace(/\b(?:delivered the opinion|concurs?\b|dissents?\b|concurring|dissenting|specially)[\s\S]*$/i, '')
    .replace(/^\s*opinion by:?\s*/i, '');
  const chief = /\bchief\b|\bC\.\s?J\./i.test(text);
  text = text
    .replace(/\b(?:mr\.\s+)?(?:chief\s+)?(?:justice|judge)\b\.?/gi, ' ')
    .replace(/,\s*(?:C\.\s?)?J\.?\s*$/i, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,:;]+|[\s,:;]+$/g, '')
    .replace(/(\p{L}{2,})\.$/u, '$1');
  const words = text.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 4 || !/\p{L}{2,}/u.test(text)) return null;
  return `${words.map(nameCase).join(' ')}, ${chief ? 'C.J.' : 'J.'}`;
}

const MARKER_NAMES: Record<LawOpinion, string> = {
  majority: 'Opinion of the court',
  concurrence: 'Concurrence',
  dissent: 'Dissent',
  'concurrence-dissent': 'Concurrence in part and dissent in part',
};

/** The plain words a part opens with: "(Dissent, Other, J.)"; "Opinion of the court, Fable, J." for the majority. */
export function opinionLabel(opinion: LawOpinion, judge: string | null): string {
  return [MARKER_NAMES[opinion], judge].filter(Boolean).join(', ');
}

/** The citation's parenthetical for a separate writing: " (Other, J., dissenting)"; nothing for the court's. */
export function opinionParenthetical(opinion: LawOpinion, judge: string | null, role: string): string {
  if (!isSeparateOpinion(opinion)) return '';
  return judge ? ` (${judge}, ${role})` : ` (${role} opinion)`;
}
