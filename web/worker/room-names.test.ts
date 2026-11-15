// SPDX-License-Identifier: Apache-2.0
// The three configurable names (room-names.ts): today's values are the defaults, and anything unset, blank or
// malformed falls back to them, so a room that sets nothing shows exactly what it did before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSISTANT_NAME_REFUSED, assistantNameProblem, DEFAULT_ASSISTANT_NAME, DEFAULT_INSTANCE_NAME, DEFAULT_TOOL_PREFIX, roomNames, roomNamesOf, TOOL_PREFIX_PATTERN } from './room-names.ts';

const TODAY = { instanceName: 'Legallas', assistantName: 'Legallas', toolPrefix: 'legallas_' };

test("the defaults are today's literals", () => {
  assert.equal(DEFAULT_INSTANCE_NAME, 'Legallas');
  assert.equal(DEFAULT_ASSISTANT_NAME, 'Legallas');
  assert.equal(DEFAULT_TOOL_PREFIX, 'legallas_');
  assert.deepEqual(roomNames(), TODAY);
  assert.deepEqual(roomNamesOf({}), TODAY);
});

test('a room renames all three from config keys or Worker vars', () => {
  const renamed = { instanceName: 'Acme Data Room', assistantName: 'Juniper', toolPrefix: 'acme_' };
  assert.deepEqual(roomNames(renamed), renamed);
  assert.deepEqual(roomNamesOf({ INSTANCE_NAME: 'Acme Data Room', ASSISTANT_NAME: 'Juniper', MCP_TOOL_PREFIX: 'acme_' }), renamed);
  assert.deepEqual(roomNames({ instanceName: '  Acme  ', toolPrefix: ' acme_ ' }), { ...TODAY, instanceName: 'Acme', toolPrefix: 'acme_' }, 'trimmed');
});

test('an unset, blank or malformed name falls back to the default', () => {
  for (const bad of [undefined, null, 42, '', '   ', '<b>Acme</b>', 'A & B', 'Acme "Room"', "Acme's", 'Acme\nBcc: x@evil.example', 'x'.repeat(41)]) {
    assert.deepEqual(roomNames({ instanceName: bad, assistantName: bad }), TODAY, String(bad));
  }
});

test('the tool prefix keeps every tool name within Microsoft and Claude limits, or falls back', () => {
  for (const good of ['acme_', 'a_', 'legallas_', 'x1234567890abcde_']) assert.ok(TOOL_PREFIX_PATTERN.test(good), good);
  for (const bad of ['', 'acme', 'Acme_', '1acme_', 'ac-me_', 'acme__', '_', 'x1234567890abcdef_', 'acme_ x']) {
    assert.ok(!TOOL_PREFIX_PATTERN.test(bad), bad);
    assert.equal(roomNames({ toolPrefix: bad }).toolPrefix, 'legallas_', bad);
  }
  // The longest tool name (legallas_list_documents and friends, 14 characters after the prefix) stays under 64.
  assert.ok('x1234567890abcde_'.length + 'list_documents'.length <= 64);
});

test('the refusal message is word for word the notices file (A1, "Assistant names")', () => {
  const notices = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'legal', 'product-notices.md'), 'utf8');
  assert.ok(notices.includes(`Message: "${ASSISTANT_NAME_REFUSED}"`));
});

test('an assistant name that could pass for a lawyer is refused, in any case, as a whole word (A1)', () => {
  const refused = [
    'Lawyer', 'AI Lawyer', 'lawyers', 'ATTORNEY', 'Attorney-at-Law', 'Counsel', 'General Counsel', 'Counselor Ada',
    'Counsellor', 'Esquire', 'Ada Lane, Esq.', 'Ada Lane Esq', 'Advocate', 'Your Advocate', 'Advocates', 'Lane Law Firm',
    'law firm', 'Legal Adviser', 'legal advisor', 'Legal Advisers', 'LawyerBot', 'AILawyer', 'Lawyer2', 'the_counsel',
  ];
  for (const name of refused) {
    assert.equal(assistantNameProblem(name), ASSISTANT_NAME_REFUSED, name);
    assert.equal(roomNames({ assistantName: name }).assistantName, DEFAULT_ASSISTANT_NAME, `${name} falls back to the default`);
    assert.equal(roomNamesOf({ ASSISTANT_NAME: name }).assistantName, DEFAULT_ASSISTANT_NAME, `${name} as a Worker var`);
  }
});

test('words that only contain a refused word, and the defaults, pass (A1)', () => {
  for (const name of ['Legallas', 'Juniper', 'Counselling Notes', 'Advocacy Desk', 'Lawson', 'Firmware', 'Legal Helper', 'Esquiline', 'Law Library', 'Adviser']) {
    assert.equal(assistantNameProblem(name), null, name);
    assert.equal(roomNames({ assistantName: name }).assistantName, name);
  }
  assert.equal(assistantNameProblem(DEFAULT_ASSISTANT_NAME), null);
  // The instance name is the room's own name, not a speaker: A1's list is for the assistant only.
  assert.equal(roomNames({ instanceName: 'Lane Law Firm Room' }).instanceName, 'Lane Law Firm Room');
});
