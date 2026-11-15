// SPDX-License-Identifier: Apache-2.0
// legallas_case_overview's checklist section on the fixture room (Doe v. Harbor Labs, prefix DOE): every item with its
// status and due dates, the documents matched to it as cites, a room link to the item, the summary's count, published
// matter or not, and nothing of it while the room's checklist is off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { BASELINE } from '../../worker/checklist-baseline.ts';
import { MATTER_KEY } from '../../worker/matter-types.ts';
import { roomToday } from '../../worker/routes/checklist.ts';
import { COMPACT_LIMITS, ROOM_ORIGIN, type McpEnv, type ToolContext } from '../contract.ts';
import { forProfile } from '../format.ts';
import { catalogDb, toolCtx } from './doc-fixtures.ts';
import { DOC_IDS, MATTER_JSON } from './overview-fixtures.ts';
import { checklistLink, roomDay } from './overview-checklist.ts';
import { overviewTool, resetOverviewCache } from './overview.ts';

type Value = Record<string, any>;
const DOCS = Object.values(DOC_IDS);
const SPA = DOCS[1]!;

/**
 * The fixture catalog, a signed founder stock purchase agreement matched on 2026-09-20, and the matter when published.
 * `entityType`: the one the room owner saved on /checklist/ (worker/company-settings.ts).
 */
function room(options: { published?: boolean; checklist?: boolean; entityType?: string } = {}): ToolContext {
  resetOverviewCache();
  const { db, sqlite } = catalogDb(DOCS.map((id, i) => ({ id, path: Object.keys(DOC_IDS)[i]!, controlSeq: i + 1 })));
  sqlite
    .prepare("INSERT INTO checklist_matches (id, item_id, document_id, signed, doc_date, matched_by, matched_at) VALUES ('m1', 'founders.stock-purchase-agreement', ?, 'yes', '2026-09-20', 'ada@firm.example', '2026-09-21T00:00:00Z')")
    .run(SPA);
  if (options.entityType) {
    sqlite.prepare("INSERT INTO company_settings (entity_type, set_by, set_at) VALUES (?, 'ada@firm.example', '2026-10-01T00:00:00.000Z')").run(options.entityType);
  }
  const { ctx } = toolCtx(db);
  const env = ctx.env as McpEnv & Record<string, unknown>;
  if (options.checklist !== false) env.CHECKLIST_ENABLED = '1';
  env.FILES = { get: async (key: string) => (key === MATTER_KEY && options.published !== false ? { key, etag: 'e1', body: true, text: async () => MATTER_JSON } : null) } as unknown as R2Bucket;
  return ctx;
}

async function call(ctx: ToolContext, args: Record<string, unknown>) {
  const out = await overviewTool.handler(overviewTool.inputSchema.parse(args), ctx);
  return { out, value: out.structuredContent as Value };
}

/** Every entry of the checklist section, following nextCursor. */
async function items(ctx: ToolContext): Promise<Value[]> {
  const all: Value[] = [];
  let cursor: string | undefined;
  do {
    const { out, value } = await call(ctx, cursor ? { section: 'checklist', cursor } : { section: 'checklist' });
    assert.equal(out.isError, undefined);
    all.push(...value.entries);
    cursor = value.nextCursor ?? undefined;
  } while (cursor);
  return all;
}

test('the entity type the owner saved on /checklist/ picks the items here too, so the AI and the page agree', async () => {
  const ids = (await items(room({ entityType: 'colorado-llc' }))).map((item) => item.id);
  assert.ok(ids.includes('formation.operating-agreement'));
  assert.equal(ids.includes('formation.bylaws'), false);
});

test('the checklist section lists every item with its status, due dates and matched documents as cites', async () => {
  const all = await items(room());
  assert.equal(all.length, BASELINE.items.length);
  assert.deepEqual(all.map((item) => item.id), BASELINE.items.map((item) => item.id));
  const spa = all.find((item) => item.id === 'founders.stock-purchase-agreement')!;
  assert.equal(spa.status, 'in_place');
  assert.equal(spa.evidence, undefined, 'a settled item leaves out what a complete copy looks like');
  assert.deepEqual(spa.cites, [{ control: 'DOE-000002', doc: SPA, link: `${ROOM_ORIGIN}/doc/?id=${SPA}`, signed: 'yes', date: '2026-09-20' }]);
  const election = all.find((item) => item.id === 'founders.section-83b-election')!;
  assert.equal(election.status, 'if_applies');
  assert.equal(election.link, `${ROOM_ORIGIN}/checklist/#founders.section-83b-election`);
  assert.ok(election.evidence, 'an open item says what a complete copy looks like');
  assert.equal(election.due.length, 1);
  assert.deepEqual([election.due[0].date, election.due[0].state], ['2026-10-20', 'soon']);
  assert.match(election.due[0].basis, /^30 days after 2026-09-20, the transfer date on the stock or unit agreement/);
  for (const item of all) {
    assert.equal(item.link, checklistLink(item.id));
    assert.ok(['in_place', 'check', 'missing', 'if_applies', 'not_applicable', 'not_yet'].includes(item.status), item.id);
    for (const due of item.due) assert.match(due.date, /^\d{4}-\d{2}-\d{2}$/, item.id);
  }
});

test('the summary counts the checklist, with the matter published or not', async () => {
  const published = (await call(room(), { section: 'summary' })).value;
  assert.equal(published.counts.checklist, BASELINE.items.length);
  assert.equal(published.retrieved, '2026-10-01');
  const unpublished = (await call(room({ published: false }), { section: 'summary' })).value;
  assert.deepEqual([unpublished.published, unpublished.counts], [false, { checklist: BASELINE.items.length }]);
  assert.equal((await items(room({ published: false }))).length, BASELINE.items.length, 'the section reads with no matter');
});

test('with the checklist off, the overview neither lists the section nor counts it, and refuses it', async () => {
  const ctx = room({ checklist: false });
  const listed = (env: Record<string, string>) => z.toJSONSchema(overviewTool.inputSchemaFor!(env as unknown as McpEnv)) as Value;
  assert.ok(!listed({}).properties.section.enum.includes('checklist'));
  assert.ok(listed({ CHECKLIST_ENABLED: '1' }).properties.section.enum.includes('checklist'));
  assert.equal((await call(ctx, { section: 'summary' })).value.counts.checklist, undefined);
  const { out } = await call(ctx, { section: 'checklist' });
  assert.equal(out.isError, true);
  assert.match((out.content[0] as { text: string }).text, /^unavailable:/);
});

test('a compact caller keeps a small view of each item: status, dates and its first cite', async () => {
  const ctx = { ...room(), clientKind: 'microsoft' as const, profile: 'compact' as const };
  const shaped = forProfile('compact', (await call(ctx, { section: 'checklist' })).out);
  const view = shaped.structuredContent as Value;
  const text = (shaped.content[0] as { text: string }).text;
  assert.ok(JSON.stringify(view).length < text.length);
  assert.ok(JSON.stringify(shaped).length <= COMPACT_LIMITS.maxChars, 'text and view together within the compact limit');
  const spa = view.entries.find((item: Value) => item.id === 'founders.stock-purchase-agreement');
  if (spa) assert.deepEqual(spa.cite, { control: 'DOE-000002', link: `${ROOM_ORIGIN}/doc/?id=${SPA}` });
  for (const item of view.entries) assert.deepEqual(Object.keys(item).filter((key) => !['id', 'title', 'stage', 'status', 'due', 'cite', 'link'].includes(key)), [], item.id);
});

test("the section's day is the room's: the same rule as the checklist page", () => {
  const at = new Date('2026-10-01T05:30:00Z');
  for (const zone of [undefined, '', 'America/Denver', 'Pacific/Kiritimati', 'Not/A_Zone']) assert.equal(roomDay(zone, at), roomToday(zone, at), String(zone));
});
