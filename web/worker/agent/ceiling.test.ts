// SPDX-License-Identifier: Apache-2.0
// One research question's hard ceiling (ceiling.ts): the arithmetic for every model Ask may run, and the bindings
// that refuse a call before it could pass the ceiling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TOKENS, REASONING_EFFORT } from '../ask.ts';
import { FALLBACK_MODEL } from '../ask-model.ts';
import { WORKERS_AI_FREE_NEURONS, worstCaseNeurons } from '../budget.ts';
import { BudgetExhausted } from '../spend.ts';
import {
  CeilingReached,
  FINAL_INPUT_CHARS,
  FINAL_MAX_TOKENS,
  FINAL_MIN_TOKENS,
  FINAL_RESERVE,
  finalBinding,
  finalMaxTokens,
  finalModels,
  QuestionCeiling,
  RESEARCH_NEURON_CEILING,
  stepBinding,
  TOOL_BUDGET,
  TOOL_MAX_TOKENS,
} from './ceiling.ts';

const GLM = '@cf/zai-org/glm-5.3-flash';
const input = (chars: number, extra: Record<string, unknown> = {}) => ({ messages: [{ role: 'user', content: 'x'.repeat(chars) }], ...extra });

/** A binding that records calls; `fail` makes the next call throw that error. */
function fakeAi() {
  const calls: { model: string; input: Record<string, unknown>; args: number }[] = [];
  let fail: unknown = null;
  const ai = {
    async run(model: string, body: Record<string, unknown>, ...rest: unknown[]) {
      calls.push({ model, input: body, args: 2 + rest.length });
      if (fail) {
        const error = fail;
        fail = null;
        throw error;
      }
      return { ok: true };
    },
  };
  return { calls, ai: ai as unknown as Ai, failNext: (error: unknown) => (fail = error) };
}

test('the ceiling is about a fifth of the free day, and the final answer keeps its reserve', () => {
  assert.equal(RESEARCH_NEURON_CEILING, 2_000);
  assert.ok(RESEARCH_NEURON_CEILING * 4 < WORKERS_AI_FREE_NEURONS, 'room for quick Ask beside a few research questions');
  assert.equal(TOOL_BUDGET, RESEARCH_NEURON_CEILING - FINAL_RESERVE);
  assert.equal(FINAL_MAX_TOKENS, MAX_TOKENS, 'the same output ceiling as quick Ask');
});

test('every model Ask may run writes a full answer from the largest final prompt within the reserve', () => {
  const models = new Set([...Object.keys(REASONING_EFFORT), ...finalModels(GLM)]);
  for (const model of models) {
    const tokens = finalMaxTokens(model, FINAL_INPUT_CHARS, FINAL_RESERVE);
    assert.ok(tokens >= FINAL_MIN_TOKENS, `${model}: ${tokens} output tokens`);
    const worst = worstCaseNeurons(model, input(FINAL_INPUT_CHARS, { max_tokens: tokens }));
    assert.ok(worst <= FINAL_RESERVE, `${model}: ${worst} neurons`);
  }
  assert.equal(finalMaxTokens(GLM, FINAL_INPUT_CHARS, FINAL_RESERVE), FINAL_MAX_TOKENS, 'glm-5.3-flash keeps the whole output');
  assert.deepEqual(finalModels(FALLBACK_MODEL), [FALLBACK_MODEL]);
});

test('finalMaxTokens never lets the worst case pass what is left', () => {
  for (const model of [GLM, FALLBACK_MODEL]) {
    for (const left of [0, 1, 37, 400, 999, 1_200, 2_000]) {
      for (const chars of [0, 1_000, 20_000, FINAL_INPUT_CHARS]) {
        const tokens = finalMaxTokens(model, chars, left);
        if (tokens === 0) continue;
        assert.ok(worstCaseNeurons(model, input(chars, { max_tokens: tokens })) <= left, `${model} ${left} ${chars}`);
      }
    }
  }
});

test('tool steps hold within the tool budget, and the step past it is never called', async () => {
  const { calls, ai } = fakeAi();
  const ceiling = new QuestionCeiling();
  const binding = stepBinding(ai, ceiling);
  const step = input(30_000, { max_tokens: TOOL_MAX_TOKENS });
  let made = 0;
  for (let i = 0; i < 10; i++) {
    try {
      await binding.run(GLM as keyof AiModels, step as never);
      made++;
    } catch (error) {
      assert.ok(error instanceof CeilingReached);
      break;
    }
  }
  assert.ok(made >= 3, `${made} steps of a 30,000-character input fit`);
  assert.equal(calls.length, made);
  assert.ok(ceiling.held <= TOOL_BUDGET);
  assert.ok(ceiling.left >= FINAL_RESERVE, 'the final answer keeps its reserve');
});

test('the final binding sets max_tokens per model and keeps the call\'s shape', async () => {
  const { calls, ai } = fakeAi();
  const ceiling = new QuestionCeiling();
  await finalBinding(ai, ceiling).run(GLM as keyof AiModels, input(10_000, { stream: true, max_tokens: 16_384 }) as never);
  assert.equal(calls[0]!.args, 2, 'no options object added');
  assert.equal(calls[0]!.input.max_tokens, FINAL_MAX_TOKENS);
  assert.equal(calls[0]!.input.stream, true);
  assert.ok(ceiling.held <= RESEARCH_NEURON_CEILING);
});

test('a whole question never holds more than the ceiling, fallback included', async () => {
  const { calls, ai, failNext } = fakeAi();
  const ceiling = new QuestionCeiling();
  const steps = stepBinding(ai, ceiling);
  for (let i = 0; i < 8; i++) await steps.run(GLM as keyof AiModels, input(30_000, { max_tokens: TOOL_MAX_TOKENS }) as never).catch(() => undefined);
  const final = finalBinding(ai, ceiling);
  // The primary runs and fails after doing work (its hold stays); the fallback then gets only what is left.
  failNext(new Error('5xx: internal error'));
  await final.run(GLM as keyof AiModels, input(FINAL_INPUT_CHARS) as never).catch(() => undefined);
  await final.run(FALLBACK_MODEL as keyof AiModels, input(FINAL_INPUT_CHARS) as never).catch((error: unknown) => assert.ok(error instanceof CeilingReached));
  assert.ok(ceiling.held <= RESEARCH_NEURON_CEILING, `${ceiling.held}`);
  for (const call of calls.slice(-1)) assert.ok(typeof call.input.max_tokens === 'number');
});

test('a refusal before any work gives the hold back; the day\'s allowance is remembered for the turn', async () => {
  const { ai, failNext } = fakeAi();
  const ceiling = new QuestionCeiling();
  const binding = finalBinding(ai, ceiling);
  failNext(new Error('3040: Capacity temporarily exceeded'));
  await assert.rejects(binding.run(GLM as keyof AiModels, input(1_000) as never));
  assert.equal(ceiling.held, 0);
  failNext(new BudgetExhausted('neurons'));
  await assert.rejects(stepBinding(ai, ceiling).run(GLM as keyof AiModels, input(1_000, { max_tokens: TOOL_MAX_TOKENS }) as never), BudgetExhausted);
  assert.equal(ceiling.held, 0);
  assert.ok(ceiling.budget instanceof BudgetExhausted);
});

test('holds refuse junk amounts', () => {
  const ceiling = new QuestionCeiling();
  assert.equal(ceiling.hold(-1), false);
  assert.equal(ceiling.hold(Number.NaN), false);
  assert.equal(ceiling.hold(RESEARCH_NEURON_CEILING + 1), false);
  assert.equal(ceiling.hold(RESEARCH_NEURON_CEILING), true);
  assert.equal(ceiling.left, 0);
});
