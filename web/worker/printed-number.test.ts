// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommentBody } from './comments.ts';
import { holdsPrintedNumber, printedNumberGuard } from './printed-number.ts';
import { cleanText, cleanTitle } from './proposals.ts';

// The SSA's voided sample number, joined at run time.
const SAMPLE = ['078', '05', '1120'].join('-');

test('a comment or a guest\'s comment holding a printed number is refused, with a code and not the number (#267)', () => {
  assert.deepEqual(parseCommentBody(`Holder ${SAMPLE} on file`), { ok: false, error: 'pii_in_comment' });
  assert.deepEqual(parseCommentBody('Doe v. Harbor Labs: see p. 4'), { ok: true, body: 'Doe v. Harbor Labs: see p. 4' });
});

test('a proposal\'s title, reason or body holding one is refused', () => {
  assert.equal(cleanTitle(`Letter for ${SAMPLE}`), null);
  assert.equal(cleanText(`SSN: ${SAMPLE.replaceAll('-', '')}`, 500), null);
  assert.equal(cleanText('A side letter for Harbor Labs', 500), 'A side letter for Harbor Labs');
});

test('an upload\'s name, and plain-text bytes split across chunks, are read; other formats pass through', async () => {
  assert.equal(holdsPrintedNumber(`notes ${SAMPLE}.md`), true);
  const bytes = new TextEncoder().encode(`Founder notes.\nHolder ${SAMPLE}\n`);
  const run = async (on: boolean) => {
    const guard = printedNumberGuard(on);
    const at = bytes.indexOf(0x2d); // splits the number between two chunks
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, at));
        controller.enqueue(bytes.slice(at));
        controller.close();
      },
    });
    const out = new Uint8Array(await new Response(source.pipeThrough(guard.stream)).arrayBuffer());
    assert.deepEqual(out, bytes, 'bytes pass through unchanged');
    return guard.found();
  };
  assert.equal(await run(true), true);
  assert.equal(await run(false), false);
});
