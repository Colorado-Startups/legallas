// SPDX-License-Identifier: Apache-2.0
// The owner-only WebSocket probe (probe.ts) through the real gate in index.ts, the 101 passthrough in headers.ts, and
// the research instance name. Node has no WebSocketPair and no 101 Response, so the Worker-level echo itself runs only
// in workerd (worker/agent/SPIKE.md) and in the Wave 1 production probe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Env } from '../env.ts';
import { withSecurityHeaders } from '../headers.ts';
import { handle } from '../index.ts';
import { researchInstanceName } from './instance.ts';
import {
  closeAfterProbeTime,
  isSameOriginUpgrade,
  isWebSocketUpgrade,
  PROBE_MAX_MESSAGE,
  PROBE_MAX_PONGS,
  PROBE_SECONDS,
  probeReply,
} from './probe.ts';
import { RESEARCH_PATHS } from './protocol.ts';

const HOST = 'http://localhost:8789';
const OWNER = 'founder@example.test';
const COUNSEL = 'counsel@example.test';

/** Stands in for the 101 a Durable Object returns; Node cannot build a Response with status 101. */
const UPGRADED = { status: 101, webSocket: {}, headers: new Headers() } as unknown as Response;

function fakeEnv(devEmail: string, forwarded: { name?: string; request?: Request }[] = []): Env {
  const members: Record<string, string> = { [OWNER]: 'owner', [COUNSEL]: 'counsel' };
  return {
    ASSETS: { fetch: async () => new Response('APP') },
    DB: { prepare: () => ({ bind: (email: string) => ({ first: async () => (members[email] ? { email, role: members[email], name: null } : null) }) }) },
    RESEARCH: {
      getByName: (name: string) => ({
        fetch: async (request: Request) => {
          forwarded.push({ name, request });
          return UPGRADED;
        },
      }),
    },
    TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    LEGALLAS_MODEL: 'x',
    DAILY_QUESTION_CAP: '100',
    ALLOW_DEV_IDENTITY: '1',
    DEV_IDENTITY_EMAIL: devEmail,
  } as unknown as Env;
}

const upgrade = (extra: Record<string, string> = {}): RequestInit => ({ headers: { Upgrade: 'websocket', Origin: HOST, 'Sec-Fetch-Site': 'same-origin', ...extra } });
const probe = (env: Env, init: RequestInit, query = '') => handle(new Request(`${HOST}${RESEARCH_PATHS.probe}${query}`, init), env, {} as ExecutionContext);

test('only a 101 carrying a WebSocket passes the security headers untouched; everything else still gets them', () => {
  assert.equal(withSecurityHeaders(UPGRADED, 'api'), UPGRADED);
  const carriesSocket = { status: 200, webSocket: {}, headers: new Headers() } as unknown as Response;
  const wrapped = withSecurityHeaders(carriesSocket, 'api');
  assert.notEqual(wrapped, carriesSocket);
  assert.equal(wrapped.headers.get('Content-Security-Policy'), "default-src 'none'; frame-ancestors 'none'");
  assert.equal(wrapped.headers.get('Cache-Control'), 'private, no-store');
  const plain = withSecurityHeaders(new Response('x'), 'api');
  assert.equal(plain.headers.get('Content-Security-Policy'), "default-src 'none'; frame-ancestors 'none'");
});

test('only the owner may open the probe; counsel get the usual 403 with security headers', async () => {
  const res = await probe(fakeEnv(COUNSEL), upgrade());
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'forbidden' });
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
});

test('the probe needs a WebSocket handshake', async () => {
  const res = await probe(fakeEnv(OWNER), { headers: { Origin: HOST } });
  assert.equal(res.status, 426);
  assert.deepEqual(await res.json(), { error: 'upgrade_required' });
});

test('a cross-origin or originless upgrade is refused (cross-site WebSocket hijacking)', async () => {
  const forwarded: { name?: string }[] = [];
  const env = fakeEnv(OWNER, forwarded);
  const refused: Record<string, string>[] = [
    { Origin: 'https://example.com' },
    { Origin: 'https://room.example.com.evil.test' },
    { Origin: 'http://localhost:9999' },
    { Origin: HOST, 'Sec-Fetch-Site': 'same-site' },
    { Origin: HOST, 'Sec-Fetch-Site': 'cross-site' },
  ];
  for (const headers of refused) {
    const res = await probe(env, upgrade(headers), '?via=do');
    assert.equal(res.status, 403, JSON.stringify(headers));
  }
  const originless = await probe(env, { headers: { Upgrade: 'websocket' } }, '?via=do');
  assert.equal(originless.status, 403);
  assert.equal(forwarded.length, 0, 'nothing reached the Durable Object');
});

test('via=do reaches the member\'s own instance with a fresh request: no cookie, token or client header', async () => {
  const forwarded: { name?: string; request?: Request }[] = [];
  const res = await probe(
    fakeEnv(OWNER, forwarded),
    upgrade({ Cookie: 'CF_Authorization=t', 'Cf-Access-Jwt-Assertion': 't', 'X-Member-Email': 'someone@else.test' }),
    '?via=do&name=other',
  );
  assert.equal(res, UPGRADED, 'the 101 comes back untouched');
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0]!.name, createHash('sha256').update(`research:${OWNER}`).digest('hex'));
  const sent = forwarded[0]!.request!;
  assert.equal(sent.url, `${HOST}${RESEARCH_PATHS.probe}`);
  assert.deepEqual([...sent.headers.keys()], ['upgrade']);
});

test('upgrade checks', () => {
  assert.equal(isWebSocketUpgrade(new Request(HOST, { headers: { Upgrade: 'WebSocket' } })), true);
  assert.equal(isWebSocketUpgrade(new Request(HOST, { method: 'POST', headers: { Upgrade: 'websocket' } })), false);
  assert.equal(isWebSocketUpgrade(new Request(HOST)), false);
  assert.equal(isSameOriginUpgrade(new Request(`${HOST}/x`, { headers: { Origin: HOST } })), true, 'Sec-Fetch-Site may be absent');
  assert.equal(isSameOriginUpgrade(new Request(`${HOST}/x`, { headers: { Origin: `${HOST}/` } })), false);
});

test('the probe answers numbered pongs, never echoes what it was sent, and closes at its limits', () => {
  let pongs = 0;
  for (let i = 1; i <= PROBE_MAX_PONGS; i++) {
    const step = probeReply(pongs, 'ping SECRET');
    assert.deepEqual(JSON.parse(step.reply!), { type: 'pong', n: i });
    assert.equal(step.close, i === PROBE_MAX_PONGS ? 1000 : null);
    pongs = step.pongs;
  }
  assert.deepEqual(probeReply(pongs, 'ping'), { pongs, reply: null, close: null }, 'nothing after the last pong');
  assert.deepEqual(probeReply(0, new ArrayBuffer(4)), { pongs: PROBE_MAX_PONGS, reply: null, close: 1003 });
  assert.deepEqual(probeReply(2, 'x'.repeat(PROBE_MAX_MESSAGE + 1)), { pongs: PROBE_MAX_PONGS, reply: null, close: 1003 });
});

test('both probe paths close after PROBE_SECONDS, and stop answering first', () => {
  const closes: [number, string][] = [];
  const socket = { close: (code: number, reason: string) => closes.push([code, reason]) } as unknown as WebSocket;
  const timers: { run: () => void; ms: number }[] = [];
  const schedule = (run: () => void, ms: number) => timers.push({ run, ms });
  const order: string[] = [];
  closeAfterProbeTime(socket, () => order.push('stop'), schedule);
  assert.deepEqual(timers.map((t) => t.ms), [PROBE_SECONDS * 1000]);
  assert.equal(PROBE_SECONDS, 60);
  assert.deepEqual(closes, [], 'nothing closes before the timer');
  timers[0]!.run();
  assert.deepEqual(order, ['stop']);
  assert.deepEqual(closes, [[1000, 'probe timeout']]);

  // A socket already gone: neither a throwing stop nor a throwing close escapes the timer.
  const gone = { close: () => { throw new TypeError('closed'); } } as unknown as WebSocket;
  closeAfterProbeTime(gone, () => { throw new TypeError('closed'); }, schedule);
  assert.doesNotThrow(() => timers[1]!.run());

  // Node cannot run the echo (no WebSocketPair, no 101), so pin that it arms the limit and that the Durable Object
  // answers with that same echo rather than hibernatable sockets, whose timer would lapse (worker/agent/SPIKE.md).
  const research = readFileSync(join(import.meta.dirname, 'research.ts'), 'utf8');
  const probeSource = readFileSync(join(import.meta.dirname, 'probe.ts'), 'utf8');
  assert.match(probeSource, /^ {2}closeAfterProbeTime\(server, /m);
  assert.match(research, /return probeEcho\('do'\);/);
  assert.doesNotMatch(research, /acceptWebSocket/);
});

test('the instance name is sha256("research:" + email), never the email itself', async () => {
  const name = await researchInstanceName(OWNER);
  assert.match(name, /^[0-9a-f]{64}$/);
  assert.equal(name, createHash('sha256').update(`research:${OWNER}`).digest('hex'));
  assert.notEqual(await researchInstanceName(COUNSEL), name);
});
