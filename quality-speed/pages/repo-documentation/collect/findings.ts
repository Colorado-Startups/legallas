// SPDX-License-Identifier: Apache-2.0
// Every doc error the page counts, in one place: broken internal links, dead
// names and failed questions. Doc lag (lag.ts) times these same findings.

import { join } from 'node:path';
import { type Corpus } from './corpus.ts';
import { type Finding, brokenLinks } from './links.ts';
import { type DeadName, deadNames, loadContext } from './names.ts';
import { type QuestionResult, checkQuestions, loadQuestions } from './questions.ts';

export interface Findings { links: Finding[]; names: DeadName[]; questions: QuestionResult[] }

export function findings(c: Corpus, configDir: string): Findings {
  const ctx = loadContext(c, join(configDir, 'not-in-tree.json'));
  return {
    links: brokenLinks(c),
    names: deadNames(c, ctx),
    questions: checkQuestions(c, loadQuestions(join(configDir, 'questions.json'))),
  };
}

/**
 * Stable keys, without line numbers, so an edit above a finding does not reopen it. A question counts when the doc
 * and the code disagree (stated but untrue, true but unstated) or a doc contradicts it; when neither the doc nor the
 * code has it yet, the feature isn't built, which is not a doc lagging behind.
 */
export function keysOf(f: Findings): Set<string> {
  const keys = new Set<string>();
  for (const l of f.links) keys.add(`link ${l.path} ${l.target}`);
  for (const n of f.names) keys.add(`name ${n.path} ${n.name}`);
  for (const q of f.questions) if (q.conflicts.length > 0 || q.stated !== q.true) keys.add(`question ${q.id}`);
  return keys;
}

export function findingKeys(c: Corpus, configDir: string): Set<string> {
  return keysOf(findings(c, configDir));
}
