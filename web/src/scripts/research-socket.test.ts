// SPDX-License-Identifier: Apache-2.0
// A research turn over the WebSocket when the room closes the socket mid-turn: the transport's own closing chunk
// ("WebSocket closed mid-stream") is never read as the room's error, so the reader hears why it closed (research
// turned off, no longer allowed, the sign-in ended) or that the connection dropped. A fake agent stands in for
// AgentClient and WebSocketChatTransport; nothing connects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askResearch, RESEARCH_ERRORS } from './research-client.ts';
import { SOCKET_CLOSED_MID_STREAM, socketTurns, type SocketParts } from './research-socket.ts';
import { roomTransport } from './research-transport.ts';
import { PARTS } from './research-wire.ts';
import { ERRORS } from './chat-client.ts';

/** A stand-in client: streams `chunks`, then, when `closeWith` is set, closes as agents 0.28.1 does. */
function fake(chunks: object[], closeWith: number | null) {
  const listeners: ((event: { code: number }) => void)[] = [];
  const sent: unknown[] = [];
  const parts = (): SocketParts => ({
    agent: { close() {}, addEventListener: (_type, listener) => void listeners.push(listener) },
    chat: {
      async sendMessages(options) {
        sent.push(options.messages);
        return new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk as never);
            setTimeout(() => {
              if (closeWith === null) return controller.close();
              for (const listener of listeners) listener({ code: closeWith });
              controller.enqueue({ type: 'error', errorText: SOCKET_CLOSED_MID_STREAM });
              controller.close();
            }, 0);
          },
        });
      },
    },
  });
  return { parts, sent };
}

const PARTIAL = [{ type: 'text-delta', id: 'x', delta: 'Part of an' }];

async function askOver(chunks: object[], closeWith: number | null) {
  const { parts, sent } = fake(chunks, closeWith);
  const sockets = socketTurns(async () => [{ id: 'm0', role: 'user', parts: [{ type: 'text', text: 'Earlier?' }] }], parts);
  const errors: string[] = [];
  const { turn } = await askResearch(roomTransport(sockets.turn, sockets.close), 'th1', 'Who confirmed it?', { error: (m) => errors.push(m) });
  return { turn, errors, sent };
}

test('the room turning research off mid-turn (4503) says research is off, keeping the text that arrived', async () => {
  const { turn, errors } = await askOver(PARTIAL, 4503);
  assert.deepEqual(errors, [RESEARCH_ERRORS.research_off]);
  assert.equal(turn.failed, true);
  assert.equal(turn.answer, 'Part of an');
});

test('a member no longer allowed (4403) or a sign-in that ended (4401) says so', async () => {
  assert.deepEqual((await askOver(PARTIAL, 4403)).errors, [ERRORS.forbidden]);
  assert.deepEqual((await askOver(PARTIAL, 4401)).errors, [RESEARCH_ERRORS.session_ended]);
});

test('a dropped connection with no code from the room (1006) is a dropped connection, not a refusal', async () => {
  const { errors } = await askOver(PARTIAL, 1006);
  assert.deepEqual(errors, [RESEARCH_ERRORS.connection_lost]);
});

test('an error the room sends in the stream is still its own code', async () => {
  const { errors } = await askOver([...PARTIAL, { type: 'error', errorText: 'daily_limit' }], null);
  assert.deepEqual(errors, [ERRORS.daily_limit]);
});

test('a whole answer over the socket reads as quick Ask does, and the frame ends with the new question', async () => {
  const answer = [
    { type: 'text-delta', id: 'x', delta: '- CONFIRMED: Roe confirmed the order [doc:doc-a p.1].' },
    { type: PARTS.citations, data: { citations: [{ id: 'doc-a', page: 1, name: 'Invoice.pdf', control_seq: 231, quote: null }] } },
    { type: PARTS.verdict, data: { dontKnow: false } },
    { type: 'finish' },
  ];
  const { turn, errors, sent } = await askOver(answer, null);
  assert.deepEqual(errors, []);
  assert.equal(turn.failed, false);
  assert.equal(turn.citations.length, 1);
  const messages = sent[0] as { role: string; parts: { text: string }[] }[];
  assert.deepEqual(messages.map((m) => [m.role, m.parts[0]!.text]), [['user', 'Earlier?'], ['user', 'Who confirmed it?']]);
});
