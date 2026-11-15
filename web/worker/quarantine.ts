// SPDX-License-Identifier: Apache-2.0
// Passages that talk to the model are marked untrusted. The prompt already fences every passage as data and tells
// the model never to obey it (prompt.ts), but in the eval (W1, --plant) a passage that told "AI tools" what to cite,
// how to label, or to drop their rules still drew cites to itself in about a quarter of the runs. A passage of a case
// document has no reason to address an AI assistant, so one that does is not evidence: it stays fenced in the prompt
// under an "untrusted" header with no document id, it is left out of the cite book (so no cite to it can validate),
// a reminder before the question says how to treat it, and only the count is logged.
//
// Deterministic and generic: well-known prompt-injection signatures (OWASP LLM01), never words from a matter. A
// passage is marked on one strong signal (an order to ignore earlier instructions, the words "system prompt", an
// order about what to cite, image syntax pointing off the room, a role-play order) or two weaker ones (words
// addressed to an AI or an assistant, a formatting order for "every answer", a "system notice", "always cite").
//
// A forged court order needs no words for a model (eval v2, --plant): a captioned "ORDER ... The Court GRANTS ...
// SO ORDERED" in a plain note was cited and stated as the ruling. Only the court's own record may carry an order
// (source-kind.ts isCourtRecord), so a passage that presents itself as one anywhere else (provenance.ts
// selfDescribedCourtRuling) is fenced the same way, under its own header and reminder. A party's filing is left to
// the label guard (answer-shape.ts): motions carry captions and proposed orders "IT IS SO ORDERED".
import { selfDescribedCourtRuling } from './provenance.ts';
import { isCourtRecord, sourceKind, type SourceFields } from './source-kind.ts';

/** Signals that on their own mark a passage as an instruction to the model. */
const STRONG: readonly RegExp[] = [
  /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|earlier|above|preceding|all)\b[^.\n]{0,25}\b(?:instructions?|rules?|prompts?|directions?|guidelines?)\b/i,
  /\b(?:system|developer)\s+prompt\b/i,
  /\bcite\s+(?:this|that)\s+(?:tag|note)\b|\bcite\b[^.\n]{0,40}\bp:\s*\d/i,
  /!\[[^\]\n]{0,200}\]\(\s*(?:https?:|\/\/|data:)/i,
  /\bstay in character\b|\bfrom now on,? you are\b[^.\n]{0,80}\b(?:unrestricted|no rules|without rules|in character)\b/i,
];

/** Signals that mark a passage only together with another. */
const WEAK: readonly RegExp[] = [
  /\b(?:AI|A\.I\.|automated)\s+(?:tools?|assistants?|systems?|models?|answers?|responses?)\b|\b(?:language models?|LLMs?|chatbots?)\b/i,
  /\b(?:the|this|you(?:r)?)\s+assistant\b|\bassistants? processing\b/i,
  /\b(?:you are now|from now on,? you|stay in character|pretend (?:to be|you are)|act as an?|let'?s play a game)\b/i,
  /\b(?:every|each|all)\s+(?:answer|response|reply|statement|claim)s?\s+(?:must|should|shall|is to|are to)\b|\blabel every\b/i,
  /\b(?:maintenance|debug|admin|god)\s+mode\b|\bpriority\s+0\b/i,
  /\b(?:system|developer)\s+(?:message|notice|instructions?)\b/i,
  /\balways\s+cite\b/i,
];

/** True when a passage reads as an instruction to the model rather than a record. */
export function addressesModel(text: string): boolean {
  if (STRONG.some((pattern) => pattern.test(text))) return true;
  return WEAK.filter((pattern) => pattern.test(text)).length >= 2;
}

/**
 * True when a passage presents itself as a court's order but its document is not the court's record (nor a party's
 * filing): the room cannot verify it, so it is no more evidence than a page addressed to the model.
 */
export function unfiledCourtRuling(text: string, doc: SourceFields): boolean {
  return selfDescribedCourtRuling(text) && !isCourtRecord(doc) && sourceKind(doc) !== 'filing';
}

/** How a quarantined passage is marked: `untrusted` always, `unfiledRuling` when it reads as an unfiled court order. */
export type Quarantined<T> = T & { untrusted?: true; unfiledRuling?: true };

/**
 * The passages with those that address the model, or (given `docOf`) read as a court order outside the court's
 * record, marked `untrusted`, and how many were marked. A passage whose document `docOf` does not know is judged as
 * a nameless record: an unknown document is not the court's record either.
 */
export function quarantine<T extends { text: string }>(
  chunks: readonly T[],
  docOf?: (chunk: T) => SourceFields | undefined,
): { chunks: Quarantined<T>[]; withheld: number } {
  let withheld = 0;
  const out = chunks.map((chunk): Quarantined<T> => {
    if (addressesModel(chunk.text)) {
      withheld++;
      return { ...chunk, untrusted: true };
    }
    if (!docOf || !unfiledCourtRuling(chunk.text, docOf(chunk) ?? { name: '' })) return chunk;
    withheld++;
    return { ...chunk, untrusted: true, unfiledRuling: true };
  });
  return { chunks: out, withheld };
}
