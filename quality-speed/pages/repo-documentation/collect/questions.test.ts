// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repo } from './fixture.ts';
import { type Question, checkQuestions, docValue, findLine, grade, provenValue } from './questions.ts';

const base: Omit<Question, 'id' | 'doc' | 'truth'> = { audience: 'agent', question: 'Which command seeds the room?', accept: ['npm run dev:seed'] };

function setup() {
  return repo({
    'web/package.json': JSON.stringify({ scripts: { 'dev:seed': 'x' } }),
    'web/README.md': '# Room\n\nRun `npm run\ndev:seed` to seed it.\n',
    'web/list.toml': '[[item]]\n[[item]]\n',
    '.github/workflows/ci.yml': '# The Doe v. Roe room\non: push\n',
  });
}

test('a question passes when the doc states it, the code proves it and nothing contradicts it', () => {
  const r = setup();
  try {
    const qs: Question[] = [
      { ...base, id: 'ok', doc: { path: 'web/README.md', pattern: 'npm run dev:seed' }, truth: [{ kind: 'script', name: 'dev:seed' }] },
      { ...base, id: 'untrue', doc: { path: 'web/README.md', pattern: 'npm run dev:seed' }, truth: [{ kind: 'file', path: 'web/none.ts' }] },
      { ...base, id: 'unstated', doc: { path: 'web/README.md', pattern: 'npm run law' }, truth: [{ kind: 'script', name: 'dev:seed' }] },
      { ...base, id: 'count', doc: { path: 'web/README.md', pattern: 'seed' }, truth: [{ kind: 'count', path: 'web/list.toml', pattern: '^\\[\\[item\\]\\]$', equals: 2 }] },
      {
        ...base,
        id: 'contradicted',
        doc: { path: 'web/README.md', pattern: 'seed' },
        truth: [{ kind: 'grep', path: 'web/README.md', pattern: 'seed it' }],
        conflicts: ['Doe v\\.\\s+Roe room'],
      },
    ];
    const res = checkQuestions(r.corpus(), qs);
    assert.deepEqual(
      res.map((q) => [q.id, q.pass]),
      [['ok', true], ['untrue', false], ['unstated', false], ['count', true], ['contradicted', false]],
    );
    assert.deepEqual(res[4]?.conflicts, [{ path: '.github/workflows/ci.yml', line: 1 }]);
    assert.equal(res[0]?.line, 3, 'a phrase that wraps onto the next line is found on its first line');
  } finally {
    r.done();
  }
});

test('findLine and grade', () => {
  assert.equal(findLine(['a', 'b c', 'd'], 'c d'), 2);
  assert.equal(findLine(['a'], 'z'), null);
  const q = { ...base, id: 'g', doc: { path: 'x', pattern: 'x' }, truth: [], accept: ['npm run dev:seed', '\\bweb\\b'] };
  assert.equal(grade(q, 'Run npm run dev:seed from web/.'), true);
  assert.equal(grade(q, 'Run npm run dev:seed.'), false);
});

test('count_as_doc: the code count must equal the number the doc states, at any count', () => {
  const q = (stated: number): Question => ({
    ...base,
    id: `n${stated}`,
    accept: ['\\b{doc}\\b'],
    doc: { path: 'docs/list.md', pattern: '\\| Items \\| (\\d+)' },
    truth: [{ kind: 'count_as_doc', path: 'docs/list.toml', pattern: '^\\[\\[item\\]\\]$' }],
  });
  const agree = repo({ 'docs/list.md': '| Items | 3 |\n', 'docs/list.toml': '[[item]]\n[[item]]\n[[item]]\n' });
  const drift = repo({ 'docs/list.md': '| Items | 2 |\n', 'docs/list.toml': '[[item]]\n[[item]]\n[[item]]\n' });
  try {
    assert.equal(checkQuestions(agree.corpus(), [q(3)])[0]?.pass, true);
    assert.equal(checkQuestions(drift.corpus(), [q(2)])[0]?.true, false, 'the doc says 2, the code has 3');
    assert.equal(docValue(agree.corpus(), q(3)), '3');
    assert.equal(grade(q(3), 'There are 3 items.', '3'), true);
    assert.equal(grade(q(3), 'There are 30 items.', '3'), false);
    assert.equal(grade(q(3), 'There are 3 items.', null), false, 'no stated value, no pass');
    // A drifted doc says 2 where the code has 3: no value is proven, so neither the doc's answer nor any other passes.
    assert.equal(provenValue(drift.corpus(), q(2)), null);
    assert.equal(grade(q(2), 'There are 2 items.', provenValue(drift.corpus(), q(2))), false);
    assert.equal(grade(q(2), 'There are 3 items.', provenValue(drift.corpus(), q(2))), false);
    assert.equal(provenValue(agree.corpus(), q(3)), '3');
  } finally {
    agree.done();
    drift.done();
  }
});
