// SPDX-License-Identifier: Apache-2.0
// Groq (GroqCloud; Groq LLC, Mountain View, California) as Ask's second model backend, for the hours after Workers
// AI's free daily neurons are spent (the owner, 2026-10-31). Case content may reach a third party only under zero data
// retention (SECURITY.md). Groq keeps no inference data once Zero Data Retention is on (console.groq.com > Settings >
// Data Controls); without it, it may keep inputs and outputs for up to 30 days (https://console.groq.com/docs/your-data,
// read 2026-10-31). The code cannot see that setting, so the room's config is the gate (ask-provider.ts groqGate).
//
// Groq is one case of an OpenAI-compatible host (ask-chat.ts, which the room's own host, ask-host.ts, uses too): this
// file holds only what is Groq's own. Its fixed endpoint and model, its free plan's limits (which ask-fit.ts trims the
// turn to), and its request body. One call per answer, no retry; a 429 means the free plan's limits are spent
// (GroqRefused): Ask answers with its out-of-budget message and never asks again in a loop. Logs and errors carry the
// HTTP status only, never a prompt, an answer or the key.
//
// Pure apart from the fetch it is handed, with no Workers types, so worker/ and scripts/ both import it.
import { CHARS_PER_TOKEN, inputChars, outputCeiling, tokensFromChars } from './budget.ts';
import { chatStream, ChatRefused, ChatUnavailable, wireMessages, type ChatMessage, type Fetcher } from './ask-chat.ts';

export { retryAfterSeconds, type ChatMessage, type Fetcher } from './ask-chat.ts';
/** Groq refused for its rate limits (429, `groq_http_429`): the free plan's minute or day is spent. Ask treats it as out of budget. */
export { ChatRefused as GroqRefused };
/** Any other failed Groq call: `groq_http_<status>`, `groq_fetch_failed` or `groq_no_key`. */
export { ChatUnavailable as GroqUnavailable };

export const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
/** The one model Ask runs on Groq. 131,072-token context, 65,536 output (console.groq.com/docs/model/openai/gpt-oss-120b). */
export const GROQ_MODEL = 'openai/gpt-oss-120b';

/**
 * The free plan's limits on openai/gpt-oss-120b, per organization: the org's limits page in the console, read
 * 2026-10-31; also console.groq.com/docs/rate-limits.
 */
export interface GroqLimits {
  requestsPerMinute: number;
  requestsPerDay: number;
  tokensPerMinute: number;
  tokensPerDay: number;
}
export const GROQ_LIMITS: Readonly<GroqLimits> = { requestsPerMinute: 30, requestsPerDay: 1_000, tokensPerMinute: 8_000, tokensPerDay: 200_000 };

/** Reasoning effort on Groq: what the replica eval chose for gpt-oss-120b on Workers AI (ask.ts REASONING_EFFORT). */
export const GROQ_REASONING_EFFORT = 'medium';
/**
 * Completion tokens for one answer, reasoning included. Ask's own 16,384 would not fit the 8,000-token minute: an
 * answer is usually 300 to 600 tokens and gpt-oss's medium reasoning a few hundred more. A cut answer streams with
 * `finish_reason: "length"`, which Ask shows as truncated (ask-stream.ts); the replica eval counts those calls.
 */
export const GROQ_MAX_COMPLETION_TOKENS = 2_048;
/** Room for the prompt estimate's error (CHARS_PER_TOKEN is an average) inside one minute's tokens. */
export const GROQ_TOKEN_MARGIN = 500;
/**
 * The prompt one Groq request may send, in estimated tokens. Groq's rate-limit page does not say whether its
 * tokens-per-minute check counts a request's completion ceiling before it runs, so it is assumed to (OpenAI's does):
 * the prompt, the whole ceiling and the margin fit one minute's tokens, and one request alone is never refused for
 * size. ask-fit.ts trims the turn to this.
 */
export const GROQ_PROMPT_TOKENS = GROQ_LIMITS.tokensPerMinute - GROQ_MAX_COMPLETION_TOKENS - GROQ_TOKEN_MARGIN;
/** The same in characters, at budget.ts CHARS_PER_TOKEN. */
export const GROQ_PROMPT_CHARS = GROQ_PROMPT_TOKENS * CHARS_PER_TOKEN;

/** A wall-time ceiling on one call: Groq streams a 2,048-token answer in seconds, so a minute means it is stuck. */
export const GROQ_TIMEOUT_MS = 60_000;

export type GroqEffort = 'low' | 'medium' | 'high';

/**
 * The request body for one streamed answer. `include_reasoning: false` leaves gpt-oss's reasoning out of the
 * stream: the reader never sees it (ask-stream.ts), so it need not cross the network either.
 */
export function groqInput(messages: readonly ChatMessage[], options: { effort?: GroqEffort | null; maxCompletionTokens?: number } = {}) {
  return {
    model: GROQ_MODEL,
    messages: wireMessages(messages),
    stream: true as const,
    max_completion_tokens: options.maxCompletionTokens ?? GROQ_MAX_COMPLETION_TOKENS,
    ...(options.effort === null ? {} : { reasoning_effort: options.effort ?? GROQ_REASONING_EFFORT }),
    include_reasoning: false,
  };
}

/**
 * The tokens one request may count against Groq's minute and day: its prompt estimate (budget.ts inputChars at
 * CHARS_PER_TOKEN) and its whole completion ceiling.
 */
export function groqRequestTokens(input: unknown): number {
  return tokensFromChars(inputChars(input)) + (outputCeiling(input) ?? GROQ_MAX_COMPLETION_TOKENS);
}

/**
 * One streamed answer from Groq: the response body as text/event-stream. Throws GroqRefused on 429 and
 * GroqUnavailable on anything else that is not a streaming 200 (ask-chat.ts chatStream). Never retries. An empty key
 * fails before any request, so the prompt never leaves without one.
 */
export function groqChat(
  fetcher: Fetcher,
  apiKey: string,
  input: ReturnType<typeof groqInput>,
  options: { signal?: AbortSignal } = {},
): Promise<ReadableStream<Uint8Array>> {
  return chatStream(fetcher, { url: GROQ_CHAT_URL, apiKey, label: 'groq', timeoutMs: GROQ_TIMEOUT_MS }, input, options);
}
