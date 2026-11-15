// SPDX-License-Identifier: Apache-2.0
// Groq's stream for tests (ask-groq.test.ts, ask-provider.test.ts): never a live call.
import { GROQ_MODEL } from './ask-groq.ts';

/** Groq's stream as the OpenAI-compatible endpoint sends it: content deltas, a finish_reason, x_groq usage, [DONE]. */
export function groqSse(answer: string, finish = 'stop'): string {
  const pieces = [...answer.matchAll(/[\s\S]{1,6}/g)].map((m) => `data: ${JSON.stringify({ id: 'chatcmpl-1', object: 'chat.completion.chunk', model: GROQ_MODEL, choices: [{ index: 0, delta: { content: m[0] }, finish_reason: null }] })}\n\n`);
  const last = `data: ${JSON.stringify({ id: 'chatcmpl-1', choices: [{ index: 0, delta: {}, finish_reason: finish }], x_groq: { id: 'req_1', usage: { prompt_tokens: 5000, completion_tokens: 600, total_tokens: 5600 } } })}\n\n`;
  return pieces.join('') + last + 'data: [DONE]\n\n';
}
