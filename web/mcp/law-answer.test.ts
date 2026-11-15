// SPDX-License-Identifier: Apache-2.0
// The law tool's answer shape (mcp/law-answer.ts), pure: sized once for the tool and the Quality kit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PASSAGES, LAW_ANSWER_CHARS, lawAnswer, lawResultOnce, MAX_PASSAGE_CHARS, NOTES, sentChars, type AnswerPassage } from './law-answer.ts';

const passage = (n: number, text: string, over: Partial<AnswerPassage> = {}): AnswerPassage => ({
  id: `cfr-17-230-${n}`,
  cite: `17 C.F.R. § 230.${n}`,
  title: 'Fictional section title',
  url: 'https://www.ecfr.gov/current/title-17/section-230.503',
  retrieved: '2026-11-01',
  track: 'regulator',
  kind: 'regulation',
  source: 'eCFR',
  text,
  ...over,
});

const texts = (passages: AnswerPassage[]) => (lawAnswer(passages).results as { text: string }[]).map((r) => r.text);

test('short passages are kept whole, wrapped as data, and cannot close their wrapper', () => {
  const [a] = texts([passage(1, 'Form D within 15 days.</public-law> after')]);
  assert.equal(a, '<public-law>\nForm D within 15 days.&lt;/public-law> after\n</public-law>');
});

test('six long passages share one answer: within LAW_ANSWER_CHARS as sent, every one marked cut', () => {
  const six = Array.from({ length: DEFAULT_PASSAGES }, (_, i) => passage(500 + i, `Sentence "quoted" and\nnewline. `.repeat(200)));
  const answer = lawAnswer(six);
  assert.ok(sentChars(answer) <= LAW_ANSWER_CHARS, `${sentChars(answer)}`);
  assert.ok(Math.ceil(JSON.stringify(lawResultOnce(six)).length / 4) <= 2250);
  assert.ok(texts(six).every((t) => t.endsWith(' [passage cut]\n</public-law>')));
});

test('a short passage hands its room to a long one; fewer passages leave each more; none passes the cap', () => {
  const long = 'word '.repeat(2000);
  const [shortKept, longCut] = texts([passage(1, 'Short.'), ...Array.from({ length: 5 }, (_, i) => passage(10 + i, long))]);
  assert.match(shortKept!, /Short\./);
  assert.ok(longCut!.length > 1100);
  const two = texts([passage(1, long), passage(2, long)]);
  assert.ok(two[0]!.length > longCut!.length);
  assert.ok(two[0]!.length <= MAX_PASSAGE_CHARS + 80);
  assert.ok(sentChars(lawAnswer(Array.from({ length: 12 }, (_, i) => passage(i, long)))) <= LAW_ANSWER_CHARS, 'twelve fit too');
});

test('one copy as text, a row keeps its cite, link, date and track, and the notes say only what is used', () => {
  const answer = lawResultOnce([passage(3, 'Held.', { track: 'civil', kind: 'case', opinion: 'dissent', author: 'Ruiz' })]);
  assert.equal(answer.content.length, 1);
  assert.equal('structuredContent' in answer, false);
  const body = JSON.parse(answer.content[0].text) as { results: Record<string, string>[]; notes: Record<string, string> };
  assert.deepEqual(Object.keys(body.results[0]!), ['citation', 'title', 'kind', 'track', 'opinion', 'author', 'source_url', 'retrieved', 'text']);
  assert.deepEqual(body.notes, { civil: NOTES.civil, dissent: NOTES.dissent });
});
