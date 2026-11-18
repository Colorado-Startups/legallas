// SPDX-License-Identifier: Apache-2.0
// What would really hurt a customer through the room's sync endpoints: a stored original lost, a file arriving damaged, a
// half-finished run in the record, two devices at once, a secret printed. A real folder, the real engine, and the Worker's
// real routes on real SQLite. The server here stands in for Access: it checks the token's headers, then passes the request
// on without the secret.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { DatabaseSync } from 'node:sqlite';
import { applyPlan } from './apply.ts';
import { configuredStoredName } from './config.ts';
import { diffSync, type DocumentRow } from './diff.ts';
import { directTextPages } from './extract.ts';
import { guardWalk } from './guard.ts';
import { loadModule } from './load-module.ts';
import { RECORD_BATCH, roomOrigin, roomSync, type RoomSyncOptions } from './room-sync.ts';
import { saveBack } from './saveback.ts';
import { createSnapshot, MidSyncChange } from './snapshot.ts';
import { MIRROR_ROWS_SQL } from './sqlplan.ts';
import { leavesPrivilege } from '../worker/sync-rules.ts';

interface Bucket {
  objects: Map<string, { bytes: Uint8Array }>;
  deleted: string[];
}

interface Room {
  env: { SEARCH: { jobs: { create: () => Promise<unknown> } } };
  sqlite: DatabaseSync;
  files: Bucket;
  index: Bucket;
}

const { syncRoom, CLIENT, ORIGIN } = await loadModule<{ syncRoom: () => Room; CLIENT: string; ORIGIN: string }>('worker/sync-fixtures.ts');
const { handleSync } = await loadModule<{ handleSync: (request: Request, env: unknown, url: URL, clientId: string | null) => Promise<Response> }>('worker/routes/sync.ts');
// The record hashes a large file's bytes with Workers' crypto.DigestStream; this installs it on Node.
await loadModule('worker/digest-fixtures.ts');

const SECRET = 'cfast_invented_secret_for_this_test';
const WEB = path.resolve(import.meta.dirname, '..');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function client(room: Room, extra: Partial<RoomSyncOptions> = {}, fault: (url: string, method: string) => Response | null = () => null) {
  const fetcher: typeof fetch = async (input, init) => {
    const faulty = fault(String(input), init?.method ?? 'GET');
    if (faulty) return faulty;
    const headers = new Headers(init?.headers);
    headers.delete('CF-Access-Client-Secret');
    const body = init?.body;
    if (body !== undefined && body !== null) headers.set('Content-Length', String(body instanceof Blob ? body.size : Buffer.byteLength(body as string)));
    const url = String(input);
    const request = new Request(url, { method: init?.method, headers, ...(body !== undefined ? { body, duplex: 'half' } : {}) } as RequestInit);
    return handleSync(request, room.env, new URL(url), CLIENT);
  };
  return roomSync({ origin: ORIGIN, clientId: CLIENT, clientSecret: SECRET, device: 'laptop one', fetcher, retryDelayMs: 0, ...extra });
}

async function folder() {
  const parent = await mkdtemp(path.join(tmpdir(), 'legallas-room-sync-'));
  const root = path.join(parent, 'Company Documents');
  await mkdir(path.join(root, 'Founders'), { recursive: true });
  await writeFile(path.join(root, 'Founders', 'Notes for Résumé.md'), '# Notes\n\nInvented notes.');
  await writeFile(path.join(root, 'guide.md'), '# Guide\n\nInvented guide.');
  await writeFile(path.join(root, 'plain.txt'), 'Invented plain text.');
  const config = path.join(parent, 'room.config.json');
  // The stored name the command's preload reads from this checkout's own room config, so a room with a name of its
  // own runs these tests too (config.ts assertStoredName).
  const storedName = configuredStoredName();
  await writeFile(config, JSON.stringify({ sourceRoot: root, inboxDir: path.join(parent, 'From counsel'), cacheDir: path.join(parent, 'cache'), storedName }));
  return { parent, root, cache: path.join(parent, 'cache'), config, done: () => rm(parent, { recursive: true, force: true }) };
}

type Folder = Awaited<ReturnType<typeof folder>>;
type Sync = ReturnType<typeof client>;
let runs = 0;

async function runOnce(sync: Sync, f: Folder, verifyOriginals: () => Promise<void> = async () => undefined) {
  const { files } = await guardWalk(f.root, async () => null);
  const snapshot = await createSnapshot(files, f.cache, `r${(runs += 1)}`, (from, to) => copyFile(from, to));
  const plan = diffSync(snapshot.files, (await sync.d1Query(MIRROR_ROWS_SQL)) as unknown as DocumentRow[], randomUUID, (from, to) => !leavesPrivilege(from, to));
  await sync.acquire();
  try {
    return await applyPlan(plan, {
      wrangler: sync,
      extractPdf: async () => [],
      readText: directTextPages,
      verifyOriginals,
      workDir: snapshot.dir,
      cacheDir: f.cache,
      inboxDir: path.join(f.parent, 'From counsel'),
      now: new Date().toISOString(),
      log: () => undefined,
      quarantine: async () => undefined,
    });
  } finally {
    await sync.release();
  }
}

const rows = (room: Room) =>
  room.sqlite.prepare('SELECT id, path, r2_key, removed_at FROM documents ORDER BY path').all().map((row) => ({ ...row })) as { id: string; path: string; r2_key: string; removed_at: string | null }[];

test('a change, a rename and a removal never delete a stored original', async () => {
  const f = await folder();
  const room = syncRoom();
  const sync = client(room);
  try {
    await runOnce(sync, f);
    const before = rows(room);
    assert.deepEqual(before.map((row) => row.path), ['Founders/Notes for Résumé.md', 'guide.md', 'plain.txt']);

    await writeFile(path.join(f.root, 'guide.md'), '# Guide\n\nChanged.');
    await copyFile(path.join(f.root, 'plain.txt'), path.join(f.root, 'Founders', 'plain.txt'));
    await rm(path.join(f.root, 'plain.txt'));
    await rm(path.join(f.root, 'Founders', 'Notes for Résumé.md'));
    await runOnce(sync, f);

    const after = rows(room);
    assert.equal(after.find((row) => row.path === 'Founders/plain.txt')?.id, before[2]!.id, 'a rename keeps the document');
    assert.ok(after.find((row) => row.id === before[0]!.id)?.removed_at, 'a removal keeps the row');
    assert.deepEqual(room.files.deleted, []);
    for (const row of before) assert.ok(room.files.objects.has(row.r2_key), 'every old original is still stored');
  } finally {
    await f.done();
  }
});

test('a file moved out of a privileged folder syncs as a new document, and the old one is kept', async () => {
  const f = await folder();
  const room = syncRoom();
  const sync = client(room);
  try {
    await mkdir(path.join(f.root, 'Privileged'));
    await writeFile(path.join(f.root, 'Privileged', 'memo.txt'), 'Invented memo.');
    await runOnce(sync, f);
    const before = rows(room).find((row) => row.path === 'Privileged/memo.txt')!;

    await copyFile(path.join(f.root, 'Privileged', 'memo.txt'), path.join(f.root, 'memo.txt'));
    await rm(path.join(f.root, 'Privileged', 'memo.txt'));
    await runOnce(sync, f);

    const after = rows(room);
    assert.ok(after.find((row) => row.id === before.id)?.removed_at);
    assert.notEqual(after.find((row) => row.path === 'memo.txt')?.id, before.id);
    assert.ok(room.files.objects.has(before.r2_key));
  } finally {
    await f.done();
  }
});

test('a file over the limit goes up in parts and arrives whole', async () => {
  const f = await folder();
  const room = syncRoom();
  try {
    const bytes = new Uint8Array(11 * 1024 * 1024);
    for (let i = 0; i < bytes.length; i += 4093) bytes[i] = i % 251;
    await writeFile(path.join(f.root, 'data room.zip'), bytes);
    await runOnce(client(room, { singlePutBytes: 1024 * 1024, partBytes: 5 * 1024 * 1024 }), f);
    const stored = room.files.objects.get(rows(room).find((row) => row.path === 'data room.zip')!.r2_key);
    assert.equal(sha(stored!.bytes), sha(bytes));
  } finally {
    await f.done();
  }
});

test('a change in the folder mid-run leaves the record untouched', async () => {
  const f = await folder();
  const room = syncRoom();
  try {
    const stopped = () => Promise.reject(new MidSyncChange(['guide.md']));
    await assert.rejects(runOnce(client(room), f, stopped), MidSyncChange);
    assert.deepEqual(rows(room), []);
    assert.equal(room.files.objects.size, 0);
  } finally {
    await f.done();
  }
});

test('a room that fails once is tried again, and a re-index it can\'t start is only a note', async () => {
  const f = await folder();
  const room = syncRoom();
  const notes: string[] = [];
  let failures = 2;
  const sync = client(room, { log: (line) => notes.push(line) }, (url, method) => {
    if (method === 'POST' && url.endsWith('/api/sync/record') && failures > 0) {
      failures -= 1;
      return new Response('', { status: 503 });
    }
    return null;
  });
  room.env.SEARCH.jobs.create = async () => {
    throw new Error('no job');
  };
  try {
    await runOnce(sync, f);
    assert.equal(failures, 0);
    assert.equal(rows(room).length, 3);
    assert.ok(notes.some((line) => line.includes('on its own schedule')));
  } finally {
    await f.done();
  }
});

test('a lease lost partway through the record stops the run, keeps what it wrote, and the next run finishes', async () => {
  const f = await folder();
  for (let n = 0; n < RECORD_BATCH; n += 1) await writeFile(path.join(f.root, `note ${n}.txt`), `Invented note ${n}.`);
  const room = syncRoom();
  let records = 0;
  const sync = client(room, {}, (url, method) => {
    if (method === 'POST' && url.endsWith('/api/sync/record') && (records += 1) === 2) return Response.json({ error: 'lease_lost' }, { status: 409 });
    return null;
  });
  try {
    await assert.rejects(runOnce(sync, f), /lease_lost/);
    const kept = rows(room);
    assert.equal(kept.length, RECORD_BATCH);
    for (const row of kept) assert.ok(room.files.objects.has(row.r2_key), 'an original the record points at stays');

    await runOnce(client(room), f);
    assert.equal(rows(room).length, RECORD_BATCH + 3);
    for (const row of rows(room)) assert.ok(room.files.objects.has(row.r2_key));
  } finally {
    await f.done();
  }
});

test('an empty file syncs like any other', async () => {
  const f = await folder();
  await writeFile(path.join(f.root, 'empty.txt'), '');
  const room = syncRoom();
  try {
    await runOnce(client(room), f);
    const row = rows(room).find((candidate) => candidate.path === 'empty.txt')!;
    assert.equal(room.files.objects.get(row.r2_key)?.bytes.length, 0);
  } finally {
    await f.done();
  }
});

test('the room client saves an approved draft back: listed from the state, read, written to Drafts/, then marked saved (card 6.1)', async () => {
  const marked: unknown[] = [];
  const fault = (url: string, method: string): Response | null => {
    const route = new URL(url).pathname;
    if (route === '/api/sync/state') return Response.json({ rows: [], pending: [], drafts: [{ id: 'draft-1', name: 'Harbor Labs side letter.md' }] });
    if (route === '/api/sync/drafts/draft-1' && method === 'GET') return new Response('# Draft: not legal advice\nInvented text.\n');
    if (route === '/api/sync/drafts' && method === 'POST') {
      marked.push(route);
      return Response.json({ ok: true });
    }
    return null;
  };
  const sync = client(syncRoom(), {}, fault);
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-saveback-'));
  try {
    const drafts = await sync.drafts();
    assert.deepEqual(drafts, [{ id: 'draft-1', name: 'Harbor Labs side letter.md' }]);
    assert.deepEqual(await saveBack(drafts, sync.draftSource, dir, () => undefined), { saved: 1, failed: 0 });
    assert.equal(await readFile(path.join(dir, 'Drafts', 'Harbor Labs side letter.md'), 'utf8'), '# Draft: not legal advice\nInvented text.\n');
    assert.equal(marked.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the secret goes only to the room over https, or this computer\'s own wrangler dev', () => {
  assert.equal(roomOrigin('room.example.test'), 'https://room.example.test');
  assert.equal(roomOrigin('http://localhost:8789'), 'http://localhost:8789');
  for (const bad of ['http://room.example.test', 'http://localhost.example.test', 'https://room.example.test/api']) assert.throws(() => roomOrigin(bad), /must/, bad);
});

// --- The real command, in its own process, over real HTTP ---------------------------------------------------------------

function serve(room: Room) {
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      if (incoming.headers['cf-access-client-id'] !== CLIENT || incoming.headers['cf-access-client-secret'] !== SECRET) {
        outgoing.writeHead(403, { 'Content-Type': 'text/html' }).end('<html>refused by Access</html>');
        return;
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string' && !name.startsWith('cf-access-client')) headers.set(name, value);
      }
      const url = new URL(incoming.url ?? '/', `http://localhost:${(server.address() as AddressInfo).port}`);
      const hasBody = incoming.method !== 'GET' && incoming.method !== 'HEAD';
      const request = new Request(url, { method: incoming.method, headers, ...(hasBody ? { body: Readable.toWeb(incoming) as NodeReadableStream, duplex: 'half' } : {}) } as RequestInit);
      const response = await handleSync(request, room.env, url, CLIENT);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    })().catch(() => outgoing.writeHead(500).end());
  });
  return new Promise<{ origin: string; close: () => Promise<unknown> }>((resolve) => {
    server.listen(0, 'localhost', () =>
      resolve({ origin: `http://localhost:${(server.address() as AddressInfo).port}`, close: () => new Promise((done) => server.close(done)) }),
    );
  });
}

function command(args: readonly string[], f: Folder, origin: string, secret = SECRET): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', './scripts/room-preload.ts', 'scripts/sync.ts', '--config', f.config, '--room', ...args],
      { cwd: WEB, encoding: 'utf8', env: { ...process.env, ROOM_SYNC_CLIENT_ID: CLIENT, ROOM_SYNC_CLIENT_SECRET: secret, ROOM_SYNC_ORIGIN: origin } },
      (error, stdout, stderr) => resolve({ code: error ? 1 : 0, out: stdout + stderr }),
    );
  });
}

test('the command: a dry run changes nothing, apply syncs exactly that plan, and a wrong secret is refused and never printed', async () => {
  const f = await folder();
  const room = syncRoom();
  const { origin, close } = await serve(room);
  try {
    const wrong = await command([], f, origin, 'wrong_secret_value');
    assert.equal(wrong.code, 1);
    assert.match(wrong.out, /HTTP 403/);
    assert.doesNotMatch(wrong.out, /wrong_secret_value|refused by Access/);

    const dry = await command([], f, origin);
    assert.equal(dry.code, 0, dry.out);
    assert.match(dry.out, /Dry run only\. Nothing was changed\./);
    assert.deepEqual(rows(room), []);

    const fingerprint = /Plan fingerprint: ([0-9a-f]{12})/.exec(dry.out)![1]!;
    const applied = await command(['--apply', '--yes', '--expect', fingerprint], f, origin);
    assert.equal(applied.code, 0, applied.out);
    assert.equal(rows(room).length, 3);
    for (const row of rows(room)) assert.ok(room.files.objects.has(row.r2_key));
    const stored = room.files.objects.get(rows(room).find((row) => row.path === 'guide.md')!.r2_key)!;
    assert.equal(sha(stored.bytes), sha(await readFile(path.join(f.root, 'guide.md'))));

    assert.match((await command(['--apply', '--yes'], f, origin)).out, /Nothing to do\./);
  } finally {
    await close();
    await f.done();
  }
});

test('the command: a full month keeps documents flowing, says search is behind, and a later sync catches up', async () => {
  const f = await folder();
  const room = syncRoom();
  const { origin, close } = await serve(room);
  const period = new Date().toISOString().slice(0, 7);
  try {
    room.sqlite.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('search_ingest_tokens', ?, ?)").run(period, Number.MAX_SAFE_INTEGER - 1);
    const full = await command(['--apply', '--yes'], f, origin);
    assert.equal(full.code, 0, full.out);
    assert.equal(rows(room).length, 3);
    assert.match(full.out, /Search is full for this month/);
    assert.equal(room.index.objects.size, 0);

    room.sqlite.exec("DELETE FROM spend_counters WHERE meter = 'search_ingest_tokens'");
    const later = await command(['--apply', '--yes'], f, origin);
    assert.equal(later.code, 0, later.out);
    assert.equal(room.index.objects.size, 3, 'every document\'s text is there now');
    assert.doesNotMatch(later.out, /Search is full/);

    // A changed document's old text leaves search while the new text can't be written, then the new text arrives.
    const texts = () => [...room.index.objects.values()].map((object) => Buffer.from(object.bytes).toString());
    await writeFile(path.join(f.root, 'guide.md'), '# Guide\n\nChanged guide.');
    room.sqlite.prepare("INSERT OR REPLACE INTO spend_counters (meter, period, used) VALUES ('search_ingest_tokens', ?, ?)").run(period, Number.MAX_SAFE_INTEGER);
    const changed = await command(['--apply', '--yes'], f, origin);
    assert.equal(changed.code, 0, changed.out);
    assert.equal(texts().filter((text) => text.includes('Invented guide')).length, 0);
    assert.equal(room.index.objects.size, 2);
    room.sqlite.exec("DELETE FROM spend_counters WHERE meter = 'search_ingest_tokens'");
    const caught = await command(['--apply', '--yes'], f, origin);
    assert.equal(caught.code, 0, caught.out);
    assert.equal(texts().filter((text) => text.includes('Changed guide')).length, 1);

    // A new laptop has no record of what it indexed. In a full month the room's good text stays, however many times it syncs.
    await rm(f.cache, { recursive: true, force: true });
    room.sqlite.prepare("INSERT OR REPLACE INTO spend_counters (meter, period, used) VALUES ('search_ingest_tokens', ?, ?)").run(period, Number.MAX_SAFE_INTEGER);
    for (const run of [1, 2]) {
      const fresh = await command(['--apply', '--yes'], f, origin);
      assert.equal(fresh.code, 0, fresh.out);
      assert.equal(room.index.objects.size, 3, `run ${run}`);
    }
  } finally {
    await close();
    await f.done();
  }
});

test('the command: a folder not filled yet, or a file evicted to iCloud, refuses and loses nothing', async () => {
  const f = await folder();
  const room = syncRoom();
  const { origin, close } = await serve(room);
  try {
    assert.equal((await command(['--apply', '--yes'], f, origin)).code, 0);
    const before = rows(room);
    const objects = room.files.objects.size;
    const nothingLost = () => {
      assert.deepEqual(rows(room), before);
      assert.equal(room.files.objects.size, objects);
      assert.deepEqual(room.files.deleted, []);
    };

    // One file evicted: the stub stands for it, and the walk has no such file.
    await rm(path.join(f.root, 'guide.md'));
    await writeFile(path.join(f.root, '.guide.md.icloud'), 'stub');
    const evicted = await command(['--apply', '--yes'], f, origin);
    assert.equal(evicted.code, 1);
    assert.match(evicted.out, /in iCloud, not on this computer/);
    assert.match(evicted.out, /guide\.md/);
    nothingLost();

    // The folder not filled at all.
    await rm(f.root, { recursive: true });
    await mkdir(f.root);
    const empty = await command(['--apply', '--yes'], f, origin);
    assert.equal(empty.code, 1);
    assert.match(empty.out, /holds no files/);
    assert.ok(empty.out.includes(f.root));
    nothingLost();
  } finally {
    await close();
    await f.done();
  }
});

test('the command: a path the room can\'t hold is refused by name in the dry run, with nothing uploaded', async () => {
  const f = await folder();
  await mkdir(path.join(f.root, 'From-Counsel'));
  await writeFile(path.join(f.root, 'From-Counsel', 'x.md'), '# Invented');
  const room = syncRoom();
  const { origin, close } = await serve(room);
  try {
    const dry = await command([], f, origin);
    assert.equal(dry.code, 1, dry.out);
    assert.match(dry.out, /can't hold files with these paths/);
    assert.match(dry.out, /From-Counsel\/x\.md/);
    assert.equal(room.files.objects.size, 0);
    assert.deepEqual(rows(room), []);
  } finally {
    await close();
    await f.done();
  }
});

test('the command: another device syncing stops a run, and --take-over takes it', async () => {
  const f = await folder();
  const room = syncRoom();
  const { origin, close } = await serve(room);
  try {
    room.sqlite.exec(`INSERT INTO sync_lease (id, lease_id, device, expires_at) VALUES (1, 'other', 'the other laptop', '2999-01-01T00:00:00.000Z')`);
    const held = await command(['--apply', '--yes'], f, origin);
    assert.equal(held.code, 1);
    assert.match(held.out, /"the other laptop" is syncing this room/);
    assert.deepEqual(rows(room), []);

    assert.equal((await command(['--take-over', '--apply', '--yes'], f, origin)).code, 0);
    assert.equal(rows(room).length, 3);
  } finally {
    await close();
    await f.done();
  }
});
