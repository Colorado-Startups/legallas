// SPDX-License-Identifier: Apache-2.0
// One research question, the same over the WebSocket and the HTTP fallback (research.ts): the order is quick Ask's
// (worker/routes/ask.ts). The kill switch, the member row read again from D1 (a removed member or a role that may not
// ask is refused at once), the question's checks, the burst limit, room for a whole question in today's Workers AI
// allowance (ceiling.ts RESEARCH_NEURON_CEILING), the daily cap at RESEARCH_QUESTION_COST, one ai_question audit row
// with no text, then quick Ask's own search of the question and the tool steps (steps.ts, tools/seed.ts) and the
// final answer (final.ts). A question that fails on our side
// before its answer starts, or whose answer fails in the stream, is given back to the cap; a degenerate answer still
// counts, like quick Ask's.
//
// Privacy: the question travels only to the model and the tools. It is never logged, audited or put in a URL; logs
// carry reason words and counts.
import { auditStatement } from '../audit.ts';
import { dailyCap, MAX_QUESTION_CHARS, refundQuestion, takeQuestion } from '../ask.ts';
import { liveDocuments } from '../retrieval.ts';
import { utcDay } from '../usage.ts';
import { matterBrief } from '../ask-brief.ts';
import { recommends } from '../recommend.ts';
import { isCompanyRoom } from '../room-shape.ts';
import { canPerform, findMember } from '../auth.ts';
import { withinBurst } from '../burst.ts';
import type { Env, Member, RequestContext } from '../env.ts';
import { loadMatter } from '../routes/matter.ts';
import { BudgetExhausted, budgetCode, shortMeter, type WaitUntil } from '../spend.ts';
import { DegenerateAnswer } from '../ask-stream.ts';
import { QuestionCeiling, RESEARCH_NEURON_CEILING } from './ceiling.ts';
import { AnswerFailed, runFinal, TurnCancelled, type ChunkWriter } from './final.ts';
import { researchBindings, type ResearchEnv } from './mock.ts';
import { RESEARCH_QUESTION_COST, researchTransport, type ResearchError } from './protocol.ts';
import { runToolSteps, type PastTurn } from './steps.ts';
import { toolState } from './tools/adapters.ts';

/** One research turn's request: the environment and the thread owner's email. */
export interface TurnRequest {
  env: ResearchEnv;
  /** The thread owner's email, from the identity worker/index.ts verified (identity.ts); never from a client. */
  email: string;
  /** For the audit row, as worker/audit.ts records it. */
  client: { ip: string | null; userAgent: string | null };
  /** The member's request came to localhost (wrangler dev): the mocks and spend.ts's local rule apply. */
  local: boolean;
  question: string;
  /** Earlier turns of this thread as the server stored them. */
  history: readonly PastTurn[];
  signal?: AbortSignal;
  waitUntil?: WaitUntil;
}

/** The outcome of a turn: the answer, or an error. */
export type TurnOutcome = { ok: true; question: string; answer: string; dontKnow: boolean } | { ok: false; error: ResearchError };

type Admitted = { ok: true; member: Member; question: string; giveBack: () => Promise<void> } | { ok: false; error: ResearchError };

/** The question cleaned as quick Ask cleans it (ask.ts readQuestion): control characters out, trimmed, within the limit. */
export function cleanQuestion(raw: string): { ok: true; question: string } | { ok: false; error: 'empty_question' | 'question_too_long' } {
  const question = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  if (!question) return { ok: false, error: 'empty_question' };
  if ([...question].length > MAX_QUESTION_CHARS) return { ok: false, error: 'question_too_long' };
  return { ok: true, question };
}

/** One ai_question row: who, when, from where. Never the question, an answer or a document id. */
async function auditQuestion(env: ResearchEnv, member: Member, client: TurnRequest['client']): Promise<void> {
  const headers = new Headers();
  if (client.ip) headers.set('CF-Connecting-IP', client.ip);
  if (client.userAgent) headers.set('User-Agent', client.userAgent);
  const c = { env: { DB: env.DB }, member, request: new Request('https://research.invalid/', { headers }) } as unknown as RequestContext;
  await auditStatement(c, 'ai_question', null).run();
}

const nameOf = (error: unknown) => (error instanceof Error ? error.name : typeof error);

/** Everything before any spend: who may ask, what, and whether today has room. Charges the question last. */
async function admit(req: TurnRequest): Promise<Admitted> {
  const { env } = req;
  if (researchTransport(env.RESEARCH_ENABLED) === null) return { ok: false, error: 'research_off' };
  const member = await findMember(env.DB, req.email);
  if (!member || !canPerform(member.role, 'ask')) return { ok: false, error: 'forbidden' };
  const cleaned = cleanQuestion(req.question);
  if (!cleaned.ok) return cleaned;
  if (!(await withinBurst(env.ASK_LIMIT, member.email, 'research_ratelimit_error'))) return { ok: false, error: 'rate_limited' };
  try {
    const short = await shortMeter(env.DB, { neurons: RESEARCH_NEURON_CEILING });
    if (short) {
      console.error('research_budget_refused', short);
      return { ok: false, error: budgetCode(short) };
    }
  } catch (error) {
    console.error('research_budget_unreadable', error instanceof Error ? error.name : typeof error);
    return { ok: false, error: 'budget_unavailable' };
  }
  const day = utcDay();
  if (!(await takeQuestion(env.DB, member.email, dailyCap(env.DAILY_QUESTION_CAP), day, RESEARCH_QUESTION_COST))) {
    return { ok: false, error: 'daily_limit' };
  }
  const giveBack = () =>
    refundQuestion(env.DB, member.email, day, RESEARCH_QUESTION_COST).catch((error: unknown) => console.error('research_refund_failed', nameOf(error)));
  return { ok: true, member, question: cleaned.question, giveBack };
}

/** The final answer's question: the member's own words, after the thread's earlier questions as context only. */
export function finalQuestion(question: string, history: readonly PastTurn[]): string {
  const earlier = history.slice(-3).map((turn) => `- ${turn.question.replace(/\s+/g, ' ').slice(0, 300)}`);
  if (earlier.length === 0) return question;
  return `Earlier questions in this research thread (context only, not evidence):\n${earlier.join('\n')}\n\n${question}`;
}

/** The error a turn ends with when the final answer could not start. */
function startFailure(error: unknown): ResearchError {
  if (error instanceof BudgetExhausted) return budgetCode(error.meter);
  return 'model_unavailable';
}

/**
 * Runs one research question and writes its chunks: `data-progress` as the tools work, `data-records` when a public
 * records check ran, then the answer's text, `data-citations` and `data-verdict` (final.ts), or one `error` chunk with a code from protocol.ts. Never throws: once
 * the question is charged, anything unexpected gives it back and ends as `answer_failed` (logged by name). A turn the
 * member cancelled (`signal`) ends quietly and keeps its charge, like an answer quick Ask's reader abandons.
 */
export async function runResearchTurn(writer: ChunkWriter, req: TurnRequest): Promise<TurnOutcome> {
  const admitted = await admit(req);
  if (!admitted.ok) {
    writer.write({ type: 'error', errorText: admitted.error });
    return admitted;
  }
  try {
    return await answer(writer, req, admitted);
  } catch (error) {
    if (req.signal?.aborted) return { ok: false, error: 'answer_failed' };
    await admitted.giveBack();
    console.error('research_turn_failed', nameOf(error));
    writer.write({ type: 'error', errorText: 'answer_failed' });
    return { ok: false, error: 'answer_failed' };
  }
}

/** The charged part of a turn: the audit row, the tool steps, then the final answer. */
async function answer(writer: ChunkWriter, req: TurnRequest, admitted: Extract<Admitted, { ok: true }>): Promise<TurnOutcome> {
  const { member, question, giveBack } = admitted;
  const { env } = req;
  await auditQuestion(env, member, req.client);
  const bindings = researchBindings(env, { local: req.local, waitUntil: req.waitUntil });
  const ceiling = new QuestionCeiling();
  let steps = 0;
  const progress = () => writer.write({ type: 'data-progress', id: 'progress', data: { steps, ...state.evidence.counts() } });
  const state = toolState(bindings.tools, member, progress);
  progress();
  steps = await runToolSteps({ ai: bindings.stepAi, model: env.LEGALLAS_MODEL, question, history: req.history, state, ceiling, signal: req.signal, onStep: (n) => ((steps = n), progress()) });
  // A public-records check goes to the member as its own card, as the tool returned it, never through the answer.
  if (state.records.length > 0) writer.write({ type: 'data-records', id: 'records', data: { checks: state.records } });
  const empty = state.evidence.chunks.length === 0 && state.evidence.law.length === 0;
  if (empty && (ceiling.budget || state.refused)) {
    await giveBack();
    const error: ResearchError = ceiling.budget ? 'ai_budget' : 'search_budget';
    writer.write({ type: 'error', errorText: error });
    return { ok: false, error };
  }
  // Read through the member's role, like quick Ask, so a role without viewPrivileged never sees proof tags on a
  // privileged document.
  const brief = await matterBrief(() => loadMatter({ FILES: env.FILES } as Env), (ids) => liveDocuments(env.DB, ids, member.role));
  const company = await isCompanyRoom(env);
  try {
    const final = await runFinal(writer, { ai: bindings.finalAi, model: env.LEGALLAS_MODEL, question: finalQuestion(question, req.history), evidence: state.evidence, brief, ceiling, recommend: recommends(env), company, signal: req.signal });
    if (final.withheld > 0) console.error('research_passages_withheld', final.withheld);
    return { ok: true, question, answer: final.answer, dontKnow: final.dontKnow };
  } catch (error) {
    if (error instanceof DegenerateAnswer || error instanceof TurnCancelled) return { ok: false, error: 'answer_failed' };
    await giveBack();
    if (error instanceof AnswerFailed) return { ok: false, error: 'answer_failed' };
    const code = startFailure(error);
    console.error('research_model_failed', nameOf(error));
    writer.write({ type: 'error', errorText: code });
    return { ok: false, error: code };
  }
}

/**
 * A turn, then `record` for an answered one (research.ts saves the turn and the thread's activity). A record that
 * fails is logged by name and never turns an answered turn into a failed one: the verdict has already gone out.
 */
export async function answerAndRecord(writer: ChunkWriter, req: TurnRequest, record: (outcome: Extract<TurnOutcome, { ok: true }>) => Promise<void>): Promise<TurnOutcome> {
  const outcome = await runResearchTurn(writer, req);
  if (outcome.ok) await record(outcome).catch((error: unknown) => console.error('research_record_failed', nameOf(error)));
  return outcome;
}
