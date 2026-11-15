// SPDX-License-Identifier: Apache-2.0
// The page's score-setting inputs (inputs.json), read once. Changing one is a goal change: inputs.lock.json pins
// the file, and inputs.test.ts fails until the change carries a signed-off entry.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface Inputs {
  corpus_excluded: string[];
  /** The front door: the README a visitor lands on. */
  readme: string;
  /** The community files GitHub links beside it. */
  community: string[];
  /** The visual share, in percent, a community file needs to count. */
  community_visual_min: number;
  words_per_minute: number;
  min_definite_share: number;
  /** How many of main's newest first-parent commits Activity reads. */
  main_commits: number;
  /** The rest feed the checks the Code page imports from this folder. Readability leaves out the template agreements, not their indexes. */
  readability_excluded_pattern: string;
  entry: { agent: string; person: string };
  unreached_minutes: number;
  sentence_limit: number;
  min_comment_words: number;
  lag_window_days: number;
}

export const INPUTS_FILE = fileURLToPath(new URL('../inputs.json', import.meta.url));
export const INPUTS: Inputs = JSON.parse(readFileSync(INPUTS_FILE, 'utf8')) as Inputs;
