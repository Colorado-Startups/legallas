// SPDX-License-Identifier: Apache-2.0
// Goals only tighten: the page's score-setting inputs outside manifest.json (the not-in-tree list,
// inputs.json) are pinned in inputs.lock.json. A pin may move only through change entries added since the base
// branch's lock, each with the independent reviewer's sign-off, so editing a file and its pin together fails.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = new URL('../', import.meta.url);
const sha = (f: string) => createHash('sha256').update(readFileSync(new URL(f, dir))).digest('hex');
const LOCK_PATH = 'quality-speed/pages/repo-documentation/inputs.lock.json';

export interface Change { date: string; file: string; from: string; to: string; reason: string; issue: number; signoff_comment: number }
export interface Lock { pins: Record<string, string>; changes: Change[] }

const lock = JSON.parse(readFileSync(new URL('inputs.lock.json', dir), 'utf8')) as Lock;

/** The problems with moving from the base branch's lock to this one; empty when every moved pin is accounted for. */
export function lockProblems(base: Lock | null, head: Lock): string[] {
  const problems: string[] = [];
  for (const c of head.changes) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date)) problems.push('a change has no date');
    if (!(c.file in head.pins)) problems.push('a change names a file that is not pinned');
    if (!/^[0-9a-f]{64}$/.test(c.from) || !/^[0-9a-f]{64}$/.test(c.to)) problems.push('a change lacks its sha256 before and after');
    if (!c.reason) problems.push('a change has no reason');
    if (!(Number.isInteger(c.issue) && c.issue > 0)) problems.push('a change names no issue or pull request');
    if (!(Number.isInteger(c.signoff_comment) && c.signoff_comment > 0)) problems.push("a change has no reviewer's sign-off comment");
  }
  if (!base) return problems;
  if (JSON.stringify(head.changes.slice(0, base.changes.length)) !== JSON.stringify(base.changes)) {
    problems.push("the base branch's change entries were edited or removed");
  }
  const added = head.changes.slice(base.changes.length);
  for (const [file, pin] of Object.entries(head.pins)) {
    const from = base.pins[file];
    const mine = added.filter((c) => c.file === file);
    if (from === undefined) {
      problems.push(`${file} is newly pinned: pins are fixed by the first list`);
      continue;
    }
    if (from === pin && mine.length === 0) continue;
    if (mine.length === 0) {
      problems.push(`${file}'s pin moved with no change entry`);
      continue;
    }
    if (mine[0]?.from !== from) problems.push(`${file}'s first new change must start at the base pin`);
    for (let i = 1; i < mine.length; i++) if (mine[i]?.from !== mine[i - 1]?.to) problems.push(`${file}'s changes must chain`);
    if (mine.at(-1)?.to !== pin) problems.push(`${file}'s last change must end at its pin`);
  }
  for (const file of Object.keys(base.pins)) if (!(file in head.pins)) problems.push(`${file} was unpinned`);
  return problems;
}

/**
 * The base branch's lock: from the pull request's base commit when CI names it, otherwise origin/main. null when the
 * base has no lock yet (the page's first merge). A base that can't be read fails, never passes.
 */
function baseLock(): Lock | null {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const ref = process.env.PR_BASE_SHA && /^[0-9a-f]{40}$/.test(process.env.PR_BASE_SHA) ? process.env.PR_BASE_SHA : 'origin/main';
  const exists = spawnSync('git', ['-C', root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { encoding: 'utf8' });
  assert.equal(exists.status, 0, `the base ${ref} is not in this checkout: fetch it (CI checks out with fetch-depth: 0)`);
  const show = spawnSync('git', ['-C', root, 'show', `${ref}:${LOCK_PATH}`], { encoding: 'utf8' });
  if (show.status !== 0) return null;
  return JSON.parse(show.stdout) as Lock;
}

test('every pinned input matches its pin', () => {
  assert.deepEqual(Object.keys(lock.pins).sort(), ['inputs.json', 'not-in-tree.json', 'questions.json']);
  for (const [file, pin] of Object.entries(lock.pins)) {
    assert.equal(sha(file), pin, `${file} changed: record the change in inputs.lock.json with the reviewer's sign-off`);
  }
});

test("every pin that moved since the base branch's lock is accounted for by signed-off change entries", () => {
  assert.deepEqual(lockProblems(baseLock(), lock), []);
});

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const change = (from: string, to: string): Change => ({ date: '2026-11-02', file: 'questions.json', from, to, reason: 'superseded', issue: 1, signoff_comment: 2 });

test('lockProblems: a re-pin with no entry fails; a signed-off chain passes; history cannot be rewritten', () => {
  const base: Lock = { pins: { 'questions.json': A }, changes: [] };
  assert.deepEqual(lockProblems(base, { pins: { 'questions.json': A }, changes: [] }), []);
  assert.deepEqual(lockProblems(base, { pins: { 'questions.json': B }, changes: [] }), ["questions.json's pin moved with no change entry"]);
  assert.deepEqual(lockProblems(base, { pins: { 'questions.json': C }, changes: [change(A, B), change(B, C)] }), []);
  assert.deepEqual(lockProblems(base, { pins: { 'questions.json': C }, changes: [change(B, C)] }), ["questions.json's first new change must start at the base pin"]);
  const withHistory: Lock = { pins: { 'questions.json': B }, changes: [change(A, B)] };
  assert.deepEqual(lockProblems(withHistory, { pins: { 'questions.json': B }, changes: [] }), ["the base branch's change entries were edited or removed"]);
  assert.deepEqual(lockProblems(null, { pins: { 'questions.json': B }, changes: [{ ...change(A, B), signoff_comment: 0 }] }), ["a change has no reviewer's sign-off comment"]);
});
