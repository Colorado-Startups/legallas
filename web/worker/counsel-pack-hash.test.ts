// SPDX-License-Identifier: Apache-2.0
// The hash chain from source to export (research A3; FRE 902(14)): the sync helper's SHA-256 of each file on the Mac
// and of each counsel upload's bytes, the one D1 stores, and the counsel pack's, on the fictional room (Doe v. Harbor
// Labs, prefix DOE). Uploads go through the real room route; the pack reads the same SQLite. The test name is the Data
// room row's rule (dispute.counsel.complete.hash_at_intake_and_export).
import './digest-fixtures.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildPack } from '../scripts/counsel-pack-build.ts';
import { INDEX_NAME } from '../scripts/counsel-pack-plan.ts';
import { sha256File } from '../scripts/snapshot.ts';
import type { Env } from './env.ts';
import { handle } from './room.ts';
import { testDb } from './sqlite-d1.ts';

const HOST = 'http://localhost:8789';
const COUNSEL = 'ada@firm.example';

// Workers' FixedLengthStream, as the upload route uses it: passes bytes through unchanged.
(globalThis as Record<string, unknown>).FixedLengthStream = class {
  constructor() {
    return new TransformStream<Uint8Array, Uint8Array>();
  }
};

const MIRROR: Record<string, string> = {
  '01-Corporate-Records/Stock-Agreement__20110607__Harbor-Labs.pdf': '%PDF-1.7 founders stock agreement, Harbor Labs, Jane Doe and Richard Roe',
  '02-Board-Minutes/Minutes__20120509__Harbor-Labs.pdf': '%PDF-1.7 minutes, vote of 2 to 1',
  '04-Letters/Letter__20120903__Doe.txt': 'Richard, I do not agree to the repurchase.',
};
const UPLOADS: Record<string, string> = {
  'memo.pdf': '%PDF-1.7 counsel memo on the bridge note',
  // Past the route's 4 KB peek and many chunks long.
  'chronology.txt': 'March 2012: the bridge note is amended.\n'.repeat(5000),
};

const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Writes each mirror file under `source` and stores its row as sync does, noting the helper's hash by document id. */
async function seedMirror(sqlite: ReturnType<typeof testDb>['sqlite'], source: string, helper: Map<string, string>): Promise<void> {
  // Mirror rows as sync stores them: the helper hashes each file at the source (snapshot.ts), and the room keeps it.
  let seq = 0;
  for (const [rel, content] of Object.entries(MIRROR)) {
    await mkdir(path.dirname(path.join(source, rel)), { recursive: true });
    await writeFile(path.join(source, rel), content);
    const hash = await sha256File(path.join(source, rel));
    seq += 1;
    helper.set(`m${seq}`, hash);
    sqlite
      .prepare(
        'INSERT INTO documents (id, path, folder, name, kind, content_type, size, sha256, r2_key, source, updated_at, control_seq) ' +
          "VALUES (?, ?, ?, ?, 'pdf', 'application/pdf', ?, ?, ?, 'mirror', '2026-03-01T00:00:00.000Z', ?)",
      )
      .run(`m${seq}`, rel, path.posix.dirname(rel), path.posix.basename(rel), Buffer.byteLength(content), hash, `k${seq}`, seq);
  }
}

/** The room's bindings: the shell, the in-memory database, and a bucket that keeps what is put in it. */
function roomEnv(db: ReturnType<typeof testDb>['db'], objects: Map<string, Uint8Array>): Env {
  return {
    ASSETS: { fetch: async () => new Response('shell') },
    DB: db,
    FILES: {
      async put(key: string, body: ReadableStream<Uint8Array>) {
        objects.set(key, new Uint8Array(await new Response(body).arrayBuffer()));
        return { etag: 'etag-multipart-1' };
      },
      async delete(key: string) {
        objects.delete(key);
      },
    },
    TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    ALLOW_DEV_IDENTITY: '1',
    DEV_IDENTITY_EMAIL: COUNSEL,
  } as unknown as Env;
}

/** Uploads each counsel file through the real route, noting the hash of the bytes counsel chose by document id. */
async function uploadAll(env: Env, helper: Map<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(UPLOADS)) {
    const bytes = new TextEncoder().encode(content);
    const res = await handle(
      new Request(`${HOST}/api/uploads`, {
        method: 'PUT',
        body: bytes,
        headers: { Origin: HOST, 'Sec-Fetch-Site': 'same-origin', 'X-Upload-Name': name, 'Content-Length': String(bytes.byteLength) },
      }),
      env,
      {} as ExecutionContext,
    );
    assert.equal(res.status, 201, name);
    // An upload's source is the file counsel chose: its bytes, hashed here as the helper would.
    helper.set(((await res.json()) as { id: string }).id, sha(bytes));
  }
}

/** Builds the counsel pack from the room's SQLite and bucket, then reads the export's index back. */
async function buildAndReadPack(
  sqlite: ReturnType<typeof testDb>['sqlite'],
  objects: Map<string, Uint8Array>,
  parent: string,
  source: string,
  out: string,
): Promise<{ out: string; report: Awaited<ReturnType<typeof buildPack>>; index: { path: string; sha256: string; link: string }[] }> {
  const report = await buildPack(
    { out, sourceRoot: source, prefix: 'DOE', banner: 'Work Product.', includeUploads: true, zip: false, dryRun: false },
    {
      d1Query: async (sql) => sqlite.prepare(sql).all().map((r) => ({ ...r })),
      r2Get: async (_bucket, key, file) => {
        const body = objects.get(key);
        if (!body) throw new Error('no such key');
        await writeFile(file, body);
      },
      now: new Date('2026-11-05T12:00:00Z'),
      finderInfo: async () => null,
      repoRoot: path.join(parent, 'repo'),
    },
  );
  const lines = (await readFile(path.join(out, INDEX_NAME), 'utf8')).replace(/^﻿/, '').trim().split('\r\n');
  const header = lines[0]!.split(',');
  const index = lines.slice(1).map((line) => {
    const cells = line.split(',');
    return { path: cells[header.indexOf('path')]!, sha256: cells[header.indexOf('sha256')]!, link: cells[header.indexOf('room_link')]! };
  });
  return { out, report, index };
}

async function room() {
  const parent = await mkdtemp(path.join(tmpdir(), 'legallas-hash-'));
  const source = path.join(parent, 'Harbor');
  const { db, sqlite } = testDb();
  sqlite.exec(`INSERT INTO members (email, role, name) VALUES ('${COUNSEL}', 'counsel', 'Ada Quill')`);
  const helper = new Map<string, string>();
  await seedMirror(sqlite, source, helper);
  const objects = new Map<string, Uint8Array>();
  await uploadAll(roomEnv(db, objects), helper);
  const stored = () =>
    new Map(sqlite.prepare('SELECT id, sha256 FROM documents WHERE removed_at IS NULL').all().map((r) => [String(r.id), r.sha256 as string | null]));
  const r2Keys = new Map(sqlite.prepare("SELECT id, r2_key FROM documents WHERE source = 'counsel'").all().map((r) => [String(r.id), String(r.r2_key)]));
  let runs = 0;
  const pack = () => buildAndReadPack(sqlite, objects, parent, source, path.join(parent, `Pack-${++runs}`));
  return { source, objects, r2Keys, helper, stored, pack, done: () => rm(parent, { recursive: true, force: true }) };
}

test("the helper's SHA-256 at the source equals the stored one and the export's, for every document", async () => {
  const r = await room();
  try {
    const stored = r.stored();
    assert.equal(stored.size, Object.keys(MIRROR).length + Object.keys(UPLOADS).length);
    for (const [id, hash] of r.helper) assert.equal(stored.get(id), hash, `stored at intake: ${id}`);

    const { out, report, index } = await r.pack();
    assert.equal(report.outcomes.copied, stored.size, 'every document is in the export');
    assert.equal(index.length, stored.size);
    for (const line of index) {
      const id = decodeURIComponent(new URL(line.link).searchParams.get('id') ?? '');
      assert.equal(line.sha256, r.helper.get(id), `export index: ${line.path}`);
      assert.equal(line.sha256, stored.get(id));
      assert.equal(await sha256File(path.join(out, line.path)), line.sha256, `exported bytes: ${line.path}`);
    }

    // A copy that no longer matches the stored hash stays out of the export, as an upload or as a file on the Mac.
    const [uploadId] = [...r.r2Keys.keys()];
    r.objects.set(r.r2Keys.get(uploadId!)!, new TextEncoder().encode('%PDF-1.7 altered after intake'));
    await writeFile(path.join(r.source, Object.keys(MIRROR)[1]!), '%PDF-1.7 minutes, vote of 3 to 0');
    const changed = await r.pack();
    assert.equal(changed.report.outcomes.changed, 2);
    assert.equal(changed.index.length, stored.size - 2);
    for (const line of changed.index) assert.equal(await sha256File(path.join(changed.out, line.path)), stored.get(decodeURIComponent(new URL(line.link).searchParams.get('id') ?? '')));
  } finally {
    await r.done();
  }
});
