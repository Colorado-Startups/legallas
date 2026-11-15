// SPDX-License-Identifier: Apache-2.0
// Research mode on the page and in the drawer (plan D10 to D12): the switch shows only when the room says research
// is on, quick Ask stays the default, the research code loads only on use (the 60 KB eager budget), and the copy
// says honestly where each kind of history lives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RESEARCH_PROTOCOL, THREAD_TTL_DAYS } from '../../worker/agent/protocol.ts';
import { checkAvailability, modeKey, parseStatus, researchOn } from './research-mode.ts';
import { THREADS_NOTE } from './research-threads.ts';

const read = (rel: string) => readFileSync(join(import.meta.dirname, rel), 'utf8');

test('the switch shows only when GET /api/research says research is on, in this protocol, over a known transport', () => {
  const on = { protocol: RESEARCH_PROTOCOL, enabled: true, transport: 'websocket', questionCost: 3, maxQuestionChars: 2000 };
  assert.deepEqual(researchOn(on), on);
  assert.equal(researchOn({ ...on, transport: 'http' })?.transport, 'http');
  assert.deepEqual(researchOn({ protocol: RESEARCH_PROTOCOL, enabled: true, transport: 'http' }), { ...on, transport: 'http' }, 'missing numbers take the protocol defaults');
  for (const off of [
    null, undefined, 'yes', {}, { ...on, enabled: false }, { ...on, enabled: 'true' }, { ...on, transport: null },
    { ...on, transport: 'sse' }, { ...on, protocol: RESEARCH_PROTOCOL + 1 }, { ...on, protocol: undefined },
  ]) {
    assert.equal(researchOn(off), null, JSON.stringify(off));
  }
});

test('the switch is a two-way radio group: arrows flip, Home and End go to the ends', () => {
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    assert.equal(modeKey(key, 'quick'), 'research', key);
    assert.equal(modeKey(key, 'research'), 'quick', key);
  }
  assert.equal(modeKey('Home', 'research'), 'quick');
  assert.equal(modeKey('End', 'quick'), 'research');
  assert.equal(modeKey('Enter', 'quick'), null);
  assert.equal(modeKey('r', 'quick'), null);
});

test('Quick is checked when the page loads; Research waits hidden for the room', () => {
  const page = read('../pages/ask.astro');
  assert.match(page, /<div class="ask-mode" role="radiogroup" aria-label="Answer mode" data-ask-modes hidden>/);
  assert.match(page, /aria-checked="true" data-ask-mode="quick"/);
  assert.match(page, /aria-checked="false" tabindex="-1" data-ask-mode="research"/);
  assert.match(page, /<div data-research hidden><\/div>/);
});

test('the research panel and its client load only on use, never with the page or the drawer', () => {
  for (const file of ['chat.ts', 'chat-drawer.ts', 'ask-drawer.ts', 'chat-signout.ts', 'research-mode.ts']) {
    const source = read(file);
    const statics = [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
    const bare = [...source.matchAll(/^import\s+'([^']+)'/gm)].map((m) => m[1]);
    for (const spec of [...statics, ...bare]) {
      assert.doesNotMatch(spec!, /research-(panel|threads|transport|socket|client|wire|mock)|^agents|^ai$/, `${file} imports ${spec} up front`);
    }
  }
  assert.match(read('chat.ts'), /import\('\.\/research-panel\.ts'\)/);
  assert.match(read('chat-drawer.ts'), /import\('\.\/research-panel\.ts'\)/);
});

test('the mock never ships: no room script imports it, statically or with import()', () => {
  for (const file of ['chat.ts', 'chat-drawer.ts', 'research-panel.ts', 'research-threads.ts', 'research-transport.ts', 'research-socket.ts', 'research-client.ts', 'research-wire.ts', 'research-mode.ts']) {
    const code = read(file).replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    assert.ok(!/research-mock/.test(code), `${file} reaches research-mock.ts`);
  }
});

test('the privacy note says where each history lives (plan D12)', () => {
  const page = read('../pages/ask.astro').replace(/\s+/g, ' ');
  assert.match(page, /Quick answers: the room records that you asked, never what\. The question and its answer are saved only in this browser profile until you use Sign out or Clear history/);
  assert.match(page, /<p data-research-privacy hidden> Research: each thread, with its questions, answers and step counts, is saved in this room on Cloudflare, where only you can open it\. Delete a thread at any time; the room deletes it 90 days after its last question\. Cloudflare's point-in-time recovery keeps deleted data for up to 30 days\. <\/p>/);
  assert.equal(THREAD_TTL_DAYS, 90, 'the page says 90 days: change the copy with the protocol');
  assert.doesNotMatch(page, /Questions and answers stay in this browser/, 'the old browser-only promise is gone');
  // Restated with the point-in-time recovery sentence: the panel says all of D12.
  assert.match(THREADS_NOTE, /^Saved in this room on Cloudflare, only for you\. Delete a thread at any time; the room deletes it 90 days after its last question\. Cloudflare's point-in-time recovery keeps deleted data for up to 30 days\. A research question counts as 3 toward today's question limit\.$/);
  assert.match(read('chat-store.ts').split('\n').slice(0, 6).join(' '), /Quick Ask history, kept ONLY in this browser.*Research threads are not kept here: they are saved in the room on Cloudflare/);
});

test('the D12 note sits after the thread list, so it shows when the list is closed (the drawer)', () => {
  const threads = read('research-threads.ts');
  assert.match(threads, /root\.append\(summary, fresh, message, list\);/, 'the disclosure holds the list only');
  assert.match(threads, /note: el\('p', 'ask-research__note t-caption', THREADS_NOTE\)/);
  assert.match(read('research-panel.ts'), /root\.append\(ctx\.list\.root, ctx\.list\.note, log\);/, 'the panel places the note after the disclosure');
});

test('the open thread is marked on its button, the control a reader reaches', () => {
  const threads = read('research-threads.ts');
  assert.match(threads, /if \(thread\.id === current\) open\.setAttribute\('aria-current', 'true'\);/);
  assert.doesNotMatch(threads, /li\.setAttribute\('aria-current'/);
});

test('an off status is still read: research is deployed but its kill switch is off', () => {
  const off = { protocol: RESEARCH_PROTOCOL, enabled: false, transport: null, questionCost: 3, maxQuestionChars: 2000 };
  assert.deepEqual(parseStatus(off), off);
  assert.equal(researchOn(off), null, 'off is never on');
  assert.equal(parseStatus({ ...off, enabled: true }), null, 'on with no transport is unreadable');
  assert.equal(parseStatus({ ...off, transport: 'carrier-pigeon' }), null);
  assert.equal(parseStatus({ ...off, protocol: RESEARCH_PROTOCOL + 1 }), null);
});

test('while research is off the switch shows only for a member with saved threads to read or delete (D12)', async () => {
  const on = { protocol: RESEARCH_PROTOCOL, enabled: true, transport: 'websocket', questionCost: 3, maxQuestionChars: 2000 } as const;
  const off = { ...on, enabled: false, transport: null };
  const real = globalThis.fetch;
  const asked: string[] = [];
  const answer = (status: number, body: unknown) => {
    globalThis.fetch = (async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
  };
  try {
    answer(200, [{ id: 't1', title: 'T', updatedAt: '2026-10-20T00:00:00.000Z' }]);
    assert.equal(await checkAvailability(on), 'on');
    assert.deepEqual(asked, [], 'on needs no thread list');
    assert.equal(await checkAvailability(off), 'saved');
    assert.deepEqual(asked, ['/api/research/threads']);
    answer(200, []);
    assert.equal(await checkAvailability(off), null, 'nothing saved: no switch');
    answer(403, { error: 'forbidden' });
    assert.equal(await checkAvailability(off), null, 'a member who may not ask sees no switch');
    assert.equal(await checkAvailability(null), null);
  } finally {
    globalThis.fetch = real;
  }
});
