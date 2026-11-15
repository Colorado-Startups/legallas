// SPDX-License-Identifier: Apache-2.0
// The hard ceiling on one research question (the owner, 2026-10-20: no usage billing; Legallas's AI lives inside Workers
// AI's free 10,000 neurons a day, shared with quick Ask, and budget.ts stops the Workers at 9,000). A question may
// hold at most RESEARCH_NEURON_CEILING neurons in all, counted as the worst case meteredAi holds for each call
// (budget.ts worstCaseNeurons): the tool steps share what is left after FINAL_RESERVE, and the final answer gets the
// rest, its max_tokens cut per model so even the fallback model fits. So the bound holds before any call is made,
// whatever the model writes; ceiling.test.ts pins the arithmetic.
//
// Pure apart from wrapping a binding; never logs.
import { FALLBACK_MODEL } from '../ask-model.ts';
import { inputChars, neuronRate, neuronsFor, tokensFromChars, worstCaseNeurons } from '../budget.ts';
import { BudgetExhausted, refusedUnbilled } from '../spend.ts';

/** The most one research question may hold, in neurons: about a fifth of the Workers' day. */
export const RESEARCH_NEURON_CEILING = 2_000;
/** Kept for the final answer: the tool steps may hold only what is left. */
export const FINAL_RESERVE = 1_200;
/** What the tool steps may hold together. */
export const TOOL_BUDGET = RESEARCH_NEURON_CEILING - FINAL_RESERVE;

/** Model calls that choose tools, at most. */
export const MAX_TOOL_STEPS = 4;
/** Tool calls in one question, at most, across every step. */
export const MAX_TOOL_CALLS = 6;
/** Searches of the record or the law library in one question, at most. */
export const MAX_SEARCHES = 4;
/** Output tokens for a tool step: low reasoning plus a tool call. */
export const TOOL_MAX_TOKENS = 1_536;
/** A tool result as the tool-step model reads it, at most (tools/compact.ts trims to it). */
export const TOOL_RESULT_CHARS = 5_000;

/** The final answer's whole input (rules, case picture, passages, law, question), at most: about 15,000 tokens. */
export const FINAL_INPUT_CHARS = 45_000;
/** The final answer's output tokens, at most: quick Ask's MAX_TOKENS (worker/ask.ts). */
export const FINAL_MAX_TOKENS = 16_384;
/** Fewer output tokens than this would not leave room for an answer at high reasoning effort. */
export const FINAL_MIN_TOKENS = 4_096;

/** A call would pass the question's ceiling, so it is not made. Never a model failure: the turn moves on or stops. */
export class CeilingReached extends Error {
  override name = 'CeilingReached';
}

/** The neurons one research question has held, against RESEARCH_NEURON_CEILING. */
export class QuestionCeiling {
  #held = 0;
  /** Set when the day's Workers AI allowance refused a call (spend.ts), so the turn says so instead of failing. */
  budget: BudgetExhausted | null = null;
  /** Which phase the ceiling stopped, if it did: the tool steps end there, and the final answer cannot start. */
  stopped: 'tools' | 'final' | null = null;

  get held(): number {
    return this.#held;
  }

  /** What the question may still hold. */
  get left(): number {
    return RESEARCH_NEURON_CEILING - this.#held;
  }

  /** Holds `neurons` if the total stays within `limit` (the tool phase's, or the whole ceiling); false otherwise. */
  hold(neurons: number, limit: number = RESEARCH_NEURON_CEILING): boolean {
    if (!Number.isFinite(neurons) || neurons < 0 || this.#held + neurons > limit) return false;
    this.#held += neurons;
    return true;
  }

  /** Gives back a hold for a call the binding refused before any work (spend.ts refusedUnbilled). */
  release(neurons: number): void {
    this.#held = Math.max(0, this.#held - neurons);
  }
}

/**
 * The final answer's max_tokens for `model` with `chars` of input and `left` neurons still free: as many output tokens
 * as that pays for at the model's rate, at most FINAL_MAX_TOKENS. worstCaseNeurons of the call then stays within
 * `left`, because both round the same way.
 */
export function finalMaxTokens(model: string, chars: number, left: number): number {
  const rate = neuronRate(model);
  if (rate.output === 0) return FINAL_MAX_TOKENS;
  const room = left - neuronsFor(model, tokensFromChars(chars), 0);
  return Math.max(0, Math.min(FINAL_MAX_TOKENS, Math.floor((room * 1_000_000) / rate.output)));
}

type Run = (model: string, input: unknown, options?: unknown) => Promise<unknown>;

/** Calls `run` with the same number of arguments it was given, so a two-argument call stays one. */
function forward(run: Run, model: string, input: unknown, rest: unknown[]): Promise<unknown> {
  return rest.length > 0 ? run(model, input, rest[0]) : run(model, input);
}

/** Notes on `ceiling` which phase it stopped, and returns the error to throw. */
function stop(ceiling: QuestionCeiling, phase: 'tools' | 'final'): CeilingReached {
  ceiling.stopped = phase;
  return new CeilingReached(phase);
}

/** Holds `hold` on `ceiling`, makes the call, and gives the hold back when the binding refused before any work. */
async function held(ceiling: QuestionCeiling, hold: number, call: () => Promise<unknown>): Promise<unknown> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof BudgetExhausted) ceiling.budget = error;
    if (error instanceof BudgetExhausted || refusedUnbilled(error)) ceiling.release(hold);
    throw error;
  }
}

/**
 * The binding the tool steps call (through createAI, model.ts): each call holds its worst case within TOOL_BUDGET,
 * or throws CeilingReached without calling.
 */
export function stepBinding(ai: Pick<Ai, 'run'>, ceiling: QuestionCeiling): Pick<Ai, 'run'> {
  const run = ai.run as unknown as Run;
  const step = async (model: string, input: unknown, ...rest: unknown[]) => {
    const hold = worstCaseNeurons(model, input);
    if (!ceiling.hold(hold, TOOL_BUDGET)) throw stop(ceiling, 'tools');
    return held(ceiling, hold, () => forward(run.bind(ai), model, input, rest));
  };
  return { run: step } as unknown as Pick<Ai, 'run'>;
}

/**
 * The binding the final answer calls (through ask-model.ts runModel, primary then fallback): max_tokens is set to what
 * the question has left for that model (finalMaxTokens), and a call that cannot get FINAL_MIN_TOKENS is not made.
 */
export function finalBinding(ai: Pick<Ai, 'run'>, ceiling: QuestionCeiling): Pick<Ai, 'run'> {
  const run = ai.run as unknown as Run;
  const final = async (model: string, input: unknown, ...rest: unknown[]) => {
    const maxTokens = finalMaxTokens(model, inputChars(input), ceiling.left);
    if (maxTokens < FINAL_MIN_TOKENS) throw stop(ceiling, 'final');
    const capped = { ...(input as Record<string, unknown>), max_tokens: maxTokens };
    const hold = worstCaseNeurons(model, capped);
    if (!ceiling.hold(hold)) throw stop(ceiling, 'final');
    return held(ceiling, hold, () => forward(run.bind(ai), model, capped, rest));
  };
  return { run: final } as unknown as Pick<Ai, 'run'>;
}

/** The models a final answer may run, for the ceiling's pins: Ask's model and the fallback runModel hands over to. */
export function finalModels(primary: string): string[] {
  return primary === FALLBACK_MODEL ? [primary] : [primary, FALLBACK_MODEL];
}
