// SPDX-License-Identifier: Apache-2.0
// How the site counts words, shared by the validator and the publish guard so the two can't drift apart.

/** A run of letters in any script, counted once per 20 letters, so prose with no spaces still counts. */
const LETTERS = /\p{L}+/gu;

/** The words in a text: letter runs, 20 letters to a word. Numbers and punctuation don't count. */
export const wordsIn = (text: string): number => (text.match(LETTERS) ?? []).reduce((sum, run) => sum + Math.ceil(run.length / 20), 0);
