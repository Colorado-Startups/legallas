// SPDX-License-Identifier: Apache-2.0
// The views as the AI sees them (MCP Apps): each served as a ui:// resource of type text/html;profile=mcp-app, named by
// exactly the two tools' _meta, with the room's tool names inside, and pages that load and request nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpHandler, type CallToolResult } from '@modelcontextprotocol/server';
import { withGuestScope } from '../../worker/privilege.ts';
import type { ClientKind, McpEnv, Props, ToolContext } from '../contract.ts';
import { forProfile } from '../format.ts';
import { listDocumentsTool } from '../tools/documents.ts';
import { DOC_IDS, LIST_SECTIONS, overviewCtx, pages } from '../tools/overview-fixtures.ts';
// Pro adds the case overview (as the room's MCP entry does; connect/copilot/mcp-tools.ts lists the same way).
import '../pro.ts';
import { buildServer, GUEST_TOOLS } from '../server.ts';
import { CONFIG_ID, DATA_ID, scriptJson, viewConfig, viewDocument, viewHtml, VIEW_MIME, VIEW_OF_TOOL, VIEWS, type ViewName } from './views.ts';
import { VIEW_HTML } from './views.generated.ts';

const PROPS: Props = { email: 'counsel@example.test', role: 'counsel', clientId: 'client-1', clientName: 'Claude' };
const ENV = {} as McpEnv;
const VIEWED: Record<string, ViewName> = VIEW_OF_TOOL;

type Json = Record<string, any>;

/** One JSON-RPC call to a server built for `kind`, in memory (no network, no bindings touched). */
async function rpc(method: string, params: Json = {}, kind: ClientKind = 'claude', env: McpEnv = ENV): Promise<Json> {
  const request = new Request('https://mcp.example.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await (await createMcpHandler(() => buildServer(env, PROPS, undefined, undefined, kind)).fetch(request)).text();
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  assert.ok(data, `an SSE data line in: ${text.slice(0, 200)}`);
  const out = JSON.parse(data.slice('data: '.length)) as Json;
  assert.equal(out.error, undefined, JSON.stringify(out.error));
  return out.result as Json;
}

for (const kind of ['claude', 'microsoft'] as const) {
  test(`${kind}: the overview and the document list name their view, both visible to the model and the view; no other tool does`, async () => {
    const { tools } = await rpc('tools/list', {}, kind);
    for (const tool of tools as Json[]) {
      const view = VIEWED[tool.name];
      if (!view) {
        assert.equal(tool._meta?.ui, undefined, `${tool.name} has no view`);
        continue;
      }
      assert.equal(tool._meta.ui.resourceUri, VIEWS[view].uri);
      assert.deepEqual(tool._meta.ui.visibility, ['model', 'app']);
      assert.equal(tool._meta['ui/resourceUri'], VIEWS[view].uri);
    }
    assert.deepEqual(Object.keys(VIEWED).filter((name) => (tools as Json[]).some((tool) => tool.name === name)), Object.keys(VIEWED));
  });
}

test('both views are listed and read as text/html;profile=mcp-app, with no outside origin and no fixed domain', async () => {
  const { resources } = await rpc('resources/list');
  assert.deepEqual((resources as Json[]).map((r) => [r.uri, r.mimeType]).sort(), Object.values(VIEWS).map((v) => [v.uri, VIEW_MIME]).sort());
  for (const view of Object.keys(VIEWS) as ViewName[]) {
    const { contents } = await rpc('resources/read', { uri: VIEWS[view].uri });
    assert.equal(contents.length, 1);
    const [page] = contents as Json[];
    assert.equal(page.uri, VIEWS[view].uri);
    assert.equal(page.mimeType, VIEW_MIME);
    assert.match(page.text, /^<!doctype html>/);
    assert.equal(page.text, viewHtml(view, viewConfig()));
    // No csp: the hosts then allow no outside origin. No domain: the views need no stable origin (views.ts).
    assert.deepEqual(page._meta, { ui: { prefersBorder: true } });
  }
});

test("a room with its own tool prefix gets views that call its own tools", async () => {
  const env = { MCP_TOOL_PREFIX: 'acme_' } as unknown as McpEnv;
  const { tools } = await rpc('tools/list', {}, 'claude', env);
  const names = (tools as Json[]).map((tool) => tool.name as string);
  const config = viewConfig('acme_');
  assert.ok(names.includes(config.tools.overview) && names.includes(config.tools.list) && names.includes(config.tools.read), JSON.stringify({ names, config }));
  const { contents } = await rpc('resources/read', { uri: VIEWS.grid.uri }, 'claude', env);
  assert.ok(contents[0].text.includes(`<script type="application/json" id="${CONFIG_ID}">${scriptJson(config)}</script>`));
});

/** What a page could fetch, load, or open a connection with. A view has none of it (the host's policy blocks it too). */
const NETWORK = [
  /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/, /importScripts/, /\bimport\s*\(/, /new\s+(?:Shared)?Worker\b/,
  /<link\b/i, /<iframe\b/i, /<img\b/i, /<script[^>]+\bsrc=/i, /\bsrc\s*=\s*["']?(?:https?:)?\/\//i, /url\(\s*["']?(?:https?:)?\/\//i, /@import/i,
];

for (const view of Object.keys(VIEWS) as ViewName[]) {
  test(`${view}: one self-contained page that requests nothing`, () => {
    const page = VIEW_HTML[view];
    for (const pattern of NETWORK) assert.doesNotMatch(page, pattern);
    assert.equal(page.match(/<script\b/gi)?.length ?? 0, page.includes('<script>') ? 1 : 0, 'one inline script at most, before the config is added');
    assert.equal(page.match(/<\/script/gi)?.length ?? 0, page.match(/<script\b/gi)?.length ?? 0, 'nothing in the code closes its script early');
  });
}

test('a page saved for the binder carries its result inside, and case text cannot close the block it sits in', () => {
  const hostile = '</script><script>parent.postMessage("x","*")</script><!--';
  const result = { content: [{ type: 'text', text: hostile }], structuredContent: { section: 'events', entries: [{ id: 'e1', title: hostile }] } };
  const page = viewDocument('overview', result, viewConfig(), { section: 'events' });
  const block = new RegExp(`<script type="application/json" id="${DATA_ID}">([^<]*)</script>`).exec(page);
  assert.ok(block, 'the data block');
  assert.deepEqual(JSON.parse(block[1]!), { result, args: { section: 'events' } });
  assert.ok(!page.slice(0, page.indexOf('</head>')).includes('<!--'), 'no comment opened in the head');
  assert.equal(page.split(hostile).length, 1, 'the hostile text never appears raw');
});

// The investor rule at the fields the views read: an investor's AI reads as a room reader (#825), and every row the
// grid, the board or the timeline could draw comes from these structured copies.
const ROOM = 'aaaa0000-0000-4000-8000-000000000001';
const IDS = Object.values(DOC_IDS);
/** Filed under a privileged folder (overviewCtx): DOE-000001. A room folder can never be a privileged one (migration 0012). */
const FILED = IDS[0]!;
/** Marked privileged in the manifest, in a folder of the room: DOE-000002. */
const MARKED = IDS[1]!;
const HIDDEN: readonly [string, RegExp][] = [[FILED, /DOE-000001(?!\d)/], [MARKED, /DOE-000002(?!\d)/]];

/** Every structured copy a view reads, as `ctx` gets it: each page of the document list and of every overview section. */
async function viewed(ctx: ToolContext): Promise<string> {
  const copies: unknown[] = [];
  const keep = (result: CallToolResult) => copies.push(forProfile(ctx.profile, result).structuredContent ?? null);
  let cursor: string | undefined;
  do {
    const result = await listDocumentsTool.handler(listDocumentsTool.inputSchema.parse(cursor ? { cursor } : {}), ctx);
    assert.equal(result.isError, undefined);
    keep(result);
    cursor = (result.structuredContent as Json).next_cursor;
  } while (cursor);
  for (const section of ['summary', ...LIST_SECTIONS]) for (const page of await pages(ctx, section)) keep(page.result);
  return JSON.stringify(copies).toLowerCase();
}

for (const profile of ['standard', 'compact'] as const) {
  test(`${profile}: an investor's views never carry a privileged document's id or control number; the owner's do`, async () => {
    const ctx = overviewCtx({ privileged: [FILED], profile });
    const folders = [...new Set(Object.keys(DOC_IDS).map((path) => path.split('/')[0]!))];
    await ctx.env.DB.prepare("INSERT INTO rooms (id, kind, name, created_by) VALUES (?1, 'deal', 'Seed round', 'owner-cli')").bind(ROOM).run();
    for (const [i, folder] of folders.entries()) {
      await ctx.env.DB.prepare("INSERT INTO room_folders (id, room_id, folder, added_by) VALUES (?1, ?2, ?3, 'owner-cli')").bind(`f${i}`, ROOM, folder).run();
    }
    const investor = await withGuestScope({ rooms: [ROOM], folders, marks: new Set([MARKED.toLowerCase()]) }, (role) => viewed({ ...ctx, member: { ...ctx.member, role } }));
    const owner = await viewed({ ...ctx, member: { ...ctx.member, role: 'owner' } });
    assert.match(investor, /doe-000003(?!\d)/, "the investor still sees the room's other documents");
    for (const [id, control] of HIDDEN) {
      assert.ok(!investor.includes(id.toLowerCase()), `the investor's views carry ${control.source}'s document id`);
      assert.doesNotMatch(investor, new RegExp(control.source, 'i'));
      assert.ok(owner.includes(id.toLowerCase()) && new RegExp(control.source, 'i').test(owner), `the owner's views show ${control.source}`);
    }
    assert.ok(!GUEST_TOOLS.has('legallas_case_overview'), "and the server never lets a guest's AI call the overview at all");
  });
}
