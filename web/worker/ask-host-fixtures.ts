// SPDX-License-Identifier: Apache-2.0
// A room's own host for tests (ask-host.test.ts, ask-host-route.test.ts, ask-provider.test.ts): an invented host and
// recorded-style streams, never a live call. The host name is a placeholder under example.com.

/** ASK_HOST with every condition of the gate met. */
export const HOST_ON = {
  enabled: true,
  zdr_confirmed: true,
  eval_runs: ['10000000002'],
  url: 'https://models.example.com/v1',
  model: 'example-org/open-model-70b',
};
export const HOST_KEY = 'host-key';
export const HOST_CHAT_URL = 'https://models.example.com/v1/chat/completions';

/**
 * An OpenAI-compatible stream as such hosts send it: a comment line some hosts send while they work, a reasoning delta
 * (never shown to the reader), content deltas, a finish_reason, a usage frame with no choices, and [DONE].
 */
export function hostSse(answer: string, finish = 'stop'): string {
  const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
  const pieces = [...answer.matchAll(/[\s\S]{1,6}/g)].map((m) => frame({ id: 'gen-1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: m[0] }, finish_reason: null }] }));
  return [
    ': host processing\n\n',
    frame({ id: 'gen-1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: '', reasoning: 'Thinking about the record.' }, finish_reason: null }] }),
    ...pieces,
    frame({ id: 'gen-1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: finish }] }),
    frame({ id: 'gen-1', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 4000, completion_tokens: 500, total_tokens: 4500 } }),
    'data: [DONE]\n\n',
  ].join('');
}
