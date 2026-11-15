// SPDX-License-Identifier: Apache-2.0
// The room's rule that a Social Security number never goes in, at every way in that skips the sync's guard: a comment,
// a guest's comment, a proposal, and a counsel upload's name and plain-text bytes (#267). The same rules as the guard
// (scripts/pii.ts). A refusal is a short code; the number is never logged or returned.
import { findPiiSync } from '../scripts/pii.ts';

/** True when `text` holds a printed SSN, a labelled nine-digit number or a private key. */
export function holdsPrintedNumber(text: string): boolean {
  return findPiiSync(text).length > 0;
}

/** Text carried between chunks, so a number split across two still meets a label before it. */
const OVERLAP = 160;

/** Passes bytes through unchanged, reading them as UTF-8 text when `on`; `found()` says whether they held a number. */
export function printedNumberGuard(on: boolean): { stream: TransformStream<Uint8Array, Uint8Array>; found: () => boolean } {
  const decoder = new TextDecoder();
  let tail = '';
  let found = false;
  const read = (text: string) => {
    found ||= holdsPrintedNumber(tail + text);
    tail = (tail + text).slice(-OVERLAP);
  };
  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (on && !found) read(decoder.decode(chunk, { stream: true }));
      controller.enqueue(chunk);
    },
    flush() {
      if (on && !found) read(decoder.decode());
    },
  });
  return { stream, found: () => found };
}
