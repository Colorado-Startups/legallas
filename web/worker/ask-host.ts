// SPDX-License-Identifier: Apache-2.0
// The room's own model host for Ask (ASK_HOST): any host that serves an open-weight model behind an OpenAI-compatible
// `POST <url>/chat/completions`, OpenRouter among them. Off by default. When its gate is open (ask-gate.ts: enabled,
// zdr_confirmed, passing Replica eval runs on this host, a usable url and model, the Worker secret
// LEGALLAS_ASK_HOST_API_KEY, not local development), Ask sends every question's turn to this host instead of Workers
// AI (ask-provider.ts). Closed, Ask answers on Workers AI exactly as before. The room's documents then go to that
// host: web/ASK-MODEL.md tells the owner what that means and how to check the host's data retention.
//
// The room describes the host in wrangler.jsonc:
//   "ASK_HOST": { "enabled": false, "zdr_confirmed": false, "eval_runs": [], "url": "", "model": "", "body": {} }
// - url: the host's https base URL (https://openrouter.ai/api/v1), or its whole chat completions URL;
// - model: the host's name for the model;
// - body: optional extra request fields the host takes, such as OpenRouter's provider routing. It never replaces the
//   model, the messages, streaming or the completion ceiling (RESERVED).
// On openrouter.ai the request always carries `provider.zdr: true` and `provider.data_collection: "deny"`, so
// OpenRouter routes it only to endpoints with a zero-data-retention policy, or refuses it (openrouterZdr).
//
// Pure apart from the fetch it is handed, with no Workers types, so worker/ and scripts/ both import it.
import { backendConfig, backendGate, configRecord, type BackendConfig, type GateClosed, type GateOptions } from './ask-gate.ts';
import { chatStream, wireMessages, type ChatMessage, type Fetcher } from './ask-chat.ts';

/** The word the host's errors and logs start with (`host_http_503`): never its URL or name. */
export const HOST_LABEL = 'host';
/**
 * Completion tokens for one answer, reasoning included where the host counts it: Ask's own ceiling (ask.ts
 * MAX_TOKENS; ask-host.test.ts holds them equal). A cut answer streams `finish_reason: "length"` and shows as truncated.
 */
export const HOST_MAX_TOKENS = 16_384;
/** A wall-time ceiling on one call, streaming included: a slow host writing a whole long answer, with room. */
export const HOST_TIMEOUT_MS = 300_000;
/** The most `body` may hold, as JSON characters: room for a provider list, not for a prompt. */
export const HOST_BODY_CHARS = 2_000;
/** Request fields Ask sets itself; `body` may not carry them. */
export const RESERVED = ['model', 'messages', 'stream', 'stream_options', 'max_tokens', 'max_completion_tokens', 'n'] as const;
/** A host's model name: letters, digits and the punctuation hosts use (`meta-llama/llama-4-scout:nitro`), never a URL. */
const MODEL_NAME = /^(?!.*\/\/)[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;

/** ASK_HOST, read strictly. url, model and body are null when missing or unusable, which keeps the gate closed. */
export interface HostConfig extends BackendConfig {
  /** The chat completions URL. */
  url: string | null;
  model: string | null;
  body: Record<string, unknown> | null;
}

/**
 * The chat completions URL for a base URL (`<base>/chat/completions`), or for a URL that already ends so. Only https,
 * with no credentials, query or fragment; anything else is null.
 */
export function chatUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path.endsWith('/chat/completions') ? path : `${path}/chat/completions`}`;
}

/** `body` as a plain object of at most HOST_BODY_CHARS with no reserved field; absent is empty, anything else null. */
function extraFields(value: unknown): Record<string, unknown> | null {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (JSON.stringify(value).length > HOST_BODY_CHARS) return null;
  if (RESERVED.some((field) => Object.hasOwn(value, field))) return null;
  return value as Record<string, unknown>;
}

/** ASK_HOST as wrangler hands it over (a JSON object var) or as a JSON string. */
export function hostConfig(value: unknown): HostConfig {
  const record = configRecord(value);
  const model = typeof record.model === 'string' && MODEL_NAME.test(record.model.trim()) ? record.model.trim() : null;
  return { ...backendConfig(record), url: chatUrl(record.url), model, body: extraFields(record.body) };
}

/** The Worker's view of the host: the room config and the secret. */
export interface HostEnv {
  ASK_HOST?: unknown;
  LEGALLAS_ASK_HOST_API_KEY?: string;
}

/** What an open gate hands the answer: the key and where, with what, to send it. */
export interface HostTarget {
  url: string;
  model: string;
  body: Record<string, unknown>;
}

export type HostGate = ({ open: true; apiKey: string } & HostTarget) | { open: false; reason: GateClosed };

/** The shared gate (ask-gate.ts backendGate) for ASK_HOST and LEGALLAS_ASK_HOST_API_KEY. */
export function hostGate(env: HostEnv, options: Omit<GateOptions, 'usable'> = {}): HostGate {
  const config = hostConfig(env.ASK_HOST);
  const { url, model, body } = config;
  const usable = url !== null && model !== null && body !== null;
  const gate = backendGate(config, env.LEGALLAS_ASK_HOST_API_KEY, { ...options, usable });
  if (!gate.open) return gate;
  // An open gate means usable was true; this narrows the types.
  if (url === null || model === null || body === null) return { open: false, reason: 'bad_host' };
  return { ...gate, url, model, body };
}

/** OpenRouter (openrouter.ai and its regional hosts), whose router picks among many providers. */
export function isOpenRouter(url: string): boolean {
  const host = new URL(url).hostname;
  return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
}

/**
 * The room's provider routing with OpenRouter's zero-data-retention filter forced on: `zdr: true` routes only to
 * endpoints with a Zero Data Retention policy and `data_collection: "deny"` leaves out providers that keep or train on
 * data. OpenRouter refuses a request no allowed endpoint can serve. Read from OpenRouter's provider routing and ZDR
 * pages through a search on 2026-11-01 (the pages themselves did not load from the build machine; web/ASK-MODEL.md).
 */
export function openrouterZdr(provider: unknown): Record<string, unknown> {
  const own = provider && typeof provider === 'object' && !Array.isArray(provider) ? (provider as Record<string, unknown>) : {};
  return { ...own, zdr: true, data_collection: 'deny' };
}

/** The request body for one streamed answer on the host. */
export function hostInput(target: HostTarget, messages: readonly ChatMessage[], options: { maxTokens?: number } = {}) {
  return {
    ...target.body,
    ...(isOpenRouter(target.url) ? { provider: openrouterZdr(target.body.provider) } : {}),
    model: target.model,
    messages: wireMessages(messages),
    stream: true as const,
    max_tokens: options.maxTokens ?? HOST_MAX_TOKENS,
  };
}

/**
 * One streamed answer from the host (ask-chat.ts chatStream): throws ChatRefused on 429 and ChatUnavailable on any
 * other failure, each as `host_<what>` only. Never retries.
 */
export function hostChat(
  fetcher: Fetcher,
  target: { url: string; apiKey: string },
  input: ReturnType<typeof hostInput>,
  options: { signal?: AbortSignal } = {},
): Promise<ReadableStream<Uint8Array>> {
  return chatStream(fetcher, { url: target.url, apiKey: target.apiKey, label: HOST_LABEL, timeoutMs: HOST_TIMEOUT_MS }, input, options);
}
