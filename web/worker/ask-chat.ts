// SPDX-License-Identifier: Apache-2.0
// One streamed answer from an OpenAI-compatible chat endpoint (`POST <base>/chat/completions` with `stream: true`), the
// client both outside backends share: Groq (ask-groq.ts) and the room's own host (ASK_HOST, ask-host.ts). Case text
// reaches either only through ask-provider.ts's zero-data-retention gate; this file never decides that.
//
// No SDK, no proxy, no retry here (a blank answer is asked once more by ask-stream.ts retryDegenerate, as on Workers
// AI). The stream is OpenAI-style (`choices[0].delta.content`), which ask-stream.ts modelDeltas already reads. A 429 is
// a refusal (ChatRefused), made once and never retried in a loop. Errors and logs carry the endpoint's label and the
// HTTP status only, never a prompt, an answer, the endpoint's URL, its error body (it may quote the request) or the key.
//
// Pure apart from the fetch it is handed, with no Workers types, so worker/ and scripts/ both import it.

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/** Where one call goes. */
export interface ChatEndpoint {
  /** The chat completions URL. */
  url: string;
  apiKey: string;
  /** The word every error message starts with (`groq`, `host`): fixed, never taken from the config. */
  label: string;
  /** A wall-time ceiling on the whole call, streaming included. */
  timeoutMs: number;
}

/** The endpoint refused for its rate limits (429). The message is `<label>_http_429`. */
export class ChatRefused extends Error {
  override name = 'ChatRefused';
  /** The endpoint's retry-after in seconds, when it sent one. */
  readonly retryAfter: number | null;
  constructor(label: string, retryAfter: number | null) {
    super(`${label}_http_429`);
    this.retryAfter = retryAfter;
  }
}

/** Any other failed call: `<label>_http_<status>`, `<label>_fetch_failed` when no response came, `<label>_no_key`. */
export class ChatUnavailable extends Error {
  override name = 'ChatUnavailable';
}

/** retry-after as whole seconds, or null when absent or not a number of seconds. */
export function retryAfterSeconds(value: string | null): number | null {
  if (value === null || !/^\s*\d+(?:\.\d+)?\s*$/.test(value)) return null;
  return Math.max(1, Math.ceil(Number(value)));
}

/** Messages as they travel: role and content, nothing else a message object may carry. */
export const wireMessages = (messages: readonly ChatMessage[]) => messages.map(({ role, content }) => ({ role, content }));

/**
 * One streamed answer: the response body as text/event-stream. Throws ChatRefused on 429 and ChatUnavailable on
 * anything else that is not a streaming 200. Never retries. An empty key fails before any request, so the prompt
 * never leaves without one.
 */
export async function chatStream(
  fetcher: Fetcher,
  endpoint: ChatEndpoint,
  body: unknown,
  options: { signal?: AbortSignal } = {},
): Promise<ReadableStream<Uint8Array>> {
  const { label } = endpoint;
  const apiKey = endpoint.apiKey.trim();
  if (!apiKey) throw new ChatUnavailable(`${label}_no_key`);
  const timeout = AbortSignal.timeout(endpoint.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetcher(endpoint.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    throw new ChatUnavailable(`${label}_fetch_failed`);
  }
  if (response.status === 429) {
    await response.body?.cancel().catch(() => undefined);
    throw new ChatRefused(label, retryAfterSeconds(response.headers.get('retry-after')));
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new ChatUnavailable(`${label}_http_${response.status}`);
  }
  return response.body;
}
