// SPDX-License-Identifier: Apache-2.0
// Which writing an opinion part comes from (W4b): author lines read as citations name judges, and the writing's
// own words decide whether it is a concurrence, a dissent or both. Fictional names only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { articleRole, headingOf, isDescriptor, judgeName, opinionLabel, opinionParenthetical, roleOf } from './opinions.ts';

test('author lines in every reporter form name the judge as a citation does', () => {
  const cases: [string, string | null][] = [
    ['Justice FABLE', 'Fable, J.'],
    ['Justice FABLE,', 'Fable, J.'],
    ['JUSTICE FABLE', 'Fable, J.'],
    ['FABLE, Justice.', 'Fable, J.'],
    ['FABLE, Chief Justice,', 'Fable, C.J.'],
    ['Chief Justice FABLE', 'Fable, C.J.'],
    ['Chief Judge FABLE.', 'Fable, C.J.'],
    ['Judge FABLE.*', 'Fable, J.'],
    ['FABLE, J.', 'Fable, J.'],
    ['Mr. Justice Fable', 'Fable, J.'],
    ['Opinion by JUDGE FABLE', 'Fable, J.'],
    ['Judge J. FABLE.', 'J. Fable, J.'],
    ['JUSTICE ÉCLAIR delivered the Opinion of the Court.', 'Éclair, J.'],
    ['CHIEF JUSTICE FABLE, dissenting.', 'Fable, C.J.'],
    ["JUSTICE O'FABLE, concurring in the judgment.", "O'Fable, J."],
    ['PER CURIAM', null],
    ['', null],
  ];
  for (const [raw, want] of cases) assert.equal(judgeName(raw), want, raw);
});

test('the writing\'s own words decide its kind; CAP\'s type decides only when they are silent', () => {
  assert.deepEqual(roleOf('concurring in part and dissenting in part:'), { opinion: 'concurrence-dissent', role: 'concurring in part and dissenting in part' });
  assert.deepEqual(roleOf('Judge OTHER, dissenting.'), { opinion: 'dissent', role: 'dissenting' });
  assert.deepEqual(roleOf('specially concurring:'), { opinion: 'concurrence', role: 'specially concurring' });
  assert.deepEqual(roleOf('concurring in the judgment.'), { opinion: 'concurrence', role: 'concurring in the judgment' });
  assert.equal(roleOf('delivered the Opinion of the Court.'), null);
  assert.deepEqual(articleRole('majority', 'Justice FABLE'), { opinion: 'majority', role: 'opinion of the court' });
  assert.deepEqual(articleRole('dissent', 'Justice FABLE,'), { opinion: 'dissent', role: 'dissenting' });
  assert.equal(articleRole('concurrence', 'FABLE, Justice, concurring in part and dissenting in part:').opinion, 'concurrence-dissent', 'a writing that says it dissents in part is not a plain concurrence');
  assert.throws(() => articleRole('plurality', 'Justice FABLE'), /unknown CAP opinion type "plurality"/, 'an unknown writing is never called the court\'s opinion');
});

test('a heading inside an article opens a separate writing; sentences and notations never do', () => {
  assert.deepEqual(headingOf('JUSTICE ÉCLAIR, dissenting.'), { opinion: 'dissent', role: 'dissenting', judge: 'Éclair, J.' });
  assert.deepEqual(headingOf('FABLE, Justice, concurring in part and dissenting in part:'), { opinion: 'concurrence-dissent', role: 'concurring in part and dissenting in part', judge: 'Fable, J.' });
  assert.equal(headingOf('JUSTICE ÉCLAIR dissents and JUSTICE FABLE joins in the dissent.'), null);
  assert.equal(headingOf('Judge FABLE concurs in part and dissents in part.'), null);
  assert.equal(headingOf('Accordingly, I respectfully dissent.'), null);
  assert.equal(headingOf('The majority, in dissenting from that view, is mistaken about the rule.'), null);
  assert.equal(headingOf('Fable, dissenting.'), null, 'reporters print the name in capitals there');
  assert.ok(isDescriptor('dissenting.') && isDescriptor('concurring in part and dissenting in part:') && isDescriptor('specially concurring:'));
  assert.equal(isDescriptor('delivered the Opinion of the Court.'), false);
});

test('a separate writing is labelled plainly and cited with the parenthetical a brief uses', () => {
  assert.equal(opinionLabel('dissent', 'Fable, J.'), 'Dissent, Fable, J.');
  assert.equal(opinionLabel('majority', 'Fable, J.'), 'Opinion of the court, Fable, J.');
  assert.equal(opinionLabel('concurrence-dissent', null), 'Concurrence in part and dissent in part');
  assert.equal(opinionParenthetical('dissent', 'Fable, J.', 'dissenting'), ' (Fable, J., dissenting)');
  assert.equal(opinionParenthetical('concurrence', null, 'concurring in the judgment'), ' (concurring in the judgment opinion)');
  assert.equal(opinionParenthetical('majority', 'Fable, J.', 'opinion of the court'), '');
});
