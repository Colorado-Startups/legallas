// SPDX-License-Identifier: Apache-2.0
// The bindings a research turn uses: metered in production (spend.ts), and free canned ones for local development
// when ASK_MOCK is "1" and the request came to localhost, exactly like quick Ask's mock (worker/ask-mock.ts). The
// mock speaks the real wire formats, so the real tools, evidence book, cite book and checks all run: its tool-step
// model searches for the question, reads the first two pages of the first document found, then says DONE; the final
// answer, the record search and the law library are quick Ask's own mocks.
import { askBindings, askMockEnabled } from '../ask-mock.ts';
import type { Env } from '../env.ts';
import { lawLibrary } from '../law-mock.ts';
import { withSpendGuards, type WaitUntil } from '../spend.ts';
import type { ResearchToolEnv } from './tools/adapters.ts';

/** What one turn calls: the tool steps' model, the final answer's model, and the tools' bindings. */
export interface ResearchBindings {
  stepAi: Pick<Ai, 'run'>;
  finalAi: Pick<Ai, 'run'>;
  tools: ResearchToolEnv;
  mocked: boolean;
}

/** The env a research turn reads. */
export type ResearchEnv = Pick<
  Env,
  | 'DB'
  | 'INDEX'
  | 'FILES'
  | 'AI'
  | 'SEARCH'
  | 'LEGALLAS_MODEL'
  | 'DAILY_QUESTION_CAP'
  | 'RESEARCH_ENABLED'
  | 'ASK_LIMIT'
  | 'CONTROL_PREFIX'
  | 'ASSISTANT_NAME'
  | 'ASK_VISUALS'
  | 'RECOMMEND'
  | 'COMPANY_ROOM_ENABLED'
  | 'ASK_MOCK'
  | 'LEGALLAS_DEV_REMOTE_AI'
  | 'LAW_LIBRARY'
  | 'LAW'
  | 'LAW_SEARCH'
  | 'PUBLIC_RECORDS'
  | 'PUBLIC_RECORDS_CONTACT'
  | 'COURTLISTENER_TOKEN'
  | 'PROPOSALS_ENABLED'
>;

/** A stand-in request for the mocks' localhost check: the Durable Object only knows whether the member came locally. */
const LOCAL = new Request('http://localhost/');
const REMOTE = new Request('https://research.invalid/');

/** One tool call in Workers AI's chat-completions shape (non-streaming, what generateText asks for). */
function toolCall(name: string, args: Record<string, unknown>) {
  return {
    choices: [
      {
        message: { role: 'assistant', content: null, tool_calls: [{ id: `mock-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  };
}

/** The canned tool-step model: search for the question, read the first document found, then DONE. */
export function mockStepAi(): Pick<Ai, 'run'> {
  const run = async (_model: string, input: { messages?: { role: string; content?: unknown }[] }) => {
    const messages = input.messages ?? [];
    const results = messages.filter((message) => message.role === 'tool').length;
    const question = String([...messages].reverse().find((message) => message.role === 'user')?.content ?? '');
    if (results === 0) return toolCall('legallas_search', { query: question.slice(0, 200) || 'documents' });
    if (results === 1) return toolCall('legallas_read_pages', { id: 'R1', from: 1, to: 2 });
    return { choices: [{ message: { role: 'assistant', content: 'DONE' }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0 } };
  };
  return { run } as unknown as Pick<Ai, 'run'>;
}

/**
 * The bindings for one turn. `local` is whether the member's request came to localhost (wrangler dev): there the mock
 * answers when ASK_MOCK is "1", and the billed bindings refuse unless LEGALLAS_DEV_REMOTE_AI is "1" (spend.ts).
 */
export function researchBindings(env: ResearchEnv, options: { local: boolean; waitUntil?: WaitUntil }): ResearchBindings {
  const records = { PUBLIC_RECORDS: env.PUBLIC_RECORDS, PUBLIC_RECORDS_CONTACT: env.PUBLIC_RECORDS_CONTACT, COURTLISTENER_TOKEN: env.COURTLISTENER_TOKEN };
  const base = { DB: env.DB, INDEX: env.INDEX, FILES: env.FILES, CONTROL_PREFIX: env.CONTROL_PREFIX, ASSISTANT_NAME: env.ASSISTANT_NAME, ASK_VISUALS: env.ASK_VISUALS, LAW: env.LAW, LAW_LIBRARY: env.LAW_LIBRARY, PROPOSALS_ENABLED: env.PROPOSALS_ENABLED, ...records };
  const request = options.local ? LOCAL : REMOTE;
  if (askMockEnabled(request, env)) {
    const mock = askBindings(request, env as Env);
    const law = lawLibrary(request, env as Env);
    return {
      stepAi: mockStepAi(),
      finalAi: mock.AI,
      tools: { ...base, SEARCH: mock.SEARCH, ...(law ? { LAW: law.bucket, LAW_SEARCH: law.search } : { LAW_LIBRARY: '0' }) },
      mocked: true,
    };
  }
  const metered = withSpendGuards(env, { waitUntil: options.waitUntil, local: options.local });
  return {
    stepAi: metered.AI,
    finalAi: metered.AI,
    tools: { ...base, SEARCH: metered.SEARCH, ...(metered.LAW_SEARCH ? { LAW_SEARCH: metered.LAW_SEARCH } : {}) },
    mocked: false,
  };
}
