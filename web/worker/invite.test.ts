// SPDX-License-Identifier: Apache-2.0
// The invitation (invite.ts): the scripts' copy of which guest roles may connect matches rooms.ts, and the message a
// role that may not connect gets carries no connect link. The link itself, and the panel it opens:
// mcp/pages/connect-panel.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUEST_CONNECTS, connectLink, inviteMessage } from './invite.ts';
import { canGuest } from './rooms.ts';

test('the scripts\' GUEST_CONNECTS says what rooms.ts says', () => {
  assert.equal(GUEST_CONNECTS.investor, canGuest('deal', 'investor', 'connect'));
  assert.equal(GUEST_CONNECTS.counsel, canGuest('matter', 'counsel', 'connect'));
});

test('a role that may not connect gets the room link alone; the notice follows either message', () => {
  const browse = inviteMessage('counsel', 'jane@example.com', { connect: false });
  assert.equal(browse, "You're invited to the Legallas room: https://room.example.com/\nSign in with jane@example.com.");
  assert.ok(!browse.includes(connectLink('counsel')));
  const investor = inviteMessage('investor', 'sam@example.com', { notice: 'Confidential.' });
  assert.deepEqual(investor.split('\n'), [
    "You're invited to the Legallas room.",
    '',
    `Connect your AI first (Claude, Microsoft 365 Copilot or OpenCode): ${connectLink('investor')}`,
    'Sign in with sam@example.com when it asks. To browse instead: https://room.example.com/',
    '',
    'Confidential.',
  ]);
  assert.equal(connectLink('investor'), 'https://mcp.room.example.com/connect?for=investor');
  assert.ok(inviteMessage('counsel', 'jane@example.com').includes('(Claude, Microsoft 365 Copilot, Harvey or OpenCode)'), 'counsel keep Harvey');
});
