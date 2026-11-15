// SPDX-License-Identifier: Apache-2.0
// Planted canaries (OWASP LLM02; ASVS 8.3.3): text an investor must never receive, in documents outside what the room
// shows (a sibling folder with the same prefix, another room's folder, a privileged path, a manifest-marked document,
// personal data under a folder guide) and in comments they may not read. Every guest GET route is walked, for the
// room's own documents and each planted one, so a guest route added later is walked too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetDocFactsCache } from './doc-facts-serve.ts';
import type { Env } from './env.ts';
import { handle } from './index.ts';
import { COUNSEL, DOC, fakeFiles, HOST, IVY, OTTO, ROOM_A, roomsDb, roomsEnv } from './rooms-fixtures.ts';
import { GUEST_ROUTES } from './routes/rooms.ts';

const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;
const CANARY = 'CANARY-7Q4X';
const VIEWER = { 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Site': 'same-origin' };

test('planted canaries never reach a guest', async () => {
  const { db, sqlite } = roomsDb();
  const planted = [
    ['00000000-0000-4000-8000-000000000301', `Deals/Harbor Seed Two/${CANARY} sibling.pdf`],
    ['00000000-0000-4000-8000-000000000302', `Deals/Other Deal/${CANARY} other room.pdf`],
    ['00000000-0000-4000-8000-000000000303', `Deals/Harbor Seed/Privileged/${CANARY} memo.pdf`],
    ['00000000-0000-4000-8000-000000000304', `Deals/Harbor Seed/.claude/${CANARY} SSN 078-05-1120.md`],
  ] as const;
  for (const [id, path] of planted) {
    const slash = path.lastIndexOf('/');
    sqlite
      .prepare("INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at) VALUES (?1, ?2, ?3, ?4, 'pdf', 'application/pdf', 10, ?5, 'mirror', '2026-02-01T00:00:00.000Z')")
      .run(id, path, path.slice(0, slash), path.slice(slash + 1), `r2-canary-${id}`);
  }
  // The manifest-marked document and every planted one carry the canary in their bytes; counsel's advice and another
  // investor's question carry it in their text.
  const secret = new Set([...planted.map(([id]) => `r2-canary-${id}`), `r2-${DOC.privilegedMark.id}`]);
  const files = fakeFiles();
  const bytes = {
    async get(key: string, options?: unknown) {
      if (!secret.has(key)) return files.get(key, options as never);
      const body = new TextEncoder().encode(`${CANARY} 078-05-1120`);
      return { key, size: body.length, body: new Response(body).body };
    },
  } as unknown as R2Bucket;
  const comment = (cid: string, email: string, room: string | null) =>
    sqlite.prepare('INSERT INTO comments (id, document_id, author_email, body, room_id) VALUES (?1, ?2, ?3, ?4, ?5)').run(cid, DOC.term.id, email, `${CANARY} from ${cid}`, room);
  comment('counsel-advice', COUNSEL, null);
  comment('otto-question', OTTO, ROOM_A);

  const ids = [...[DOC.term.id, DOC.cap.id, DOC.visual.id, DOC.privilegedMark.id, DOC.sibling.id, DOC.otherCase.id], ...planted.map(([id]) => id)];
  const paths = new Set<string>();
  for (const route of GUEST_ROUTES.filter((r) => r.method === 'GET')) {
    if (!route.path.includes(':id')) paths.add(route.path.replace(':room', ROOM_A));
    else for (const id of ids) paths.add(route.path.replace(':room', ROOM_A).replace(':id', id));
  }
  let walked = 0;
  for (const path of paths) {
    resetDocFactsCache();
    const env = { ...roomsEnv(db, IVY).env, FILES: bytes } as Env;
    const res = await handle(new Request(`${HOST}${path}`, { headers: VIEWER }), env, ctx);
    const text = await res.text();
    assert.ok(!text.includes(CANARY) && !text.includes('078-05-1120'), `${path} (${res.status}) leaked a canary`);
    walked++;
  }
  assert.ok(walked >= 20, `walked ${walked} guest requests`);
});
