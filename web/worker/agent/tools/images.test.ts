// SPDX-License-Identifier: Apache-2.0
// Visual PNGs for the tool steps (images.ts): the per-image floor, the gate that sends an image only within it and
// within what the tool phase has left, the question's ceiling with images, and the image's path through `ai` and
// createAI (../model.ts) as they really run (one step only, as an image part of a user message).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateText, stepCountIs, tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import { pngBytes } from '../../../mcp/tools/files-fixtures.ts';
import { REASONING_EFFORT } from '../../ask.ts';
import { inputChars, neuronsFor, tokensFromChars, worstCaseNeurons } from '../../budget.ts';
import { BudgetExhausted } from '../../spend.ts';
import { VISUAL_PNG_MAX_BYTES } from '../../visuals.ts';
import {
  FINAL_INPUT_CHARS,
  FINAL_RESERVE,
  finalBinding,
  finalModels,
  MAX_TOOL_STEPS,
  QuestionCeiling,
  RESEARCH_NEURON_CEILING,
  stepBinding,
  TOOL_BUDGET,
  TOOL_MAX_TOKENS,
} from '../ceiling.ts';
import {
  IMAGE_LABEL, IMAGE_NEURON_FLOOR, imageLabel, imagePlan, requestRefused, stepWithImages, VISION_MODELS, visionGate, visionTokens, withoutImages, type QueuedImage,
} from './images.ts';
import { stepModel } from '../model.ts';

const GLM = '@cf/zai-org/glm-5.3-flash';
const OSS = '@cf/openai/gpt-oss-120b';
/** The gate as it ran until 2026-11-05: glm-5.3-flash (retired 2026-11-15) is the model whose images visionTokens bounds. */
const LEGACY_VISION: ReadonlySet<string> = new Set([GLM]);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

/** A tool step's input as createAI sends it: text worth `chars`, then an image message for each PNG. */
function stepInput(chars: number, pngs: Uint8Array[] = []) {
  const images = pngs.map((png) => ({
    role: 'user',
    content: [{ type: 'text', text: imageLabel('R1') }, { type: 'image_url', image_url: { url: `data:image/png;base64,${b64(png)}` } }],
  }));
  return { messages: [{ role: 'user', content: 'x'.repeat(chars) }, ...images], max_tokens: TOOL_MAX_TOKENS };
}

/** What a call may really bill, at most: its text at CHARS_PER_TOKEN, each image at visionTokens, its whole output. */
function billedAtMost(model: string, input: { messages: { content: unknown }[]; max_tokens?: number }): number {
  let vision = 0;
  const text = {
    ...input,
    messages: input.messages.map((message) => {
      if (!Array.isArray(message.content)) return message;
      const parts = message.content.filter((part: { type: string }) => part.type !== 'image_url');
      for (const part of message.content as { type: string; image_url?: { url: string } }[]) {
        if (part.type !== 'image_url') continue;
        const header = Buffer.from(part.image_url!.url.split(',')[1]!, 'base64'); // safe: stepInput's data URLs
        vision += visionTokens(header.readUInt32BE(16), header.readUInt32BE(20));
      }
      return { ...message, content: parts };
    }),
  };
  return neuronsFor(model, tokensFromChars(inputChars(text)) + vision, input.max_tokens ?? 0);
}

/** A binding that records what reached it; `fail` makes the next call throw. */
function fakeAi() {
  const calls: { model: string; input: any }[] = [];
  let fail: unknown = null;
  const ai = {
    async run(model: string, input: unknown) {
      calls.push({ model, input });
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

const carried = (input: { messages: { content: unknown }[] }) =>
  input.messages.some((message) => Array.isArray(message.content) && message.content.some((part: { type: string }) => part.type === 'image_url'));

test('the floor is one step\'s share of the tool budget, and never reaches the final answer\'s reserve', () => {
  assert.equal(IMAGE_NEURON_FLOOR, 200);
  assert.equal(IMAGE_NEURON_FLOOR, Math.floor(TOOL_BUDGET / MAX_TOOL_STEPS));
  assert.equal(TOOL_BUDGET + FINAL_RESERVE, RESEARCH_NEURON_CEILING);
  assert.equal(visionTokens(1_000, 1_000), 4 * 36 * 36 + 16, 'four tokens per 28-pixel cell, plus markers');
  assert.equal(visionTokens(1, 1), visionTokens(112, 112), 'small images count as the size GLM scales them to');
  assert.deepEqual([...VISION_MODELS], [], 'off: Ask\'s model reads no images, and glm-5.3-flash retires on 2026-11-15');
});

test('an image is sent only within the floor: by bytes, by pixels, by what is left, and only to a vision model', async () => {
  const small = pngBytes(800, 600, 10_000);
  const plan = imagePlan(GLM, stepInput(6_000, [small]), 0, LEGACY_VISION);
  assert.ok(plan.send && plan.worst <= IMAGE_NEURON_FLOOR, JSON.stringify(plan));
  // Characters a step at the side files' own limit (VISUAL_PNG_MAX_BYTES): over the floor, so never sent.
  assert.deepEqual(imagePlan(GLM, stepInput(6_000, [pngBytes(800, 600, VISUAL_PNG_MAX_BYTES - 33)]), 0, LEGACY_VISION), { send: false });
  // Few bytes but many pixels: a flat strip whose vision tokens pass the floor although its characters do not.
  assert.deepEqual(imagePlan(GLM, stepInput(6_000, [pngBytes(40_000, 25, 64)]), 0, LEGACY_VISION), { send: false });
  // A flat page whose pixels need more than its characters count: sent, with the difference held on top.
  const flat = imagePlan(GLM, stepInput(6_000, [pngBytes(1_000, 1_000, 64)]), 0, LEGACY_VISION);
  assert.ok(flat.send && flat.topUp > 0, JSON.stringify(flat));
  assert.deepEqual(imagePlan(GLM, stepInput(6_000, [small]), TOOL_BUDGET - 120, LEGACY_VISION), { send: false }, 'the step alone fits; with the image it would not');
  assert.deepEqual(imagePlan(OSS, stepInput(6_000, [small]), 0, LEGACY_VISION), { send: false }, 'not a vision model');
  const jpeg = { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64(small)}` } }] }] };
  assert.deepEqual(imagePlan(GLM, jpeg, 0, LEGACY_VISION), { send: false }, 'only PNGs are read');

  // Through the gate: a step whose image does not fit still runs, without the image.
  const { calls, ai } = fakeAi();
  const ceiling = new QuestionCeiling();
  const steps = visionGate(stepBinding(ai, ceiling), ceiling, LEGACY_VISION);
  await steps.run(GLM as keyof AiModels, stepInput(6_000, [pngBytes(40_000, 25, 64)]) as never);
  assert.equal(calls.length, 1);
  assert.ok(!carried(calls[0]!.input));
  assert.ok(withoutImages(calls[0]!.input) === null);
  await steps.run(GLM as keyof AiModels, stepInput(6_000, [small]) as never);
  assert.ok(carried(calls[1]!.input), 'the image that fits goes as it is');
});

test('as shipped, no model gets an image: the step runs with the visual\'s text only', async () => {
  const small = pngBytes(800, 600, 10_000);
  for (const model of [OSS, GLM]) assert.deepEqual(imagePlan(model, stepInput(6_000, [small]), 0), { send: false }, model);
  const { calls, ai } = fakeAi();
  const ceiling = new QuestionCeiling();
  await visionGate(stepBinding(ai, ceiling), ceiling).run(OSS as keyof AiModels, stepInput(6_000, [small]) as never);
  assert.equal(calls.length, 1);
  assert.ok(!carried(calls[0]!.input), 'the image was taken out');
  assert.equal(ceiling.held, worstCaseNeurons(OSS, withoutImages(stepInput(6_000, [small]))), 'only the step without the image is held');
});

test('the gate holds the top-up before the call and gives it back when the call is refused unbilled', async () => {
  const { ai, failNext } = fakeAi();
  const ceiling = new QuestionCeiling();
  const steps = visionGate(stepBinding(ai, ceiling), ceiling, LEGACY_VISION);
  const input = stepInput(3_000, [pngBytes(1_000, 1_000, 64)]);
  const plan = imagePlan(GLM, input, 0, LEGACY_VISION);
  assert.ok(plan.send);
  await steps.run(GLM as keyof AiModels, input as never);
  assert.ok(ceiling.held >= plan.topUp + 1, 'the top-up and the step');
  assert.ok(ceiling.held >= billedAtMost(GLM, input), 'the hold covers the pixels, not just the characters');
  const before = ceiling.held;
  failNext(new Error('3040: Capacity temporarily exceeded'));
  await assert.rejects(steps.run(GLM as keyof AiModels, input as never));
  assert.equal(ceiling.held, before, 'nothing kept for a call refused before any work');
});

test('a step whose request is refused with its image goes once more without it; capacity and rate limits do not', async () => {
  const { calls, ai, failNext } = fakeAi();
  const ceiling = new QuestionCeiling();
  const steps = visionGate(stepBinding(ai, ceiling), ceiling, LEGACY_VISION);
  const input = stepInput(3_000, [pngBytes(800, 600, 5_000)]);
  failNext(new Error('400: Bad input: the image could not be read'));
  assert.deepEqual(await steps.run(GLM as keyof AiModels, input as never), { ok: true });
  assert.equal(calls.length, 2);
  assert.ok(carried(calls[0]!.input) && !carried(calls[1]!.input), 'the image went first, then the step without it');
  assert.equal(ceiling.held, worstCaseNeurons(GLM, withoutImages(input)), 'only the step without the image is held');
  assert.equal(requestRefused(new Error('413 Payload Too Large')), true);
  for (const error of [new Error('3040: Capacity temporarily exceeded'), new Error('429 Too Many Requests'), new Error('5006: internal error'), new BudgetExhausted('neurons')]) {
    assert.equal(requestRefused(error), false, error.message);
  }
  failNext(new Error('3040: Capacity temporarily exceeded'));
  await assert.rejects(steps.run(GLM as keyof AiModels, input as never));
  assert.equal(calls.length, 3, 'no second try');
});

test('an image step that reports more prompt tokens than its holds cover is logged once, by name only', async (t) => {
  const errors = t.mock.method(console, 'error', () => undefined);
  let reported = 0;
  const ai = { run: async () => ({ usage: { prompt_tokens: reported, completion_tokens: 0 } }) } as unknown as Ai;
  const ceiling = new QuestionCeiling();
  const steps = visionGate(stepBinding(ai, ceiling), ceiling, LEGACY_VISION);
  const input = stepInput(3_000, [pngBytes(800, 600, 5_000)]);
  const plan = imagePlan(GLM, input, 0, LEGACY_VISION);
  assert.ok(plan.send);
  reported = plan.tokens;
  await steps.run(GLM as keyof AiModels, input as never);
  assert.equal(errors.mock.callCount(), 0, 'within the hold');
  reported = plan.tokens + 1;
  await steps.run(GLM as keyof AiModels, input as never);
  assert.deepEqual(errors.mock.calls.map((call) => call.arguments), [['research_image_underheld']]);
});

test('a whole question with images never holds more than the ceiling, and every hold covers its bill', async () => {
  for (const finalModel of new Set([...Object.keys(REASONING_EFFORT), ...finalModels(GLM)])) {
    const { calls, ai } = fakeAi();
    const ceiling = new QuestionCeiling();
    const steps = visionGate(stepBinding(ai, ceiling), ceiling, LEGACY_VISION);
    const pages = [pngBytes(1_000, 1_000, 64), pngBytes(1_200, 800, 20_000), pngBytes(900, 900, 30_000), pngBytes(640, 480, 5_000)];
    for (let i = 0; i < MAX_TOOL_STEPS; i++) {
      await steps.run(GLM as keyof AiModels, stepInput(6_000 + 4_000 * i, [pages[i]!]) as never).catch(() => undefined);
    }
    assert.ok(calls.some((call) => carried(call.input)), 'at least one step carried an image');
    const toolBills = calls.reduce((sum, call) => sum + billedAtMost(call.model, call.input), 0);
    assert.ok(toolBills <= ceiling.held && ceiling.held <= TOOL_BUDGET, `${toolBills} <= ${ceiling.held} <= ${TOOL_BUDGET}`);
    const final = finalBinding(ai, ceiling);
    await final.run(finalModel as keyof AiModels, { messages: [{ role: 'user', content: 'x'.repeat(FINAL_INPUT_CHARS) }] } as never).catch(() => undefined);
    assert.ok(ceiling.held <= RESEARCH_NEURON_CEILING, `${finalModel}: ${ceiling.held}`);
    const bills = calls.reduce((sum, call) => sum + billedAtMost(call.model, call.input), 0);
    assert.ok(bills <= ceiling.held, `${finalModel}: billed at most ${bills}, held ${ceiling.held}`);
  }
});

test('stepWithImages: the newest image rides the next step only, and an earlier one is taken out', () => {
  const queue: QueuedImage[] = [{ alias: 'R1', png: pngBytes(10, 10) }, { alias: 'R2', png: pngBytes(20, 20) }];
  const base: ModelMessage[] = [{ role: 'user', content: 'What does the chart show?' }];
  const first = stepWithImages(base, queue);
  assert.equal(first.length, 2);
  assert.equal(queue.length, 0, 'the queue is emptied');
  const parts = first[1]!.content as { type: string; text?: string; mediaType?: string }[];
  assert.equal(parts[0]!.text, imageLabel('R2'));
  assert.equal(parts[1]!.mediaType, 'image/png');
  assert.deepEqual(stepWithImages(first, queue), base, 'gone from the step after');
  const member: ModelMessage = { role: 'user', content: [{ type: 'text', text: `${IMAGE_LABEL}is how the member began` }] };
  assert.deepEqual(stepWithImages([member], queue), [member], 'a text-only message is never taken for an image message');
});

test('through ai and createAI: the image goes as an image part of one step only, counted as images.ts counts it', async () => {
  const inputs: any[] = [];
  const queue: QueuedImage[] = [];
  const png = pngBytes(800, 600, 6_000);
  const replies = [
    { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'look', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] },
    { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 't2', type: 'function', function: { name: 'look', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] },
    { choices: [{ message: { role: 'assistant', content: 'DONE' }, finish_reason: 'stop' }] },
  ];
  const ai = { run: async (_model: string, input: unknown) => (inputs.push(input), { ...replies[inputs.length - 1], usage: { prompt_tokens: 0, completion_tokens: 0 } }) };
  const ceiling = new QuestionCeiling();
  let looked = 0;
  await generateText({
    model: stepModel(visionGate(stepBinding(ai as unknown as Ai, ceiling), ceiling, LEGACY_VISION), GLM),
    messages: [{ role: 'user', content: 'What does the chart show?' }],
    tools: { look: tool({ description: 'Look at R1.', inputSchema: z.object({}), execute: async () => (looked++ === 0 && queue.push({ alias: 'R1', png }), 'ok') }) },
    prepareStep: ({ messages }) => ({ messages: stepWithImages(messages, queue) }),
    stopWhen: stepCountIs(MAX_TOOL_STEPS),
    maxOutputTokens: TOOL_MAX_TOKENS,
    maxRetries: 0,
  });
  assert.equal(inputs.length, 3);
  assert.ok(!carried(inputs[0]) && carried(inputs[1]) && !carried(inputs[2]), 'the step after the tool call, and that one only');
  const message = inputs[1].messages.at(-1);
  assert.equal(message.role, 'user');
  assert.equal(message.content[0].text, imageLabel('R1'));
  assert.equal(message.content[1].image_url.url, `data:image/png;base64,${b64(png)}`);
  const plan = imagePlan(GLM, inputs[1], 0, LEGACY_VISION);
  assert.ok(plan.send);
  const chars = inputChars(inputs[1]) - inputChars(withoutImages(inputs[1]));
  assert.equal(chars, JSON.stringify(message.content[1]).length + imageLabel('R1').length, 'the label and the part, as budget.ts counts them');
});
