// SPDX-License-Identifier: Apache-2.0
// The workflow checks and the drill. The workflows below are invented; the last tests run the plants that need no
// download against this repository's own gates, in throwaway folders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ciOkPlants, localPlants, wiringPlants } from './drill.ts';
import { Unreadable } from './measure.ts';
import { isPinned, jobBlocks, jobNeeds, jobsWithTimeout, knownJobs, readWorkflows, runBlock, unpinnedDependencies } from './workflows.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SHA = 'a'.repeat(40);
const file = (text: string, name = 'a.yml') => ({ name, text });

const SAMPLE = `name: Sample
on: pull_request

jobs:
  first:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@${SHA} # v7
      - name: Hello
        run: echo hello
  # A comment between jobs.
  second:
    needs: [first, third]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
      - name: Decide
        env:
          RESULT: success
        run: |
          if [ "$RESULT" != "success" ]; then
            exit 1
          fi
          # The last line.
  third:
    runs-on: ubuntu-latest
    timeout-minutes: 1
    steps:
      - run: curl -fsSL https://example.invalid/install.sh | bash -s -- 1.0
`;

test('jobs are the keys under jobs:', () => {
  assert.deepEqual([...jobBlocks(SAMPLE).keys()], ['first', 'second', 'third']);
});

test('a job with no limit of its own is counted against the share', () => {
  const reading = jobsWithTimeout([file(SAMPLE)]);
  assert.ok(reading);
  assert.equal(reading.samples, 3);
  assert.ok(Math.abs(reading.value - (2 / 3) * 100) < 1e-9);
  assert.equal(jobsWithTimeout([file('name: None\n')]), null);
});

test('a step-level timeout does not count as the job\'s, and neither does a limit too long to protect anything', () => {
  const stepOnly = 'jobs:\n  one:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n        timeout-minutes: 3\n';
  assert.deepEqual(jobsWithTimeout([file(stepOnly)]), { value: 0, samples: 1 });
  assert.deepEqual(jobsWithTimeout([file('jobs:\n  one:\n    timeout-minutes: 360\n')]), { value: 0, samples: 1 });
  assert.deepEqual(jobsWithTimeout([file('jobs:\n  one:\n    timeout-minutes: 60\n')]), { value: 100, samples: 1 });
});

test('a job with a comment on its line is still a job', () => {
  assert.deepEqual([...jobBlocks('jobs:\n  one: # the first\n    runs-on: x\n  two:\n    runs-on: x\n').keys()], ['one', 'two']);
});

test('only a full SHA, a local action or an image digest is pinned', () => {
  assert.ok(isPinned(`actions/checkout@${SHA}`));
  assert.ok(isPinned('./.github/actions/local'));
  assert.ok(isPinned(`docker://alpine@sha256:${'b'.repeat(64)}`));
  assert.equal(isPinned('actions/checkout@v4'), false);
  assert.equal(isPinned(`actions/checkout@${'a'.repeat(39)}`), false);
  assert.equal(isPinned('docker://alpine:3'), false);
});

test('unpinned counts tags and downloads piped into a shell, in workflows and scripts, not in comments', () => {
  const script = file('#!/bin/sh\n# curl https://example.invalid | sh in a comment\ncurl -fsSL https://example.invalid/x.tgz -o x.tgz\nbash <(curl -s https://example.invalid/y)\n', 'a.sh');
  assert.deepEqual(unpinnedDependencies([file(SAMPLE)], [script]), { value: 3, samples: 4 });
  assert.deepEqual(unpinnedDependencies([file(`    steps:\n      - uses: a/b@${SHA}\n`)], []), { value: 0, samples: 1 });
});

test('needs and the run block come out as written', () => {
  const blocks = jobBlocks(SAMPLE);
  assert.deepEqual(jobNeeds(blocks.get('second') ?? []), ['first', 'third']);
  assert.deepEqual(jobNeeds(blocks.get('first') ?? []), []);
  const script = runBlock(blocks.get('second') ?? []);
  assert.ok(script?.startsWith('if [ "$RESULT" != "success" ]; then\n  exit 1\nfi'));
  assert.equal(runBlock(blocks.get('first') ?? []), null);
});

test('known jobs are a workflow\'s job ids and plain names, never an expression', () => {
  const text = 'jobs:\n  one:\n    name: First Job\n  two:\n    name: Lane \${{ matrix.x }}\n';
  assert.deepEqual([...knownJobs([file(text, 'my-flow.yml')])].sort(), ['my-flow_first-job', 'my-flow_one', 'my-flow_two']);
});

test('this repository\'s workflows give readings, and this site\'s own stays out', () => {
  const workflows = readWorkflows(ROOT);
  assert.ok(workflows.some((f) => f.name === 'ci.yml'));
  assert.equal(workflows.some((f) => f.name.startsWith('quality-speed')), false);
  assert.ok((jobsWithTimeout(workflows)?.samples ?? 0) > 5);
});

const ciOkWith = (run: string) => [file(`jobs:\n  checks:\n    runs-on: x\n  ci-ok:\n    needs: [checks]\n    steps:\n      - name: Decide\n        env:\n          CHECKS: \${{ needs.checks.result }}\n          SWIFT: \${{ needs.swift.result }}\n        run: |\n          ${run}\n`, 'ci.yml')];

test('a ci-ok that lets anything through fails its plants', () => {
  const plants = ciOkWith('exit 0').flatMap((f) => ciOkPlants([f]));
  assert.ok(plants.length >= 6);
  assert.ok(plants.every((plant) => !plant.caught));
});

test('a ci-ok that always fails is a broken control, not a perfect catch', () => {
  assert.throws(() => ciOkPlants(ciOkWith('exit 1')), Unreadable);
});

test('a ci-ok that reads no results has nothing to plant', () => {
  assert.throws(() => ciOkPlants([file('jobs:\n  ci-ok:\n    steps:\n      - run: |\n          exit 0\n', 'ci.yml')]), Unreadable);
});

test('a new gate joins the drill by itself, and one ci-ok ignores fails its plant', () => {
  const lines = (env: string) => `jobs:\n  checks:\n    runs-on: x\n  new-gate:\n    runs-on: x\n  ci-ok:\n    if: always()\n    needs: [checks, new-gate]\n    steps:\n      - name: Decide\n        env:\n          CHECKS: \${{ needs.checks.result }}\n${env}        run: |\n          [ "$CHECKS" = success ] && [ "\${NEW:-skipped}" != failure ] && [ "\${NEW:-skipped}" != cancelled ]\n`;
  const wired = lines('          NEW: ${{ needs.new-gate.result }}\n');
  assert.ok(ciOkPlants([file(wired, 'ci.yml')]).some((plant) => plant.name === 'ci_ok_new_gate_failure' && plant.caught));
  assert.deepEqual(missed(wired), []);
  assert.deepEqual(missed(lines('')), ['ci_ok_reads_real_results']);
});

const WIRED = `jobs:
  checks:
    runs-on: x
    steps:
      - name: Secret scan
        run: scan
      - name: Web test
        if: x
        run: test
  swift:
    runs-on: x
  swift-ocr:
    runs-on: x
  office-mac:
    runs-on: x
  ci-ok:
    if: always()
    needs: [checks, swift, swift-ocr, office-mac]
    steps:
      - name: Decide
        env:
          CHECKS: \${{ needs.checks.result }}
          SWIFT: \${{ needs.swift.result }}
          SWIFT_OCR: \${{ needs.swift-ocr.result }}
          OFFICE_MAC: \${{ needs.office-mac.result }}
        run: |
          exit 0
`;
const missed = (text: string) => wiringPlants([file(text, 'ci.yml')]).filter((plant) => !plant.caught).map((plant) => plant.name);

test('sound wiring passes, and each way of disconnecting a gate fails', () => {
  assert.deepEqual(missed(WIRED), []);
  assert.deepEqual(missed(WIRED.replace('[checks, swift, swift-ocr, office-mac]', '[checks, swift, swift-ocr]')), ['ci_ok_waits_for_every_job']);
  assert.deepEqual(missed(WIRED.replace('CHECKS: \${{ needs.checks.result }}', 'CHECKS: success')), ['ci_ok_reads_real_results']);
  assert.deepEqual(missed(WIRED.replace('    if: always()\n', '')), ['ci_ok_always_runs']);
  assert.deepEqual(missed(WIRED.replace('      - name: Decide\n', '      - name: Decide\n        if: false\n')), ['ci_ok_always_runs']);
  assert.deepEqual(missed(WIRED.replace('      - name: Web test\n', '      - name: Web test\n        continue-on-error: true\n')), ['no_gate_continues_on_error']);
});

test('this repository\'s gates catch every plant that needs no download', () => {
  const plants = localPlants(ROOT);
  assert.equal(plants.length, 26);
  assert.deepEqual(plants.filter((plant) => !plant.caught).map((plant) => plant.name), []);
});
