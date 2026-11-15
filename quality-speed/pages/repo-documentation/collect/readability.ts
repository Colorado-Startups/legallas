// SPDX-License-Identifier: Apache-2.0
// Readability: the share of prose sentences over 25 words, the point past
// which GOV.UK's plain-English standard says to split a sentence. Code
// blocks, tables and headings are left out; a code span counts as one word.
// The template agreements are left out: they are the product's own legal
// drafting, worded to the statutes they cite: product text, not docs. The
// templates' index pages count.

import { type Corpus } from './corpus.ts';
import { INPUTS } from './inputs.ts';

export const SENTENCE_LIMIT = INPUTS.sentence_limit;

export interface Sentence { path: string; line: number; words: number }

/** Joins wrapped prose lines into paragraphs and list items, then splits them into sentences. */
export function sentences(c: Corpus): Sentence[] {
  const out: Sentence[] = [];
  for (const doc of c.docs.values()) {
    if (new RegExp(INPUTS.readability_excluded_pattern).test(doc.path)) continue;
    let buf = '';
    let start = 0;
    let last = -1;
    const flush = () => {
      if (buf.trim()) out.push(...split(doc.path, start, buf));
      buf = '';
    };
    for (const p of doc.prose) {
      const continues = p.kind === 'para' && p.line === last + 1;
      if (!continues || p.kind === 'heading') flush();
      if (p.kind === 'heading') {
        last = p.line;
        continue;
      }
      if (!buf) start = p.line;
      buf += ` ${p.text}`;
      last = p.line;
    }
    flush();
  }
  return out;
}

function split(path: string, line: number, text: string): Sentence[] {
  const clean = text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, 'URL')
    // Abbreviations and numbers whose dot does not end a sentence.
    .replace(/\b(e\.g|i\.e|etc|vs|v|No|Inc|Ltd|L\.P|Corp|Co|St|Mr|Ms|Dr|U\.S|Hon|Sec|Art|Fed|R|Civ|P|Stat|Rev|Reg|Ch|Pt|ss?)\./g, '$1')
    .replace(/(\d)\.(\d)/g, '$1$2');
  return clean
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"(`*])/)
    .map((s) => ({ path, line, words: s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length }))
    .filter((s) => s.words >= 3);
}

export function longShare(list: Sentence[]): number {
  if (list.length === 0) return 0;
  return list.filter((s) => s.words > SENTENCE_LIMIT).length / list.length;
}
