// SPDX-License-Identifier: Apache-2.0
// A research turn over the Agents SDK WebSocket (plan D11; worker/agent/SPIKE.md section 6), the default transport.
// Imported by research-transport.ts only when GET /api/research names the WebSocket, because it carries the agents
// client (about 27 KB gzip): never part of a page's eager script.
//
// AgentClient connects on our own path (`threadPath('socket', id)`), never /agents/*, and WebSocketChatTransport turns
// it into the AI SDK chat transport. One socket at a time, for the open thread. The request frame carries the thread's
// messages as the room holds them plus the new question, as the SDK's own client sends; the room reads only the last
// user message (protocol.ts questionOf), so nothing the page sends can add to the record.
//
// When the socket closes mid-turn, the transport ends the stream with its own error chunk ("WebSocket closed
// mid-stream"). That chunk is never read as the room's error: the turn ends with the room's close code when it gave
// one (4401, 4403, 4503: protocol.ts RESEARCH_CLOSE), and as a dropped connection otherwise.
import { WebSocketChatTransport } from 'agents/chat/transport';
import { AgentClient } from 'agents/client';
import type { UIMessage, UIMessageChunk } from 'ai';
import { threadPath } from '../../worker/agent/protocol.ts';
import { ResearchError } from './research-client.ts';
import type { TurnSender } from './research-transport.ts';
import { closeCode } from './research-wire.ts';
import { showSessionEnded } from './session-ended.ts';

/** The error text WebSocketChatTransport (agents 0.28.1) ends a stream with when its socket closes. */
export const SOCKET_CLOSED_MID_STREAM = 'WebSocket closed mid-stream';

/** The parts of AgentClient and WebSocketChatTransport a turn uses, so tests can pass stand-ins. */
export interface SocketParts {
  agent: { close(): void; addEventListener(type: 'close', listener: (event: { code: number }) => void): void };
  chat: { sendMessages(options: Parameters<WebSocketChatTransport['sendMessages']>[0]): Promise<ReadableStream<UIMessageChunk>> };
}

interface Socket extends SocketParts {
  id: string;
  /** The error code of a final close from the room, once it closed that way. */
  closed: string | null;
}

/** The real client for one thread: AgentClient on the thread's socket path, wrapped as the chat transport. */
export function agentParts(id: string): SocketParts {
  const agent = new AgentClient({ agent: 'LegallasResearch', host: window.location.host, basePath: threadPath('socket', id).slice(1) });
  return { agent: agent as unknown as SocketParts['agent'], chat: new WebSocketChatTransport({ agent }) };
}

function open(id: string, parts: (id: string) => SocketParts): Socket {
  const socket: Socket = { id, ...parts(id), closed: null };
  // Added before the transport's own listener, so the code is known by the time its closing chunk is read.
  socket.agent.addEventListener('close', (event) => {
    const code = closeCode(event.code);
    if (!code) return;
    socket.closed = code;
    if (code === 'session_ended') showSessionEnded();
  });
  return socket;
}

/** The member's new question as the one message the room reads. */
function question(text: string): UIMessage {
  return { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text }] };
}

/** True for the chunk the transport ends a stream with when its socket closes, rather than one from the room. */
function transportClosed(chunk: unknown, socket: Socket): boolean {
  const c = chunk as { type?: unknown; errorText?: unknown } | null;
  return c?.type === 'error' && (socket.closed !== null || c.errorText === SOCKET_CLOSED_MID_STREAM);
}

/** Reads one turn's stream into `read`; a close mid-turn throws its code, or connection_lost. */
async function readTurn(stream: ReadableStream<UIMessageChunk>, socket: Socket, read: (chunk: unknown) => void): Promise<void> {
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (transportClosed(value, socket)) throw new ResearchError(socket.closed ?? 'connection_lost');
    read(value);
  }
  if (socket.closed) throw new ResearchError(socket.closed);
}

/**
 * Turns over the WebSocket; `history` reads a thread's messages from the room before each turn. `parts` builds the
 * client for a thread (the real one by default; tests pass a stand-in).
 */
export function socketTurns(history: (id: string) => Promise<unknown[]>, parts: (id: string) => SocketParts = agentParts): { turn: TurnSender; close(): void } {
  let current: Socket | null = null;
  const connect = (id: string): Socket => {
    if (current && current.id === id && !current.closed) return current;
    current?.agent.close();
    return (current = open(id, parts));
  };
  const turn: TurnSender = async (id, text, read) => {
    const messages = [...((await history(id)) as UIMessage[]), question(text)];
    const socket = connect(id);
    try {
      const stream = await socket.chat.sendMessages({ chatId: id, messages, abortSignal: undefined, trigger: 'submit-message' });
      await readTurn(stream, socket, read);
    } catch (err) {
      throw err instanceof ResearchError ? err : new ResearchError(socket.closed ?? 'connection_lost');
    }
  };
  return {
    turn,
    close() {
      current?.agent.close();
      current = null;
    },
  };
}
