// SPDX-License-Identifier: Apache-2.0
// Ask Legallas and privileged folders (worker/privilege.ts): POST /api/ask through the real gate, real SQL and fake AI
// bindings. Counsel's and the owner's Ask read and cite privileged passages. The read-only family role is retired: the
// gate refuses a leftover family row before anything is searched, and retrieval and the case picture's citable set
// still leave privileged documents out for that role, so the filter holds on its own.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sseParser } from '../src/scripts/chat-sse.ts';
import { askRequest, harness } from './ask-fixtures.ts';
import type { Role } from './env.ts';
import { addLeftoverFamily, pastTheGate } from './gate-fixtures.ts';
import { handle } from './index.ts';
import { liveDocuments, retrieve } from './retrieval.ts';
import { chunk, OWNER } from './room-fixtures.ts';
import { resetMatterCache } from './routes/matter.ts';

const ctx = {} as ExecutionContext;
const PEOPLE: Record<Role, string> = { owner: OWNER, counsel: 'ada@firm.example' };
const RETIRED = 'family' as Role;
const KIN = 'kin@mail.example';
const MEMBERS = Object.fromEntries(Object.entries(PEOPLE).map(([role, email]) => [email, role]));
const SECRET = 'LAWYER-NOTE-POSITION on the repurchase claim.';

beforeEach(() => resetMatterCache());

function addDocument(h: ReturnType<typeof harness>, id: string, path: string): void {
  const name = path.split('/').pop()!;
  h.db
    .prepare("INSERT INTO documents (id, path, folder, name, kind, content_type, size, pages, r2_key, source, updated_at) VALUES (?1, ?2, ?3, ?4, 'pdf', 'application/pdf', 1, 9, ?5, 'mirror', 'now')")
    .run(id, path, path.slice(0, path.length - name.length - 1), name, `k-${id}`);
}

async function ask(role: Role, opts: Parameters<typeof harness>[0], setup: (h: ReturnType<typeof harness>) => void = () => {}) {
  const h = harness({ ...opts, members: MEMBERS, email: PEOPLE[role] });
  setup(h);
  const res = await handle(askRequest({ question: 'What happened at the inspection?' }), h.env, ctx);
  assert.equal(res.status, 200, role);
  const parser = sseParser();
  const events = [...parser.push(await res.text()), ...parser.end()];
  const cites = (events.find((e) => e.event === 'citations')?.data as { citations: { id: string }[] } | undefined)?.citations ?? [];
  const reading = events.find((e) => e.event === 'reading')?.data as { documents: number } | undefined;
  const prompt = h.runs.map((run) => run.input.messages.map((m) => m.content).join('\n')).join('\n');
  return { cites: cites.map((c) => c.id), reading, prompt, runs: h.runs.length };
}

const RETRIEVED = {
  chunks: [chunk('doc-priv', 1, SECRET), chunk('doc-live-a', 2, 'The open record says the meeting happened.')],
  answer: 'READ: The meeting happened [doc:doc-live-a p:2], and the position was set [doc:doc-priv p:1].',
};
const withPrivileged = (h: ReturnType<typeof harness>) => addDocument(h, 'doc-priv', '07-Lawyer-Notes-PRIVILEGED/Witness-notes.pdf');

test('a leftover family row is refused at the gate: nothing is searched and the model is never called', async () => {
  const h = harness({ ...RETRIEVED, members: MEMBERS, email: KIN });
  withPrivileged(h);
  addLeftoverFamily(h.db, KIN);
  const res = await handle(askRequest({ question: 'What happened at the inspection?' }), h.env, ctx);
  assert.equal(res.status, 403);
  assert.doesNotMatch(await res.text(), /LAWYER-NOTE-POSITION|Witness-notes/);
  assert.deepEqual([h.searches.length, h.runs.length], [0, 0]);
});

test("past the gate, the Ask route's own wall refuses a role without ask: nothing searched, counted or audited", async () => {
  for (const role of ['limited' as Role, RETIRED]) {
    const h = harness({ ...RETRIEVED, members: MEMBERS });
    withPrivileged(h);
    const res = await pastTheGate(askRequest({ question: 'What happened at the inspection?' }), h.env, { email: OWNER, role, name: null }, ctx);
    assert.equal(res.status, 403, role);
    assert.deepEqual(await res.json(), { error: 'forbidden' }, role);
    assert.deepEqual([h.searches.length, h.runs.length], [0, 0], role);
    for (const table of ['usage', 'audit_log']) {
      assert.equal((h.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n, 0, `${role} ${table}`);
    }
  }
});

test('retrieval for the retired role drops a privileged passage, name and all; owner and counsel keep it', async () => {
  const h = harness({ ...RETRIEVED, members: MEMBERS });
  withPrivileged(h);
  const read = (role: Role) => retrieve(h.env.SEARCH, h.env.DB, 'What happened at the inspection?', role);
  const retired = await read(RETIRED);
  assert.deepEqual(retired.chunks.map((c) => c.docId), ['doc-live-a']);
  assert.deepEqual([...retired.citable.keys()], ['doc-live-a']);
  assert.doesNotMatch(JSON.stringify(retired.chunks), /LAWYER-NOTE-POSITION|Witness-notes/);
  for (const role of ['owner', 'counsel'] as const) {
    assert.deepEqual((await read(role)).chunks.map((c) => c.docId).sort(), ['doc-live-a', 'doc-priv'], role);
  }
});

test('owner and counsel: the same question reads and cites the privileged passage as before', async () => {
  for (const role of ['owner', 'counsel'] as const) {
    const got = await ask(role, RETRIEVED, withPrivileged);
    assert.match(got.prompt, /LAWYER-NOTE-POSITION/, role);
    assert.deepEqual(got.cites.sort(), ['doc-live-a', 'doc-priv'], role);
  }
});

test('retrieval for the retired role is empty when only privileged passages match', async () => {
  const h = harness({ chunks: [chunk('doc-priv', 1, SECRET)], members: MEMBERS });
  withPrivileged(h);
  const retired = await retrieve(h.env.SEARCH, h.env.DB, 'What happened at the inspection?', RETIRED);
  assert.deepEqual([retired.chunks, [...retired.citable.keys()]], [[], []]);
});

const RAW = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'matter.example.json'), 'utf8');
const PROOF = JSON.parse(RAW).tracks[0].points[0].proof[0].cite as { doc: string; page: number };

test('the case picture: proof on a privileged document is cited for owner and counsel, and not citable for the retired role', async () => {
  const opts = { chunks: [chunk('doc-live-a', 2, 'Other text.')], answer: `READ: A point [doc:${PROOF.doc} p:${PROOF.page}].`, matter: RAW };
  const proofIn = (folder: string) => (h: ReturnType<typeof harness>) => addDocument(h, PROOF.doc, `${folder}/Proof-memo.pdf`);
  for (const role of ['owner', 'counsel'] as const) {
    const got = await ask(role, opts, proofIn('07-Lawyer-Notes-PRIVILEGED'));
    assert.match(got.prompt, /Filing 1 of 2/, role);
    assert.deepEqual(got.cites, [PROOF.doc], role);
  }
  // The case picture's citable set is liveDocuments for the member's role (routes/ask.ts matterBrief).
  for (const [folder, citable] of [['07-Lawyer-Notes-PRIVILEGED', false], ['01-Corporate-Records', true]] as const) {
    const h = harness({ members: MEMBERS });
    proofIn(folder)(h);
    assert.equal((await liveDocuments(h.env.DB, [PROOF.doc], RETIRED)).has(PROOF.doc), citable, folder);
  }
});
