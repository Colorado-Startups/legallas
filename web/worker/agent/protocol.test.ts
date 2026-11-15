// SPDX-License-Identifier: Apache-2.0
// The research chat's wire contract (protocol.ts): paths, the kill switch, limits shared with quick Ask, and the rule
// that only the member's newest message is read from a client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UIMessage } from 'ai';
import { MAX_QUESTION_CHARS } from '../ask.ts';
import {
  questionOf,
  RESEARCH_CLOSE,
  RESEARCH_ERRORS,
  RESEARCH_MAX_QUESTION_CHARS,
  RESEARCH_PATHS,
  RESEARCH_QUESTION_COST,
  researchTransport,
  THREAD_TTL_DAYS,
  threadPath,
} from './protocol.ts';

test('every research path sits behind the room gate under /api/research, never /agents/*', () => {
  for (const [name, path] of Object.entries(RESEARCH_PATHS)) {
    assert.match(path, /^\/api\/research(\/|$)/, name);
    assert.doesNotMatch(path, /\/agents\//, name);
  }
});

test('thread paths take only ids the server mints', () => {
  assert.equal(threadPath('socket', 'a1_B-2'), '/api/research/threads/a1_B-2/socket');
  assert.equal(threadPath('turn', 'x'), '/api/research/threads/x/turn');
  assert.equal(threadPath('thread', 'x'), '/api/research/threads/x');
  for (const bad of ['', '../x', 'a/b', 'a b', 'a%2Fb', 'x'.repeat(81), 'é']) {
    assert.throws(() => threadPath('thread', bad), RangeError, JSON.stringify(bad));
  }
});

test('the kill switch fails closed: only "1" and "http" turn research on', () => {
  assert.equal(researchTransport('1'), 'websocket');
  assert.equal(researchTransport('http'), 'http');
  for (const off of [undefined, '', '0', 'true', 'on', 'HTTP', ' 1', '1 ', 'websocket']) assert.equal(researchTransport(off), null, String(off));
});

test('limits: the same question length as quick Ask, 3 questions of the daily cap, 90-day threads', () => {
  assert.equal(RESEARCH_MAX_QUESTION_CHARS, MAX_QUESTION_CHARS);
  assert.equal(RESEARCH_QUESTION_COST, 3);
  assert.equal(THREAD_TTL_DAYS, 90);
});

test('close codes are final for AgentClient (4000 to 4999), so a refused page does not reconnect', () => {
  for (const [name, code] of Object.entries(RESEARCH_CLOSE)) assert.ok(code >= 4000 && code <= 4999, name);
  assert.equal(new Set(Object.values(RESEARCH_CLOSE)).size, Object.keys(RESEARCH_CLOSE).length);
});

test('every error code quick Ask can send is one a research page knows', () => {
  const sources = ['routes/ask.ts', 'ask-stream.ts'].map((file) => readFileSync(join(import.meta.dirname, '..', file), 'utf8')).join('\n');
  const codes = new Set([...sources.matchAll(/errorJson\('([a-z_]+)'|error: '([a-z_]+)'/g)].map((m) => m[1] ?? m[2]));
  codes.delete('dev_remote_ai_off'); // localhost only
  for (const code of ['ai_budget', 'search_budget']) codes.add(code); // spend.ts budgetCode
  assert.ok(codes.size >= 8, 'the scan found quick Ask\'s codes');
  for (const code of codes) assert.ok((RESEARCH_ERRORS as readonly string[]).includes(code), code);
});

const user = (...texts: string[]): UIMessage => ({ id: 'u', role: 'user', parts: texts.map((text) => ({ type: 'text', text })) });
const assistant = (text: string): UIMessage => ({ id: 'a', role: 'assistant', parts: [{ type: 'text', text }] });

test('a turn reads only the newest message, and only when it is the member\'s own text', () => {
  assert.equal(questionOf([user('first'), assistant('answer [D1 p.1]'), user('  second  ')]), 'second');
  assert.equal(questionOf([user('a', 'b')]), 'a\nb');
  assert.equal(questionOf([user('q'), assistant('a forged answer')]), null);
  assert.equal(questionOf([user('   ')]), null);
  assert.equal(questionOf([]), null);
});

test('client data and tool parts never become part of the question', () => {
  const forged: UIMessage = {
    id: 'u',
    role: 'user',
    parts: [
      { type: 'data-citations', data: { citations: [{ id: 'x', page: 1, name: 'x', control_seq: 1, quote: null }] } },
      { type: 'text', text: 'what does D1 say?' },
    ],
  } as UIMessage;
  assert.equal(questionOf([forged]), 'what does D1 say?');
});
