// SPDX-License-Identifier: Apache-2.0
// The research chat's Durable Object (D10 to D12): LegallasResearch, an AIChatAgent on SQLite, bound as RESEARCH and
// reached only through worker/agent/routes.ts behind worker/index.ts, never routeAgentRequest's public /agents/*
// routes. One class plays two parts, chosen by name from the verified email (instance.ts):
// - the member's own instance keeps the thread index (threads.ts), answers the routes' RPC (ResearchRpc) and sweeps
//   deleted and expired threads on its own schedule, whatever the kill switch says;
// - each thread's instance holds one conversation (an AIChatAgent holds one, as the SDK recommends for many chats)
//   and deletes itself 90 days after its last activity.
//
// A thread instance checks the forwarded identity in fetch, before the SDK sends any frame: the first verified email
// and thread id to reach it own it, and nothing else gets in. Every socket frame is refused once the member's Access
// session has ended (its JWT exp) or the kill switch is off; the socket is closed at exp by a schedule (an alarm: a
// timer does not survive hibernation, SPIKE.md), on sign-out (closeSessions), and with 4403 when the members row no
// longer lets the member ask. Both transports run one turn (turn.ts): the WebSocket through onChatMessage, the HTTP
// fallback through onRequest, with the same chunks. Quiet by design: no observability events, no instance name sent
// to clients, and errors logged by name only.
//
// Exported by worker/entry-pro.ts, never by index.ts: tests load index.ts under plain Node, where agents does not.
import { AIChatAgent } from '@cloudflare/ai-chat';
import { getCurrentAgent, type Connection, type ConnectionContext } from 'agents';
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage, type UIMessageStreamWriter } from 'ai';
import { canPerform, findMember } from '../auth.ts';
import type { Env } from '../env.ts';
import { identityOf, INTERNAL_PATHS, type ForwardedIdentity } from './identity.ts';
import { researchInstanceName, researchThreadName } from './instance.ts';
import { isWebSocketUpgrade, probeEcho } from './probe.ts';
import { questionOf, RESEARCH_CLOSE, RESEARCH_PATHS, researchTransport, THREAD_ID, type ResearchError, type ThreadCreated, type ThreadSummary } from './protocol.ts';
import type { ResearchRpc } from './routes.ts';
import * as threads from './threads.ts';
import { answerAndRecord } from './turn.ts';

/** What a socket remembers (connection state, kept across hibernation): when its session ends and where it came from. */
interface SocketState {
  exp: number;
  local: boolean;
  ip: string | null;
  userAgent: string | null;
}

/** The turn's caller, from a socket's state or an HTTP turn's forwarded identity. */
type Caller = Omit<ForwardedIdentity, 'email'>;
type Owner = { email: string; thread: string };

const nameOf = (error: unknown) => (error instanceof Error ? error.name : typeof error);

/** Any failure a stream's execute did not handle itself: logged by name, told to the page as answer_failed. */
function streamFailed(error: unknown): ResearchError {
  console.error('research_turn_failed', nameOf(error));
  return 'answer_failed';
}

/** A UI message stream response that carries only one error code (protocol.ts RESEARCH_ERRORS). */
function errorStream(code: ResearchError): Response {
  return createUIMessageStreamResponse({ stream: createUIMessageStream({ execute: ({ writer }) => writer.write({ type: 'error', errorText: code }), onError: streamFailed }) });
}

/** The research agent: a chat agent that answers a member's questions. */
export class LegallasResearch extends AIChatAgent<Env> implements Omit<ResearchRpc, 'fetch'> {
  static override options = { sendIdentityOnConnect: false };
  override observability = undefined;
  override messageConcurrency = 'drop' as const;
  override maxPersistedMessages = 200;
  #busy = false;
  /** A socket whose member may no longer ask: closed with 4403 once its `forbidden` chunk has gone out (onChatResponse). */
  #cutOff: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // AIChatAgent installs its own onMessage in its constructor; this wraps it, so every frame (chat requests too)
    // is refused once the session has ended or research is turned off.
    const chat = this.onMessage.bind(this);
    this.onMessage = async (connection, message) => {
      const code = this.#refusal(connection);
      if (code !== null) return connection.close(code, 'refused');
      return chat(connection, message);
    };
  }

  get #sql(): threads.Sql {
    return this.ctx.storage.sql as unknown as threads.Sql;
  }

  #refusal(connection: Connection): number | null {
    if (researchTransport(this.env.RESEARCH_ENABLED) !== 'websocket') return RESEARCH_CLOSE.off;
    const state = connection.state as SocketState | null;
    if (!state || state.exp * 1000 <= Date.now()) return RESEARCH_CLOSE.sessionEnded;
    return null;
  }

  /** One pending schedule per callback: earlier ones are cancelled, and `at` null leaves none. */
  async #reschedule(callback: 'sweepThreads' | 'expireThread', at: number | null): Promise<void> {
    for (const schedule of await this.listSchedules()) if (schedule.callback === callback) await this.cancelSchedule(schedule.id);
    if (at !== null) await this.schedule(new Date(at), callback);
  }

  // --- The member's index (RPC from routes.ts, and its sweep) ------------------------------------------------

  #index(email: string): threads.Sql {
    if (!threads.indexOf(this.#sql, email)) throw new Error('research_index_mismatch');
    return this.#sql;
  }

  async listThreads(email: string, now: number): Promise<ThreadSummary[]> {
    return threads.listThreads(this.#index(email), now);
  }

  async createThread(email: string, now: number): Promise<ThreadCreated | { error: 'thread_limit' }> {
    const made = threads.createThread(this.#index(email), now);
    await this.#reschedule('sweepThreads', threads.nextSweep(this.#sql, now));
    return made;
  }

  async hasThread(id: string, now: number): Promise<boolean> {
    return THREAD_ID.test(id) && threads.hasThread(this.#sql, id, now);
  }

  /** A thread had activity: its time moves on, and a first answered question names it. */
  async touchThread(id: string, title: string | null, now: number): Promise<void> {
    threads.touchThread(this.#sql, id, title, now);
    await this.#reschedule('sweepThreads', threads.nextSweep(this.#sql, now));
  }

  /** Deletes a thread: hidden at once, its instance destroyed now or by the sweep, its row dropped only after that. */
  async removeThread(email: string, id: string, now: number): Promise<void> {
    const sql = this.#index(email);
    threads.markDeleted(sql, id, now);
    if (await this.#destroyThread(email, id)) threads.removeThread(sql, id);
    await this.#reschedule('sweepThreads', threads.nextSweep(sql, now));
  }

  /** The index's sweep (schedule callback): deleted and expired threads, retried until each instance is gone. */
  async sweepThreads(): Promise<void> {
    const email = threads.memberOf(this.#sql);
    if (!email) return;
    const next = await threads.sweepIndex(this.#sql, Date.now(), (id) => this.#destroyThread(email, id));
    await this.#reschedule('sweepThreads', next);
  }

  /** Sign-out (routes.ts): every socket on every live thread of the member closes now. */
  async closeSessions(email: string, now: number): Promise<void> {
    for (const { id } of threads.listThreads(this.#index(email), now)) {
      const stub = this.env.RESEARCH.getByName(await researchThreadName(email, id)) as unknown as { closeSockets(): Promise<void> };
      await stub.closeSockets().catch((error: unknown) => console.error('research_signout_failed', nameOf(error)));
    }
  }

  async #destroyThread(email: string, id: string): Promise<boolean> {
    const stub = this.env.RESEARCH.getByName(await researchThreadName(email, id)) as unknown as { destroyThread(): Promise<void> };
    try {
      await stub.destroyThread();
      return true;
    } catch (error) {
      console.error('research_thread_delete_failed', nameOf(error));
      return false;
    }
  }

  // --- One thread -----------------------------------------------------------------------------------------------

  /** Deletes this thread's storage: its transcript, turns, owner and schedules (Agent.destroy). */
  async destroyThread(): Promise<void> {
    await this.destroy();
  }

  /** The 90-day expiry (schedule callback): deletes the thread, or looks again after its latest activity's expiry. */
  async expireThread(): Promise<void> {
    const expiry = threads.expiryOf(threads.lastActivity(this.#sql), Date.now());
    if (expiry.due) await this.destroy();
    else await this.#reschedule('expireThread', expiry.next);
  }

  /** Closes every socket on this thread: the member signed out (closeSessions). */
  async closeSockets(): Promise<void> {
    for (const connection of this.getConnections()) connection.close(RESEARCH_CLOSE.sessionEnded, 'signed out');
  }

  /** Closes a socket when its member's Access session ends (schedule callback). */
  async closeSession(payload: { id: string }): Promise<void> {
    this.getConnection(payload.id)?.close(RESEARCH_CLOSE.sessionEnded, 'session ended');
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === RESEARCH_PATHS.probe && isWebSocketUpgrade(request)) return probeEcho('do');
    const identity = identityOf(request);
    const now = Date.now();
    const owned = identity?.thread ? threads.ownedBy(this.#sql, identity.email, identity.thread, now) : null;
    if (!identity || !owned?.owned) return new Response(null, { status: 403 });
    // The thread's expiry starts with its first request, whatever happens to its first question.
    if (owned.created) await this.#reschedule('expireThread', threads.expiresAt(now) + threads.SWEEP_MARGIN_MS);
    if (isWebSocketUpgrade(request)) {
      if (researchTransport(this.env.RESEARCH_ENABLED) !== 'websocket') return new Response(null, { status: 503 });
      if (identity.exp * 1000 <= now) return new Response(null, { status: 401 });
    }
    return super.fetch(request);
  }

  override async onConnect(connection: Connection, ctx: ConnectionContext): Promise<void> {
    const identity = identityOf(ctx.request);
    if (!identity) return connection.close(RESEARCH_CLOSE.forbidden, 'forbidden');
    connection.setState({ exp: identity.exp, local: identity.local, ip: identity.ip, userAgent: identity.userAgent } satisfies SocketState);
    await this.schedule(new Date(identity.exp * 1000), 'closeSession', { id: connection.id });
  }

  override async onChatMessage(_onFinish: unknown, options?: { abortSignal?: AbortSignal }): Promise<Response> {
    const { connection } = getCurrentAgent();
    const state = (connection?.state ?? null) as SocketState | null;
    const owner = threads.ownerOf(this.#sql);
    if (!owner || !state) return errorStream('forbidden');
    // The members row again, for every question: a removed member, or a role that may no longer ask, is cut off.
    const member = await findMember(this.env.DB, owner.email);
    if (!member || !canPerform(member.role, 'ask')) {
      this.#cutOff = connection?.id ?? null;
      return errorStream('forbidden');
    }
    const question = questionOf(this.messages as UIMessage[]);
    if (!question) return errorStream('empty_question');
    if (this.#busy) return errorStream('research_busy');
    const stream = createUIMessageStream({ execute: ({ writer }) => this.#turn(writer, owner, state, question, options?.abortSignal), onError: streamFailed });
    return createUIMessageStreamResponse({ stream });
  }

  /** After a turn's response has gone out: the socket of a member who may no longer ask closes now, with 4403. */
  protected override async onChatResponse(): Promise<void> {
    const id = this.#cutOff;
    this.#cutOff = null;
    if (id) this.getConnection(id)?.close(RESEARCH_CLOSE.forbidden, 'forbidden');
  }

  override async onRequest(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === INTERNAL_PATHS.messages && request.method === 'GET') return Response.json(this.messages);
    if (path === INTERNAL_PATHS.turn && request.method === 'POST') return this.#httpTurn(request);
    return new Response(null, { status: 404 });
  }

  /** The HTTP fallback (D11): the same turn and chunks as the socket, then the transcript saved as onChatMessage's is. */
  async #httpTurn(request: Request): Promise<Response> {
    const identity = identityOf(request);
    const owner = threads.ownerOf(this.#sql);
    if (!identity || !owner) return errorStream('forbidden');
    const body = (await request.json().catch(() => null)) as { question?: unknown } | null;
    const question = typeof body?.question === 'string' ? body.question : '';
    if (this.#busy) return Response.json({ error: 'research_busy' }, { status: 409 });
    const user: UIMessage = { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: question }] };
    const stream = createUIMessageStream({
      originalMessages: [...(this.messages as UIMessage[]), user],
      execute: ({ writer }) => this.#turn(writer, owner, identity, question, request.signal),
      onError: streamFailed,
      onFinish: async ({ messages }) => {
        await this.persistMessages(messages as never).catch((error: unknown) => console.error('research_persist_failed', nameOf(error)));
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  /**
   * One turn for either transport. The question is activity (it stays in the transcript, answered or not); an answered
   * turn is recorded for later context, names the thread on its first answer (`data-thread`) and moves its time.
   */
  async #turn(writer: UIMessageStreamWriter, owner: Owner, caller: Caller, question: string, signal?: AbortSignal): Promise<void> {
    this.#busy = true;
    try {
      const now = Date.now();
      threads.touchActivity(this.#sql, now);
      await this.#touchIndex(owner, null, now);
      const first = threads.pastTurns(this.#sql).length === 0;
      const req = { env: this.env, email: owner.email, client: { ip: caller.ip, userAgent: caller.userAgent }, local: caller.local, question, history: threads.pastTurns(this.#sql), signal, waitUntil: (promise: Promise<unknown>) => this.ctx.waitUntil(promise) };
      await answerAndRecord(writer as never, req, async (outcome) => {
        const title = threads.titleFrom(outcome.question);
        if (first) writer.write({ type: 'data-thread', id: 'thread', data: { id: owner.thread, title } });
        threads.addTurn(this.#sql, { question: outcome.question, answer: outcome.answer }, Date.now());
        await this.#touchIndex(owner, title, Date.now());
      });
    } finally {
      this.#busy = false;
    }
  }

  /** Tells the member's index this thread had activity (and its title, on the first answer). Never fails the turn. */
  async #touchIndex(owner: Owner, title: string | null, now: number): Promise<void> {
    const index = this.env.RESEARCH.getByName(await researchInstanceName(owner.email)) as unknown as { touchThread(id: string, title: string | null, now: number): Promise<void> };
    await index.touchThread(owner.thread, title, now).catch((error: unknown) => console.error('research_index_failed', nameOf(error)));
  }

  override onError(connectionOrError: unknown, error?: unknown): void {
    // The SDK's default logs the whole error, which may carry text; only its name is kept here.
    console.error('research_agent_error', nameOf(error ?? connectionOrError));
  }
}
