// SPDX-License-Identifier: Apache-2.0
// The dev fixture's bytes must be the same on every machine, because the sample room's extract cache is keyed by their
// sha256: written on a Mac, read on Linux. Imports node: built-ins only, so one file runs in seconds with no install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { pdfBytes, pngBytes, xlsxBytes, zlibStored } from './dev-pdf.ts';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('zlibStored writes a stream any inflater reads, at every block boundary', () => {
  for (const size of [0, 1, 65_535, 65_536, 200_000]) {
    const data = Buffer.alloc(size, 7);
    assert.ok(inflateSync(zlibStored(data)).equals(data), `size ${size}`);
  }
  assert.ok(inflateSync(zlibStored(Buffer.from('some bytes that vary'))).equals(Buffer.from('some bytes that vary')));
});

// Fixed hashes, so a run on another CPU or Node fails here if any writer ever goes back to something platform dependent.
test('each writer gives the same bytes on every machine', () => {
  assert.equal(sha(pngBytes(96, 64, ['FAF7F0', 'A98B4F', '1F3A2E'])), '7fda945cf553dcde5321d2cd05e644d6d65c68190e95eebadae27f2e637f86a5');
  assert.equal(sha(pdfBytes([['DOE v. HARBOR LABS, INC.', '', 'Page one (of two)'], ['Page two']])), '0c6c3ce8c965257056fbd2a92ae816b3ae8e73c8be55973cc41f0615b6556ec0');
  assert.equal(sha(xlsxBytes([['Fixture workbook', 'Name'], ['Row', 'Value']])), '471e07581ceba2e182607812be6efaf6f1b47e52a6d09a5f960c292872f56e52');
});
