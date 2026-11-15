// SPDX-License-Identifier: Apache-2.0
// Every route the room serves, walked through the real gate on real SQLite as a stranger, as counsel and as the owner, so a
// route that forgets its permission check fails here. rooms-access.test.ts walks them as a guest. The Data room page
// (quality-speed/pages/data-room/list.ts) reads these three tests by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canPerform } from './auth.ts';
import { handle } from './index.ts';
import { roomRoutes } from './room.ts';
import { COUNSEL, DOC, HOST, OWNER, roomsDb, roomsEnv, SAME_ORIGIN, STRANGER } from './rooms-fixtures.ts';
import type { Env, Member } from './env.ts';
import type { Route } from './router.ts';

const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;

/** What only the owner may reach: the activity log, its copy, the full notice's ticks, a room's guest preview and document history, by the role matrix, and the research socket's probe, by its own check. */
const OWNER_ONLY = new Set([
  'GET /api/activity',
  'GET /api/activity/audit-log.jsonl',
  'GET /api/activity/notice',
  'GET /api/research/probe',
  'GET /api/rooms/:room/preview',
  'GET /api/documents/:id/versions',
  'GET /files/:id/versions/:n',
  'GET /api/rooms/:room/as-of',
  'GET /api/litigation/as-of',
]);

const pathOf = (route: Route) => route.path.replace(/:(\w+)/g, (_m, name: string) => (name === 'id' ? DOC.term.id : 'x'));

/**
 * The status of one request to `route` as `email`, with the headers a same-origin page and socket send, so a 403 means the
 * person was refused. A handler may throw on a binding the fixtures lack: it was reached, and that's all this asks.
 */
async function status(db: D1Database, email: string, route: Route, settings: Record<string, string> = {}): Promise<number | 'reached'> {
  const headers = { ...SAME_ORIGIN, Upgrade: 'websocket' };
  const init = { method: route.method, headers, body: route.method === 'GET' || route.method === 'HEAD' ? undefined : '{}' };
  try {
    return (await handle(new Request(`${HOST}${pathOf(route)}`, init), { ...roomsEnv(db, email).env, ...settings } as Env, ctx)).status;
  } catch {
    return 'reached';
  }
}

test('a stranger is refused on every route', async () => {
  const { db } = roomsDb();
  const routes = roomRoutes();
  assert.ok(routes.length > 20, 'the walk covers the whole table');
  for (const route of routes) assert.equal(await status(db, STRANGER, route), 403, `${route.method} ${route.path}`);
});

test('counsel is refused exactly what the role matrix refuses', async () => {
  assert.equal(canPerform('counsel', 'viewActivity'), false, 'the routes in OWNER_ONLY are refused because of this');
  const { db } = roomsDb();
  for (const route of roomRoutes()) {
    const got = await status(db, COUNSEL, route);
    if (OWNER_ONLY.has(`${route.method} ${route.path}`)) assert.equal(got, 403, `${route.method} ${route.path}`);
    else assert.notEqual(got, 403, `${route.method} ${route.path}`);
  }
});

test('the owner is refused nothing', async () => {
  const { db } = roomsDb();
  for (const route of roomRoutes()) assert.notEqual(await status(db, OWNER, route), 403, `${route.method} ${route.path}`);
});

/** The routes a room adds with a setting: the proposals and the checklist. The walks above see only the core table. */
const SETTINGS = { PROPOSALS_ENABLED: '1', CHECKLIST_ENABLED: '1' };
/** Of those, what only the owner may reach: the company's own facts, by the role matrix (setCompany). */
const OWNER_ONLY_SETTING = new Set(['PUT /api/checklist/company']);
const settingRoutes = () => {
  const core = new Set(roomRoutes().map((route) => `${route.method} ${route.path}`));
  return roomRoutes(SETTINGS).filter((route) => !core.has(`${route.method} ${route.path}`));
};

test('with their settings on, the proposal and checklist routes are walked too (#285)', async () => {
  const added = settingRoutes();
  assert.ok(added.filter((route) => route.path.startsWith('/api/proposals')).length >= 5, 'every /api/proposals route');
  assert.equal(canPerform('counsel', 'setCompany'), false, 'the routes in OWNER_ONLY_SETTING are refused because of this');
  const { db } = roomsDb();
  for (const name of OWNER_ONLY_SETTING) assert.ok(added.some((route) => `${route.method} ${route.path}` === name), `${name} is still a route`);
  for (const route of added) {
    const name = `${route.method} ${route.path}`;
    assert.equal(await status(db, STRANGER, route, SETTINGS), 403, `a stranger: ${name}`);
    const counsel = await status(db, COUNSEL, route, SETTINGS);
    if (OWNER_ONLY_SETTING.has(name)) assert.equal(counsel, 403, `counsel: ${name}`);
    else assert.notEqual(counsel, 403, `counsel: ${name}`);
    assert.notEqual(await status(db, OWNER, route, SETTINGS), 403, `the owner: ${name}`);
  }
});

/**
 * The routes that serve any member about themselves, and nothing about the room: who they are, their own AI connection,
 * whether research is open to them (it says `enabled: false` here, checked below), and ending their own research
 * sessions, which a sign-out must never be refused.
 */
const SELF_ONLY = new Set(['GET /api/me', 'GET /api/me/ai', 'GET /api/research', 'POST /api/research/signout']);

test('a member whose role allows nothing is refused on every route but their own /api/me, so no handler can drop its check (#285)', async () => {
  // No role in the matrix lacks `download`, so the walks above could not see a handler that forgot to ask for it
  // (worker/export.ts did). A role the matrix doesn't list is allowed nothing (canPerform), so each handler's own check
  // is the only thing that can refuse it here: the gate's member lookup is skipped by calling the handler itself.
  assert.equal(canPerform('family' as Member['role'], 'view'), false);
  const { db } = roomsDb();
  const env = { ...roomsEnv(db, COUNSEL).env, ...SETTINGS } as Env;
  const member = { email: 'nobody@example.test', role: 'family', name: null } as unknown as Member;
  const routes = roomRoutes(SETTINGS);
  for (const name of SELF_ONLY) assert.ok(routes.some((route) => `${route.method} ${route.path}` === name), `${name} is still a route`);
  for (const route of routes) {
    const name = `${route.method} ${route.path}`;
    const request = new Request(`${HOST}${pathOf(route)}`, {
      method: route.method,
      headers: { ...SAME_ORIGIN, Upgrade: 'websocket' },
      body: route.method === 'GET' || route.method === 'HEAD' ? undefined : '{}',
    });
    const params = Object.fromEntries([...route.path.matchAll(/:(\w+)/g)].map(([, key]) => [key!, key === 'id' ? DOC.term.id : 'x']));
    let got: number | 'threw';
    let body: unknown = null;
    try {
      const response = await route.handler({ request, env, ctx, url: new URL(request.url), member, params });
      got = response.status;
      if (name === 'GET /api/research' || name === 'GET /api/me/ai' || got === 403) body = await response.json();
    } catch {
      got = 'threw';
    }
    // A self-only handler may throw on a binding the fixtures lack: it was reached, which is all it is asked.
    if (SELF_ONLY.has(name)) assert.notEqual(got, 403, name);
    else {
      assert.equal(got, 403, name);
      // Refused for the role, not for some other check (a socket's origin, say) that would hide a missing one.
      assert.equal((body as { error?: unknown }).error, 'forbidden', name);
    }
    if (name === 'GET /api/research') assert.equal((body as { enabled?: unknown }).enabled, false, 'research is not open to them');
    if (name === 'GET /api/me/ai') assert.equal((body as { ai?: { connected?: unknown } }).ai?.connected, false, 'and no AI lookup for them');
  }
});
