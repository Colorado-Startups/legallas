// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CASE_GUARD, caseGuardPattern } from './case-guard.ts';

test('the guard\'s matter pattern is read as the guard applies it, case-insensitive', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'case-guard-'));
  try {
    const file = path.join(dir, 'guard-case-data.sh');
    assert.equal(caseGuardPattern(file), null, 'no guard');
    writeFileSync(file, "#!/usr/bin/env bash\nforbidden='x'\nmatter='Alpha v\\.|Beta Labs'\n");
    const pattern = caseGuardPattern(file);
    assert.ok(pattern?.test('the ALPHA V. case') && pattern.test('beta labs') && !pattern.test('Alpha Labs'));
    writeFileSync(file, 'matter="$(cat "$MATTER_WORDS")"\n');
    assert.equal(caseGuardPattern(file), null, 'a guard that reads its words from elsewhere holds no pattern here');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the room\'s own guard, where the checkout has it, yields a pattern', { skip: !existsSync(CASE_GUARD) && 'no case-data guard here' }, () => {
  assert.ok(caseGuardPattern() instanceof RegExp);
});
