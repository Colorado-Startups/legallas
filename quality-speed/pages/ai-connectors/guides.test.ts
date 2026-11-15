// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countSteps, NO_GUIDE_STEPS, section, stepsByAi, worstSteps } from './guides.ts';

test('a parent step counts by its children, a bold step with a list under it too', () => {
  const lines = ['1. Open it.', '2. Sign in:', '   1. Email.', '   2. Code.', '3. Ask.', '**1. Upload.** Wizard:', '1. Choose.', '2. Next.', '**2. Allow it.**', 'Prose with 4. inside.'];
  assert.equal(countSteps(lines), 2 + 2 + 2 + 1);
});

test('a section ends at the next heading of any level, and a missing heading is null', () => {
  const md = '# T\n## What you do\n1. A.\n2. B.\n### More\n1. C.\n';
  assert.deepEqual(section(md, 'What you do'), ['1. A.', '2. B.']);
  assert.equal(section(md, 'Nope'), null);
});

test('no open-weight.md counts 20 steps, the floor, so the metric reads 20, not missing', () => {
  const md = (file: string, sections: string[]) => [file, sections.map((h) => `## ${h}\n1. A.\n`).join('')] as const;
  const files = new Map<string, string | null>([
    md('web/connect/claude-ai.md', ['What you do']),
    md('web/connect/copilot.md', ['What you do', 'The Legallas agent for Microsoft 365']),
    md('web/connect/harvey.md', ['What you do', 'What your Harvey admin does once']),
  ]);
  const steps = stepsByAi(files);
  assert.equal(steps.claude, 1);
  assert.equal(steps.open_weight, NO_GUIDE_STEPS);
  assert.equal(worstSteps(steps), 20);
});

test('a guide missing a main-path section has no step count', () => {
  const steps = stepsByAi(new Map([['web/connect/copilot.md', '## What you do\n1. A.\n']]));
  assert.equal(steps.copilot, null);
  assert.equal(worstSteps(steps), null);
});

test('a section with no counted step reads missing, so steps rewritten as prose cannot read 0', () => {
  const files = new Map<string, string | null>([['web/connect/claude-ai.md', '## What you do\nOpen it, sign in and ask.\n']]);
  assert.equal(stepsByAi(files).claude, null);
});
