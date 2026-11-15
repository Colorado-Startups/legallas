// SPDX-License-Identifier: Apache-2.0
// POST /api/ask { question }: Ask Legallas. Owned by the Legallas AI workstream.
// index.ts already authenticated the caller, loaded their member row and checked the write origin.
//
// Order: permission, input, burst limit, daily cap, audit (no text), retrieval filtered to live documents the member
// may see (a role without viewPrivileged never reaches a privileged folder), then the answer streamed as SSE with
// server-validated citations at the end. Each citation carries its control
// number and a pinpoint quote from the retrieved page text (R10), so the browser never re-reads the index. With nothing retrieved, Legallas says
// he does not know without calling the model at all, unless the case picture (ask-brief.ts) can answer.
// A refused model call is retried once and then handed to the fallback model (ask-model.ts); a question that fails
// on our side (search or every model unavailable, before or during the stream) is given back to the cap. An answer
// the model made but left blank twice (DegenerateAnswer) still counts: the cap is also the guard on model spend.
// The prompt, the shaping of the streamed text (short cite ids mapped back, labels held to the record) and the
// verdict come from ask-turn.ts, which the eval replica runs too.
// Spend (worker/budget.ts): before the member's cap, a read checks that today's Workers AI allowance and this month's
// AI Search allowance have room, so an exhausted budget never costs a question; every model call and search then
// counts in D1 through the metered bindings (spend.ts), and a refusal there gives the question back too. Once the free
// keyword index is built (scripts/fts-index.ts), a month with less AI Search room than the turn's searches need no
// longer refuses: the turn makes no AI Search query (no law search either) and the record is searched by keyword
// (retrieval.ts KEYWORD_FALLBACK, worker/fts.ts), as it is after an AI Search failure. Until then the refusal stands here.
// Once the day's neurons are spent (the pre-check or the model call's hold), Ask answers on Groq when the room config
// opens its zero-data-retention gate (ask-provider.ts: ASK_GROQ, the key, not local development without the remote-AI
// opt-in), with the turn fitted to Groq's free minute (ask-fit.ts); otherwise, and on Groq's 429, it is 429 ai_budget.
// When the room's own host opens the same gate (ask-host.ts: ASK_HOST, its key), it answers every question instead of
// Workers AI, so the neurons pre-check does not apply; its failure is 503 model_unavailable. Closed, nothing changes.
import { askVisuals, dailyCap, MAX_TOKENS, readQuestion, refundQuestion, takeQuestion, type AskBindings } from '../ask.ts';
import { keywordFallbackFor, keywordFallbackReady, liveDocuments, RETRIEVAL, retrieve, type Retrieved } from '../retrieval.ts';
import { utcDay } from '../usage.ts';
import { matterBrief } from '../ask-brief.ts';
import { askBindings } from '../ask-mock.ts';
import { answerWith, groqGate, type GroqGate, type ProviderAnswer } from '../ask-provider.ts';
import { hostGate, type HostGate } from '../ask-host.ts';
import { answerStream, DegenerateAnswer, fixedText, retryDegenerate, SSE_HEADERS } from '../ask-stream.ts';
import { audit } from '../audit.ts';
import { canPerform } from '../auth.ts';
import { neuronsFor, secondsToReset, type Meter } from '../budget.ts';
import { BURST_RETRY_AFTER_SECONDS, withinBurst } from '../burst.ts';
import { ASK_LAW_MIN_VECTOR, lawEnabled, retrieveLaw, validateLawCitations, type RetrievedLaw } from '../law.ts';
import { lawLibrary } from '../law-mock.ts';
import type { Env, RequestContext } from '../env.ts';
import { recommends } from '../recommend.ts';
import { isCompanyRoom } from '../room-shape.ts';
import { errorJson, json } from '../http.ts';
import type { TurnInput } from '../ask-turn.ts';
import { DONT_KNOW } from '../prompt.ts';
import type { Route } from '../router.ts';
import { BudgetExhausted, budgetCode, isLocalRequest, LocalSpendOff, shortMeter, waitUntilOf, withSpendGuards } from '../spend.ts';
import { loadMatter } from './matter.ts';

const NOTHING_FOUND = `${DONT_KNOW} Nothing in this room's documents answers this. Try naming a document, a person or a date.`;

/** AI Search for a keyword-only turn: refuses as a spent month would, before any query, so retrieve() falls back. */
const SPENT_SEARCH: Pick<AiSearchInstance, 'search'> = { search: async () => Promise.reject(new BudgetExhausted('search_semantic')) };

export { isDontKnow } from '../ask-turn.ts';

/** Local development without ASK_MOCK or LEGALLAS_DEV_REMOTE_AI: the billed bindings would spend uncounted. */
function localSpendRefusal(): Response {
  console.error('ask_local_spend_off');
  return errorJson('dev_remote_ai_off', 503);
}

/** 429 with ai_budget or search_budget (src/scripts/chat-client.ts ERRORS), and when the allowance comes back. */
function budgetRefusal(meter: Meter, now: Date = new Date()): Response {
  console.error('ask_budget_refused', meter);
  return json({ error: budgetCode(meter) }, 429, { 'retry-after': String(secondsToReset(meter, now)) });
}

/** Documents and distinct pages in the retrieved set: counts only, for the Ask companion's "reading" state. */
export function readingCounts(chunks: readonly { docId: string; text: string }[], documents: number): { documents: number; pages: number } {
  const pages = new Set<string>();
  for (const chunk of chunks) {
    for (const match of chunk.text.matchAll(/\[\[doc:([A-Za-z0-9_-]{1,64}) p:([0-9]{1,6})\]\]/g)) {
      if (match[1] === chunk.docId) pages.add(`${match[1]}:${match[2]}`);
    }
  }
  return { documents, pages: Math.max(pages.size, documents) };
}

/**
 * The spend pre-check, before the member's cap, so an exhausted budget never costs a question: the least one answer
 * holds (its whole max_tokens of output) and its first searches (the record, and the law library when it is on).
 * Without the neurons, the turn goes to Groq when its gate is open (neuronsShort) and nothing runs when it is not. With
 * the room's own host open (`hostOpen`), Workers AI is not asked, so its neurons are not checked.
 * Without room for every search, the turn runs on keyword search alone (keywordOnly) once the keyword index is built,
 * and is refused here, as before, while it is not. Each search still reserves before it runs (spend.ts), so none ever
 * passes the month's limit; near it, a refused law search only leaves law out.
 */
async function spendGate(c: RequestContext, groq: GroqGate, hostOpen: boolean): Promise<Response | { keywordOnly: boolean; neuronsShort: boolean }> {
  const searches = lawEnabled(c.env) ? 2 : 1;
  let neuronsShort: boolean;
  let short: Meter | null;
  try {
    neuronsShort = hostOpen ? false : (await shortMeter(c.env.DB, { neurons: neuronsFor(c.env.LEGALLAS_MODEL, 0, MAX_TOKENS) })) !== null;
    short = await shortMeter(c.env.DB, { search_semantic: searches });
  } catch (error) {
    // Fails closed: without its counters (migration 0007 not applied, or D1 down) the room cannot keep to its budget.
    console.error('ask_budget_unreadable', error instanceof Error ? error.name : typeof error);
    return errorJson('budget_unavailable', 503);
  }
  if (neuronsShort && !groq.open) {
    console.error('ask_groq_closed', groq.reason);
    return budgetRefusal('neurons');
  }
  if (short === 'search_semantic' && !(await keywordFallbackReady(c.env.DB))) return budgetRefusal(short);
  return { keywordOnly: short === 'search_semantic', neuronsShort };
}

/**
 * The law library (off unless turned on), searched beside the record; it never fails the request. Law reaches the
 * prompt only when the question is about law (law.ts ASK_LAW_MIN_VECTOR). A keyword-only turn has no law.
 */
function lawFor(request: Request, metered: Env, question: string, keywordOnly: boolean): Promise<RetrievedLaw | null> {
  const library = keywordOnly ? null : lawLibrary(request, metered);
  if (!library) return Promise.resolve(null);
  return retrieveLaw(library.search, library.bucket, question, { minVector: ASK_LAW_MIN_VECTOR }).catch((error: unknown) => {
    console.error('ask_law_retrieval_failed', error instanceof Error ? error.name : typeof error);
    return null;
  });
}

/**
 * The record's passages for the question, from live documents the member may see. Visuals (their AI text, plan D8)
 * only once ASK_VISUALS is "1", after a replica eval shows no loss. A keyword-only turn hands retrieve() a search that
 * is already spent, so no AI Search query runs and the keyword index answers; an AI Search failure falls back to it
 * too (retrieval.ts retrieve, which logs either). A failure gives the question back and becomes the response.
 */
async function searchRecord(
  c: RequestContext,
  search: AskBindings['SEARCH'],
  question: string,
  keywordOnly: boolean,
  giveBack: () => Promise<unknown>,
): Promise<Retrieved | Response> {
  const visuals = askVisuals(c.env);
  const options = { includeVisuals: visuals, keywordFallback: keywordFallbackFor(visuals), keywordOnOutage: true };
  try {
    return await retrieve(keywordOnly ? SPENT_SEARCH : search, c.env.DB, question, c.member.role, RETRIEVAL, options);
  } catch (error) {
    await giveBack();
    if (error instanceof BudgetExhausted) return budgetRefusal(error.meter);
    if (error instanceof LocalSpendOff) return localSpendRefusal();
    console.error('ask_retrieval_failed', error instanceof Error ? error.name : typeof error);
    return errorJson('search_unavailable', 503);
  }
}

/**
 * The answer's first model call, made here so an outage is still a 503: the room's own host when its gate is open;
 * otherwise Workers AI, retried once and handed to the fallback model when refused (ask-model.ts), each call with no
 * options, and Groq when the neurons are spent and its gate is open (ask-provider.ts). The answer's `start` returns that stream once and makes any later call itself
 * (retryDegenerate); its `turn` is the one sent (Groq's is fitted). A failure gives the question back and becomes the
 * response: a spent budget (Groq's 429 included) is 429 ai_budget, anything else 503 model_unavailable.
 */
async function firstAnswer(
  c: RequestContext,
  ai: Parameters<typeof answerWith>[0]['ai'],
  input: TurnInput,
  options: { groq: GroqGate; host: HostGate; neuronsShort: boolean },
  giveBack: () => Promise<unknown>,
): Promise<ProviderAnswer | Response> {
  try {
    // fetch is read at call time, so a test can stand in for Groq or the room's host.
    return await answerWith({ ai, model: c.env.LEGALLAS_MODEL, input, gate: options.groq, host: options.host, fetcher: (url, init) => fetch(url, init), neuronsShort: options.neuronsShort });
  } catch (error) {
    await giveBack();
    if (error instanceof BudgetExhausted) return budgetRefusal(error.meter);
    if (error instanceof LocalSpendOff) return localSpendRefusal();
    console.error('ask_model_failed', error instanceof Error ? error.name : typeof error);
    return errorJson('model_unavailable', 503);
  }
}

async function ask(c: RequestContext): Promise<Response> {
  if (!canPerform(c.member.role, 'ask')) return errorJson('forbidden', 403);

  const input = await readQuestion(c.request);
  if (!input.ok) return errorJson(input.error, input.error === 'question_too_long' ? 413 : 400);

  // The burst limit runs first, so a double submit or a loop is refused without spending the daily cap.
  if (!(await withinBurst(c.env.ASK_LIMIT, c.member.email, 'ask_ratelimit_error'))) {
    return json({ error: 'rate_limited' }, 429, { 'retry-after': String(BURST_RETRY_AFTER_SECONDS) });
  }
  // The outside backends' gate: local development reaches them only with the same opt-in the billed bindings need
  // (spend.ts). A room's host that is turned on but closed says why (a word), and Ask answers on Workers AI.
  const local = isLocalRequest(c.request) && c.env.LEGALLAS_DEV_REMOTE_AI !== '1';
  const groq = groqGate(c.env, { local });
  const host = hostGate(c.env, { local });
  if (!host.open && host.reason !== 'off') console.error('ask_host_closed', host.reason);
  const gate = await spendGate(c, groq, host.open);
  if (gate instanceof Response) return gate;
  const day = utcDay();
  if (!(await takeQuestion(c.env.DB, c.member.email, dailyCap(c.env.DAILY_QUESTION_CAP), day))) {
    return errorJson('daily_limit', 429);
  }
  // A question that fails on our side is given back; a failed refund is logged, never fatal.
  const giveBack = () => refundQuestion(c.env.DB, c.member.email, day).catch((error: unknown) => console.error('ask_refund_failed', error instanceof Error ? error.name : typeof error));
  // One ai_question row: who, when, from where. Never the question, the answer or any document id.
  await audit(c, 'ai_question', null);

  // An answer the member abandons still settles its spend after the response ends (spend.ts tapUsage). On localhost the
  // billed bindings refuse unless LEGALLAS_DEV_REMOTE_AI is "1" (ASK_MOCK is the free way to develop).
  const metered = withSpendGuards(c.env, { waitUntil: waitUntilOf(c.ctx), local: isLocalRequest(c.request) });
  const { AI, SEARCH } = askBindings(c.request, metered);
  const lawing = lawFor(c.request, metered, input.question, gate.keywordOnly);
  // The case picture loads beside retrieval; it never fails the request (ask-brief.ts).
  // Both read through the member's role, so a role without viewPrivileged never retrieves or cites a privileged
  // document (privilege.ts).
  const briefing = matterBrief(() => loadMatter(c.env), (ids) => liveDocuments(c.env.DB, ids, c.member.role));
  const company = isCompanyRoom(c.env);
  const retrieved = await searchRecord(c, SEARCH, input.question, gate.keywordOnly, giveBack);
  if (retrieved instanceof Response) return retrieved;
  const brief = await briefing;
  const law = await lawing;
  const lawSent = law !== null && law.passages.length > 0;

  if (retrieved.chunks.length === 0 && !brief && !law?.passages.length) {
    return new Response(answerStream(fixedText(NOTHING_FOUND), () => ({ citations: [], dontKnow: true })), { headers: SSE_HEADERS });
  }

  // Proof tags in the case picture are citable too (the turn's cite book holds both).
  const turnInput: TurnInput = { question: input.question, chunks: retrieved.chunks, citable: retrieved.citable, brief, law: law?.passages ?? [], speakers: brief?.speakers ?? [], recommend: recommends(c.env), company: await company };
  const first = await firstAnswer(c, AI, turnInput, { groq, host, neuronsShort: gate.neuronsShort }, giveBack);
  if (first instanceof Response) return first;
  const { turn } = first;
  // A count only: which passage, and its text, never reach the log.
  if (turn.withheld > 0) console.error('ask_passages_withheld', turn.withheld);
  // Groq's fit takes law first: an answer whose prompt held no law is a record answer.
  const lawShown = lawSent && !(first.dropped && first.dropped.law > 0);

  const body = answerStream(
    turn.shape(retryDegenerate(first.start)),
    (answer) => ({
      ...turn.finish(answer),
      // Only when law reached the prompt: below the floor the answer is a record answer, exactly as before.
      ...(lawShown && law ? { law: validateLawCitations(answer, law.citable) } : {}),
    }),
    // `law: true` tells the browser to read [law:] tags as pending cites while the answer streams.
    { event: 'reading', data: { ...readingCounts(retrieved.chunks, retrieved.citable.size), ...(lawShown ? { law: true as const } : {}) } },
    (error) => (error instanceof DegenerateAnswer ? Promise.resolve() : giveBack()),
  );
  return new Response(body, { headers: SSE_HEADERS });
}

export const routes: Route[] = [{ method: 'POST', path: '/api/ask', handler: ask }];
