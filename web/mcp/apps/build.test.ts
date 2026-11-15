// SPDX-License-Identifier: Apache-2.0
// views.generated.ts is what mcp/apps/build.ts makes of the views and the chart kit today. When this fails, the Views
// workflow (.github/workflows/mcp-views.yml) has uploaded the file to commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildViews, GENERATED_FILE, renderGenerated } from './build.ts';

test('views.generated.ts is up to date with mcp/apps/view/ and src/scripts/viz/', { timeout: 60_000 }, async () => {
  const expected = renderGenerated(await buildViews());
  assert.ok(readFileSync(GENERATED_FILE, 'utf8') === expected, 'views.generated.ts is stale: commit the one the Views workflow uploads (node mcp/apps/build.ts)');
});
