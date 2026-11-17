// SPDX-License-Identifier: Apache-2.0
// settings-apply.yml's Plan, run on expected-settings.json: the workflow's own jq program, taken from the workflow, so a
// setting it doesn't know or a value it won't apply fails here, on the pull request, instead of stopping a run on main.
//
//   node --test quality-speed/pages/settings/apply.test.ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const WORKFLOW = readFileSync(new URL('../../../.github/workflows/settings-apply.yml', import.meta.url), 'utf8');
const EXPECTED = readFileSync(new URL('./expected-settings.json', import.meta.url), 'utf8');

/** The Plan step's jq program, between `jq --arg target "$REPO" '` and `' "$file"`, with the YAML block's indent removed. */
function planProgram(): string {
  const start = WORKFLOW.indexOf(`jq --arg target "$REPO" '`);
  const end = WORKFLOW.indexOf(`' "$file" >"$RUNNER_TEMP/plan.json"`, start);
  assert.ok(start > 0 && end > start, 'the Plan step still holds one jq program');
  return WORKFLOW.slice(start + `jq --arg target "$REPO" '`.length, end);
}

interface Plan {
  problems: string[];
  plan: { id: string; want: unknown }[];
  left: string[];
}
function plan(file: string): Plan {
  const run = spawnSync('jq', ['--arg', 'target', 'Colorado-Startups/legallas', planProgram()], { input: file, encoding: 'utf8' });
  assert.equal(run.status, 0, `jq ran: ${run.stderr}`);
  return JSON.parse(run.stdout) as Plan;
}

test('the plan for the committed file has no problems, and leaves the security settings alone', () => {
  const p = plan(EXPECTED);
  assert.deepEqual(p.problems, []);
  const ids = p.plan.map((x) => x.id);
  for (const id of ['secret_scanning', 'secret_scanning_push_protection', 'dependabot_security_updates', 'repo_visibility', 'allow_forking']) {
    assert.equal(ids.includes(id), false, `${id} is never applied here`);
  }
  assert.deepEqual(p.plan.find((x) => x.id === 'web_commit_signoff_required')?.want, true);
});

test('a repo-level setting the workflow does not know, or a value it will not apply, stops the plan', () => {
  const e = JSON.parse(EXPECTED) as { settings: { id: string; read: string; expect: { op: string; value: unknown } }[] };
  const unknown = structuredClone(e);
  unknown.settings.push({ ...unknown.settings[0]!, id: 'some_new_field' });
  assert.deepEqual(plan(JSON.stringify(unknown)).problems, ['some_new_field: not a repo-level field this workflow knows']);
  const looser = structuredClone(e);
  looser.settings.find((s) => s.id === 'web_commit_signoff_required')!.expect.value = false;
  assert.deepEqual(plan(JSON.stringify(looser)).problems, ['web_commit_signoff_required: the value is not one this workflow applies']);
});
