// SPDX-License-Identifier: Apache-2.0
// The owner-only WebSocket echo probe (D11, Wave 1). Access cannot be tested locally, so this proves in production that
// a WebSocket reaches the room through Cloudflare Access: to the Worker itself, and with `?via=do` on through the
// RESEARCH binding to the research Durable Object (worker/agent/research.ts). It carries no case data: the server says
// hello, answers each short text message with a numbered pong whatever it says, and closes after PROBE_MAX_PONGS
// messages or PROBE_SECONDS. Nothing is logged or stored.
//
// Imports nothing from cloudflare:workers or agents, so worker/index.ts (which tests load under plain Node) can route it.
import type { RequestContext } from '../env.ts';
import { errorJson } from '../http.ts';
import type { Route } from '../router.ts';
import { researchInstanceName } from './instance.ts';
import { RESEARCH_PATHS, type ProbeFrame } from './protocol.ts';

/** The limit on pongs that the probe answers. */
export const PROBE_MAX_PONGS = 8;
/** Longer or binary messages close the probe: it only ever needs "ping". */
export const PROBE_MAX_MESSAGE = 64;
/** How many seconds the probe may stay open. */
export const PROBE_SECONDS = 60;

/** A WebSocket handshake: GET with `Upgrade: websocket`. */
export function isWebSocketUpgrade(request: Request): boolean {
  return request.method === 'GET' && (request.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket';
}

/**
 * A browser opens a WebSocket with its page's Origin and the room's cookies, even from another site (cross-site
 * WebSocket hijacking), and a handshake is a GET, so index.ts's write check never sees it. An upgrade is accepted only
 * from the room's own pages: the exact Origin, and `Sec-Fetch-Site: same-origin` whenever the browser sends one.
 */
export function isSameOriginUpgrade(request: Request): boolean {
  if (request.headers.get('Origin') !== new URL(request.url).origin) return false;
  const site = request.headers.get('Sec-Fetch-Site');
  return site === null || site === 'same-origin';
}

/** The hello frame the probe sends, naming which side answered. */
export function probeHello(via: 'worker' | 'do'): string {
  return JSON.stringify({ type: 'hello', via } satisfies ProbeFrame);
}

/** One step of the probe: the pong count and the frame to send back. */
export interface ProbeStep {
  pongs: number;
  /** The frame to send back, or null. */
  reply: string | null;
  /** Close with this code after the reply, or null to stay open. */
  close: number | null;
}

/**
 * The probe's answer to one message, given how many pongs it has sent. Pure, so both echo paths share it. Messages
 * still in flight after the last pong get nothing: sending on a closing socket throws in workerd and aborts it.
 */
export function probeReply(pongs: number, message: unknown): ProbeStep {
  if (pongs >= PROBE_MAX_PONGS) return { pongs, reply: null, close: null };
  if (typeof message !== 'string' || message.length > PROBE_MAX_MESSAGE) return { pongs: PROBE_MAX_PONGS, reply: null, close: 1003 };
  const n = pongs + 1;
  return { pongs: n, reply: JSON.stringify({ type: 'pong', n } satisfies ProbeFrame), close: n >= PROBE_MAX_PONGS ? 1000 : null };
}

/** Closes a socket that may already be closed. */
export function closeQuietly(socket: WebSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    // Already closed or closing: nothing to do.
  }
}

/**
 * The probe's time limit, the same on both paths: after PROBE_SECONDS the socket closes whatever the client does.
 * `stop` runs first, so a message still in flight gets no reply (sending on a closing socket aborts it). `schedule`
 * exists for tests.
 */
export function closeAfterProbeTime(
  socket: WebSocket,
  stop: () => void,
  schedule: (run: () => void, ms: number) => unknown = setTimeout,
): void {
  schedule(() => {
    try {
      stop();
    } catch {
      // The socket is already gone: closing below is still harmless.
    }
    closeQuietly(socket, 1000, 'probe timeout');
  }, PROBE_SECONDS * 1000);
}

/**
 * The echo, the same in the Worker and in the Durable Object: a plain accepted WebSocketPair, closed after the last pong
 * or PROBE_SECONDS. Not the hibernation API: the probe lives a minute at most, and a pending timer does not keep a
 * Durable Object with only hibernatable sockets awake (seen in workerd, worker/agent/SPIKE.md), so its limit would lapse.
 */
export function probeEcho(via: 'worker' | 'do'): Response {
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();
  let pongs = 0;
  server.addEventListener('message', (event) => {
    const step = probeReply(pongs, event.data);
    pongs = step.pongs;
    if (step.reply) server.send(step.reply);
    if (step.close !== null) closeQuietly(server, step.close, 'probe done');
  });
  // Closed by the client: answer nothing more.
  server.addEventListener('close', () => {
    pongs = PROBE_MAX_PONGS;
  });
  closeAfterProbeTime(server, () => {
    pongs = PROBE_MAX_PONGS;
  });
  server.send(probeHello(via));
  return new Response(null, { status: 101, webSocket: client });
}

async function probe({ request, env, url, member }: RequestContext): Promise<Response> {
  if (member.role !== 'owner') return errorJson('forbidden', 403);
  if (!isWebSocketUpgrade(request)) return errorJson('upgrade_required', 426);
  if (!isSameOriginUpgrade(request)) return errorJson('forbidden', 403);
  if (url.searchParams.get('via') !== 'do') return probeEcho('worker');
  const stub = env.RESEARCH.getByName(await researchInstanceName(member.email));
  // A fresh request: no cookie, Access token or other client header ever reaches the Durable Object.
  return stub.fetch(new Request(new URL(RESEARCH_PATHS.probe, url.origin), { headers: { Upgrade: 'websocket' } }));
}

/** The probe's routes. */
export const routes: Route[] = [{ method: 'GET', path: RESEARCH_PATHS.probe, handler: probe }];
