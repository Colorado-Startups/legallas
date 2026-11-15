// SPDX-License-Identifier: Apache-2.0
// The research chat's routes (protocol.ts RESEARCH_PATHS), mounted by worker/index.ts behind its two locks: a verified
// Access identity and a members row. Each route checks the role (canPerform 'ask'); what spends (a new thread, the
// socket, a turn) also checks the kill switch, while reading, listing and deleting threads and sign-out never do. A
// route reaches a Durable Object only by a name derived from the verified email (instance.ts), with a request built fresh
// (identity.ts). A thread id is used only after the member's own index confirms it. The socket route also needs the
// exact Origin (probe.ts isSameOriginUpgrade); writes already need it in index.ts.
//
// Imports nothing from cloudflare:workers or agents (only types from research.ts), so index.ts stays loadable under
// plain Node. Logs: none; the Durable Objects log codes only.
import { canPerform } from '../auth.ts';
import { readLimited } from '../comments.ts';
import type { RequestContext } from '../env.ts';
import { errorJson, json } from '../http.ts';
import type { Route } from '../router.ts';
import { isLocalRequest } from '../spend.ts';
import { forwarded, INTERNAL_PATHS, sessionExp, type ForwardedIdentity } from './identity.ts';
import { researchInstanceName, researchThreadName } from './instance.ts';
import { isSameOriginUpgrade, isWebSocketUpgrade, routes as probeRoutes } from './probe.ts';
import {
  RESEARCH_MAX_QUESTION_CHARS,
  RESEARCH_PATHS,
  RESEARCH_PROTOCOL,
  RESEARCH_QUESTION_COST,
  researchTransport,
  THREAD_ID,
  type ResearchStatus,
  type ThreadCreated,
  type ThreadSummary,
} from './protocol.ts';

/** What the routes call on a research Durable Object (research.ts LegallasResearch implements it). */
export interface ResearchRpc {
  listThreads(email: string, now: number): Promise<ThreadSummary[]>;
  createThread(email: string, now: number): Promise<ThreadCreated | { error: 'thread_limit' }>;
  hasThread(id: string, now: number): Promise<boolean>;
  removeThread(email: string, id: string, now: number): Promise<void>;
  closeSessions(email: string, now: number): Promise<void>;
  fetch(request: Request): Promise<Response>;
}

/** The body of a turn: the question in JSON, a little room around it. */
const MAX_TURN_BODY_BYTES = 16_384;

function identityFor(c: RequestContext): ForwardedIdentity {
  return {
    email: c.member.email,
    exp: sessionExp(c.request),
    local: isLocalRequest(c.request),
    ip: c.request.headers.get('CF-Connecting-IP'),
    userAgent: c.request.headers.get('User-Agent'),
  };
}

async function memberIndex(c: RequestContext): Promise<ResearchRpc> {
  return c.env.RESEARCH.getByName(await researchInstanceName(c.member.email)) as unknown as ResearchRpc;
}

async function threadObject(c: RequestContext, id: string): Promise<ResearchRpc> {
  return c.env.RESEARCH.getByName(await researchThreadName(c.member.email, id)) as unknown as ResearchRpc;
}

/** Refuses a member who may not ask. */
function notAllowed(c: RequestContext): Response | null {
  return canPerform(c.member.role, 'ask') ? null : errorJson('forbidden', 403);
}

/**
 * Also refuses everyone while the kill switch is off: for what spends (a new thread, the socket, a turn). Reading,
 * listing and deleting threads, and sign-out, stay open: the switch stops spend, never a member's own data.
 */
function refused(c: RequestContext): Response | null {
  return notAllowed(c) ?? (researchTransport(c.env.RESEARCH_ENABLED) === null ? errorJson('research_off', 503) : null);
}

/** The thread id in the path, confirmed in the member's own index; else a 404 thread_missing response. */
async function ownThread(c: RequestContext): Promise<string | Response> {
  const id = c.params.id ?? '';
  if (!THREAD_ID.test(id) || !(await (await memberIndex(c)).hasThread(id, Date.now()))) return errorJson('thread_missing', 404);
  return id;
}

async function status(c: RequestContext): Promise<Response> {
  const transport = researchTransport(c.env.RESEARCH_ENABLED);
  const body: ResearchStatus = {
    protocol: RESEARCH_PROTOCOL,
    enabled: transport !== null && canPerform(c.member.role, 'ask'),
    transport,
    questionCost: RESEARCH_QUESTION_COST,
    maxQuestionChars: RESEARCH_MAX_QUESTION_CHARS,
  };
  return json(body);
}

async function list(c: RequestContext): Promise<Response> {
  return notAllowed(c) ?? json(await (await memberIndex(c)).listThreads(c.member.email, Date.now()));
}

async function create(c: RequestContext): Promise<Response> {
  const no = refused(c);
  if (no) return no;
  const made = await (await memberIndex(c)).createThread(c.member.email, Date.now());
  return 'error' in made ? errorJson(made.error, 409) : json(made satisfies ThreadCreated, 201);
}

async function read(c: RequestContext): Promise<Response> {
  const id = notAllowed(c) ?? (await ownThread(c));
  if (id instanceof Response) return id;
  return (await threadObject(c, id)).fetch(forwarded(new URL(INTERNAL_PATHS.messages, c.url.origin), identityFor(c), { thread: id }));
}

/** Deletes a thread: gone from the list at once, its storage destroyed now or by the index's sweep (threads.ts). */
async function remove(c: RequestContext): Promise<Response> {
  const id = notAllowed(c) ?? (await ownThread(c));
  if (id instanceof Response) return id;
  await (await memberIndex(c)).removeThread(c.member.email, id, Date.now());
  return new Response(null, { status: 204 });
}

async function socket(c: RequestContext): Promise<Response> {
  const no = refused(c);
  if (no) return no;
  if (researchTransport(c.env.RESEARCH_ENABLED) !== 'websocket') return errorJson('research_off', 503);
  if (!isWebSocketUpgrade(c.request)) return errorJson('upgrade_required', 426);
  if (!isSameOriginUpgrade(c.request)) return errorJson('forbidden', 403);
  const id = await ownThread(c);
  if (id instanceof Response) return id;
  // The client's own URL (its query carries the socket's connection id), with nothing else of its request.
  return (await threadObject(c, id)).fetch(forwarded(c.url, identityFor(c), { thread: id, upgrade: true }));
}

async function turn(c: RequestContext): Promise<Response> {
  const id = refused(c) ?? (await ownThread(c));
  if (id instanceof Response) return id;
  const raw = await readLimited(c.request, MAX_TURN_BODY_BYTES);
  if (raw === null) return errorJson('question_too_long', 413);
  let question: unknown;
  try {
    question = (JSON.parse(raw) as { question?: unknown } | null)?.question;
  } catch {
    return errorJson('bad_request', 400);
  }
  if (typeof question !== 'string') return errorJson('bad_request', 400);
  // Only the question goes on: whatever else the body carried (messages, history, ids) is dropped here.
  return (await threadObject(c, id)).fetch(forwarded(new URL(INTERNAL_PATHS.turn, c.url.origin), identityFor(c), { thread: id, json: { question } }));
}

/** Sign-out: every socket the member holds closes now, kill switch or not. Same-origin like every write (index.ts). */
async function signout(c: RequestContext): Promise<Response> {
  await (await memberIndex(c)).closeSessions(c.member.email, Date.now());
  return new Response(null, { status: 204 });
}

/** The research API routes. */
export const routes: Route[] = [
  ...probeRoutes,
  { method: 'GET', path: RESEARCH_PATHS.status, handler: status },
  { method: 'GET', path: RESEARCH_PATHS.threads, handler: list },
  { method: 'POST', path: RESEARCH_PATHS.threads, handler: create },
  { method: 'GET', path: RESEARCH_PATHS.thread, handler: read },
  { method: 'DELETE', path: RESEARCH_PATHS.thread, handler: remove },
  { method: 'GET', path: RESEARCH_PATHS.socket, handler: socket },
  { method: 'POST', path: RESEARCH_PATHS.turn, handler: turn },
  { method: 'POST', path: RESEARCH_PATHS.signout, handler: signout },
];
