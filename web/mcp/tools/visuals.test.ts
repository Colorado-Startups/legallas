// SPDX-License-Identifier: Apache-2.0
// legallas_view_visual on real SQLite with a fake legallas-files bucket, and a DOE visual found by the retrieval
// legallas_search runs after it is indexed the way sync indexes it (scripts/extract.ts reading the rendered text).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { directTextPages } from '../../scripts/extract.ts';
import { buildParts } from '../../scripts/indexparts.ts';
import { visualTextSource, writeVisualEntry } from '../../scripts/visual-ai.ts';
import type { Role } from '../../worker/env.ts';
import { RETRIEVAL, retrieve } from '../../worker/retrieval.ts';
import { MANIFEST_NAME, visualAiKey } from '../../worker/visuals.ts';
import { COMPACT_LIMITS, DAILY_DOWNLOAD_CAP, type ToolContext } from '../contract.ts';
import { devSearch } from '../dev-search.ts';
import { encodeCursor } from '../format.ts';
import { body, catalogDb, fakeIndex, toolCtx, type DocSeed } from './doc-fixtures.ts';
import { viewVisualTool } from './visuals.ts';
import { FENCE, PLANTED_AI, PLANTED_ORDER } from './untrusted-fixtures.ts';
import { UNFILED_ORDER_REMINDER, UNTRUSTED_REMINDER } from '../../worker/prompt.ts';

const sha = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');
const FOLDER = '03-Kitchen-Records/Visuals';
/** A tiny PNG header (signature and IHDR, 10 by 10 pixels): enough for the side-file checks. */
const PNG = (() => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 10, 0, 0, 0, 10]);
  return bytes;
})();

interface Room {
  visuals: { slug: string; section: string; title: string; text?: string; png?: boolean; overview?: boolean }[];
  sections?: { slug: string; label: string; title: string }[];
  extra?: DocSeed[];
  manifest?: string;
}

/** A binder: its manifest row and file, one documents row per visual, and the side files in legallas-files. */
function room(spec: Room) {
  const sections = spec.sections ?? [{ slug: 'tab-1', label: 'Tab 1', title: 'Doe deliveries' }];
  const seeds: DocSeed[] = [
    { id: 'manifest', path: `${FOLDER}/${MANIFEST_NAME}`, kind: 'text', controlSeq: 1 },
    ...spec.visuals.map((v, i) => ({ id: `vis-${v.slug}`, path: `${FOLDER}/${v.slug}.html`, kind: 'visual', controlSeq: 10 + i })),
    ...(spec.extra ?? []),
  ];
  const { db, sqlite } = catalogDb(seeds);
  const objects = new Map<string, string | Uint8Array>();
  objects.set('R2-LEAK-manifest', spec.manifest ?? JSON.stringify({
    version: 1,
    sections,
    visuals: spec.visuals.map((v) => ({ slug: v.slug, section: v.section, file: `${v.slug}.html`, title: v.title, overview: v.overview ?? false })),
  }));
  for (const v of [...spec.visuals, ...(spec.extra ?? []).map((seed) => ({ slug: seed.id, text: `Text of ${seed.id}`, png: false }))]) {
    const id = v.slug.startsWith('extra-') ? v.slug : `vis-${v.slug}`;
    const pageSha = sha(`<html>${v.slug}</html>`);
    sqlite.prepare('UPDATE documents SET sha256 = ?1 WHERE id = ?2').run(pageSha, id);
    if (v.text !== undefined) objects.set(visualAiKey(pageSha, 'txt'), v.text);
    if (v.png) objects.set(visualAiKey(pageSha, 'png'), PNG);
  }
  const files = {
    async get(key: string) {
      const value = objects.get(key);
      if (value === undefined) return null;
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
      return { text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => bytes.slice().buffer };
    },
  };
  return { db, sqlite, files };
}

function context(spec: Room, opts: { profile?: 'compact' | 'standard'; clientKind?: string; role?: string } = {}) {
  const { db, sqlite, files } = room(spec);
  const { ctx, audits } = toolCtx(db, undefined, (opts.role ?? 'counsel') as Role);
  (ctx.env as { FILES?: unknown }).FILES = files;
  Object.assign(ctx, { profile: opts.profile ?? 'standard', clientKind: opts.clientKind ?? 'claude' });
  return { ctx, audits, sqlite };
}

async function call(ctx: ToolContext, args: Record<string, unknown>) {
  return viewVisualTool.handler(viewVisualTool.inputSchema.parse(args), ctx);
}

const DOE = {
  visuals: [
    { slug: 'route-map', section: 'tab-1', title: 'Doe route map', text: '# Doe route map\nCopperline delivers 212 meals to the Roe Commissary.', png: true },
    { slug: 'hub', section: 'tab-1', title: 'Doe delivery overview', text: '# Overview', overview: true },
    { slug: 'later', section: 'tab-2', title: 'Doe timeline' },
  ],
  sections: [
    { slug: 'tab-1', label: 'Tab 1', title: 'Doe deliveries' },
    { slug: 'tab-2', label: 'Tab 2', title: 'Doe timeline' },
  ],
};

test('with no id, the table of contents lists tabs and pages in reading order, with control numbers and room links', async () => {
  const { ctx, audits } = context(DOE);
  const out = await call(ctx, {});
  const value = body(out);
  assert.deepEqual([value.tabs, value.visuals, value.from, value.next], [2, 3, 1, undefined]);
  assert.deepEqual(value.sections.map((s: any) => [s.tab, s.title, s.visuals.map((v: any) => v.slug)]), [
    ['Tab 1', 'Doe deliveries', ['hub', 'route-map']],
    ['Tab 2', 'Doe timeline', ['later']],
  ]);
  assert.deepEqual(value.sections[0].visuals[0], {
    id: 'vis-hub', slug: 'hub', control: 'DOE-000011', title: 'Doe delivery overview', summary: null, overview: true,
    link: 'https://room.example.com/visual/?v=hub',
  });
  const text = JSON.stringify(out);
  for (const leak of ['SHA-LEAK', 'R2-LEAK', 'ETAG-LEAK', sha('<html>hub</html>'), 'meta/visual-ai']) assert.ok(!text.includes(leak), leak);
  assert.deepEqual(audits, [{ action: 'ai_read', documentId: null }]);
});

test('a compact client pages the table of contents within 25 pages and 9,000 characters, and the cursor round-trips', async () => {
  const visuals = Array.from({ length: 40 }, (_, i) => ({ slug: `page-${i}`, section: 'tab-1', title: `Doe page ${i} ${'with a long title '.repeat(6)}` }));
  const { ctx } = context({ visuals }, { profile: 'compact', clientKind: 'microsoft' });
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let pageCount = 0; pageCount < 10; pageCount += 1) {
    const out = await call(ctx, cursor ? { cursor } : {});
    const value = body(out);
    const text = (out.content[0] as { text: string }).text;
    assert.ok(text.length <= COMPACT_LIMITS.maxChars, `page ${pageCount}: ${text.length}`);
    const slugs = value.sections.flatMap((s: any) => s.visuals.map((v: any) => v.slug));
    assert.ok(slugs.length >= 1 && slugs.length <= 25);
    seen.push(...slugs);
    cursor = value.next;
    if (!cursor) break;
  }
  assert.deepEqual(seen, visuals.map((v) => v.slug));
  assert.ok(body(await call(context({ visuals }, { profile: 'standard' }).ctx, {})).next === undefined, 'standard lists them all at once');
  assert.equal((await call(ctx, { cursor: 'not-a-cursor' })).isError, true);
  assert.equal((await call(ctx, { cursor: encodeCursor(['text', 'vis-page-1', 3]) })).isError, true, 'a text cursor does not page the table');
  assert.equal((await call(ctx, { cursor: encodeCursor(['toc', 40]) })).isError, true, 'past the end');
});

test('a visual by slug or id returns its text as case data, its tab and room link, and the PNG for Claude only', async () => {
  const claude = context(DOE);
  const out = await call(claude.ctx, { id: 'route-map' });
  const value = body(out);
  assert.deepEqual(
    [value.id, value.slug, value.control, value.title, value.tab, value.link, value.image_embedded],
    ['vis-route-map', 'route-map', 'DOE-000010', 'Doe route map', 'Tab 1: Doe deliveries', 'https://room.example.com/visual/?v=route-map', true],
  );
  assert.equal(value.text, '<case-record>\n# Doe route map\nCopperline delivers 212 meals to the Roe Commissary.\n</case-record>');
  const image = out.content.find((item) => item.type === 'image') as { data: string; mimeType: string };
  assert.deepEqual([image.mimeType, new Uint8Array(Buffer.from(image.data, 'base64'))], ['image/png', PNG]);
  assert.deepEqual(claude.audits, [{ action: 'ai_read', documentId: 'vis-route-map' }, { action: 'download', documentId: 'vis-route-map' }], 'the PNG is a byte pull');

  for (const clientKind of ['microsoft', 'harvey', 'unknown']) {
    const other = await call(context(DOE, { clientKind }).ctx, { id: 'vis-route-map' });
    assert.equal(other.content.some((item) => item.type === 'image'), false, clientKind);
    assert.equal(body(other).image_embedded, undefined);
  }
  const unsynced = body(await call(context(DOE).ctx, { id: 'later' }));
  assert.deepEqual([unsynced.text, unsynced.title], [null, 'Doe timeline']);
  assert.equal((await call(context(DOE).ctx, { id: 'no-such-visual' })).isError, true);
});

test('at the daily download cap the text still comes back, without the PNG and with the reason', async () => {
  const { ctx, audits, sqlite } = context(DOE);
  const insert = sqlite.prepare('INSERT INTO audit_log (ts, email, action, document_id, via) VALUES (?, ?, ?, ?, ?)');
  for (let i = 0; i < DAILY_DOWNLOAD_CAP - 1; i += 1) insert.run('2026-10-01T08:00:00.000Z', ctx.member.email, 'download', `doc-${i}`, 'Claude');
  insert.run('2026-10-01T09:00:00.000Z', ctx.member.email, 'download', 'doc-room', null);
  insert.run('2026-09-30T23:59:00.000Z', ctx.member.email, 'download', 'doc-yesterday', 'Claude');
  const last = await call(ctx, { id: 'route-map' });
  assert.equal(last.content.some((item) => item.type === 'image'), true, 'the 200th pull still goes');
  insert.run('2026-10-01T10:00:00.000Z', ctx.member.email, 'download', 'vis-route-map', 'Claude');

  audits.length = 0;
  const capped = await call(ctx, { id: 'route-map' });
  const value = body(capped);
  assert.equal(capped.content.some((item) => item.type === 'image'), false);
  assert.deepEqual([value.image_embedded, value.image_reason], [false, 'download_limit']);
  assert.match(value.text, /Copperline delivers 212 meals to the Roe Commissary\./);
  assert.deepEqual(audits, [{ action: 'ai_read', documentId: 'vis-route-map' }], 'no download is audited when none is sent');
});

test('a text cursor belongs to its visual', async () => {
  const long = Array.from({ length: 900 }, (_, i) => `Line ${i}: Doe ledger`).join('\n');
  const { ctx } = context({ visuals: [{ slug: 'ledger', section: 'tab-1', title: 'Doe ledger', text: long }, { slug: 'other', section: 'tab-1', title: 'Doe other', text: long }] }, { profile: 'compact' });
  const next = body(await call(ctx, { id: 'ledger' })).next as string;
  assert.ok(next);
  assert.equal(body(await call(ctx, { id: 'ledger', cursor: next })).from > 1, true);
  assert.equal((await call(ctx, { id: 'other', cursor: next })).isError, true);
  assert.equal((await call(ctx, { id: 'ledger', cursor: encodeCursor(['toc', 3]) })).isError, true);
  for (const bad of [encodeCursor(['text', 'vis-ledger', -1]), encodeCursor(['text', 'vis-ledger', 1.5]), encodeCursor(['text', 'vis-ledger', '3'])]) {
    assert.match(JSON.stringify(await call(ctx, { id: 'ledger', cursor: bad })), /bad_cursor/, bad);
  }
  assert.match(JSON.stringify(await call(ctx, { cursor: encodeCursor(['toc', -5]) })), /bad_cursor/, 'a negative table offset');
});

test('a long text pages within the compact limit and reads back whole', async () => {
  const long = Array.from({ length: 900 }, (_, i) => `Line ${i}: Doe ledger entry for Harbor Labs`).join('\n');
  const { ctx } = context({ visuals: [{ slug: 'ledger', section: 'tab-1', title: 'Doe ledger', text: long, png: true }] }, { profile: 'compact', clientKind: 'claude' });
  let cursor: string | undefined;
  let read = '';
  for (let n = 0; n < 20; n += 1) {
    const out = await call(ctx, { id: 'ledger', ...(cursor ? { cursor } : {}) });
    assert.ok((out.content[0] as { text: string }).text.length <= COMPACT_LIMITS.maxChars);
    assert.equal(out.content.some((item) => item.type === 'image'), n === 0, 'the image comes with the first stretch only');
    const value = body(out);
    read += value.text.replace(/^<case-record>\n/, '').replace(/\n<\/case-record>$/, '');
    cursor = value.next;
    if (!cursor) break;
  }
  assert.equal(read, long);
});

test('privilege, removal and a broken manifest: visuals outside the binder follow the same rules as every document', async () => {
  const extra: DocSeed[] = [
    { id: 'extra-priv', path: '07-Lawyer-Notes-PRIVILEGED/doe-notes.html', kind: 'visual', controlSeq: 40 },
    { id: 'extra-gone', path: 'A/old.html', kind: 'visual', controlSeq: 41, removedAt: '2026-10-01T00:00:00Z' },
  ];
  const counsel = body(await call(context({ ...DOE, extra }).ctx, { id: 'extra-priv' }));
  assert.deepEqual([counsel.slug, counsel.link, counsel.text], [null, 'https://room.example.com/doc/?id=extra-priv', '<case-record>\nText of extra-priv\n</case-record>']);
  const retired = await call(context({ ...DOE, extra }, { role: 'family' }).ctx, { id: 'extra-priv' });
  assert.equal(retired.isError, true, 'the retired family role is refused');
  assert.doesNotMatch(JSON.stringify(retired), /doe-notes|Text of extra-priv/);
  assert.equal((await call(context({ ...DOE, extra }).ctx, { id: 'extra-gone' })).isError, true);

  const broken = context({ ...DOE, manifest: '{"version": 2}' });
  assert.match(JSON.stringify(await call(broken.ctx, {})), /bad_manifest/);
  assert.equal(body(await call(broken.ctx, { id: 'vis-route-map' })).text, '<case-record>\n# Doe route map\nCopperline delivers 212 meals to the Roe Commissary.\n</case-record>');
});

test('a DOE visual is found by the search legallas_search runs once indexed from its rendered text; quick Ask leaves it out', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-visual-search-'));
  try {
    const html = '<html><body><script>draw(["Harbor Labs", 212])</script><h1>Doe monthly deliveries</h1></body></html>';
    const file = path.join(dir, 'doe-deliveries.html');
    await writeFile(file, html);
    await writeVisualEntry(dir, sha(html), '# Doe monthly deliveries\n\nFigure: Meals delivered by month\nHarbor Labs; 2012; 212 meals', null);
    const pages = await directTextPages(file, 'doe-deliveries.html', visualTextSource(dir));
    const { db } = catalogDb([
      { id: 'vis-deliveries', path: `${FOLDER}/doe-deliveries.html`, kind: 'visual', controlSeq: 77 },
      { id: 'doc-memo', path: 'A/memo.pdf', controlSeq: 3 },
    ]);
    const parts = new Map([...buildParts('vis-deliveries', pages), ...buildParts('doc-memo', [{ n: 1, text: 'An unrelated memo.' }])].map((p) => [p.key, p.body]));
    const search = devSearch(fakeIndex(parts).bucket);
    // legallas_search retrieves with includeVisuals (worker/ask.ts RetrieveOptions: "the MCP: always").
    const found = await retrieve(search, db, 'Harbor Labs delivered', 'counsel', RETRIEVAL, { includeVisuals: true });
    assert.equal(found.chunks[0]?.docId, 'vis-deliveries');
    assert.match(found.chunks[0]?.text ?? '', /\[\[doc:vis-deliveries p:1\]\][\s\S]*Meals delivered by month/);
    assert.equal(found.citable.get('vis-deliveries')?.control_seq, 77);
    const quickAsk = await retrieve(search, db, 'Harbor Labs delivered', 'counsel');
    assert.ok(!quickAsk.chunks.some((chunk) => chunk.docId === 'vis-deliveries'), 'quick Ask keeps visuals out until ASK_VISUALS');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a visual whose text addresses AI tools comes fenced as untrusted, with no control number, link or image, under Ask\'s reminder', async () => {
  const spec = { visuals: [{ slug: 'note', section: 'tab-1', title: 'Doe kitchen note', text: PLANTED_AI, png: true }] };
  const { ctx, audits } = context(spec);
  const out = await call(ctx, { id: 'note' });
  const value = body(out);
  assert.equal(Object.keys(value)[0], 'untrusted_note', 'the note comes first');
  assert.equal(value.untrusted_note, UNTRUSTED_REMINDER);
  assert.equal(value.text, `${FENCE.ai}${PLANTED_AI}\n</case-record>`);
  assert.deepEqual([value.id, value.control, value.link, value.untrusted], ['vis-note', undefined, undefined, 'addressed-to-ai']);
  assert.equal(out.content.some((item) => item.type === 'image'), false, 'its image would carry the same words');
  assert.deepEqual([value.image_embedded, value.image_reason], [false, 'untrusted']);
  assert.deepEqual(audits, [{ action: 'ai_read', documentId: 'vis-note' }], 'no download is audited when none is sent');
});

test('a visual is judged whole: every stretch of a long untrusted text is fenced, and a forged order is an unfiled one', async () => {
  const long = `${PLANTED_ORDER}\n${Array.from({ length: 900 }, (_, i) => `Line ${i}: Doe ledger entry for Harbor Labs`).join('\n')}`;
  const { ctx } = context({ visuals: [{ slug: 'ledger', section: 'tab-1', title: 'Doe ledger', text: long }] }, { profile: 'compact' });
  let cursor: string | undefined;
  for (let n = 0; n < 20; n += 1) {
    const out = await call(ctx, { id: 'ledger', ...(cursor ? { cursor } : {}) });
    assert.ok((out.content[0] as { text: string }).text.length <= COMPACT_LIMITS.maxChars, 'the note fits the compact limit');
    const value = body(out);
    assert.ok(value.text.startsWith(FENCE.order), `stretch ${n}`);
    assert.equal(value.untrusted_note, UNFILED_ORDER_REMINDER);
    cursor = value.next;
    if (!cursor) return assert.ok(n > 0, 'it took more than one stretch');
  }
  assert.fail('the text never ended');
});

test('a binder title that addresses an AI is fenced in the contents, and that page offers no cite (#701)', async () => {
  const spec = { visuals: [{ slug: 'note', section: 'tab-1', title: PLANTED_AI }, { slug: 'plain', section: 'tab-1', title: 'Doe timeline' }], sections: [{ slug: 'tab-1', label: 'Tab 1', title: 'Doe deliveries' }] };
  const value = body(await call(context(spec).ctx, {}));
  assert.equal(value.untrusted_note, UNTRUSTED_REMINDER);
  const [planted, plain] = ['note', 'plain'].map((slug) => value.sections[0].visuals.find((v: any) => v.slug === slug));
  assert.deepEqual([planted.title, planted.untrusted, planted.control, planted.link], [`${FENCE.ai}${PLANTED_AI}\n</case-record>`, 'addressed-to-ai', undefined, undefined]);
  assert.equal(plain.title, 'Doe timeline');
  assert.ok(plain.link);
});
