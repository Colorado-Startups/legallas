// SPDX-License-Identifier: Apache-2.0
// legallas_get_file (plan D7): Claude gets small PNG, JPEG and WebP images of at most one megapixel as embedded content,
// audited as `download` with the client's name every time; every other client, every PDF and anything larger gets
// details and pointers only; a visual points to legallas_view_visual; no result carries a URL to the bytes or a storage
// field. PDFs stopped being embedded after the 2026-10-20 live check: Claude's client refuses an embedded PDF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../../worker/env.ts';
import { addLeftoverFamily } from '../../worker/gate-fixtures.ts';
import { utcDay } from '../../worker/usage.ts';
import { downloadsToday, reserveDownload } from '../audit.ts';
import { DAILY_DOWNLOAD_CAP, EMBED_MAX_BASE64_CHARS, type McpEnv, type Props } from '../contract.ts';
import { runTool } from '../server.ts';
import { body, catalogDb, type DocSeed } from './doc-fixtures.ts';
import {
  base64,
  CLIENT_NAMES,
  clientCtx,
  fakeFiles,
  gifBytes,
  jpegBytes,
  pdfBytes,
  pngBytes,
  webpBytes,
  webpLosslessBytes,
  webpLossyBytes,
  type CtxOptions,
} from './files-fixtures.ts';
import { getFileTool, imageSize, MAX_EMBED_BYTES, sniffType } from './files.ts';

interface FileSeed extends DocSeed {
  contentType: string;
  bytes?: Uint8Array;
  /** The size D1 records, when it should differ from the stored bytes. */
  size?: number;
}

const SMALL_PNG = pngBytes(800, 600);
const SMALL_PDF = pdfBytes(2000);
/** pngBytes' signature and IHDR chunk, before its padding. */
const PNG_HEADER = 33;
const FILES: FileSeed[] = [
  { id: 'img', path: '06-Photos/DOE-photo.png', kind: 'image', contentType: 'image/png', bytes: SMALL_PNG, pages: null },
  { id: 'pdf', path: '04-Letters/DOE-letter.pdf', kind: 'pdf', contentType: 'application/pdf', bytes: SMALL_PDF, pages: 2, controlSeq: 12 },
  { id: 'wide', path: '06-Photos/DOE-wide.png', kind: 'image', contentType: 'image/png', bytes: pngBytes(1001, 1000) },
  { id: 'mp', path: '06-Photos/DOE-exact.png', kind: 'image', contentType: 'image/png', bytes: pngBytes(1000, 1000) },
  { id: 'jpg-ok', path: '06-Photos/DOE-scan.jpg', kind: 'image', contentType: 'image/jpeg', bytes: jpegBytes(1000, 1000, 64, true) },
  { id: 'jpg-big', path: '06-Photos/DOE-scan-big.jpg', kind: 'image', contentType: 'image/jpeg', bytes: jpegBytes(1001, 1000) },
  { id: 'vp8-ok', path: '06-Photos/DOE-lossy.webp', kind: 'image', contentType: 'image/webp', bytes: webpLossyBytes(1000, 1000) },
  { id: 'vp8l-big', path: '06-Photos/DOE-lossless.webp', kind: 'image', contentType: 'image/webp', bytes: webpLosslessBytes(1000, 1001) },
  { id: 'gif', path: '06-Photos/DOE-anim.gif', kind: 'image', contentType: 'image/gif', bytes: gifBytes(10, 10) },
  { id: 'gif-as-png', path: '06-Photos/DOE-anim.png', kind: 'image', contentType: 'image/png', bytes: gifBytes(10, 10) },
  { id: 'jpg-cut', path: '06-Photos/DOE-cut.jpg', kind: 'image', contentType: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03]) },
  { id: 'edge', path: '06-Photos/DOE-edge.png', kind: 'image', contentType: 'image/png', bytes: pngBytes(800, 600, MAX_EMBED_BYTES - PNG_HEADER) },
  { id: 'over', path: '06-Photos/DOE-over.png', kind: 'image', contentType: 'image/png', bytes: pngBytes(800, 600, MAX_EMBED_BYTES - PNG_HEADER + 1) },
  { id: 'stale', path: '06-Photos/DOE-stale.png', kind: 'image', contentType: 'image/png', bytes: pngBytes(800, 600, MAX_EMBED_BYTES), size: 100 },
  { id: 'pdf-edge', path: '04-Letters/DOE-edge.pdf', kind: 'pdf', contentType: 'application/pdf', bytes: pdfBytes(MAX_EMBED_BYTES - 9) },
  { id: 'pdf-big', path: '04-Letters/DOE-big.pdf', kind: 'pdf', contentType: 'application/pdf', bytes: pdfBytes(MAX_EMBED_BYTES), pages: 40 },
  { id: 'pdf-stale', path: '04-Letters/DOE-stale.pdf', kind: 'pdf', contentType: 'application/pdf', bytes: pdfBytes(MAX_EMBED_BYTES), size: 100 },
  { id: 'pdf-as-png', path: '06-Photos/DOE-scan.png', kind: 'image', contentType: 'image/png', bytes: pdfBytes(200) },
  { id: 'fake', path: '06-Photos/DOE-fake.png', kind: 'image', contentType: 'image/png', bytes: new TextEncoder().encode('<svg onload="x()"></svg>') },
  { id: 'svg', path: '06-Photos/DOE-chart.svg', kind: 'image', contentType: 'image/svg+xml', bytes: new TextEncoder().encode('<svg></svg>') },
  { id: 'notes', path: '04-Letters/DOE-notes.md', kind: 'markdown', contentType: 'text/markdown', bytes: new TextEncoder().encode('# Notes') },
  { id: 'vis', path: '03-Kitchen-Records/Visuals/DOE-map.html', kind: 'visual', contentType: 'text/html', bytes: new TextEncoder().encode('<html></html>') },
  { id: 'lost', path: '06-Photos/DOE-lost.png', kind: 'image', contentType: 'image/png' },
  { id: 'priv', path: '07-Lawyer-Notes-PRIVILEGED/DOE-memo.png', kind: 'image', contentType: 'image/png', bytes: SMALL_PNG },
  { id: 'gone', path: '04-Letters/DOE-gone.pdf', kind: 'pdf', contentType: 'application/pdf', bytes: SMALL_PDF, removedAt: '2026-09-01T00:00:00Z' },
  { id: 'hidden', path: '03-Kitchen-Records/Visuals/legallas-visuals.json', kind: 'file', contentType: 'application/json', bytes: new TextEncoder().encode('{}') },
];

function room() {
  const { db, sqlite } = catalogDb(FILES);
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES ('ada@firm.example', 'counsel', 'Ada')").run();
  const update = sqlite.prepare('UPDATE documents SET content_type = ?, size = ? WHERE id = ?');
  for (const seed of FILES) update.run(seed.contentType, seed.size ?? seed.bytes?.byteLength ?? 10, seed.id);
  const store = new Map(FILES.filter((seed) => seed.bytes).map((seed) => [`R2-LEAK-${seed.id}`, seed.bytes!]));
  const files = fakeFiles(store);
  return { db, sqlite, files };
}

type Sqlite = ReturnType<typeof room>['sqlite'];

/** `count` audit rows of `action` for `email` at `ts`, as earlier calls would have written them. */
function seedAudits(sqlite: Sqlite, count: number, row: { email: string; ts: string; via: string | null; action?: string }) {
  const insert = sqlite.prepare('INSERT INTO audit_log (ts, email, action, document_id, via) VALUES (?, ?, ?, ?, ?)');
  for (let i = 0; i < count; i += 1) insert.run(row.ts, row.email, row.action ?? 'download', 'img', row.via);
}

const lastAuditId = (sqlite: Sqlite) => (sqlite.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM audit_log').get() as { n: number }).n;

/** The download rows written after audit id `after`, shaped like the fixture's recorded audit calls. */
function downloadsAfter(sqlite: Sqlite, after: number) {
  const rows = sqlite.prepare("SELECT action, document_id AS documentId, via FROM audit_log WHERE id > ? AND action = 'download' ORDER BY id").all(after);
  return JSON.parse(JSON.stringify(rows)) as { action: string; documentId: string; via: string }[];
}

/** The UTC day of `now` and the instants that open it and close the day before, for rows seeded on either side. */
function dayOf(now: Date) {
  const day = utcDay(now);
  return { day, start: `${day}T00:00:00.000Z`, yesterday: new Date(Date.parse(`${day}T00:00:00.000Z`) - 1).toISOString() };
}

/**
 * One call as `options` describes it. `audits` lists what it logged: the download rows it wrote to audit_log (bytes
 * are reserved in the database itself), then the reads it audited through the context.
 */
async function get(id: string, options: CtxOptions = {}, before?: (sqlite: Sqlite) => void) {
  const { db, sqlite, files } = room();
  before?.(sqlite);
  const { ctx, audits } = clientCtx(db, { files: files.bucket, ...options });
  const mark = lastAuditId(sqlite);
  const out = await getFileTool.handler(getFileTool.inputSchema.parse({ id }), ctx);
  return { out, audits: [...downloadsAfter(sqlite, mark), ...audits], gets: files.gets, sqlite };
}

const NO_STORAGE = /R2-LEAK|SHA-LEAK|ETAG-LEAK|r2_key|sha256|etag/;

test('Claude gets a small image as image content, audited as download with the client name', async () => {
  const { out, audits } = await get('img');
  assert.equal(out.content.length, 2);
  const [details, image] = out.content as [{ type: string; text: string }, { type: string; data: string; mimeType: string }];
  assert.equal(details.type, 'text');
  assert.deepEqual([image.type, image.mimeType, image.data], ['image', 'image/png', base64(SMALL_PNG)]);
  const facts = out.structuredContent as Record<string, unknown>;
  assert.deepEqual([facts.embedded, facts.width, facts.height, facts.size_bytes], [true, 800, 600, SMALL_PNG.byteLength]);
  assert.equal(facts.link, 'https://room.example.com/doc/?id=img');
  assert.deepEqual(audits, [{ action: 'download', documentId: 'img', via: 'Claude' }]);
  assert.doesNotMatch(JSON.stringify(out), NO_STORAGE);
});

test('Claude gets a small PDF as its details, page count, a legallas_read_pages pointer and the room link, never the file', async () => {
  const { out, audits, gets } = await get('pdf');
  assert.deepEqual(out.content.map((c) => c.type), ['text'], 'no embedded resource');
  const facts = body(out);
  assert.deepEqual([facts.embedded, facts.reason, facts.read_with, facts.pages], [false, 'pdf_as_text', 'legallas_read_pages', 2]);
  assert.equal(facts.link, 'https://room.example.com/doc/?id=pdf');
  assert.match(facts.note, /^PDFs come back as their text, not as files\. Read its text with legallas_read_pages/);
  assert.deepEqual(gets, [], 'the bytes are never read');
  assert.doesNotMatch(JSON.stringify(out), new RegExp(`resource|blob|${base64(SMALL_PDF).slice(0, 24).replace(/[+/]/g, '.')}`));
  assert.equal((out.structuredContent as { control: string }).control, 'DOE-000012');
  assert.deepEqual(audits, [{ action: 'ai_read', documentId: 'pdf', via: 'Claude' }], 'a read, not a download');
  assert.doesNotMatch(JSON.stringify(out), NO_STORAGE);
});

test('every byte pull is audited again: two pulls of one file are two download rows', async () => {
  const { db, sqlite, files } = room();
  const { ctx, audits } = clientCtx(db, { files: files.bucket });
  for (let i = 0; i < 2; i += 1) await getFileTool.handler({ id: 'img' }, ctx);
  assert.deepEqual(downloadsAfter(sqlite, 0).map((a) => [a.action, a.documentId, a.via]), [['download', 'img', 'Claude'], ['download', 'img', 'Claude']]);
  assert.deepEqual(audits, [], 'no read is logged beside a download');
});

test('compact, Harvey and unknown clients get text only, never bytes, and no download row', async () => {
  for (const clientKind of ['microsoft', 'harvey', 'unknown'] as const) {
    for (const id of ['img', 'pdf']) {
      const { out, audits, gets } = await get(id, { clientKind });
      assert.deepEqual(out.content.map((c) => c.type), ['text'], `${clientKind} ${id}`);
      const facts = body(out);
      assert.deepEqual([facts.embedded, facts.reason, facts.read_with], [false, 'client', 'legallas_read_pages']);
      assert.equal(facts.link, `https://room.example.com/doc/?id=${id}`);
      assert.deepEqual(gets, [], 'the bytes are never read');
      assert.deepEqual(audits, [{ action: 'ai_read', documentId: id, via: CLIENT_NAMES[clientKind] }]);
      assert.doesNotMatch(JSON.stringify(out), NO_STORAGE);
    }
  }
});

test('size caps: base64 of at most 100,000 characters, images of at most one megapixel', async () => {
  const edge = await get('edge');
  assert.equal((edge.out.content[1] as { type: string }).type, 'image');
  assert.equal((edge.out.content[1] as { data: string }).data.length, EMBED_MAX_BASE64_CHARS);
  for (const [id, mimeType] of [['mp', 'image/png'], ['jpg-ok', 'image/jpeg'], ['vp8-ok', 'image/webp']] as const) {
    const { out, audits } = await get(id);
    assert.deepEqual([(out.content[1] as { type: string }).type, (out.content[1] as { mimeType: string }).mimeType], ['image', mimeType], id);
    assert.deepEqual([body(out).width, body(out).height], [1000, 1000], id);
    assert.deepEqual(audits.map((a) => a.action), ['download'], id);
  }
  for (const id of ['over', 'wide', 'stale', 'jpg-big', 'vp8l-big']) {
    const { out, audits } = await get(id);
    assert.deepEqual(out.content.map((c) => c.type), ['text'], id);
    assert.deepEqual([body(out).reason, body(out).embedded], ['too_large', false], id);
    assert.deepEqual(audits.map((a) => a.action), ['ai_read'], id);
  }
  const over = await get('over');
  assert.deepEqual(over.gets, [], 'a file the row says is too large is never fetched');
});

test('the bytes must match the recorded type: SVG, GIF, markup, a GIF or a PDF posing as PNG, and text files are not sent', async () => {
  for (const [id, reason] of [['fake', 'unrecognized'], ['jpg-cut', 'unrecognized'], ['svg', 'type'], ['notes', 'type'], ['gif', 'type'], ['gif-as-png', 'unrecognized'], ['pdf-as-png', 'unrecognized']] as const) {
    const { out, audits } = await get(id);
    assert.deepEqual(out.content.map((c) => c.type), ['text'], id);
    assert.equal(body(out).reason, reason, id);
    assert.deepEqual(audits.map((a) => a.action), ['ai_read'], id);
  }
  const lost = await get('lost');
  assert.equal(body(lost.out).reason, 'unavailable');
});

test('a visual points to legallas_view_visual and is never fetched', async () => {
  for (const clientKind of ['claude', 'microsoft'] as const) {
    const { out, audits, gets } = await get('vis', { clientKind });
    const facts = body(out);
    assert.deepEqual([facts.reason, facts.view_with, facts.embedded], ['visual', 'legallas_view_visual', false]);
    assert.deepEqual(gets, []);
    assert.deepEqual(audits, [{ action: 'ai_read', documentId: 'vis', via: CLIENT_NAMES[clientKind] }]);
  }
});

test('a privileged file is served to counsel and refused to the retired family role; removed, hidden and unknown ones are not found', async () => {
  const family = await get('priv', { role: 'family' as Role });
  assert.match((family.out.content[0] as { text: string }).text, /^forbidden:/);
  assert.deepEqual([family.gets, family.audits], [[], []]);
  assert.equal((await get('priv', { role: 'counsel' })).out.content.length, 2);
  for (const id of ['gone', 'hidden', 'nope']) {
    const { out, gets, audits } = await get(id, { role: 'owner' });
    assert.match((out.content[0] as { text: string }).text, /^not_found:/, id);
    assert.deepEqual([gets, audits], [[], []], id);
  }
});

test('runTool refuses a family row left from before migration 0010 before the tool runs', async () => {
  const { db, sqlite } = room();
  addLeftoverFamily(sqlite, 'kin@mail.example', 'Kin');
  const env = { DB: db, TEAM_DOMAIN: '', ACCESS_AUD: '' } as never;
  const props: Props = { email: 'kin@mail.example', role: 'family' as Role, clientId: 'c1', clientName: 'Claude' };
  const handler = async () => assert.fail('legallas_get_file ran for family');
  const out = await runTool({ ...getFileTool, handler } as never, { id: 'img' }, env, props, undefined, new Date());
  assert.match((out.content[0] as { text: string }).text, /^not_a_member:/);
});

test('image headers: PNG, JPEG and WebP sizes are read; anything else, a GIF or PDF included, is not embeddable', () => {
  assert.deepEqual(imageSize(pngBytes(640, 480), 'image/png'), { width: 640, height: 480 });
  assert.deepEqual(imageSize(jpegBytes(1200, 800), 'image/jpeg'), { width: 1200, height: 800 });
  assert.deepEqual(imageSize(webpBytes(1000, 1001), 'image/webp'), { width: 1000, height: 1001 });
  assert.deepEqual(imageSize(jpegBytes(640, 4000, 64, true), 'image/jpeg'), { width: 640, height: 4000 }, 'SOF2 after RST0 and a fill byte');
  assert.deepEqual(imageSize(webpLosslessBytes(16383, 1), 'image/webp'), { width: 16383, height: 1 });
  assert.deepEqual(imageSize(webpLosslessBytes(1, 16384), 'image/webp'), { width: 1, height: 16384 });
  assert.deepEqual(imageSize(webpLosslessBytes(3001, 2999), 'image/webp'), { width: 3001, height: 2999 });
  assert.deepEqual(imageSize(webpLossyBytes(1920, 1080), 'image/webp'), { width: 1920, height: 1080 });
  assert.equal(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]), 'image/jpeg'), null, 'scan data before a frame header');
  assert.equal(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03]), 'image/jpeg'), null, 'a frame header cut short');
  assert.equal(imageSize(webpBytes(10, 10, 0).slice(0, 25), 'image/webp'), null, 'a WebP header cut short');
  assert.deepEqual(
    [pngBytes(1, 1), jpegBytes(1, 1), gifBytes(1, 1), webpBytes(1, 1), pdfBytes()].map(sniffType),
    ['image/png', 'image/jpeg', null, 'image/webp', null],
  );
  for (const text of ['<svg></svg>', '<html>', 'GIF8', 'RIFF....WAVE', '']) assert.equal(sniffType(new TextEncoder().encode(text)), null, text);
});

test('through runTool and the real audit log: two pulls by Claude are two download rows; Microsoft gets details only', async () => {
  const { db, sqlite, files } = room();
  const env = { DB: db, FILES: files.bucket, CONTROL_PREFIX: 'DOE', TEAM_DOMAIN: '', ACCESS_AUD: '' } as unknown as McpEnv;
  const as = (clientName: string): Props => ({ email: 'ada@firm.example', role: 'counsel', clientId: 'c1', clientName });
  const now = new Date();
  for (let i = 0; i < 2; i += 1) {
    const out = await runTool(getFileTool, { id: 'img' }, env, as('Claude'), undefined, now, 'claude');
    assert.equal((out.content[1] as { type: string }).type, 'image');
  }
  const copilot = await runTool(getFileTool, { id: 'img' }, env, as('Microsoft Copilot'), undefined, now, 'microsoft');
  assert.deepEqual(copilot.content.map((c) => c.type), ['text']);
  const unknown = await runTool(getFileTool, { id: 'pdf' }, env, as('Some App'), undefined, now);
  assert.deepEqual(unknown.content.map((c) => c.type), ['text']);
  const rows = JSON.parse(JSON.stringify(sqlite.prepare('SELECT action, document_id, via FROM audit_log ORDER BY id').all()));
  assert.deepEqual(rows, [
    { action: 'download', document_id: 'img', via: 'Claude' },
    { action: 'download', document_id: 'img', via: 'Claude' },
    { action: 'ai_read', document_id: 'img', via: 'Microsoft Copilot' },
    { action: 'ai_read', document_id: 'pdf', via: 'Some App' },
  ]);
});

test('the daily download cap: the 200th pull of the day still embeds, past it the answer falls back to the details', async () => {
  const me = 'counsel@example.test';
  const now = new Date();
  const { start: today, yesterday } = dayOf(now);
  const under = await get('img', { now }, (sqlite) => seedAudits(sqlite, DAILY_DOWNLOAD_CAP - 1, { email: me, ts: today, via: 'Claude' }));
  assert.equal((under.out.content[1] as { type: string }).type, 'image');
  assert.deepEqual(under.audits.map((a) => a.action), ['download']);

  const at = await get('img', { now }, (sqlite) => seedAudits(sqlite, DAILY_DOWNLOAD_CAP, { email: me, ts: today, via: 'Harvey' }));
  assert.equal(at.out.isError, undefined, 'the call still answers');
  assert.deepEqual(at.out.content.map((c) => c.type), ['text']);
  const facts = body(at.out);
  assert.deepEqual([facts.embedded, facts.reason, facts.read_with], [false, 'download_limit', 'legallas_read_pages']);
  assert.match(facts.note, /^The daily limit for file downloads through AI tools is reached\. It resets at midnight UTC\./);
  assert.deepEqual(at.gets, [], 'the bytes are not read');
  assert.deepEqual(at.audits.map((a) => a.action), ['ai_read']);

  const others = await get('img', { now }, (sqlite) => {
    seedAudits(sqlite, DAILY_DOWNLOAD_CAP, { email: me, ts: yesterday, via: 'Claude' });
    seedAudits(sqlite, DAILY_DOWNLOAD_CAP, { email: me, ts: today, via: null });
    seedAudits(sqlite, DAILY_DOWNLOAD_CAP, { email: 'ada@firm.example', ts: today, via: 'Claude' });
    seedAudits(sqlite, DAILY_DOWNLOAD_CAP, { email: me, ts: today, via: 'Claude', action: 'ai_read' });
  });
  assert.equal((others.out.content[1] as { type: string }).type, 'image', "yesterday's, room, other members' and read rows do not count");
});

test('through runTool: the pull that reaches the cap is sent and audited, and the next one gets the details', async () => {
  const { db, sqlite, files } = room();
  const now = new Date();
  const { start } = dayOf(now);
  seedAudits(sqlite, DAILY_DOWNLOAD_CAP - 1, { email: 'ada@firm.example', ts: start, via: 'Claude' });
  const env = { DB: db, FILES: files.bucket, CONTROL_PREFIX: 'DOE', TEAM_DOMAIN: '', ACCESS_AUD: '' } as unknown as McpEnv;
  const props: Props = { email: 'ada@firm.example', role: 'counsel', clientId: 'c1', clientName: 'Claude' };
  const last = await runTool(getFileTool, { id: 'img' }, env, props, undefined, now, 'claude');
  assert.equal((last.content[1] as { type: string }).type, 'image');
  const over = await runTool(getFileTool, { id: 'img' }, env, props, undefined, now, 'claude');
  assert.deepEqual([over.content.map((c) => c.type), body(over).reason], [['text'], 'download_limit']);
  const today = (action: string) => (sqlite.prepare('SELECT count(*) AS n FROM audit_log WHERE action = ? AND ts >= ?').get(action, start) as { n: number }).n;
  assert.deepEqual([today('download'), today('ai_read')], [DAILY_DOWNLOAD_CAP, 1]);
});

test('the cap holds under parallel calls: one statement reserves, so the 201st reservation of the day is refused', async () => {
  const { db, sqlite } = room();
  const now = new Date();
  const { day, start } = dayOf(now);
  seedAudits(sqlite, DAILY_DOWNLOAD_CAP - 10, { email: 'ada@firm.example', ts: start, via: 'Claude' });
  const entry = { email: 'ada@firm.example', documentId: 'img', via: 'Claude' };
  const won = await Promise.all(Array.from({ length: 25 }, () => reserveDownload(db, entry, DAILY_DOWNLOAD_CAP, day)));
  assert.equal(won.filter(Boolean).length, 10);
  assert.equal(await reserveDownload(db, entry, DAILY_DOWNLOAD_CAP, day), false, 'the 201st');
  const count = (sqlite.prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'download' AND ts >= ?").get(start) as { n: number }).n;
  assert.equal(count, DAILY_DOWNLOAD_CAP);
  assert.equal(await reserveDownload(db, { ...entry, via: '\u0007' }, DAILY_DOWNLOAD_CAP, day), false, 'a client name that cleans to nothing still counts');
});

test('parallel pulls that all pass the first look are still held to the cap at the reservation', async () => {
  const { db, sqlite, files } = room();
  const now = new Date();
  seedAudits(sqlite, DAILY_DOWNLOAD_CAP - 2, { email: 'counsel@example.test', ts: dayOf(now).start, via: 'Claude' });
  const calls = Array.from({ length: 5 }, () => getFileTool.handler({ id: 'img' }, clientCtx(db, { files: files.bucket, now }).ctx));
  const results = await Promise.all(calls);
  assert.equal(files.gets.length, 5, 'every call passed the first look and read the file');
  const sent = results.filter((out) => out.content.length === 2);
  const held = results.filter((out) => body(out).reason === 'download_limit');
  assert.deepEqual([sent.length, held.length], [2, 3]);
  assert.ok(held.every((out) => out.content.length === 1), 'a held call carries no bytes');
});

test('when the download row cannot be written, the call fails with internal_error and no file attached', async () => {
  const { db, sqlite, files } = room();
  sqlite.exec("CREATE TRIGGER no_downloads BEFORE INSERT ON audit_log WHEN NEW.action = 'download' BEGIN SELECT RAISE(ABORT, 'refused'); END");
  const env = { DB: db, FILES: files.bucket, CONTROL_PREFIX: 'DOE', TEAM_DOMAIN: '', ACCESS_AUD: '' } as unknown as McpEnv;
  const props: Props = { email: 'ada@firm.example', role: 'counsel', clientId: 'c1', clientName: 'Claude' };
  for (const id of ['img', 'mp']) {
    const out = await runTool(getFileTool, { id }, env, props, undefined, new Date(), 'claude');
    assert.equal(out.isError, true, id);
    assert.deepEqual(out.content.map((c) => c.type), ['text'], id);
    assert.match((out.content[0] as { text: string }).text, /^internal_error:/, id);
    assert.doesNotMatch(JSON.stringify(out), /refused|base64|blob|"data"/, id);
  }
  const pdf = await runTool(getFileTool, { id: 'pdf' }, env, props, undefined, new Date(), 'claude');
  assert.equal(body(pdf).reason, 'pdf_as_text', 'a PDF never tries to write a download row');
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'download'").get() as { n: number }).n, 0);
});

test('PDFs of any size are never sent to Claude, never read, never a download and never counted against the cap', async () => {
  const me = 'counsel@example.test';
  const now = new Date();
  for (const id of ['pdf', 'pdf-edge', 'pdf-big', 'pdf-stale']) {
    const { out, audits, gets } = await get(id, { now });
    assert.deepEqual(out.content.map((c) => c.type), ['text'], id);
    assert.deepEqual([body(out).reason, body(out).embedded, body(out).read_with], ['pdf_as_text', false, 'legallas_read_pages'], id);
    assert.deepEqual([gets, audits.map((a) => a.action)], [[], ['ai_read']], id);
  }
  assert.equal(body((await get('pdf-big', { now })).out).pages, 40, 'the page count is kept');
  const atCap = await get('pdf', { now }, (sqlite) => seedAudits(sqlite, DAILY_DOWNLOAD_CAP, { email: me, ts: dayOf(now).start, via: 'Claude' }));
  assert.equal(body(atCap.out).reason, 'pdf_as_text', 'a PDF answers the same at the cap');
  const { db, sqlite, files } = room();
  const { ctx } = clientCtx(db, { files: files.bucket, now });
  for (let i = 0; i < 3; i += 1) await getFileTool.handler({ id: 'pdf' }, ctx);
  assert.equal(await downloadsToday(db, me, dayOf(now).day), 0);
  assert.equal(downloadsAfter(sqlite, 0).length, 0);
});
