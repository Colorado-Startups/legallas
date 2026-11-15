// SPDX-License-Identifier: Apache-2.0
// Contract v2 (data-room build, 2026-10-20): which app a grant belongs to, how much a result may carry for it, the
// shared result helpers, and the three tools first registered as stubs, all landed since (sessions 3 and 4).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { testDb } from '../worker/sqlite-d1.ts';
import { COMPACT_LIMITS, DAILY_DOWNLOAD_CAP, EMBED_MAX_BASE64_CHARS, PROFILE_OF, TOOL_NAMES, type McpEnv, type Props, type ToolDefinition } from './contract.ts';
import { downloadsToday } from './audit.ts';
import { decodeCursor, embeddable, embeddedResult, encodeCursor, fitToProfile, forProfile, imageResult, jsonResult, limitsFor, toolError } from './format.ts';
import { clearClientKindCache, clientKindOf, resolveClientKind, runTool, serveMcp } from './server.ts';
import { getCommentsTool } from './tools/comments.ts';
import { getFileTool } from './tools/files.ts';
import { body, catalogDb, toolCtx } from './tools/doc-fixtures.ts';
import { clientCtx, fakeFiles, pngBytes } from './tools/files-fixtures.ts';
import { listedTools } from './tools/index.ts';

test('clientKindOf reads the app from its redirect hosts', () => {
  assert.equal(clientKindOf(['https://claude.ai/api/mcp/auth_callback']), 'claude');
  assert.equal(clientKindOf(['https://claude.com/api/mcp/auth_callback', 'https://claude.ai/api/mcp/auth_callback']), 'claude');
  assert.equal(clientKindOf(['https://app.harvey.ai/oauth/callback']), 'harvey');
  assert.equal(clientKindOf(['https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect']), 'microsoft');
  assert.equal(clientKindOf(['https://global.consent.azure-apim.net/redirect/legallas']), 'microsoft');
});

test('clientKindOf falls back to unknown for anything mixed, plain http, foreign or empty', () => {
  assert.equal(clientKindOf(['https://claude.ai/cb', 'https://app.harvey.ai/cb']), 'unknown');
  assert.equal(clientKindOf(['http://claude.ai/api/mcp/auth_callback']), 'unknown');
  assert.equal(clientKindOf(['https://claude.ai.example.test/cb']), 'unknown');
  assert.equal(clientKindOf(['https://notharvey.ai/cb']), 'unknown');
  assert.equal(clientKindOf(['not a url']), 'unknown');
  assert.equal(clientKindOf([]), 'unknown');
  assert.equal(clientKindOf(undefined), 'unknown');
});

test('Microsoft and unknown clients get compact results; Claude and Harvey keep the standard caps', () => {
  assert.deepEqual(PROFILE_OF, { claude: 'standard', harvey: 'standard', microsoft: 'compact', unknown: 'compact' });
});

function providerReturning(uris: string[] | null, calls: string[]) {
  return {
    OAUTH_PROVIDER: {
      lookupClient: async (id: string) => {
        calls.push(id);
        return uris ? { clientId: id, redirectUris: uris } : null;
      },
    },
  } as unknown as Pick<McpEnv, 'OAUTH_PROVIDER'>;
}

test('resolveClientKind looks a non-Claude client up once per isolate', async () => {
  clearClientKindCache();
  const calls: string[] = [];
  const env = providerReturning(['https://app.harvey.ai/oauth/callback'], calls);
  assert.equal(await resolveClientKind(env, 'client-a'), 'harvey');
  assert.equal(await resolveClientKind(env, 'client-a'), 'harvey');
  assert.deepEqual(calls, ['client-a']);
});

test('resolveClientKind never caches claude, the kind that receives file bytes', async () => {
  clearClientKindCache();
  const calls: string[] = [];
  let uris = ['https://claude.ai/api/mcp/auth_callback'];
  const env = { OAUTH_PROVIDER: { lookupClient: async (id: string) => (calls.push(id), { clientId: id, redirectUris: uris }) } } as unknown as Pick<McpEnv, 'OAUTH_PROVIDER'>;
  assert.equal(await resolveClientKind(env, 'client-c'), 'claude');
  // The owner adds a foreign redirect on /admin/clients: the very next call stops treating the client as Claude.
  uris = [...uris, 'https://elsewhere.example.test/cb'];
  assert.equal(await resolveClientKind(env, 'client-c'), 'unknown');
  assert.deepEqual(calls, ['client-c', 'client-c']);
});

test('resolveClientKind is unknown when the client is missing, the lookup fails or there is no provider', async () => {
  clearClientKindCache();
  assert.equal(await resolveClientKind(providerReturning(null, []), 'gone'), 'unknown');
  const failing = { OAUTH_PROVIDER: { lookupClient: async () => Promise.reject(new Error('kv down')) } } as unknown as Pick<McpEnv, 'OAUTH_PROVIDER'>;
  assert.equal(await resolveClientKind(failing, 'flaky'), 'unknown');
  // A failed lookup is not cached: the next call asks again.
  const calls: string[] = [];
  assert.equal(await resolveClientKind(providerReturning(['https://app.harvey.ai/cb'], calls), 'flaky'), 'harvey');
  assert.deepEqual(calls, ['flaky']);
  assert.equal(await resolveClientKind({} as Pick<McpEnv, 'OAUTH_PROVIDER'>, 'none'), 'unknown');
});

test('limitsFor keeps a tool own caps for standard and narrows them for compact', () => {
  const own = { maxItems: 100, maxChars: 60_000 };
  assert.deepEqual(limitsFor('standard', own), own);
  assert.deepEqual(limitsFor('compact', own), COMPACT_LIMITS);
  assert.deepEqual(limitsFor('compact', { maxItems: 10, maxChars: 4_000 }), { maxItems: 10, maxChars: 4_000 });
});

test('fitToProfile keeps whole items within both limits and says where to resume', () => {
  const items = ['aaaa', 'bbbb', 'cccc', 'dddd'];
  assert.deepEqual(fitToProfile(items, { maxItems: 10, maxChars: 8 }, (s) => s.length), { items: ['aaaa', 'bbbb'], next: 2 });
  assert.deepEqual(fitToProfile(items, { maxItems: 3, maxChars: 1_000 }, (s) => s.length), { items: ['aaaa', 'bbbb', 'cccc'], next: 3 });
  assert.deepEqual(fitToProfile(items, { maxItems: 10, maxChars: 8 }, (s) => s.length, 2), { items: ['cccc', 'dddd'], next: null });
  // The first item always goes out, so a result is never empty while items remain.
  assert.deepEqual(fitToProfile(['x'.repeat(50), 'y'], { maxItems: 10, maxChars: 8 }, (s) => s.length), { items: ['x'.repeat(50)], next: 1 });
  assert.deepEqual(fitToProfile([], COMPACT_LIMITS, () => 1), { items: [], next: null });
});

test('cursors round-trip and anything else decodes to null', () => {
  const cursor = encodeCursor(['events', 40, 'é']);
  assert.match(cursor, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeCursor(cursor), ['events', 40, 'é']);
  for (const bad of [undefined, null, '', '!!', 'e30', encodeCursor(['ok']).slice(0, 3), 'x'.repeat(600)]) assert.equal(decodeCursor(bad), null, String(bad));
  assert.equal(decodeCursor(btoa(JSON.stringify({ a: 1 })).replace(/=+$/, '')), null);
});

test('embeddable follows the base64 budget', () => {
  const maxBytes = (EMBED_MAX_BASE64_CHARS / 4) * 3;
  assert.equal(embeddable(maxBytes), true);
  assert.equal(embeddable(maxBytes + 1), false);
});

test('image and embedded results keep the JSON text and structured content first', () => {
  const image = imageResult({ id: 'd1' }, { data: 'aGk=', mimeType: 'image/png' });
  assert.equal(image.content[0].type, 'text');
  assert.deepEqual(image.content[1], { type: 'image', data: 'aGk=', mimeType: 'image/png' });
  assert.deepEqual(image.structuredContent, { id: 'd1' });
  const pdf = embeddedResult({ id: 'd2' }, { uri: 'https://legallas.example/doc/?id=d2', mimeType: 'application/pdf', blob: 'JVBERi0=' });
  assert.deepEqual(pdf.content[1], { type: 'resource', resource: { uri: 'https://legallas.example/doc/?id=d2', mimeType: 'application/pdf', blob: 'JVBERi0=' } });
});

test('forProfile: standard is unchanged; compact sends the object once, minified, with no structured content', () => {
  const value = { results: [{ id: 'd1', text: 'A "quoted" passage.' }], next_cursor: 'abc' };
  const standard = jsonResult(value);
  assert.equal(forProfile('standard', standard), standard);
  assert.deepEqual(standard.content, [{ type: 'text', text: JSON.stringify(value) }], 'standard text is the same JSON, minified');
  const compact = forProfile('compact', jsonResult(value));
  assert.deepEqual(compact.content, [{ type: 'text', text: JSON.stringify(value) }]);
  assert.equal('structuredContent' in compact, false);
  assert.deepEqual(JSON.parse((compact.content[0] as { text: string }).text), value);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(standard).length, 'one copy, not two');
});

test('forProfile: a result made with a view keeps it as compact structured content; standard keeps the whole object', () => {
  const value = { documents: [{ id: 'd1', folder: '01-Contracts', pages: 9 }], total: 1 };
  const view = { documents: [{ id: 'd1' }], total: 1 };
  assert.deepEqual(forProfile('standard', jsonResult(value, view)).structuredContent, value);
  const compact = forProfile('compact', jsonResult(value, view));
  assert.deepEqual(compact, { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: view });
});

test('forProfile passes through errors, plain text, and image or PDF results; isError and _meta stay', () => {
  const error = toolError('daily_limit', 'The daily limit for AI tool calls is reached.');
  assert.equal(forProfile('compact', error), error);
  const plain = { content: [{ type: 'text' as const, text: 'hello' }] };
  assert.equal(forProfile('compact', plain), plain);
  const image = imageResult({ id: 'd1' }, { data: 'aGk=', mimeType: 'image/png' });
  assert.equal(forProfile('compact', image), image);
  const pdf = embeddedResult({ id: 'd2' }, { uri: 'https://legallas.example/doc/?id=d2', mimeType: 'application/pdf', blob: 'JVBERi0=' });
  assert.equal(forProfile('compact', pdf), pdf);
  const withMeta = forProfile('compact', { ...jsonResult({ id: 'd3' }), isError: false, _meta: { k: 'v' } });
  assert.deepEqual(withMeta, { content: [{ type: 'text', text: '{"id":"d3"}' }], isError: false, _meta: { k: 'v' } });
});

test('runTool sends each profile its own shape: compact once as minified text, standard as text and structured content', async () => {
  const { db, sqlite } = testDb();
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?, 'counsel', 'Counsel')").run(PROPS.email);
  const env = { DB: db, TEAM_DOMAIN: '', ACCESS_AUD: '' } as unknown as McpEnv;
  const value = { results: [{ id: 'd1' }], next_cursor: 'abc' };
  const probe: ToolDefinition = { name: 'legallas_search', title: 't', description: 'd', inputSchema: z.object({}), handler: async () => jsonResult(value) };
  const at = new Date('2026-10-20T12:00:00Z');
  for (const kind of ['microsoft', 'unknown'] as const) {
    const out = await runTool(probe, {}, env, PROPS, undefined, at, kind);
    assert.deepEqual(out, { content: [{ type: 'text', text: JSON.stringify(value) }] }, kind);
  }
  for (const kind of ['claude', 'harvey'] as const) {
    const out = await runTool(probe, {}, env, PROPS, undefined, at, kind);
    // Byte for byte what the handler made: the minified text plus the same object as structured content.
    assert.equal(JSON.stringify(out), JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }), kind);
  }
});

test('the registry holds contract tools only, each once, in contract order (pro adds its two: pro.test.ts)', () => {
  const names = listedTools().map((tool) => tool.name);
  assert.deepEqual(names, TOOL_NAMES.filter((name) => names.includes(name)));
  assert.equal(new Set(names).size, names.length);
});

// The stub check ends here: legallas_get_comments and legallas_get_file were the last stubs (session 3), so the test now
// asserts the opposite, that both run for real. tools/comments.test.ts and tools/files.test.ts cover what they return.
test('the tools first registered as stubs are implemented: none answers not_available', async () => {
  const { ctx } = toolCtx(catalogDb([]).db);
  for (const tool of [getCommentsTool, getFileTool]) {
    const out = await tool.handler({ id: 'd1' } as never, ctx);
    assert.equal(out.isError, true, tool.name);
    assert.match(String((out.content[0] as { text: string }).text), /^not_found: /, tool.name);
  }
});

const PROPS: Props = { email: 'counsel@example.test', role: 'counsel', clientId: 'client-1', clientName: 'Claude' };

test('runTool hands the client kind and its profile to the handler', async () => {
  const { db, sqlite } = testDb();
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?, 'counsel', 'Counsel')").run(PROPS.email);
  const seen: [string, string][] = [];
  const probe: ToolDefinition = {
    name: 'legallas_search',
    title: 't',
    description: 'd',
    inputSchema: z.object({}),
    handler: async (_args, ctx) => {
      seen.push([ctx.clientKind, ctx.profile]);
      return { content: [] };
    },
  };
  const env = { DB: db, TEAM_DOMAIN: '', ACCESS_AUD: '' } as unknown as McpEnv;
  await runTool(probe, {}, env, PROPS, undefined, new Date('2026-10-20T12:00:00Z'), 'microsoft');
  await runTool(probe, {}, env, PROPS, undefined, new Date('2026-10-20T12:00:00Z'), 'claude');
  await runTool(probe, {}, env, PROPS, undefined, new Date('2026-10-20T12:00:00Z'));
  assert.deepEqual(seen, [['microsoft', 'compact'], ['claude', 'standard'], ['unknown', 'compact']]);
});

test('downloadsToday counts only this member AI byte pulls on that UTC day', async () => {
  const { db, sqlite } = testDb();
  const insert = sqlite.prepare('INSERT INTO audit_log (ts, email, action, document_id, via) VALUES (?, ?, ?, ?, ?)');
  insert.run('2026-10-20T00:00:00.000Z', PROPS.email, 'download', 'd1', 'Claude');
  insert.run('2026-10-20T23:59:59.999Z', PROPS.email, 'download', 'd2', 'Claude');
  insert.run('2026-10-20T12:00:00.000Z', PROPS.email, 'download', 'd3', null);
  insert.run('2026-10-19T23:59:59.999Z', PROPS.email, 'download', 'd4', 'Claude');
  insert.run('2026-10-21T00:00:00.000Z', PROPS.email, 'download', 'd5', 'Claude');
  insert.run('2026-10-20T12:00:00.000Z', 'other@example.test', 'download', 'd6', 'Claude');
  insert.run('2026-10-20T12:00:00.000Z', PROPS.email, 'ai_read', 'd7', 'Claude');
  assert.equal(await downloadsToday(db, PROPS.email, '2026-10-20'), 2);
  assert.equal(await downloadsToday(db, PROPS.email, '2026-10-31'), 0);
  assert.ok(DAILY_DOWNLOAD_CAP > 0 && Number.isInteger(DAILY_DOWNLOAD_CAP));
});

describe('Gemini Enterprise grants (a kind from 2026-10-20 to 2026-10-31) are unknown', () => {
  // The only closed models the room connects are Claude, Copilot and Harvey (the owner, 2026-10-31). A grant made with
  // Gemini Enterprise's callback before then is sized and served like any app the room does not recognise.
  const CALLBACK = 'https://vertexaisearch.cloud.google.com/oauth-redirect';

  test('clientKindOf reads Gemini Enterprise\'s callback, and every Google host, as unknown', () => {
    for (const uris of [
      [CALLBACK],
      ['https://a.vertexaisearch.cloud.google.com/oauth-redirect'],
      ['https://vertexaisearch.cloud.google.com.evil.example/oauth-redirect'],
      ['http://vertexaisearch.cloud.google.com/oauth-redirect'],
      ['https://gemini.google.com/cb'],
      ['https://cloud.google.com/cb'],
      ['http://localhost:7777/oauth/callback'],
      [CALLBACK, 'https://claude.ai/api/mcp/auth_callback'],
      [CALLBACK, 'https://elsewhere.example.test/cb'],
    ]) {
      assert.equal(clientKindOf(uris), 'unknown', uris.join(' '));
    }
  });

  test('such a grant gets compact caps, as unknown apps do', () => {
    assert.equal(PROFILE_OF[clientKindOf([CALLBACK])], 'compact');
    const own = { maxItems: 100, maxChars: 60_000 };
    assert.deepEqual(limitsFor(PROFILE_OF[clientKindOf([CALLBACK])], own), COMPACT_LIMITS);
  });

  test('resolveClientKind reads such a grant as unknown and caches it, since unknown only sizes results', async () => {
    clearClientKindCache();
    const calls: string[] = [];
    const env = providerReturning([CALLBACK], calls);
    assert.equal(await resolveClientKind(env, 'client-g'), 'unknown');
    assert.equal(await resolveClientKind(env, 'client-g'), 'unknown');
    assert.deepEqual(calls, ['client-g']);
  });

  test('legallas_get_file gives such a grant text and pointers, never the bytes', async () => {
    const { db, sqlite } = catalogDb([{ id: 'img', path: '06-Photos/DOE-photo.png', kind: 'image', pages: null }]);
    const bytes = pngBytes(800, 600);
    sqlite.prepare("UPDATE documents SET content_type = 'image/png', size = ? WHERE id = 'img'").run(bytes.byteLength);
    const files = fakeFiles(new Map([['R2-LEAK-img', bytes]]));
    const { ctx, audits } = clientCtx(db, { clientKind: clientKindOf([CALLBACK]), files: files.bucket });
    const out = await getFileTool.handler(getFileTool.inputSchema.parse({ id: 'img' }), ctx);
    assert.deepEqual(out.content.map((c) => c.type), ['text']);
    assert.deepEqual([body(out).embedded, body(out).reason], [false, 'client']);
    assert.deepEqual(files.gets, [], 'the bytes are never read');
    assert.deepEqual(audits, [{ action: 'ai_read', documentId: 'img', via: 'Some App' }]);
  });
});

test("a client registered with an unsupported AI's callback is refused on /mcp, even with a live grant and no room policy", async (t) => {
  t.mock.method(console, 'warn', () => {});
  clearClientKindCache();
  const calls: string[] = [];
  const env = { ...providerReturning(['https://chatgpt.com/connector_platform_oauth_redirect'], calls), TEAM_DOMAIN: '', ACCESS_AUD: '' } as unknown as McpEnv;
  const props = { email: 'counsel@example.test', role: 'counsel', clientId: 'client-gpt', clientName: 'ChatGPT' } as const;
  const call = () => new Request('https://mcp.example.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  for (let i = 0; i < 2; i++) {
    const response = await serveMcp(call(), env, props);
    assert.equal(response.status, 403, 'refused on every call, cached or not');
    assert.deepEqual(await response.json(), { error: 'app_not_allowed' });
  }
  assert.deepEqual(calls, ['client-gpt']);
});

test("a metadata-document client on an unsupported AI's host is refused on /mcp without a fetch, so a failed one can't serve the call", async (t) => {
  t.mock.method(console, 'warn', () => {});
  clearClientKindCache();
  let fetched = 0;
  const env = { OAUTH_PROVIDER: { lookupClient: async () => { fetched++; throw new Error('fetch failed'); } }, TEAM_DOMAIN: '', ACCESS_AUD: '' } as unknown as McpEnv;
  const props = { email: 'counsel@example.test', role: 'counsel', clientId: 'https://chatgpt.com/oauth/client.json', clientName: 'ChatGPT' } as const;
  const response = await serveMcp(new Request('https://mcp.example.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  }), env, props);
  assert.equal(response.status, 403);
  assert.equal(fetched, 0);
});
