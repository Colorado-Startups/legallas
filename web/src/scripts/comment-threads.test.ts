// SPDX-License-Identifier: Apache-2.0
// Comment threads for the discussion panel (card P6; R44).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupThreads, initials, type ThreadComment } from './comment-threads.ts';

function comment(id: string, parent_id?: string | null): ThreadComment {
  return {
    id, parent_id, author_email: 'a@example.test', author_name: null, body: id, created_at: '2026-10-01T00:00:00Z',
    resolved_at: null, resolved_by: null, resolved_by_name: null,
  };
}

const shape = (groups: ReturnType<typeof groupThreads>) => groups.map((g) => [g.head.id, g.replies.map((r) => r.id)]);

test('replies sit under their top-level comment, both in order', () => {
  const groups = groupThreads([comment('a', null), comment('b', null), comment('a1', 'a'), comment('b1', 'b'), comment('a2', 'a')]);
  assert.deepEqual(shape(groups), [['a', ['a1', 'a2']], ['b', ['b1']]]);
});

test('a server without threads gives flat threads', () => {
  assert.deepEqual(shape(groupThreads([comment('a'), comment('b')])), [['a', []], ['b', []]]);
});

test('a reply whose parent is missing stands alone rather than vanishing', () => {
  assert.deepEqual(shape(groupThreads([comment('x1', 'gone'), comment('a', null)])), [['x1', []], ['a', []]]);
  assert.deepEqual(shape(groupThreads([comment('self', 'self')])), [['self', []]]);
});

test('initials come from the name, or the address when there is none', () => {
  assert.equal(initials('Morgan Chen'), 'MC');
  assert.equal(initials('Ana Maria Ruiz'), 'AR');
  assert.equal(initials('counsel@example.test'), 'CO');
  assert.equal(initials('jane.doe@example.test'), 'JD');
  assert.equal(initials(''), '?');
});
