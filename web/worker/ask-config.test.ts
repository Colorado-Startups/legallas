// SPDX-License-Identifier: Apache-2.0
// Guards on Ask's model in wrangler.jsonc: a Cloudflare-hosted model with a reasoning effort chosen for it, neuron
// rates for it and its fallback, and no model Workers AI plans to retire. The rest of the Worker's configuration is
// pinned in config.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REASONING_EFFORT } from './ask.ts';
import { FALLBACK_MODEL } from './ask-model.ts';
import { DEPRECATED_MODELS, NEURON_RATES } from './budget.ts';
import { VISION_MODELS } from './agent/tools/images.ts';
import { readWranglerConfig } from './wrangler-config.ts';

// The room's wrangler.jsonc, or the example in a checkout without one.
const { config } = readWranglerConfig('wrangler');

test('Ask runs a Workers AI model with a reasoning effort chosen for it', () => {
  const model: string = config.vars.LEGALLAS_MODEL;
  assert.match(model, /^@cf\//, 'a Cloudflare-hosted model, so case text never leaves Cloudflare');
  assert.ok(Object.hasOwn(REASONING_EFFORT, model), `add ${model} to REASONING_EFFORT in worker/ask.ts`);
});

test('Ask\'s model and its fallback have neuron rates, so the spend budget holds what they really cost', () => {
  for (const model of [config.vars.LEGALLAS_MODEL as string, FALLBACK_MODEL]) {
    assert.ok(Object.hasOwn(NEURON_RATES, model), `add ${model} to NEURON_RATES in worker/budget.ts (Workers AI pricing page)`);
  }
});

test('no default names a model Workers AI plans to retire: Ask\'s model, its fallback, any model Ask may run, the vision models', () => {
  const retiring = (model: string) => (Object.hasOwn(DEPRECATED_MODELS, model) ? `${model} retires on ${DEPRECATED_MODELS[model]}` : null);
  const model: string = config.vars.LEGALLAS_MODEL;
  assert.equal(retiring(model), null, 'set LEGALLAS_MODEL to @cf/openai/gpt-oss-120b (web/ASK-MODEL.md)');
  assert.equal(retiring(FALLBACK_MODEL), null);
  for (const listed of [...Object.keys(REASONING_EFFORT), ...VISION_MODELS]) assert.equal(retiring(listed), null);
  for (const date of Object.values(DEPRECATED_MODELS)) assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
});
