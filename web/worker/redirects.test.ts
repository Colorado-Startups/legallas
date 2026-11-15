// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CONNECT_PATH, MCP_HOST, MCP_ORIGIN, ROOM_ORIGIN } from '../mcp/contract.ts';
import { CONNECT_URL, REDIRECTS, redirectFor } from './redirects.ts';
import { mcpHost } from './room-settings.ts';

const at = (path: string) => redirectFor(new URL(`https://room.example${path}`));

test('Case files and Inbox move to Documents, with and without the trailing slash', () => {
  assert.equal(at('/case-files'), '/documents/');
  assert.equal(at('/case-files/'), '/documents/');
  assert.equal(at('/inbox'), '/documents/#from-counsel');
  assert.equal(at('/inbox/'), '/documents/#from-counsel');
  assert.deepEqual(Object.keys(REDIRECTS).sort(), ['/case-files', '/case-files/', '/connect', '/connect/', '/inbox', '/inbox/']);
});

test('an old folder link keeps its folder hash and query', () => {
  assert.equal(at('/case-files/?q=lease#05-Inspection'), '/documents/?q=lease#05-Inspection');
  assert.equal(at('/inbox/?x=1'), '/documents/?x=1#from-counsel');
  assert.equal(at('/inbox/#05-Inspection'), '/documents/#05-Inspection');
});

test('only exact paths move', () => {
  assert.equal(at('/case-files/x'), null);
  assert.equal(at('/documents/'), null);
  assert.equal(at('/inboxes/'), null);
  assert.equal(at('/'), null);
});

test('a moved path keeps its query and hash with any table', () => {
  const table = { '/case-files/': '/documents/' };
  assert.equal(redirectFor(new URL('https://room.example/case-files/?q=lease#05'), table), '/documents/?q=lease#05');
  assert.equal(redirectFor(new URL('https://room.example/case-files/x'), table), null);
});

test('/connect on the room host goes to Connect AI on legallas-mcp, keeping a section hash', () => {
  assert.equal(at('/connect'), CONNECT_URL);
  assert.equal(at('/connect/'), CONNECT_URL);
  assert.equal(at('/connect#claude'), `${CONNECT_URL}#claude`);
  assert.equal(at('/connect/?from=room'), `${CONNECT_URL}?from=room`);
});

test('CONNECT_URL is legallas-mcp\'s own setup page, the same one the header links to', () => {
  assert.equal(CONNECT_URL, `${MCP_ORIGIN}${CONNECT_PATH}`);
  const room = readFileSync(join(import.meta.dirname, '..', 'src', 'layouts', 'Room.astro'), 'utf8');
  assert.equal(CONNECT_URL, `https://${mcpHost}/connect`);
  assert.match(room, /<a [^>]*href=\{`https:\/\/\$\{mcpHost\}\/connect`\}[^>]*>Connect AI<\/a>/);
});

test('no target leaves the site: a room path, or the fixed https legallas-mcp URL', () => {
  const site = new URL(ROOM_ORIGIN).hostname.split('.').slice(-2).join('.');
  for (const [from, target] of Object.entries(REDIRECTS)) {
    if (target.startsWith('/')) {
      assert.ok(!target.startsWith('//'), `${from} must stay a room path`);
      continue;
    }
    const url = new URL(target);
    assert.equal(url.protocol, 'https:', from);
    assert.equal(url.hostname, MCP_HOST, from);
    assert.ok(url.hostname.endsWith(`.${site}`), `${from} stays on ${site}`);
    assert.equal(url.username + url.password + url.port, '', from);
  }
});

test('nothing in the request picks the /connect target (no open redirect)', () => {
  for (const path of ['//evil.example/connect', '/connect/evil.example', '/connect%2F', '/Connect', '/connect/..', '/x/connect']) {
    assert.equal(at(path), null, path);
  }
  // The host, query and hash of the request never change where the redirect goes.
  for (const url of ['https://evil.example/connect', 'https://room.example/connect?next=https://evil.example', 'https://room.example/connect#@evil.example']) {
    const moved = redirectFor(new URL(url));
    assert.ok(moved?.startsWith(`${CONNECT_URL}`), url);
    assert.equal(new URL(moved!).host, MCP_HOST, url); // safe: the assertion above proved moved is set
  }
});
