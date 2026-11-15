// SPDX-License-Identifier: Apache-2.0
// Which model backend answers an Ask question: Workers AI (LEGALLAS_MODEL, the default), the room's own host
// (ASK_HOST, ask-host.ts) or Groq (ask-groq.ts). Both outside backends pass the same gate first (ask-gate.ts:
// enabled, zero data retention confirmed, passing Replica eval runs named, a key, not local development); closed, Ask
// answers on Workers AI exactly as before.
// - The room's own host, when its gate is open, answers every question in place of Workers AI. It is the backend the
//   room chose, so its failure is model_unavailable (the question given back), never a quiet switch to another model.
// - Groq answers only once Workers AI's neurons for the day refused (the owner's decision of 2026-10-31 for the hours
//   after the day's neurons are spent: the free ones, then the paid month's room, budget.ts neuronLimit): the route's
//   spend pre-check found them short, or the metered binding's hold refused the call (spend.ts BudgetExhausted
//   'neurons'). The room config is ASK_GROQ { enabled, zdr_confirmed, eval_runs } with the Worker secret
//   LEGALLAS_ASK_GROQ_API_KEY; eval_runs names the Replica eval workflow runs that passed the release gate on Groq
//   (.github/workflows/replica-eval.yml, provider groq; web/README.md "Production releases"). `zdr_confirmed` is the
//   owner's word that Zero Data Retention is on in console.groq.com > Settings > Data Controls.
//
// On Groq the turn is fitted to Groq's free minute (ask-fit.ts) and sent once (a blank answer is asked once more, as
// ask-stream.ts retryDegenerate does on Workers AI); a 429 is the out-of-budget answer (BudgetExhausted 'neurons', so
// the route says the day's allowance is used), never a retry. On the room's host the whole turn is sent once, the same
// way. Logs carry reason words and counts only.
import { runModel, ModelUnavailable } from './ask-model.ts';
import { fitTurn, type Dropped } from './ask-fit.ts';
import { askTurn, type Turn, type TurnInput } from './ask-turn.ts';
import { groqChat, groqInput, GroqRefused, GroqUnavailable, GROQ_PROMPT_CHARS, type Fetcher } from './ask-groq.ts';
import { hostChat, hostInput, type HostGate } from './ask-host.ts';
import { ChatRefused, ChatUnavailable } from './ask-chat.ts';
import { backendConfig, backendGate, type BackendConfig, type Gate } from './ask-gate.ts';
import { BudgetExhausted } from './spend.ts';

export type AskProvider = 'workers-ai' | 'host' | 'groq';

/** The room config's ASK_GROQ, read strictly: only `true` is true, and only GitHub run ids count as eval runs. */
export type GroqConfig = BackendConfig;

/** ASK_GROQ as wrangler hands it over (a JSON object var) or as a JSON string; anything else is all off. */
export const groqConfig = (value: unknown): GroqConfig => backendConfig(value);

export type GroqGate = Gate;

/** The Worker's view of the gate: the room config and the secret. */
export interface GroqEnv {
  ASK_GROQ?: unknown;
  LEGALLAS_ASK_GROQ_API_KEY?: string;
}

/**
 * Whether Groq may answer: the shared gate (ask-gate.ts backendGate) for ASK_GROQ and LEGALLAS_ASK_GROQ_API_KEY:
 * enabled, zero data retention confirmed, at least one passing Groq eval run named, and a key, checked in that order so
 * the log names the first thing missing. The caller passes `local` for local development without
 * LEGALLAS_DEV_REMOTE_AI (routes/ask.ts), which never reaches Groq, as the billed bindings refuse there too; the mocks
 * in ask-mock.ts are the free way to develop.
 */
export function groqGate(env: GroqEnv, options: { local?: boolean } = {}): GroqGate {
  return backendGate(groqConfig(env.ASK_GROQ), env.LEGALLAS_ASK_GROQ_API_KEY, options);
}

/** The answer's backend, the turn whose messages it was sent (Groq's is fitted) and its streams. */
export interface ProviderAnswer {
  provider: AskProvider;
  turn: Turn;
  /** Returns the first call's stream once, then makes a fresh call each time (ask-stream.ts retryDegenerate). */
  start: () => Promise<ReadableStream<Uint8Array>>;
  /** What fitting the turn to Groq took out; absent on Workers AI and the room's host. Counts only. */
  dropped?: Dropped;
}

export interface AnswerDeps {
  /** The metered Workers AI binding (spend.ts withSpendGuards), so a spent day refuses with BudgetExhausted. */
  ai: Parameters<typeof runModel>[0];
  /** LEGALLAS_MODEL. */
  model: string;
  input: TurnInput;
  gate: GroqGate;
  /** The room's own host (ask-host.ts hostGate); absent or closed, Ask answers as it did without one. */
  host?: HostGate;
  /** fetch, for Groq and the room's host. */
  fetcher: Fetcher;
  /** The route's spend pre-check found today's neurons short: Workers AI is not asked at all. */
  neuronsShort?: boolean;
  /** Passed to askTurn for both backends (tests pin the boundary). */
  turnOptions?: Parameters<typeof askTurn>[1];
  /** runModel's pause before its retry (tests pass one that does not wait). */
  wait?: Parameters<typeof runModel>[3];
}

const isNeuronRefusal = (error: unknown): boolean => error instanceof BudgetExhausted && error.meter === 'neurons';

/** A start() that hands back `first` once and then calls `again`. */
function startWith(first: ReadableStream<Uint8Array>, again: () => Promise<ReadableStream<Uint8Array>>): () => Promise<ReadableStream<Uint8Array>> {
  let held: ReadableStream<Uint8Array> | null = first;
  return async () => {
    const stream = held ?? (await again());
    held = null;
    return stream;
  };
}

/**
 * The answer's first model call. The room's own host when its gate is open (throws ModelUnavailable when it fails).
 * Otherwise Workers AI first, unless `neuronsShort` (runModel: one retry, then the fallback model); when its neurons
 * refuse and the gate is open, Groq with the fitted turn. Throws BudgetExhausted('neurons') when the neurons are spent
 * and Groq is closed or refuses (429), ModelUnavailable when every backend failed otherwise, and any other error as it
 * came (LocalSpendOff, an AI Search meter).
 */
export async function answerWith(deps: AnswerDeps): Promise<ProviderAnswer> {
  if (deps.host?.open) return hostAnswer(deps, deps.host);
  if (!deps.neuronsShort) {
    const turn = askTurn(deps.input, deps.turnOptions);
    try {
      const first = await runModel(deps.ai, deps.model, turn.messages, deps.wait);
      return { provider: 'workers-ai', turn, start: startWith(first.stream, async () => (await runModel(deps.ai, deps.model, turn.messages, deps.wait)).stream) };
    } catch (error) {
      if (!isNeuronRefusal(error)) throw error;
    }
  }
  if (!deps.gate.open) {
    console.error('ask_groq_closed', deps.gate.reason);
    throw new BudgetExhausted('neurons');
  }
  return groqAnswer(deps, deps.gate.apiKey);
}

async function groqAnswer(deps: AnswerDeps, apiKey: string): Promise<ProviderAnswer> {
  const fit = fitTurn(deps.input, GROQ_PROMPT_CHARS);
  if (!fit.fits) {
    console.error('ask_groq_prompt_too_long');
    throw new ModelUnavailable('groq_prompt_too_long');
  }
  const turn = askTurn(fit.input, deps.turnOptions);
  const call = () => groqChat(deps.fetcher, apiKey, groqInput(turn.messages));
  // Counts only: how much of the turn Groq's minute left out.
  const { law, passages, briefLines, brief, pages } = fit.dropped;
  console.error('ask_groq_answer', law, passages, briefLines, brief ? 1 : 0, pages);
  let first: ReadableStream<Uint8Array>;
  try {
    first = await call();
  } catch (error) {
    if (error instanceof GroqRefused) {
      console.error('ask_groq_refused');
      throw new BudgetExhausted('neurons');
    }
    console.error('ask_groq_unavailable', error instanceof GroqUnavailable ? error.message : error instanceof Error ? error.name : typeof error);
    throw new ModelUnavailable('groq_unavailable');
  }
  return { provider: 'groq', turn, start: startWith(first, call), dropped: fit.dropped };
}

/**
 * The room's own host: the whole turn, sent once (a blank answer is asked once more through start()). Any failure, a
 * 429 included, is model_unavailable: the room chose this host, so Ask never answers on another model instead, and the
 * question is given back. Logged as `host_<what>` only, never the host's URL, its error body or the key.
 */
async function hostAnswer(deps: AnswerDeps, host: Extract<HostGate, { open: true }>): Promise<ProviderAnswer> {
  const turn = askTurn(deps.input, deps.turnOptions);
  const call = () => hostChat(deps.fetcher, host, hostInput(host, turn.messages));
  let first: ReadableStream<Uint8Array>;
  try {
    first = await call();
  } catch (error) {
    // chatStream's messages are fixed words and a status (host_http_429, host_fetch_failed); anything else is one word.
    console.error('ask_host_unavailable', error instanceof ChatRefused || error instanceof ChatUnavailable ? error.message : 'host_failed');
    throw new ModelUnavailable('host_unavailable');
  }
  return { provider: 'host', turn, start: startWith(first, call) };
}
