// SPDX-License-Identifier: Apache-2.0
// /api/documents, /api/doc/:id, /files/:id ranges and downloads, and counsel uploads, through the real
// gate in room.ts with in-memory D1 and R2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './room.ts';
import type { Env, Role } from './env.ts';
import { pastTheGate } from './gate-fixtures.ts';
import './digest-fixtures.ts';

const HOST = 'http://localhost:8789';
const ME = 'ada@example.test';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Workers' FixedLengthStream: passes bytes through and errors unless exactly `size` arrive.
(globalThis as Record<string, unknown>).FixedLengthStream = class {
  constructor(size: number) {
    let seen = 0;
    return new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > size) controller.error(new Error('too long'));
        else controller.enqueue(chunk);
      },
      flush(controller) {
        if (seen !== size) controller.error(new Error('too short'));
      },
    });
  }
};

type Row = Record<string, unknown>;

function doc(id: string, path: string, extra: Row = {}): Row {
  const slash = path.lastIndexOf('/');
  return {
    id, path, folder: path.slice(0, Math.max(slash, 0)), name: path.slice(slash + 1), kind: 'pdf',
    content_type: 'application/pdf', size: 10, sha256: 'hash', etag: null, pages: 3, r2_key: `key-${id}`,
    source: 'mirror', uploaded_by: null, pulled_at: null, updated_at: '2026-10-01T00:00:00.000Z', removed_at: null, ...extra,
  };
}

/** The D1 stand-in: the statements the routes run, answered from `docs`, with audit rows and uploads recorded. */
function fakeDb(docs: Row[], audits: Row[], role: string) {
  const live = () => docs.filter((d) => !d.removed_at);
  const withName = (d: Row | undefined) => d && { ...d, uploader_name: d.uploaded_by === ME ? 'Ada' : null };
  return {
    prepare(sql: string) {
      const bound = (args: unknown[]) => ({
        async first() {
          if (sql.includes('FROM members')) return args[0] === ME ? { email: ME, role, name: 'Ada' } : null;
          if (sql.includes('WHERE d.id = ?1')) return withName(live().find((d) => d.id === args[0])) ?? null;
          if (sql.includes('WHERE id = ?1')) return live().find((d) => d.id === args[0]) ?? null;
          throw new Error(`unexpected first(): ${sql}`);
        },
        async all() {
          // Deliberately returns removed rows and storage columns: the route must drop them itself.
          if (sql.includes('ORDER BY path')) return { results: docs };
          if (sql.includes("d.source = 'counsel'")) return { results: live().filter((d) => d.source === 'counsel').map(withName) };
          throw new Error(`unexpected all(): ${sql}`);
        },
        async run() {
          if (sql.startsWith('INSERT INTO audit_log')) {
            const row = { email: args[0], action: args[1], document_id: args[2] };
            // auditOnce: the fake has no clock, so a repeat inside the window is any repeat in the test.
            const repeat = audits.some((a) => a.email === row.email && a.action === row.action && a.document_id === row.document_id);
            if (!(sql.includes('NOT EXISTS') && repeat)) audits.push(row);
          }
          else if (sql.startsWith('INSERT INTO documents')) {
            const [id, path, folder, name, kind, content_type, size, etag, r2_key, uploaded_by, updated_at] = args;
            docs.push({ id, path, folder, name, kind, content_type, size, etag, r2_key, uploaded_by, updated_at, sha256: null, source: 'counsel', removed_at: null });
          } else throw new Error(`unexpected run(): ${sql}`);
          return {};
        },
      });
      return { bind: (...args: unknown[]) => bound(args), all: () => bound([]).all(), first: () => bound([]).first() };
    },
  };
}

/** The R2 stand-in: ranged reads, puts that keep the bytes, and deletes that are recorded. */
function fakeFiles(objects: Map<string, Uint8Array>, deleted: string[]) {
  return {
    async get(key: string, options?: { range?: { offset: number; length: number } }) {
      const all = objects.get(key);
      if (!all) return null;
      const bytes = options?.range ? all.subarray(options.range.offset, options.range.offset + options.range.length) : all;
      return { body: new Response(bytes).body, size: all.byteLength, text: async () => new TextDecoder().decode(bytes) };
    },
    async put(key: string, body: ReadableStream<Uint8Array>) {
      objects.set(key, new Uint8Array(await new Response(body).arrayBuffer()));
      return { etag: `etag-${objects.size}` };
    },
    async delete(key: string) {
      deleted.push(key);
      objects.delete(key);
    },
  };
}

function fakeRoom(role = 'counsel') {
  const docs: Row[] = [
    doc('p1', '08-Court-Papers/complaint.pdf', { size: 10 }),
    doc('g1', '08-Court-Papers/CLAUDE.md', { kind: 'markdown', content_type: 'text/markdown; charset=utf-8', pages: null }),
    doc('v1', 'Visuals/start.html', { kind: 'visual', content_type: 'text/html; charset=utf-8' }),
    doc('x1', '08-Court-Papers/old.pdf', { removed_at: '2026-09-01T00:00:00.000Z' }),
    doc('c1', 'from-counsel/c1/memo.pdf', { source: 'counsel', uploaded_by: ME, pulled_at: '2026-10-01T01:00:00.000Z', sha256: null }),
  ];
  const audits: Row[] = [];
  const objects = new Map<string, Uint8Array>([['key-p1', new TextEncoder().encode('0123456789')], ['key-v1', new TextEncoder().encode('<p>v</p>')]]);
  const deleted: string[] = [];
  const env = {
    ASSETS: { fetch: async () => new Response('shell') }, DB: fakeDb(docs, audits, role), FILES: fakeFiles(objects, deleted),
    TEAM_DOMAIN: '', ACCESS_AUD: '', ALLOW_DEV_IDENTITY: '1', DEV_IDENTITY_EMAIL: ME,
  } as unknown as Env;
  return { env, docs, audits, objects, deleted };
}

const call = (env: Env, path: string, init?: RequestInit) => handle(new Request(`${HOST}${path}`, init), env, {} as ExecutionContext);
const SAME_ORIGIN = { Origin: HOST, 'Sec-Fetch-Site': 'same-origin' };

function put(env: Env, name: string, body: Uint8Array | string, headers: Record<string, string> = {}) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return call(env, '/api/uploads', {
    method: 'PUT', body: bytes,
    headers: { ...SAME_ORIGIN, 'X-Upload-Name': encodeURIComponent(name), 'Content-Length': String(bytes.byteLength), ...headers },
  });
}

test('/api/documents is one tree of live documents with no storage keys', async () => {
  const { env } = fakeRoom();
  const res = await call(env, '/api/documents');
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.doesNotMatch(text, /r2_key|key-p1|sha256|old\.pdf|removed_at/);
  const { root } = JSON.parse(text);
  const pleadings = root.folders.find((f: { name: string }) => f.name === '08-Court-Papers');
  assert.deepEqual(pleadings.files.map((f: { name: string }) => f.name), ['complaint.pdf']);
  assert.equal(pleadings.guide.id, 'g1');
  assert.ok(root.folders.some((f: { name: string }) => f.name === 'from-counsel'));
  assert.equal(root.count, 4);
});

test('/api/doc/:id returns metadata and writes one view, deduplicated for repeat opens', async () => {
  const { env, audits } = fakeRoom();
  const res = await call(env, '/api/doc/p1');
  assert.equal(res.status, 200);
  const body = await res.json() as Row;
  assert.equal(body.viewer, 'pdf');
  assert.equal(body.pages, 3);
  assert.equal(body.r2_key, undefined);
  assert.equal(body.sha256, undefined);
  assert.deepEqual(audits, [{ email: ME, action: 'view', document_id: 'p1' }]);
  await call(env, '/api/doc/p1');
  assert.equal(audits.length, 1);
});

test('opening a PDF logs one view, however many range requests PDF.js makes', async () => {
  const { env, audits } = fakeRoom();
  await call(env, '/api/doc/p1');
  for (const range of ['bytes=0-3', 'bytes=4-7', 'bytes=8-9', 'bytes=-2']) {
    const res = await call(env, '/files/p1', { headers: { Range: range, 'Sec-Fetch-Dest': 'empty' } });
    assert.equal(res.status, 206);
  }
  assert.deepEqual(audits.map((a) => a.action), ['view']);
});

test('a mirrored visual is audited by /files when framed, not also by /api/doc', async () => {
  const { env, audits } = fakeRoom();
  assert.equal(((await (await call(env, '/api/doc/v1')).json()) as Row).viewer, 'visual');
  assert.equal(audits.length, 0);
  await call(env, '/files/v1', { headers: { 'Sec-Fetch-Dest': 'iframe' } });
  assert.deepEqual(audits.map((a) => a.action), ['view']);
});

test('/api/doc/:id hides removed documents and counsel details stay on counsel rows', async () => {
  const { env } = fakeRoom();
  assert.equal((await call(env, '/api/doc/x1')).status, 404);
  const counsel = (await (await call(env, '/api/doc/c1')).json()) as Row;
  assert.equal(counsel.folder, 'from-counsel');
  assert.equal(counsel.uploader_name, 'Ada');
  assert.equal(((await (await call(env, '/api/doc/p1')).json()) as Row).uploaded_by, null);
});

test('a byte range is a 206 with Content-Range, inline and sandboxed', async () => {
  const { env } = fakeRoom();
  const res = await call(env, '/files/p1', { headers: { Range: 'bytes=2-5', 'Sec-Fetch-Dest': 'empty' } });
  assert.equal(res.status, 206);
  assert.equal(await res.text(), '2345');
  assert.equal(res.headers.get('Content-Range'), 'bytes 2-5/10');
  assert.equal(res.headers.get('Content-Length'), '4');
  assert.equal(res.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(res.headers.get('Content-Disposition'), null);
  assert.match(res.headers.get('Content-Security-Policy') ?? '', /^sandbox;/);
});

test('a whole-file viewer read advertises ranges and its length', async () => {
  const { env, audits } = fakeRoom();
  const res = await call(env, '/files/p1', { headers: { 'Sec-Fetch-Dest': 'empty' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(res.headers.get('Content-Length'), '10');
  assert.equal(res.headers.get('Content-Type'), 'application/pdf');
  assert.deepEqual(audits.map((a) => a.action), ['view'], 'a direct read still leaves a trail');
});

test('a script pulling every file straight from /files leaves one view per document', async () => {
  const { env, audits, objects } = fakeRoom();
  objects.set('key-g1', new TextEncoder().encode('# Guide'));
  for (let i = 0; i < 3; i++) await call(env, '/files/p1', { headers: { 'Sec-Fetch-Dest': 'empty' } });
  await call(env, '/files/g1', { headers: { 'Sec-Fetch-Dest': 'empty' } });
  assert.deepEqual(audits.map((a) => `${a.action}:${a.document_id}`), ['view:p1', 'view:g1']);
});

test('document reads triggered from another site are refused before any audit row', async () => {
  const { env, audits } = fakeRoom();
  for (const site of ['same-site', 'cross-site']) {
    assert.equal((await call(env, '/files/p1?download', { headers: { 'Sec-Fetch-Site': site } })).status, 403, site);
    assert.equal((await call(env, '/api/doc/p1', { headers: { 'Sec-Fetch-Site': site } })).status, 403, site);
  }
  assert.equal(audits.length, 0);
  assert.equal((await call(env, '/files/p1', { headers: { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Dest': 'empty' } })).status, 200);
  assert.equal((await call(env, '/files/p1?download', { headers: { 'Sec-Fetch-Site': 'none' } })).status, 200);
});

test('a resumed download that skips byte 0 is still audited', async () => {
  const { env, audits } = fakeRoom();
  await call(env, '/files/p1?download=1', { headers: { Range: 'bytes=1-' } });
  assert.deepEqual(audits.map((a) => a.action), ['download']);
});

test('the upload filename is read from X-Upload-Name, never the URL', async () => {
  const { env } = fakeRoom();
  const viaUrl = await call(env, '/api/uploads?name=a.pdf', {
    method: 'PUT', body: new TextEncoder().encode('%PDF-1.7'), headers: { ...SAME_ORIGIN, 'Content-Length': '8' },
  });
  assert.equal(viaUrl.status, 400);
  const bad = await call(env, '/api/uploads', {
    method: 'PUT', body: new TextEncoder().encode('%PDF-1.7'), headers: { ...SAME_ORIGIN, 'Content-Length': '8', 'X-Upload-Name': '%E0%A4%A' },
  });
  assert.equal(bad.status, 400);
});

test('a range past the end is a 416 that names the size', async () => {
  const { env, audits } = fakeRoom();
  const res = await call(env, '/files/p1', { headers: { Range: 'bytes=10-' } });
  assert.equal(res.status, 416);
  assert.equal(res.headers.get('Content-Range'), 'bytes */10');
  assert.match(res.headers.get('Content-Security-Policy') ?? '', /^sandbox;/);
  assert.equal(audits.length, 0);
});

test('a top-level open is an attachment and one download row', async () => {
  const { env, audits } = fakeRoom();
  const res = await call(env, '/files/p1', { headers: { 'Sec-Fetch-Dest': 'document' } });
  assert.match(res.headers.get('Content-Disposition') ?? '', /^attachment; filename="complaint\.pdf"/);
  assert.match(res.headers.get('Content-Security-Policy') ?? '', /^sandbox;/);
  assert.deepEqual(audits.map((a) => a.action), ['download']);
});

test('?download is an attachment and audited once, even when resumed by range', async () => {
  const { env, audits } = fakeRoom();
  const res = await call(env, '/files/p1?download=1', { headers: { 'Sec-Fetch-Dest': 'empty' } });
  assert.match(res.headers.get('Content-Disposition') ?? '', /^attachment;/);
  await call(env, '/files/p1?download=1', { headers: { Range: 'bytes=5-' } });
  assert.deepEqual(audits.map((a) => a.action), ['download']);
});

test('a counsel upload streams to R2 under an opaque key with a counsel row and one audit', async () => {
  const { env, docs, audits, objects } = fakeRoom();
  const res = await put(env, 'Draft ‮memo.pdf', '%PDF-1.7 dummy');
  assert.equal(res.status, 201);
  const body = (await res.json()) as Row;
  assert.equal(body.name, 'Draft memo.pdf');
  const row = docs.find((d) => d.id === body.id)!;
  assert.match(String(row.id), UUID);
  assert.match(String(row.r2_key), UUID);
  assert.notEqual(row.r2_key, row.id);
  assert.equal(row.path, `from-counsel/${row.id}/Draft memo.pdf`);
  assert.equal(row.folder, `from-counsel/${row.id}`);
  assert.equal(row.source, 'counsel');
  assert.equal(row.uploaded_by, ME);
  assert.equal(row.sha256, null);
  assert.match(String(row.etag), /^etag-/);
  assert.equal(row.size, 14);
  assert.equal(new TextDecoder().decode(objects.get(String(row.r2_key))), '%PDF-1.7 dummy');
  assert.deepEqual(audits, [{ email: ME, action: 'upload', document_id: body.id }]);
});

test('a role the code does not know is refused at the gate before anything is stored', async () => {
  const { env, docs, objects } = fakeRoom('limited');
  const res = await put(env, 'memo.pdf', '%PDF-1.7');
  assert.equal(res.status, 403);
  assert.equal(docs.length, 5);
  assert.equal(objects.size, 2);
});

test("past the gate, the upload route's own wall refuses a role without upload, and nothing is stored", async () => {
  const { env, docs, objects, audits } = fakeRoom('limited');
  const bytes = new TextEncoder().encode('%PDF-1.7');
  const headers = { ...SAME_ORIGIN, 'X-Upload-Name': 'memo.pdf', 'Content-Length': String(bytes.byteLength) };
  const request = new Request(`${HOST}/api/uploads`, { method: 'PUT', body: bytes, headers });
  const res = await pastTheGate(request, env, { email: ME, role: 'limited' as Role, name: 'Ada' });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'forbidden' });
  assert.deepEqual([docs.length, objects.size, audits.length], [5, 2, 0]);
});

test('a member row left with the retired family role may not list, download or upload, and nothing is stored', async () => {
  const { env, docs, objects } = fakeRoom('family');
  assert.equal((await call(env, '/api/documents')).status, 403);
  assert.equal((await call(env, '/files/p1?download=1', { headers: { 'Sec-Fetch-Dest': 'empty' } })).status, 403);
  assert.equal((await put(env, 'memo.pdf', '%PDF-1.7')).status, 403);
  assert.equal(docs.length, 5);
  assert.equal(objects.size, 2);
});

test('uploads are refused without Content-Length or above 95 MB', async () => {
  const { env, objects } = fakeRoom();
  const missing = await call(env, '/api/uploads', { method: 'PUT', body: new TextEncoder().encode('%PDF-1.7'), headers: { ...SAME_ORIGIN, 'X-Upload-Name': 'a.pdf' } });
  assert.equal(missing.status, 411);
  const big = await put(env, 'a.pdf', '%PDF-1.7', { 'Content-Length': String(95 * 1024 * 1024 + 1) });
  assert.equal(big.status, 413);
  assert.equal(objects.size, 2);
});

test('HTML, SVG and bytes that do not match the extension are refused', async () => {
  const { env, objects } = fakeRoom();
  assert.equal((await put(env, 'page.html', '<p>hi</p>')).status, 415);
  assert.equal((await put(env, 'logo.svg', '<svg/>')).status, 415);
  const mismatch = await put(env, 'brief.pdf', '<html><script>alert(1)</script>');
  assert.equal(mismatch.status, 415);
  assert.deepEqual(await mismatch.json(), { error: 'content_mismatch' });
  assert.equal((await put(env, '', '%PDF-1.7')).status, 400);
  assert.equal(objects.size, 2);
});

test('a PDF with JavaScript or a Word file with macros is refused with 422, and nothing is kept', async () => {
  const { env, docs, objects, deleted, audits } = fakeRoom();
  const script = await put(env, 'brief.pdf', '%PDF-1.7\n1 0 obj\n<< /OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >> >>\nendobj\n%%EOF\n');
  assert.equal(script.status, 422);
  assert.deepEqual(await script.json(), { error: 'active_content' });
  const name = new TextEncoder().encode('word/vbaProject.bin');
  const docm = new Uint8Array([0x50, 0x4b, 3, 4, 20, ...new Array(21).fill(0), name.length, 0, 0, 0, ...name]);
  const macros = await put(env, 'memo.docx', docm);
  assert.equal(macros.status, 422);
  assert.deepEqual(await macros.json(), { error: 'active_content' });
  assert.deepEqual([docs.length, objects.size, deleted.length, audits.length], [5, 2, 2, 0]);
});

test('a printed SSN in an upload\'s name or plain-text bytes is refused with 422, and nothing is kept (#267)', async () => {
  const { env, docs, objects, audits } = fakeRoom();
  const sample = ['078', '05', '1120'].join('-');
  const named = await put(env, `holder ${sample}.md`, '# Notes');
  assert.equal(named.status, 422);
  assert.deepEqual(await named.json(), { error: 'pii_in_name' });
  const inside = await put(env, 'notes.md', `# Notes\nHolder ${sample}\n`);
  assert.equal(inside.status, 422);
  assert.deepEqual(await inside.json(), { error: 'pii_in_file' });
  assert.deepEqual([docs.length, objects.size, audits.length], [5, 2, 0]);
  assert.equal((await put(env, 'notes.md', '# Doe v. Harbor Labs notes\n')).status, 201);
});

test('a plain PDF still uploads', async () => {
  const { env, docs } = fakeRoom();
  const res = await put(env, 'brief.pdf', '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /OpenAction [3 0 R /Fit] >>\nendobj\n%%EOF\n');
  assert.equal(res.status, 201);
  assert.equal(docs.length, 6);
});

test('a body longer than its Content-Length is not kept', async () => {
  const { env, docs, deleted } = fakeRoom();
  const res = await put(env, 'notes.txt', 'twenty bytes of text', { 'Content-Length': '6' });
  assert.equal(res.status, 400);
  assert.equal(deleted.length, 1);
  assert.equal(docs.length, 5);
});

test('uploads need a same-origin write', async () => {
  const { env } = fakeRoom();
  const res = await call(env, '/api/uploads', { method: 'PUT', body: '%PDF-1.7', headers: { 'X-Upload-Name': 'a.pdf', 'Content-Length': '8' } });
  assert.equal(res.status, 403);
});

test('/api/uploads lists counsel uploads with who, when and size, and no keys', async () => {
  const { env } = fakeRoom();
  const res = await call(env, '/api/uploads');
  const text = await res.text();
  assert.doesNotMatch(text, /r2_key|key-c1/);
  const { uploads } = JSON.parse(text);
  assert.deepEqual(uploads, [
    { id: 'c1', name: 'memo.pdf', kind: 'pdf', size: 10, uploaded_at: '2026-10-01T00:00:00.000Z', uploaded_by: ME, uploader_name: 'Ada', pulled: true },
  ]);
});
