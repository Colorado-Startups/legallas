// SPDX-License-Identifier: Apache-2.0
// Deadlines an Ask answer names, flagged before anyone acts on it (card 11.5), in the words of
// docs/legal/product-notices.md A6. Pure, so node tests it.
import { ANY_DEADLINE, ELECTION_83B, FORM_D } from '../../worker/product-notices.ts';

/** A deadline flagged in an answer: what it is for and how it is drawn. */
export interface DeadlineFlag {
  /** What the deadline is for; '' for any other deadline. */
  name: string;
  /** Drawn bold. */
  title: string;
  body: string;
}

/** Any deadline A6 has no words of its own for. */
export const DEADLINE_FLAG: DeadlineFlag = { name: '', ...ANY_DEADLINE };

const NAMED: readonly [RegExp, DeadlineFlag][] = [
  // Ask knows no transfer date, so the line names the rule, not a day.
  [/\b83\s*\(\s*b\s*\)/i, { name: '83(b) election', title: ELECTION_83B.title, body: ELECTION_83B.body.replace('[transfer date]: by [date]', 'the transfer date') }],
  [/\bForm\s+D\b/, { name: 'Form D', ...FORM_D }],
];
const DEADLINE = /\b(?:deadlines?|due (?:by|on|date|within)|no later than|not later than|within \d{1,3} (?:calendar |business )?days|statutes? of limitations?|limitations period)\b/i;

/** The 83(b) and Form D flags `text` calls for; else the general one when it names any other deadline. */
export function deadlineFlags(text: string): DeadlineFlag[] {
  const named = NAMED.filter(([pattern]) => pattern.test(text)).map(([, flag]) => flag);
  return named.length > 0 || !DEADLINE.test(text) ? named : [DEADLINE_FLAG];
}
