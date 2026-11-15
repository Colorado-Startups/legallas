// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ANY_DEADLINE,
  CASE_ROOM_NOTICE,
  CHECKED_AGAINST,
  COMPACT_LABEL,
  DISPUTE_LINES,
  ELECTION_83B,
  FORM_D,
  INVESTOR_LINE,
  NOT_CHECKED,
  PERSON_DECISION_LINE,
  RECOMMENDATION_NOTE,
  RECOMMENDATION_STAMP,
  SHORT_LINE,
  TAX_LINE,
} from './product-notices.ts';

test('the lines are word for word the notices file (A2)', () => {
  const notices = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'legal', 'product-notices.md'), 'utf8');
  assert.ok(notices.includes(`> ${SHORT_LINE}\n`));
  assert.ok(notices.includes(`> ${COMPACT_LABEL}\n`));
});

test('both room shapes show the lines wherever the agent speaks (A2)', () => {
  const read = (path: string) => readFileSync(join(import.meta.dirname, '..', 'src', path), 'utf8');
  const footers = read('layouts/Room.astro').match(/<footer[\s\S]*?<\/footer>/g) ?? [];
  assert.equal(footers.length, 2);
  for (const footer of footers) assert.ok(footer.includes('<p>{SHORT_LINE}</p>'));
  const ask = read('pages/ask.astro');
  assert.match(ask, /<p class="[^"]*">\{SHORT_LINE\}<\/p>/);
  assert.match(ask, /<p class="[^"]*">\{COMPACT_LABEL\}<\/p>/);
  assert.match(read('scripts/chat-drawer.ts'), /^ {2}titles\.append\(el\('p', '[^']*', COMPACT_LABEL\)\);$/m);
});

test('the recommendation lines are word for word the notices file (A4, A8)', () => {
  const notices = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'legal', 'product-notices.md'), 'utf8');
  for (const line of [RECOMMENDATION_STAMP, RECOMMENDATION_NOTE, INVESTOR_LINE, TAX_LINE, PERSON_DECISION_LINE, ...DISPUTE_LINES]) assert.ok(notices.includes(`> ${line}\n`), line);
});

test('the source and deadline lines are word for word the notices file (A1, A4, A6)', () => {
  const notices = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'legal', 'product-notices.md'), 'utf8');
  assert.ok(notices.includes(`| ${CHECKED_AGAINST} | Verified;`), 'A1: checked against, never verified');
  assert.ok(notices.includes(`marked "checked" or "${NOT_CHECKED}"`), 'A4');
  assert.ok(notices.includes(`> **${ELECTION_83B.title}** ${ELECTION_83B.body}\n`), '83(b)');
  assert.ok(notices.includes(`> **${FORM_D.title}** ${FORM_D.body} `), 'Form D');
  assert.ok(notices.includes(`> **${ANY_DEADLINE.title}** ${ANY_DEADLINE.body}\n`), 'any other deadline');
});

test('"Not private like talking to your lawyer" opens every case room page, word for word, and a company room drops it (A7)', () => {
  const notices = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'legal', 'product-notices.md'), 'utf8');
  const { title, body, cautions } = CASE_ROOM_NOTICE;
  assert.ok(notices.includes(`**On first use, and at the top of any case room:**\n\n> **${title}** ${body}\n`));
  for (const line of cautions) assert.ok(notices.includes(`> - ${typeof line === 'string' ? line : `${line[0]}**${line[1]}**${line[2]}`}\n`));
  const layout = readFileSync(join(import.meta.dirname, '..', 'src', 'layouts', 'Room.astro'), 'utf8');
  const main = layout.slice(layout.indexOf('<main'), layout.indexOf('<slot />'));
  // The notice is the first thing in <main>, before any page, and only case rooms keep it (room-shape.ts removes it).
  assert.match(main, /^<main[^>]*>\s*\{\/\*[^*]*\*\/\}\s*<aside [^>]*data-case-only>/);
  assert.ok(main.includes('{CASE_ROOM_NOTICE.title}') && main.includes('{CASE_ROOM_NOTICE.body}') && main.includes('CASE_ROOM_NOTICE.cautions.map'));
  assert.equal((layout.match(/<slot \/>/g) ?? []).length, 1);
});
