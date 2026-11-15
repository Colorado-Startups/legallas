// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlLiteral } from './sql.ts';
import { normalizeEmail } from './email.ts';

test('quotes are doubled so a hostile filename stays one string', () => {
  assert.equal(sqlLiteral("O'Brien'); DELETE FROM members;--.pdf"), "'O''Brien''); DELETE FROM members;--.pdf'");
  assert.equal(sqlLiteral("''"), "''''''");
});

test('NULL and safe integers pass through; anything else numeric is refused', () => {
  assert.equal(sqlLiteral(null), 'NULL');
  assert.equal(sqlLiteral(42), '42');
  assert.throws(() => sqlLiteral(1.5));
  assert.throws(() => sqlLiteral(Number.NaN));
  assert.throws(() => sqlLiteral(2 ** 60));
});

test('control characters are refused, including newlines and NUL', () => {
  for (const bad of ['a\u0000b', 'a\nb', 'a\rb', 'a\tb', 'a\u001bb', 'a\u007fb']) {
    assert.throws(() => sqlLiteral(bad), /control/, JSON.stringify(bad));
  }
});

test('text is NFC-normalized (macOS filenames arrive NFD)', () => {
  const nfd = 'Café.pdf';
  assert.equal(sqlLiteral(nfd), `'${'Café.pdf'}'`);
});

test('emails are trimmed, NFC-normalized and lowercased, or rejected', () => {
  assert.equal(normalizeEmail('  Founder@Example.COM '), 'founder@example.com');
  assert.equal(normalizeEmail('not an email'), null);
  assert.equal(normalizeEmail(undefined), null);
  assert.equal(normalizeEmail(`${'a'.repeat(250)}@b.co`), null);
});
