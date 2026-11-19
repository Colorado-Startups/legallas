// SPDX-License-Identifier: Apache-2.0
// The front door's own files, read as a visitor reads them: how much is visual, how long it takes, how many tokens it costs.

import { type Doc } from './corpus.ts';
import { INPUTS } from './inputs.ts';

/** Words as the publish guard counts them: letter and digit runs. */
const words = (text: string): number => text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;

const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
/** A prose line that holds only images: a picture, not prose. With its images taken out, only space is left. */
function imageOnly(text: string): boolean {
  const rest = text.replace(IMAGE, '');
  return rest !== text && rest.trim() === '';
}

/**
 * The share of a doc's content lines that are visual: table rows, fenced blocks (diagrams, commands) and image lines, against
 * paragraphs and list items. Headings count as neither. A doc with no content reads 0.
 */
export function visualShare(doc: Doc): number {
  const fenced = doc.fences.reduce((n, f) => n + f.body.split('\n').length, 0);
  let tables = 0;
  let inFence = false;
  for (const line of doc.lines) {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) inFence = !inFence;
    else if (!inFence && line.trim().startsWith('|')) tables++;
  }
  const prose = doc.prose.filter((p) => p.kind !== 'heading');
  const images = prose.filter((p) => imageOnly(p.text)).length;
  const visual = fenced + tables + images;
  const total = visual + prose.length - images;
  return total === 0 ? 0 : (100 * visual) / total;
}

/** Minutes to read every word of a doc, tables and fences included, at the page's reading rate. */
export function readingMinutes(doc: Doc): number {
  return words(doc.lines.join('\n')) / INPUTS.words_per_minute;
}

/** The data room's rule (data-room/lab/journeys.ts): four characters a token, so tokens compare across pages. */
export const tokensOf = (text: string): number => Math.ceil(text.length / 4);
