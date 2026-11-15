// SPDX-License-Identifier: Apache-2.0
// The law tool's answer, built once. legallas_search_law (mcp/tools/search-law.ts) sends it and the Quality kit
// (quality-speed/core/law/law.ts) rebuilds it to measure `law_lookup_tokens_p95`, so the number is the tokens a
// member's AI gets. Pure: no Worker or npm import, so node runs it beside the library's files.
//
// One shape for every client: the JSON once, as text (no structured copy), and the whole answer, passages and all,
// within LAW_ANSWER_CHARS. The passages share what the rest leaves; a short one gives its room to a long one. A
// cut passage says so, and `limit` is how to read more of each: fewer passages, more room for every one.
import { CASE_LAW_THROUGH, type LawChunk, type LawOpinion, type LawTrack } from '../worker/law-cite.ts';

export interface AnswerPassage extends LawChunk {
  text: string;
}

/** One answer's characters as sent (the result's JSON, its text escaped inside it): COMPACT_LIMITS.maxChars (mcp/contract.ts), 2,250 tokens at four characters each. A test holds them equal. */
export const LAW_ANSWER_CHARS = 9_000;
/** No passage runs past this, however few come back. */
export const MAX_PASSAGE_CHARS = 2500;
/** Passages a search returns unless `limit` says otherwise. */
export const DEFAULT_PASSAGES = 6;

/** The notice sent with law results: public law for research, to be reviewed by the member's own lawyer. */
export const NOTICE =
  'Public law from the law library, for research by an AI agent for legal work, not a lawyer. Have your own lawyer review how it applies. ' +
  `Case law in the library runs through ${CASE_LAW_THROUGH}; check for newer authority. Cite the authority, never this tool.`;

/** What a track or an opinion's writing means. An answer carries the lines of the values it uses, once, as `notes`. */
export const NOTES: Record<LawTrack | LawOpinion, string> = {
  civil: 'Civil: authority for a court claim.',
  regulator: 'Regulator only: never authority for a civil claim.',
  both: 'Civil and regulator filings.',
  majority: 'Opinion of the court: what the court held.',
  concurrence: "Concurrence: one judge's separate view, not the court's holding.",
  dissent: "Dissent: one judge's separate view, not the court's holding.",
  'concurrence-dissent': "Concurrence in part and dissent in part: one judge's separate view, not the court's holding.",
};

const CUT = ' [passage cut]';

/** Public law wrapped as data: text to quote and analyse, never instructions. */
export function lawData(body: string): string {
  return `<public-law>\n${body.replace(/<\s*\/\s*public-law\s*>/gi, '&lt;/public-law>')}\n</public-law>`;
}

/** Characters `text` takes inside a JSON string, quotes left out. */
const wire = (text: string) => JSON.stringify(text).length - 2;

/** The longest start of `text`, cut where a word ends when one does nearby, within `allowance` characters as JSON, with the cut mark. */
function cut(text: string, allowance: number): string {
  const room = allowance - wire(CUT);
  let [low, high] = [0, text.length];
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (wire(text.slice(0, mid)) <= room) low = mid;
    else high = mid - 1;
  }
  const head = text.slice(0, low);
  const space = head.search(/\s\S{0,40}$/);
  return `${(space > low - 60 && space > 0 ? head.slice(0, space) : head).trimEnd()}${CUT}`;
}

/** One passage's row, its text as given: the fields a citation, a link and a date need, and an opinion's writing and author. */
function row(p: AnswerPassage, text: string): Record<string, unknown> {
  return {
    citation: p.cite,
    title: p.title,
    kind: p.kind,
    track: p.track,
    ...(p.opinion ? { opinion: p.opinion, ...(p.author ? { author: p.author } : {}) } : {}),
    source_url: p.url,
    retrieved: p.retrieved,
    text,
  };
}

type Answer = { results: Record<string, unknown>[]; notes: Record<string, string>; notice: string };

/** Characters the answer takes as sent: the result's JSON, with the answer's own JSON escaped inside it. */
export const sentChars = (answer: Answer) => JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(answer) }] }).length;

/** The answer to a search: the passages in rank order, each cut to its share of LAW_ANSWER_CHARS as sent, and the notice. */
export function lawAnswer(passages: readonly AnswerPassage[], budget = LAW_ANSWER_CHARS): Answer {
  let inner = budget;
  let answer = fit(passages, inner);
  // Escaping the text a second time costs a little more than the text itself: take the overshoot out of the passages.
  for (let tries = 0; tries < 12 && sentChars(answer) > budget; tries += 1) {
    inner -= Math.max(1, sentChars(answer) - budget);
    answer = fit(passages, inner);
  }
  return answer;
}

/** The passages cut to share `budget` characters of answer JSON. */
function fit(passages: readonly AnswerPassage[], budget: number): Answer {
  const used = [...new Set(passages.flatMap((p) => [p.track, ...(p.opinion ? [p.opinion] : [])]))];
  const notes = Object.fromEntries(used.map((key) => [key, NOTES[key]]));
  const shell = { results: passages.map((p) => row(p, lawData(''))), notes, notice: NOTICE };
  // Room for the text: what is left of the budget once every row, the notes and the notice are written with empty text.
  let room = budget - JSON.stringify(shell).length;
  const want = passages.map((p) => p.text.trim().replace(/<\s*\/\s*public-law\s*>/gi, '&lt;/public-law>'));
  const need = want.map((t) => Math.min(wire(t), MAX_PASSAGE_CHARS));
  // Short passages keep all they need; the long ones split what remains evenly.
  const share = new Array<number>(passages.length).fill(0);
  [...need.keys()]
    .sort((a, b) => need[a]! - need[b]!)
    .forEach((i, n, order) => {
      share[i] = Math.max(0, Math.min(need[i]!, Math.floor(room / (order.length - n))));
      room -= share[i]!;
    });
  const results = passages.map((p, i) => {
    const text = want[i]!;
    return row(p, lawData(wire(text) <= share[i]! ? text : cut(text, share[i]!)));
  });
  return { results, notes, notice: NOTICE };
}

/** The tool's answer as a client gets it: the JSON, once, as text. */
export function lawResultOnce(passages: readonly AnswerPassage[]) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(lawAnswer(passages)) }] };
}
