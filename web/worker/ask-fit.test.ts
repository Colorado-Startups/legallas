// SPDX-License-Identifier: Apache-2.0
// Fitting Ask's turn to Groq's prompt (ask-fit.ts): the prompt askTurn builds comes under the budget, whole pieces go
// in the documented order, and the citable ids follow the text that is left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitTurn, MIN_PASSAGES, promptChars } from './ask-fit.ts';
import { askTurn, type TurnInput } from './ask-turn.ts';
import type { CitableDoc } from './passages.ts';
import { GROQ_PROMPT_CHARS } from './ask-groq.ts';
import type { LawPassage, PromptChunk } from './prompt.ts';

const doc = (id: string, pages = 9): CitableDoc => ({ id, name: `${id}.pdf`, pages, control_seq: null, folder: null });

/** A passage of `pageCount` pages, each opened by its index marker, about `chars` characters a page. */
function passage(id: string, firstPage: number, chars: number, pageCount = 1): PromptChunk {
  const pages = Array.from({ length: pageCount }, (_, i) => `[[doc:${id} p:${firstPage + i}]]\n${'Minutes record a vote. '.repeat(Math.ceil(chars / 23)).slice(0, chars)}\n`);
  return { docId: id, name: `${id}.pdf`, text: pages.join('') };
}

/** A case picture shaped like ask-brief.ts caseBrief: a header, filings with point lines carrying proof tags, a prior case. */
function brief(points: number, proofIds: readonly string[]): NonNullable<TurnInput['brief']> {
  const lines = ['Matter now: Example v. Example (District Court).', 'Filings counsel is preparing:', 'Filing 1 of 1: Complaint', '   Kind: complaint. Forum: District Court.', '   Would name: Example Co.', '   Status: Not yet filed.', '   Points to prove:'];
  for (let i = 0; i < points; i++) {
    const id = proofIds[i % proofIds.length]!;
    lines.push(`   - (A) Point ${i} about the record and what it shows in detail. Proof: strong [doc:${id} p:${(i % 5) + 1}] a note on the proof.`);
  }
  lines.push('(end of Complaint)', 'Violations:', '- A: Breach of duty. A summary of the violation.', 'Prior case (closed; history only, not being pursued): Old v. Old.');
  return { text: lines.join('\n'), citable: new Map(proofIds.map((id) => [id, doc(id)])), filed: false };
}

const law = (n: number): LawPassage[] =>
  Array.from({ length: n }, (_, i) => ({ id: `crs-${i}`, cite: `C.R.S. ${i}`, track: 'civil', text: 'The statute provides a rule. '.repeat(40) }) as LawPassage);

/** A full turn input: `n` retrieved passages, a case picture, law. */
function input(n: number, options: { points?: number; law?: number; chars?: number } = {}): TurnInput {
  const chunks = Array.from({ length: n }, (_, i) => passage(`doc-${i}`, i + 1, options.chars ?? 1200));
  return {
    question: 'When did the cooks vote?',
    chunks,
    citable: new Map(chunks.map((chunk) => [chunk.docId, doc(chunk.docId)])),
    brief: brief(options.points ?? 60, ['proof-a', 'proof-b', 'proof-c', 'doc-1']),
    law: law(options.law ?? 0),
  };
}

const ids = (chunks: readonly PromptChunk[]) => chunks.map((chunk) => chunk.docId);

/** Every document a passage marker or a case picture tag names, by where it is named. */
function named(fitted: TurnInput): { passages: Set<string>; brief: Set<string> } {
  const passages = new Set(fitted.chunks.flatMap((chunk) => [...chunk.text.matchAll(/\[\[doc:([A-Za-z0-9_-]+) p:\d+\]\]/g)].map((m) => m[1]!)));
  const tagged = new Set([...(fitted.brief?.text ?? '').matchAll(/\[doc:([A-Za-z0-9_-]+) p:\d+\]/g)].map((m) => m[1]!));
  return { passages, brief: tagged };
}

test('an input that already fits comes back as it was', () => {
  const small = input(2, { points: 2 });
  const fit = fitTurn(small, 1_000_000);
  assert.equal(fit.input, small);
  assert.equal(fit.fits, true);
  assert.deepEqual(fit.dropped, { law: 0, passages: 0, briefLines: 0, brief: false, pages: 0 });
  assert.equal(fit.chars, promptChars(small));
});

test("a Groq-sized budget brings a full turn under it, with the measure matching the prompt askTurn sends", () => {
  const full = input(20, { points: 120, law: 3 });
  assert.ok(promptChars(full) > 2 * GROQ_PROMPT_CHARS, 'the fixture is as large as a real turn');
  const fit = fitTurn(full, GROQ_PROMPT_CHARS);
  assert.equal(fit.fits, true);
  assert.ok(fit.chars <= GROQ_PROMPT_CHARS);
  const sent = askTurn(fit.input).messages.reduce((n, m) => n + m.content.length, 0);
  assert.equal(sent, fit.chars, 'a fresh boundary is as long as the measuring one');
});

test('law goes first, then the lowest-ranked passages, and the best MIN_PASSAGES stay before the case picture is cut', () => {
  const full = input(20, { points: 120, law: 3 });
  const fit = fitTurn(full, GROQ_PROMPT_CHARS);
  assert.equal(fit.dropped.law, 3);
  assert.deepEqual(fit.input.law, []);
  assert.deepEqual(ids(fit.input.chunks), ids(full.chunks).slice(0, fit.input.chunks.length), 'the kept passages are the best-ranked ones, in order');
  assert.ok(fit.input.chunks.length >= MIN_PASSAGES);
  assert.ok(fit.dropped.briefLines > 0, 'this turn needed the case picture trimmed too');
  assert.equal(fit.input.brief?.text.split('\n')[0], 'Matter now: Example v. Example (District Court).');
});

test('the case picture loses its proof lines before its other lines', () => {
  const full = input(MIN_PASSAGES, { points: 120 });
  const budget = promptChars({ ...full, brief: brief(10, ['proof-a', 'proof-b', 'proof-c', 'doc-1']) });
  const fit = fitTurn(full, budget);
  const lines = fit.input.brief!.text.split('\n');
  assert.ok(lines.includes('Prior case (closed; history only, not being pursued): Old v. Old.'), 'the lines after the points stay');
  assert.ok(lines.includes('   Would name: Example Co.'));
  assert.equal(lines.filter((line) => line.startsWith('   - (')).length <= 10, true);
});

test('citable ids follow the text: kept passages and kept tags only, and every tag left names a citable document', () => {
  for (const budget of [GROQ_PROMPT_CHARS, 14_000, 11_000, 9_500]) {
    const full = input(20, { points: 120, law: 2 });
    const fit = fitTurn(full, budget);
    const { passages, brief: tagged } = named(fit.input);
    assert.deepEqual(new Set(fit.input.citable.keys()), new Set(ids(fit.input.chunks)), `passages, budget ${budget}`);
    for (const id of passages) assert.ok(fit.input.citable.has(id), `marker ${id} is citable, budget ${budget}`);
    if (fit.input.brief) assert.deepEqual(new Set(fit.input.brief.citable.keys()), tagged, `case picture tags, budget ${budget}`);
    // Through the cite book the model sees: every short id in the prompt maps back to a document the turn may cite.
    const turn = askTurn(fit.input);
    const prompt = turn.messages.map((m) => m.content).join('\n');
    for (const match of prompt.matchAll(/\[doc:(D\d+) p:\d+\]/g)) {
      const real = turn.book.ids.get(match[1]!);
      assert.ok(real && turn.book.citable.has(real), `${match[1]} in the prompt is citable, budget ${budget}`);
    }
    for (const id of turn.book.citable.keys()) assert.ok(passages.has(id) || tagged.has(id), `${id} is shown in the prompt, budget ${budget}`);
  }
});

test('a proof document that is also a passage stays citable while either names it', () => {
  const full = input(20, { points: 120 });
  const fit = fitTurn(full, GROQ_PROMPT_CHARS);
  // doc-1 is a top-ranked passage and a proof tag: dropping its proof lines leaves it citable through the passage.
  assert.ok(fit.input.citable.has('doc-1'));
  assert.ok(askTurn(fit.input).book.citable.has('doc-1'));
});

test('past one passage and no case picture, the last pages go, each kept page keeping its marker', () => {
  const big: TurnInput = { question: 'What does it say?', chunks: [passage('doc-long', 1, 2_000, 8)], citable: new Map([['doc-long', doc('doc-long')]]), brief: brief(4, ['proof-a']) };
  const rules = promptChars({ ...big, chunks: [passage('doc-long', 1, 2_000, 2)], brief: null });
  const fit = fitTurn(big, rules + 50);
  assert.equal(fit.fits, true);
  assert.equal(fit.dropped.brief, true);
  assert.equal(fit.input.brief, null);
  assert.equal(fit.dropped.pages, 6);
  const kept = fit.input.chunks[0]!.text;
  assert.deepEqual([...kept.matchAll(/\[\[doc:doc-long p:(\d+)\]\]/g)].map((m) => Number(m[1])), [1, 2]);
  assert.ok(kept.startsWith('[[doc:doc-long p:1]]'));
  assert.ok(fit.input.citable.has('doc-long'));
});

test('a budget below the rules and one page says it does not fit, and keeps one page of the best passage', () => {
  const fit = fitTurn(input(5, { points: 10 }), 2_000);
  assert.equal(fit.fits, false);
  assert.equal(fit.input.chunks.length, 1);
  assert.equal(fit.input.chunks[0]!.docId, 'doc-0');
  assert.equal(fit.input.brief, null);
  assert.ok(fit.chars > 2_000);
});

test('a turn as large as a real one keeps several passages and the case picture header within Groq\'s prompt', () => {
  // Sizes from the replica retrieval of 2026-10-04: a 22,000-character case picture and 20 passages of about 1,250.
  const full = input(20, { points: 200, chars: 1_250 });
  assert.ok(full.brief!.text.length > 20_000);
  const fit = fitTurn(full, GROQ_PROMPT_CHARS);
  assert.equal(fit.fits, true);
  assert.ok(fit.input.chunks.length >= MIN_PASSAGES);
  assert.ok(fit.input.brief !== null, 'the case picture header survives');
});
