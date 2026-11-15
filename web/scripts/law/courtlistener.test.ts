// SPDX-License-Identifier: Apache-2.0
// CourtListener opinion HTML (W4d): head matter dropped, star pages kept, writings split, the panel line checked.
// Fictional text laid out the way CourtListener's html_with_citations prints an older opinion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courtListenerCites, courtListenerOpinions, courtListenerParties, isPanelLine } from './courtlistener.ts';

const star = (n: number) => `<span class="star-pagination">*${n}</span>`;

function page(body: string, panel = 'OTHER, C. J., and THIRD, J., concur.'): string {
  return `<div>
<center><b><span class="citation no-link">999 P.2d 100</span> (2099)</b></center>
<center><h1>FABLE CORP., Plaintiff-Appellee,<br>
v.<br>
George FICTION, Defendant-Appellant.</h1></center>
<center>No. 99-001.</center>
<p>${star(101)} Counsel One, Denver, for plaintiff-appellee.</p>
<p>Selected for Official Publication.</p>
<p>FABLE, Judge.</p>
<p>The fictional caterer sued its fictional customer. We ${star(102)} affirm.</p>
<h2>I.</h2>
<p>The customer accepted the delivery <span class="citation" data-id="1"><a href="/opinion/1/x/">1 P.2d 1</a></span> &amp; kept it.</p>
<blockquote>"A fictional contract clause."</blockquote>
${body}
<p>${panel}</p>
</div>`;
}

test('a CourtListener opinion keeps its text from the author line on, with star pages, and drops the head matter', () => {
  const html = page('<p>Judgment affirmed.</p>');
  assert.deepEqual(courtListenerCites(html), ['999 P.2d 100']);
  assert.match(courtListenerParties(html), /^FABLE CORP\., Plaintiff-Appellee, v\. George FICTION, Defendant-Appellant\.$/);
  const [court, ...rest] = courtListenerOpinions(html);
  assert.equal(rest.length, 0);
  assert.deepEqual([court!.opinion, court!.judge, court!.role, court!.startPage], ['majority', 'Fable, J.', 'opinion of the court', '101']);
  assert.deepEqual(court!.lines, [
    'The fictional caterer sued its fictional customer. We [*102] affirm.',
    'I.',
    'The customer accepted the delivery 1 P.2d 1 & kept it.',
    '"A fictional contract clause."',
    'Judgment affirmed.',
  ]);
  assert.ok(!court!.lines.some((line) => /Counsel|Selected|FABLE, Judge|concur/.test(line)), 'counsel, the author line and the panel line are not text');
});

test('a separate writing under its heading is split off, and a panel line naming one must find it', () => {
  const dissent = `<p>THIRD, Judge, dissenting.</p><p>I would ${star(103)} reverse.</p>`;
  const writings = courtListenerOpinions(page(dissent, 'OTHER, C. J., concurs.'));
  assert.deepEqual(writings.map((w) => [w.opinion, w.judge, w.startPage]), [['majority', 'Fable, J.', '101'], ['dissent', 'Third, J.', '102']]);
  assert.deepEqual(writings[1]!.lines, ['I would [*103] reverse.']);
  assert.throws(() => courtListenerOpinions(page('<p>Affirmed.</p>', 'OTHER, C. J., concurs, and THIRD, J., dissents.')), /names a separate writing/);
});

test('footnotes and a missing author line are refused; panel lines are told from text', () => {
  assert.throws(() => courtListenerOpinions(page('<p>Text<sup>1</sup></p>')), /footnotes/);
  assert.throws(() => courtListenerOpinions(page('').replace('<p>FABLE, Judge.</p>', '')), /no author line/);
  assert.ok(isPanelLine('THIRD, C. J., and OTHER, J., concur.'));
  assert.ok(isPanelLine('OTHER, J., specially concurs.'));
  assert.equal(isPanelLine('The fictional parties concur in that reading of the contract.'), false);
  assert.equal(isPanelLine('We concur.'), false);
});
