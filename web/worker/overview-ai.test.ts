// SPDX-License-Identifier: Apache-2.0
// #204: the Overview's AI panel leaves the Worker in the member's shape, so the page holds nothing invisible. A slow or
// failing lookup sends the page as built, which the panel's own script shapes as it always did. HTMLRewriter exists
// only in the Workers runtime, so a stand-in records what the page is told to change.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { MemberGrantsApi } from '../mcp/member-grants.ts';
import { appLabel } from './ai-label.ts';
import { keepsOwnOrder, panelShape, SHAPE_WAIT_MS, shapePanel, trimmedCards, type PanelShape } from './overview-ai.ts';
import { AI_APPS } from '../src/scripts/connect-order.ts';
import { PANEL_ORDER } from '../mcp/pages/connect.ts';
import { ORDER_COOKIE } from './ai-label.ts';
import { servePage } from './room-shape.ts';

const counsel = { role: 'counsel' as const, email: 'dev-counsel@example.test' };
const grants = (live: MemberGrantsApi['live']) => ({ live }) as MemberGrantsApi;

test('the shape follows the member\'s live AI connection', async () => {
  assert.deepEqual(await panelShape(grants(async () => ({ connected: false, via: null, at: null })), counsel), { state: 'open' });
  assert.deepEqual(
    await panelShape(grants(async () => ({ connected: true, via: 'claude.ai', at: '2026-01-02T03:04:05Z' })), counsel),
    { state: 'connected', via: 'Claude' },
  );
  assert.deepEqual(await panelShape(undefined, counsel), { state: 'open' }, 'no legallas-mcp to ask: the cards, as /api/me/ai says');
  assert.deepEqual(await panelShape(grants(async () => ({ connected: true, via: null, at: null })), { ...counsel, role: 'family' as never }), { state: 'none' }, 'a role that may not connect sees no panel');
});

test('a failed lookup is the cards, as /api/me/ai answers it', async (t) => {
  t.mock.method(console, 'error', () => undefined);
  assert.deepEqual(await panelShape(grants(async () => { throw new TypeError('away'); }), counsel), { state: 'open' });
});

test('a lookup slower than the wait gives no shape, so the page goes out as built', async () => {
  assert.ok(SHAPE_WAIT_MS > 0 && SHAPE_WAIT_MS <= 500, 'a page never waits long on it');
  const never = grants(() => new Promise(() => undefined));
  const started = Date.now();
  assert.equal(await panelShape(never, counsel, 20), null);
  assert.ok(Date.now() - started < 1000);
});

test('the Connected line names the app as the panel\'s script did', () => {
  assert.equal(appLabel('claude.ai'), 'Claude');
  assert.equal(appLabel('CLAUDE.COM'), 'Claude');
  assert.equal(appLabel(' Harvey '), 'Harvey');
  assert.equal(appLabel(null), 'your AI');
  assert.equal(appLabel(''), 'your AI');
});

/** Records the element changes HTMLRewriter would make, per selector. */
class Recorder {
  static made: Recorder[] = [];
  handlers: [string, { element: (el: unknown) => void }][] = [];
  constructor() {
    Recorder.made.push(this);
  }
  on(selector: string, handler: { element: (el: unknown) => void }) {
    this.handlers.push([selector, handler]);
    return this;
  }
  transform(page: Response) {
    return page;
  }
  apply(selector: string): Record<string, string | null> {
    const changes: Record<string, string | null> = {};
    const el = {
      setAttribute: (name: string, value: string) => void (changes[name] = value),
      removeAttribute: (name: string) => void (changes[name] = null),
      setInnerContent: (text: string) => void (changes['#text'] = text),
      remove: () => void (changes['#removed'] = 'yes'),
    };
    for (const [on, handler] of this.handlers) if (on === selector) handler.element(el);
    return changes;
  }
}

/** HTMLRewriter is a Workers global, absent under Node: the Recorder stands in for one test. */
function useRecorder(t: { after: (fn: () => void) => void }): void {
  const g = globalThis as { HTMLRewriter?: unknown };
  const had = Object.hasOwn(g, 'HTMLRewriter');
  const before = g.HTMLRewriter;
  g.HTMLRewriter = Recorder;
  t.after(() => {
    if (had) g.HTMLRewriter = before;
    else delete g.HTMLRewriter;
  });
}

test('the panel leaves in its shape, held no longer, marked so its script keeps it', (t) => {
  useRecorder(t);
  const page = new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } });
  const cases: [PanelShape, Record<string, string | null>, Record<string, string | null>][] = [
    [{ state: 'open' }, { 'data-state': 'open', 'data-shaped': 'server', 'aria-busy': null }, {}],
    [{ state: 'connected', via: 'Claude' }, { 'data-state': 'connected', 'data-shaped': 'server', 'aria-busy': null, 'aria-labelledby': 'ov-ai-line' }, { '#text': 'Claude' }],
    [{ state: 'none' }, { 'data-state': 'none', 'data-shaped': 'server', 'aria-busy': null, hidden: '' }, {}],
  ];
  for (const [shape, panel, via] of cases) {
    Recorder.made = [];
    shapePanel(page, shape);
    assert.deepEqual(Recorder.made[0]!.apply('[data-connect-first]'), panel, shape.state);
    assert.deepEqual(Recorder.made[0]!.apply('[data-connect-first] [data-ov-ai-via]'), via, shape.state);
  }
});

test('the founder\'s panel leaves Harvey out, as the founder\'s /connect panel does; counsel keep every card', (t) => {
  for (const [role, reader] of [['owner', 'founder'], ['counsel', 'counsel']] as const) {
    assert.deepEqual(trimmedCards(role), AI_APPS.filter((app) => !(PANEL_ORDER[reader] as readonly string[]).includes(app)), role);
  }
  useRecorder(t);
  const page = new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } });
  Recorder.made = [];
  shapePanel(page, { state: 'open' }, 'owner');
  assert.deepEqual(Recorder.made[0]!.apply('[data-connect-first] [data-ai="harvey"]'), { '#removed': 'yes' });
  Recorder.made = [];
  shapePanel(page, { state: 'open' }, 'counsel');
  assert.deepEqual(Recorder.made[0]!.apply('[data-connect-first] [data-ai="harvey"]'), {}, 'counsel still find Harvey');
});

function room(live: MemberGrantsApi['live']) {
  let asked = 0;
  const env = {
    FILES: { head: async () => null } as unknown as R2Bucket,
    ASSETS: { fetch: async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }) } as unknown as Fetcher,
    MCP_GRANTS: grants(async (email) => ((asked += 1), live(email))),
  };
  return { env, asked: () => asked };
}

const load = (env: Parameters<typeof servePage>[1], path: string, member?: typeof counsel, cookie?: string) => {
  const url = new URL(path, 'https://room.example.test');
  return servePage(new Request(url, { headers: { Accept: 'text/html', ...(cookie ? { Cookie: cookie } : {}) } }), env, url, member);
};

test('a load that picks a card order, or a browser that keeps one, goes out as built, so no card moves on screen', async (t) => {
  useRecorder(t);
  const { env, asked } = room(async () => ({ connected: false, via: null, at: null }));
  Recorder.made = [];
  await load(env, '/?ai=harvey,claude', counsel);
  await load(env, '/', counsel, `theme=light; ${ORDER_COOKIE}=1`);
  assert.equal(asked(), 0);
  assert.equal(Recorder.made.length, 0);
  const at = (path: string, cookie = '') => keepsOwnOrder(new Request(`https://room.example.test${path}`, { headers: { Cookie: cookie } }), new URL(path, 'https://room.example.test'));
  assert.equal(at('/'), false);
  assert.equal(at('/', 'not_ai_order=1'), false, 'only the cookie itself');
  assert.equal(at('/?ai='), true);
});

test('in a company room the Overview gets both its shape and its panel', async (t) => {
  useRecorder(t);
  const { env } = room(async () => ({ connected: false, via: null, at: null }));
  const company = { ...env, COMPANY_ROOM_ENABLED: '1' };
  Recorder.made = [];
  await load(company, '/', counsel);
  assert.equal(Recorder.made.length, 2, 'the company shape, then the panel');
  assert.deepEqual(Recorder.made[1]!.apply('[data-connect-first]')['data-state'], 'open');
});

test('the shaped page drops the built file\'s ETag', (t) => {
  useRecorder(t);
  const page = new Response('<html></html>', { headers: { 'Content-Type': 'text/html', ETag: '"built"' } });
  assert.equal(shapePanel(page, { state: 'open' }).headers.get('ETag'), null);
});

test('only the Overview, loaded by a member, asks for the shape', async (t) => {
  useRecorder(t);
  const { env, asked } = room(async () => ({ connected: false, via: null, at: null }));
  Recorder.made = [];
  await load(env, '/', counsel);
  assert.equal(asked(), 1);
  assert.equal(Recorder.made.length, 1, 'the Overview is shaped');
  Recorder.made = [];
  for (const path of ['/documents/', '/chronology/']) await load(env, path, counsel);
  await load(env, '/');
  assert.equal(asked(), 1, 'no other page, and no page without a member, pays for the lookup');
  assert.equal(Recorder.made.length, 0);
});

test('a slow lookup sends the Overview as built', async (t) => {
  useRecorder(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { env } = room(() => new Promise(() => undefined));
  Recorder.made = [];
  const served = load(env, '/', counsel);
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(SHAPE_WAIT_MS);
  assert.equal(await (await served).text(), '<html></html>');
  assert.equal(Recorder.made.length, 0, 'nothing rewritten');
});
