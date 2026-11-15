// SPDX-License-Identifier: Apache-2.0
// Folder guides (worker/agent-files.ts) in pro's case overview (tools/overview.ts): its docs never list one, even one
// the manifest has an entry for. The core's tools: folder-guides.test.ts.
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogDb, toolCtx } from './doc-fixtures.ts';
import { overviewTool, resetOverviewCache } from './overview.ts';
import { DOC_IDS, MATTER, matterFiles } from './profile-fixtures.ts';

beforeEach(() => resetOverviewCache());

test('the overview never lists a folder guide among its docs, even one the manifest has an entry for', async () => {
  const guideId = 'd0e0f01d-0000-4000-8000-00000000000a';
  const matter = JSON.parse(MATTER);
  matter.docs[guideId] = { date: null, type: null, from: [], to: [], summary: null, privileged: true };
  const seeds = [
    ...Object.entries(DOC_IDS).map(([path, id], i) => ({ id, path, controlSeq: i + 2 })),
    { id: guideId, path: '07-Lawyer-Notes-PRIVILEGED/CLAUDE.md', kind: 'markdown', pages: null, controlSeq: 1 },
  ];
  const { ctx } = toolCtx(catalogDb(seeds).db);
  (ctx.env as { FILES: unknown }).FILES = matterFiles(JSON.stringify(matter)).bucket;
  const docs: { id: string }[] = [];
  let cursor: string | undefined;
  do {
    const out = (await overviewTool.handler(overviewTool.inputSchema.parse({ section: 'docs', ...(cursor ? { cursor } : {}) }), ctx)).structuredContent as Record<string, any>;
    docs.push(...out.entries);
    cursor = out.nextCursor ?? undefined;
  } while (cursor);
  const summary = (await overviewTool.handler(overviewTool.inputSchema.parse({}), ctx)).structuredContent as Record<string, any>;
  assert.ok(docs.length > 0);
  assert.ok(docs.every((d) => d.id !== guideId));
  assert.equal(summary.counts.docs, docs.length, 'the count leaves it out too');
  assert.equal(docs.length, Object.keys(matter.docs).length - 1);
});
