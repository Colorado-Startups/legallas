// SPDX-License-Identifier: Apache-2.0
// The model call for Ask, made resilient. A model's rate limit is shared by the whole account (the eval replicas run
// on it too), and production Ask answered 503 model_unavailable to 3 of 5 questions while evals ran on GLM (W6 portal
// test, 2026-10-04). So a refused call is asked once more after a short pause when the refusal says capacity or
// availability, then handed to the fallback model, and only then given up. On the default model, which is the
// fallback, there is no second model: the retry, then 503.
//
// Every call is still `env.AI.run(model, input)` with no options object: no AI Gateway, no prompt logging
// (ask.test.ts pins it). Logs carry a short reason word, never the error message, a prompt or an answer.
// A spend refusal (spend.ts BudgetExhausted) is not a model failure: it is thrown at once, never retried or handed
// to the fallback, so the route can say the day's allowance is used.
import { generationInput } from './ask.ts';
import { BudgetExhausted } from './spend.ts';

/**
 * Ask's default model since 2026-11-05, and where a room on any other model goes when that one is refused, a retired
 * model included (DEPRECATED_MODELS, budget.ts). Its reasoning effort is in REASONING_EFFORT (ask.ts).
 */
export const FALLBACK_MODEL = '@cf/openai/gpt-oss-120b';
/** The pause before the one retry of a refused call. Wall time, not CPU time, so the 5 s CPU cap is not touched. */
export const MODEL_RETRY_MS = 800;

/** Why a call failed, as far as it may be logged: a capacity refusal (429, 3040), unavailability (5xx), or other. */
export type ModelFailure = 'capacity' | 'unavailable' | 'other';

export function modelFailure(error: unknown): ModelFailure {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/\b(?:429|3040)\b|capacity|too many requests|rate.?limit/i.test(text)) return 'capacity';
  if (/\b50[234]\b|unavailable|overloaded|timed? ?out|timeout/i.test(text)) return 'unavailable';
  return 'other';
}

/** Every model was refused; routes/ask.ts answers 503 model_unavailable and gives the question back. */
export class ModelUnavailable extends Error {
  override name = 'ModelUnavailable';
}

type Messages = Parameters<typeof generationInput>[0];

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One streaming answer: `primary`, once more after MODEL_RETRY_MS when it was refused for capacity or availability,
 * then FALLBACK_MODEL (each with its own generationInput, so its own reasoning effort). Throws ModelUnavailable when
 * all of them fail. Returns the stream and the model that is answering.
 */
export async function runModel(
  ai: Pick<Ai, 'run'>,
  primary: string,
  messages: Messages,
  wait: (ms: number) => Promise<void> = pause,
): Promise<{ stream: ReadableStream<Uint8Array>; model: string }> {
  const attempt = async (model: string) => ({
    stream: (await ai.run(model as keyof AiModels, generationInput(messages, model) as never)) as ReadableStream<Uint8Array>,
    model,
  });
  // A spend refusal leaves runModel at once; every other failure is classified for the retry and the fallback.
  const classify = (error: unknown): ModelFailure => {
    if (error instanceof BudgetExhausted) throw error;
    return modelFailure(error);
  };
  let failure: ModelFailure;
  try {
    return await attempt(primary);
  } catch (error) {
    failure = classify(error);
  }
  if (failure !== 'other') {
    console.error('ask_model_retry', failure);
    await wait(MODEL_RETRY_MS);
    try {
      return await attempt(primary);
    } catch (error) {
      failure = classify(error);
    }
  }
  if (primary !== FALLBACK_MODEL) {
    console.error('ask_model_fallback', failure);
    try {
      return await attempt(FALLBACK_MODEL);
    } catch (error) {
      failure = classify(error);
    }
  }
  console.error('ask_model_unavailable', failure);
  throw new ModelUnavailable(failure);
}
