// SPDX-License-Identifier: Apache-2.0
// The AI SDK model the tool steps call (steps.ts): createAI from agents/models/ai-sdk, which replaced the deprecated
// workers-ai-provider (#868), over a binding that keeps the metered binding's rules (spend.ts forwardedOptions).
//
// createAI names an AI Gateway on every binding call, "default" when none is set, and asks for the raw Response
// (agents 0.31.0, dist/images-*.js bindingTransport). AI Gateway would log prompts, so directBinding drops exactly that
// default, refuses any other gateway setting (ModelRefused, never silently stripped), forwards only an abort signal,
// and wraps the answer in the Response createAI reads. The bindings below it (tools/images.ts visionGate, ceiling.ts
// stepBinding, spend.ts meteredAi) still see Workers AI's own answers, usage included. Pure; never logs.
import { createAI } from 'agents/models/ai-sdk';
import { ModelRefused } from '../spend.ts';

/** The gateway id createAI names when none is set (agents' DEFAULT_GATEWAY_ID). */
export const DEFAULT_GATEWAY = 'default';

/** Whether `gateway` is createAI's default and nothing else: `{ id: 'default' }`. */
function onlyDefaultGateway(gateway: unknown): boolean {
  if (!gateway || typeof gateway !== 'object') return false;
  return Object.keys(gateway).length === 1 && (gateway as { id?: unknown }).id === DEFAULT_GATEWAY;
}

/**
 * The options createAI passes the binding, cut to what the binding below may get: an abort signal, or nothing (a
 * two-argument call). Throws ModelRefused for any gateway but the bare default, and for options that are not an object.
 */
export function directOptions(options: unknown): { signal: AbortSignal } | undefined {
  if (options === undefined || options === null) return undefined;
  if (typeof options !== 'object') throw new ModelRefused('options');
  const { gateway, signal } = options as { gateway?: unknown; signal?: unknown };
  if (gateway !== undefined && !onlyDefaultGateway(gateway)) throw new ModelRefused('gateway');
  return signal instanceof AbortSignal ? { signal } : undefined;
}

/** A binding's answer as the raw Response createAI asks for: a stream as server-sent events, any other as JSON. */
export function rawAnswer(answer: unknown): Response {
  if (answer instanceof ReadableStream) return new Response(answer, { headers: { 'content-type': 'text/event-stream' } });
  return Response.json(answer);
}

type Run = (model: string, input: unknown, options?: unknown) => Promise<unknown>;

/** `binding` as createAI's binding: directOptions on the way in, before anything is held; rawAnswer on the way out. */
export function directBinding(binding: Pick<Ai, 'run'>): Ai {
  const run = (binding.run as unknown as Run).bind(binding);
  const direct = async (model: string, input: unknown, options?: unknown) => {
    const forward = directOptions(options);
    return rawAnswer(forward ? await run(model, input, forward) : await run(model, input));
  };
  return { run: direct } as unknown as Ai;
}

/** The tool steps' model: `model`, a Workers AI (@cf/) id, from createAI over directBinding(binding). */
export function stepModel(binding: Pick<Ai, 'run'>, model: string) {
  return createAI({ binding: directBinding(binding) })(model as `@cf/${string}`);
}
