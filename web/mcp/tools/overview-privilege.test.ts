// SPDX-License-Identifier: Apache-2.0
// Pro's tools (mcp/pro.ts: the case overview and the visual binder) and privileged folders (worker/privilege.ts). A
// family row left from before migration 0010 is refused every tool the room lists, pro's included, before it runs;
// the overview keeps owner's and counsel's cites to a privileged document and refuses the retired role. The core's
// tools: privilege.test.ts.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Role } from '../../worker/env.ts';
import { addLeftoverFamily } from '../../worker/gate-fixtures.ts';
import { MATTER_KEY } from '../../worker/matter-types.ts';
import { testDb } from '../../worker/sqlite-d1.ts';
import type { McpEnv, Props, ToolContext } from '../contract.ts';
import '../pro.ts';
import { runTool } from '../server.ts';
import { body, catalogDb, toolCtx } from './doc-fixtures.ts';
import { listedTools, TOOLS } from './index.ts';
import { overviewTool, resetOverviewCache } from './overview.ts';
import { viewVisualTool } from './visuals.ts';

beforeEach(() => resetOverviewCache());

const RETIRED = 'family' as Role;

/** A handler's answer to the retired role: an error that names no privileged document. */
function refused(out: { isError?: boolean; content: unknown[] }, label: string, names: RegExp): void {
  assert.equal(out.isError, true, label);
  assert.doesNotMatch(JSON.stringify(out.content), names, label);
}

test('with pro, a family row left from before migration 0010 is refused every listed tool before it runs', async () => {
  const added = listedTools().filter((tool) => !TOOLS.includes(tool));
  assert.deepEqual(added, [overviewTool, viewVisualTool]);
  const { db, sqlite } = testDb();
  addLeftoverFamily(sqlite, 'kin@mail.example', 'Kin');
  const props: Props = { email: 'kin@mail.example', role: RETIRED, clientId: 'c1', clientName: 'Claude' };
  const env = { DB: db, TEAM_DOMAIN: '', ACCESS_AUD: '' } as unknown as McpEnv;
  for (const tool of added) {
    const handler = async () => assert.fail(`${tool.name} ran for family`);
    const out = await runTool({ ...tool, handler }, {}, env, props, undefined, new Date());
    assert.equal(out.isError, true, tool.name);
    assert.match((out.content[0] as { text: string }).text, /^not_a_member:/);
  }
  assert.equal((sqlite.prepare('SELECT count(*) AS n FROM usage').get() as { n: number }).n, 0);
});

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures');
const MATTER = readFileSync(join(FIXTURES, 'matter.example.json'), 'utf8');
const IDS = JSON.parse(readFileSync(join(FIXTURES, 'doc-ids.json'), 'utf8')) as Record<string, string>;
const MOVED = IDS['01-Corporate-Records/Stock-Agreement__20110607__Harbor-Labs.pdf']!;

/** Every page of every section of the overview, as one string. */
async function wholeOverview(ctx: ToolContext): Promise<string> {
  const out: unknown[] = [body(await overviewTool.handler(overviewTool.inputSchema.parse({}), ctx))];
  for (const section of ['tracks', 'violations', 'events', 'people', 'orgs', 'claims', 'money', 'docs']) {
    let cursor: string | undefined;
    do {
      const page = body(await overviewTool.handler(overviewTool.inputSchema.parse(cursor ? { section, cursor } : { section }), ctx));
      out.push(page);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  return JSON.stringify(out);
}

test('legallas_case_overview: owner and counsel keep every cite to a privileged document; the retired role is refused', async () => {
  const seeds = Object.entries(IDS).map(([path, id], i) => ({ id, path: id === MOVED ? `07-Lawyer-Notes-PRIVILEGED/${path.split('/').pop()}` : path, controlSeq: i + 1 }));
  const files = { get: async (key: string) => (key === MATTER_KEY ? { key, etag: `e${Math.random()}`, body: true, text: async () => MATTER } : null) };
  const context = (role: Role) => {
    resetOverviewCache();
    const { ctx } = toolCtx(catalogDb(seeds).db, undefined, role);
    (ctx.env as { FILES: unknown }).FILES = files;
    return ctx;
  };
  for (const role of ['owner', 'counsel'] as const) assert.ok((await wholeOverview(context(role))).includes(MOVED), role);
  const retired = context(RETIRED);
  for (const section of [undefined, 'events', 'docs']) {
    const out = await overviewTool.handler(overviewTool.inputSchema.parse(section ? { section } : {}), retired);
    refused(out, section ?? 'summary', new RegExp(MOVED));
  }
});
