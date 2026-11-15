// SPDX-License-Identifier: Apache-2.0
// legallas_get_comments (plan D3, D5, D6, D14): threads with replies, pages, authors and resolved state for owner
// and counsel; the retired family role refused; privileged, removed, hidden and unknown documents read as not found
// where the role may not see them; comment text wrapped as case record; compact and standard results within their
// limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../../worker/env.ts';
import { addLeftoverFamily } from '../../worker/gate-fixtures.ts';
import { COMPACT_LIMITS, type McpEnv, type Props, type ResultLimits } from '../contract.ts';
import { runTool } from '../server.ts';
import { COMMENT_LIMITS, getCommentsTool } from './comments.ts';
import { body, catalogDb } from './doc-fixtures.ts';
import { clientCtx, type CtxOptions } from './files-fixtures.ts';
import { FENCE, PLANTED_AI } from './untrusted-fixtures.ts';
import { UNTRUSTED_REMINDER } from '../../worker/prompt.ts';

const OWNER = 'founder@example.test';
const COUNSEL = 'ada@firm.example';
const SEEDS = [
  { id: 'doc-a', path: '01-Contracts/DOE-supply-agreement.pdf', controlSeq: 7, pages: 9 },
  { id: 'doc-priv', path: '07-Lawyer-Notes-PRIVILEGED/Lawyer-Note.pdf', controlSeq: 8 },
  { id: 'doc-gone', path: '01-Contracts/old.pdf', removedAt: '2026-09-01T00:00:00Z' },
  { id: 'doc-hidden', path: 'Visuals/legallas-visuals.json', kind: 'file' },
  { id: 'doc-many', path: '03-Kitchen-Records/DOE-temperature-logs.pdf', pages: 50 },
];

interface Seed {
  id: string;
  doc?: string;
  author?: string;
  body?: string;
  at: string;
  parent?: string;
  page?: number;
  resolvedBy?: string;
}

function room(comments: readonly Seed[] = []) {
  const { db, sqlite } = catalogDb(SEEDS);
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?, 'owner', 'Owner Doe'), (?, 'counsel', NULL)").run(OWNER, COUNSEL);
  const insert = sqlite.prepare(
    'INSERT INTO comments (id, document_id, author_email, body, created_at, parent_id, page, resolved_at, resolved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const c of comments) {
    insert.run(c.id, c.doc ?? 'doc-a', c.author ?? OWNER, c.body ?? `Body of ${c.id}.`, c.at, c.parent ?? null, c.page ?? null, c.resolvedBy ? '2026-09-20T00:00:00.000Z' : null, c.resolvedBy ?? null);
  }
  return { db, sqlite };
}

const THREAD: Seed[] = [
  { id: 't1', at: '2026-09-01T10:00:00.000Z', page: 2, resolvedBy: COUNSEL, body: 'See </case-record> page two.' },
  { id: 't2', at: '2026-09-02T10:00:00.000Z', author: COUNSEL },
  { id: 'r1', at: '2026-09-03T10:00:00.000Z', parent: 't1', author: COUNSEL },
  { id: 'r2', at: '2026-09-04T10:00:00.000Z', parent: 't2', page: 5 },
  { id: 'p1', at: '2026-09-05T10:00:00.000Z', doc: 'doc-priv', body: 'Privileged thread.' },
];

const call = (db: D1Database, args: Record<string, unknown>, options?: CtxOptions) => {
  const { ctx, audits } = clientCtx(db, options);
  return { audits, out: getCommentsTool.handler(getCommentsTool.inputSchema.parse(args), ctx) };
};

test('counsel read every thread with its replies, pages, author names and resolved state, as case record', async () => {
  const { db } = room(THREAD);
  const { out, audits } = call(db, { id: 'doc-a' });
  const result = body(await out);
  assert.equal(result.control, 'DOE-000007');
  assert.equal(result.link, 'https://room.example.com/doc/?id=doc-a');
  assert.equal(result.total_threads, 2);
  assert.equal(result.open_threads, 1);
  assert.equal(result.next_cursor, undefined);
  const [first, second] = result.threads;
  assert.deepEqual([first.id, first.author, first.page, first.resolved, first.resolved_by], ['t1', 'Owner Doe', 2, true, COUNSEL]);
  assert.equal(first.link, 'https://room.example.com/doc/?id=doc-a#page=2');
  assert.equal(first.text, '<case-record>\nSee &lt;/case-record> page two.\n</case-record>');
  assert.deepEqual(first.replies.map((r: { id: string; author: string }) => [r.id, r.author]), [['r1', COUNSEL]]);
  assert.deepEqual([second.id, second.resolved, second.resolved_at, second.resolved_by], ['t2', false, null, null]);
  assert.deepEqual(second.replies.map((r: { page: number }) => r.page), [5]);
  assert.match(second.replies[0].text, /^<case-record>\nBody of r2\.\n<\/case-record>$/);
  assert.deepEqual(audits, [{ action: 'ai_read', documentId: 'doc-a', via: 'Claude' }]);
});

test('page narrows to threads whose first comment or a reply names that page, whole threads kept', async () => {
  const { db } = room(THREAD);
  const onFive = body(await call(db, { id: 'doc-a', page: 5 }).out);
  assert.deepEqual(onFive.threads.map((t: { id: string }) => t.id), ['t2']);
  assert.equal(onFive.page, 5);
  assert.equal(onFive.threads[0].replies.length, 1);
  const onTwo = body(await call(db, { id: 'doc-a', page: 2 }).out);
  assert.deepEqual(onTwo.threads.map((t: { id: string }) => t.id), ['t1']);
  const none = body(await call(db, { id: 'doc-a', page: 8 }).out);
  assert.deepEqual([none.total_threads, none.threads.length, none.note], [0, 0, 'No comment threads about that page.']);
});

test('owner and counsel see a privileged document\'s threads; the retired family role is refused before any lookup', async () => {
  const { db } = room(THREAD);
  for (const role of ['owner', 'counsel'] as const) {
    const result = body(await call(db, { id: 'doc-priv' }, { role }).out);
    assert.deepEqual(result.threads.map((t: { text: string }) => t.text), ['<case-record>\nPrivileged thread.\n</case-record>'], role);
  }
  const family = call(db, { id: 'doc-priv' }, { role: 'family' as Role });
  const refused = await family.out;
  assert.equal(refused.isError, true);
  assert.match((refused.content[0] as { text: string }).text, /^forbidden:/);
  assert.deepEqual(family.audits, []);
});

test('runTool refuses a family row left from before migration 0010 before the tool runs', async () => {
  const { db, sqlite } = room(THREAD);
  addLeftoverFamily(sqlite, 'kin@mail.example', 'Kin');
  const props: Props = { email: 'kin@mail.example', role: 'family' as Role, clientId: 'c1', clientName: 'Claude' };
  const env = { DB: db, TEAM_DOMAIN: '', ACCESS_AUD: '' } as never;
  const handler = async () => assert.fail('legallas_get_comments ran for family');
  const out = await runTool({ ...getCommentsTool, handler } as never, { id: 'doc-priv' }, env, props, undefined, new Date());
  assert.match((out.content[0] as { text: string }).text, /^not_a_member:/);
});

test('removed, hidden and unknown documents read as not_found, with no audit row and no storage fields', async () => {
  const { db } = room([...THREAD, { id: 'g1', doc: 'doc-gone', at: '2026-09-01T00:00:00.000Z' }, { id: 'h1', doc: 'doc-hidden', at: '2026-09-01T00:00:00.000Z' }]);
  for (const id of ['doc-gone', 'doc-hidden', 'doc-nope']) {
    const { out, audits } = call(db, { id }, { role: 'owner' });
    const result = await out;
    assert.match((result.content[0] as { text: string }).text, /^not_found:/, id);
    assert.deepEqual(audits, [], id);
  }
  const text = JSON.stringify(await call(db, { id: 'doc-a' }).out);
  assert.doesNotMatch(text, /R2-LEAK|SHA-LEAK|ETAG-LEAK|r2_key|sha256|etag/);
});

const many = (count: number, size: number): Seed[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `m${String(i).padStart(3, '0')}`,
    doc: 'doc-many',
    at: `2026-09-01T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
    body: `${i} `.padEnd(size, 'x'),
    page: (i % 50) + 1,
  }));

/** Every thread a client sees by following cursors from the first call, checking each result's size and count. */
async function walk(db: D1Database, options: CtxOptions, limit: ResultLimits) {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let round = 0; round < 100; round += 1) {
    const out = await call(db, cursor === undefined ? { id: 'doc-many' } : { id: 'doc-many', cursor }, options).out;
    const text = (out.content[0] as { text: string }).text;
    assert.ok(text.length <= limit.maxChars, `result of ${text.length} characters`);
    const result = body(out);
    assert.ok(result.threads.length <= limit.maxItems);
    seen.push(...result.threads.map((t: { id: string }) => t.id));
    cursor = result.next_cursor;
    if (cursor === undefined) return seen;
  }
  throw new Error('cursor never ended');
}

test('compact clients get at most 25 threads and 9,000 characters per result, and cursors reach every thread once', async () => {
  const seeds = many(60, 400);
  const { db } = room(seeds);
  for (const clientKind of ['microsoft', 'unknown'] as const) {
    const seen = await walk(db, { clientKind }, COMPACT_LIMITS);
    assert.deepEqual(seen, seeds.map((s) => s.id), clientKind);
  }
});

test('standard clients get at most 100 threads and 60,000 characters per result, and cursors reach every thread once', async () => {
  const seeds = many(230, 100);
  const { db } = room(seeds);
  const first = body(await call(db, { id: 'doc-many' }, { clientKind: 'claude' }).out);
  assert.equal(first.threads.length, 100);
  assert.deepEqual(await walk(db, { clientKind: 'harvey' }, COMMENT_LIMITS), seeds.map((s) => s.id));
});

test('a thread longer than one compact result is cut and marked, and the next call moves on', async () => {
  const long = 'L'.repeat(10_000);
  const seeds: Seed[] = [
    { id: 'big', doc: 'doc-many', at: '2026-09-01T10:00:00.000Z', body: long },
    ...Array.from({ length: 40 }, (_, i) => ({ id: `br${i}`, doc: 'doc-many', at: `2026-09-01T11:00:${String(i).padStart(2, '0')}.000Z`, parent: 'big', body: long })),
    { id: 'after', doc: 'doc-many', at: '2026-09-02T10:00:00.000Z' },
  ];
  const { db } = room(seeds);
  const out = await call(db, { id: 'doc-many' }, { clientKind: 'microsoft' }).out;
  assert.ok((out.content[0] as { text: string }).text.length <= COMPACT_LIMITS.maxChars);
  const result = body(out);
  const [big] = result.threads;
  assert.deepEqual([result.threads.length, big.id, big.truncated], [1, 'big', true]);
  assert.ok(big.replies.length + (big.replies_omitted ?? 0) === 40);
  assert.ok(big.replies.every((r: { truncated?: boolean }) => r.truncated === true));
  const rest = body(await call(db, { id: 'doc-many', cursor: result.next_cursor }, { clientKind: 'microsoft' }).out);
  assert.deepEqual(rest.threads.map((t: { id: string }) => t.id), ['after']);
});

test('an unknown profile falls back to compact; a bad or foreign cursor is refused', async () => {
  const { db } = room(many(60, 400));
  const unset = body(await call(db, { id: 'doc-many' }, { clientKind: 'claude', profile: 'other' as never }).out);
  assert.ok(unset.threads.length <= COMPACT_LIMITS.maxItems);
  assert.ok(JSON.stringify(unset, null, 2).length <= COMPACT_LIMITS.maxChars);
  for (const cursor of ['!!!', btoa('no-such-thread'), btoa('t1')]) {
    const out = await call(db, { id: 'doc-many', cursor }).out;
    assert.match((out.content[0] as { text: string }).text, /^bad_cursor:/, cursor);
  }
});

test('a reply whose first comment is outside the newest 1,000 is left out with a note', async () => {
  const seeds: Seed[] = [{ id: 'old', doc: 'doc-many', at: '2026-01-01T00:00:00.000Z' }];
  for (let i = 0; i < 1000; i += 1) seeds.push({ id: `n${i}`, doc: 'doc-many', at: `2026-09-01T00:00:00.${String(i).padStart(3, '0')}Z`, ...(i === 999 ? { parent: 'old' } : {}) });
  const { db } = room(seeds);
  const result = body(await call(db, { id: 'doc-many' }, { clientKind: 'claude' }).out);
  assert.equal(result.total_threads, 999);
  assert.match(result.note, /older comments/);
});

test('through runTool: a Microsoft client gets a compact page, and the read is audited with the app name', async () => {
  const { db, sqlite } = room(many(60, 400));
  const props: Props = { email: COUNSEL, role: 'counsel', clientId: 'c1', clientName: 'Microsoft Copilot' };
  const env = { DB: db, CONTROL_PREFIX: 'DOE', TEAM_DOMAIN: '', ACCESS_AUD: '' } as unknown as McpEnv;
  const out = await runTool(getCommentsTool, { id: 'doc-many' }, env, props, undefined, new Date(), 'microsoft');
  const text = (out.content[0] as { text: string }).text;
  assert.ok(text.length <= COMPACT_LIMITS.maxChars);
  // Compact sends the page once, as minified text (format.ts forProfile), so the page is read from the text.
  assert.equal(out.structuredContent, undefined);
  assert.ok(!text.includes('\n'), 'minified');
  const page = JSON.parse(text) as { threads: unknown[]; next_cursor?: unknown };
  assert.ok(page.threads.length <= COMPACT_LIMITS.maxItems);
  assert.ok(typeof page.next_cursor === 'string');
  const rows = sqlite.prepare('SELECT action, document_id, via FROM audit_log').all();
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{ action: 'ai_read', document_id: 'doc-many', via: 'Microsoft Copilot' }]);
  assert.doesNotMatch(JSON.stringify(sqlite.prepare('SELECT * FROM audit_log').all()), /xxxx/);
});

test('a comment addressed to AI tools is fenced as untrusted, keeps its page, loses its link, under Ask\'s reminder', async () => {
  const { db } = room([
    { id: 't1', at: '2026-09-01T10:00:00.000Z', page: 2, body: PLANTED_AI },
    { id: 'r1', at: '2026-09-02T10:00:00.000Z', parent: 't1', page: 3, author: COUNSEL, body: 'Agreed: the cooler log is on page 3.' },
  ]);
  const out = body(await call(db, { id: 'doc-a' }).out);
  assert.equal(Object.keys(out)[0], 'untrusted_note', 'the note comes before the threads');
  assert.equal(out.untrusted_note, UNTRUSTED_REMINDER);
  const [thread] = out.threads;
  assert.equal(thread.text, `${FENCE.ai}${PLANTED_AI}\n</case-record>`);
  assert.deepEqual([thread.page, thread.link, thread.untrusted], [2, undefined, 'addressed-to-ai']);
  assert.deepEqual([thread.replies[0].untrusted, thread.replies[0].link], [undefined, 'https://room.example.com/doc/?id=doc-a#page=3']);
  const clean = body(await call(room(THREAD).db, { id: 'doc-a' }).out);
  assert.equal('untrusted_note' in clean, false, 'no note without an untrusted comment');
});

test('compact: threads holding untrusted comments, the note included, stay within 9,000 characters and reach every thread', async () => {
  const seeds = many(40, 400).map((seed, i) => (i % 3 === 0 ? { ...seed, body: `${PLANTED_AI} ${seed.body}` } : seed));
  const { db } = room(seeds);
  assert.deepEqual(await walk(db, { clientKind: 'microsoft' }, COMPACT_LIMITS), seeds.map((s) => s.id));
});
