// SPDX-License-Identifier: Apache-2.0
// Test data is invented, so the second fixture may add no new names (REVIEW.md rule 1) and no words from the dispute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeFixture } from './dev-fixture.ts';
import { COMPANY_DOCUMENTS, COMPANY_FOLDER_GUIDE, companyPages } from './dev-fixture-company.ts';

const docIds = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'doc-ids.json'), 'utf8')) as Record<string, string>;

test('the company fixture adds no new names and carries no words from the dispute', () => {
  for (const rel of COMPANY_DOCUMENTS) {
    assert.ok(rel in docIds, rel);
    for (const line of companyPages(rel).flat()) assert.doesNotMatch(line, /\bDOE v\.|\b(?:matter|plaintiff|defendant|counsel|attorney|lawyer|privileged|complaint|court)\b/i, `${rel}: ${line}`);
  }
  assert.doesNotMatch(COMPANY_FOLDER_GUIDE, /\b(?:matter|counsel|attorney|lawyer|complaint|court)\b/i);
});

test('makeFixture writes the company\'s folders and nothing from the case', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'dev-fixture-company-'));
  try {
    await makeFixture(out, 'company');
    assert.deepEqual((await readdir(out)).filter((name) => /^\d/.test(name)).sort(), ['01-Corporate-Records', '03-Investor-Agreements', '06-Cap-Table']);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
