// SPDX-License-Identifier: Apache-2.0
// A visual saved by a member's AI (worker/proposal-visual.ts, migration 0027) on real SQLite with the real migrations:
// proposed, approved into the binder sandboxed with its cites as room cites; rejected or left, nothing changes. The
// fixture is invented (Doe v. Harbor Labs, prefix DOE). Routes: proposals-routes.test.ts; the MCP tool: mcp/tools/propose.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Member } from './env.ts';
import { approveProposal, changesOf, getProposal, listProposals, rejectProposal } from './proposal-review.ts';
import {
  docCites, linkedDocumentIds, prepareProposedVisual, privilegedByDefault, SAVED_SECTION, savedPage, savedSlug, savedVisuals, VISUAL_PAGE_MAX,
  visualSrc, withSaved, type VisualRoom,
} from './proposal-visual.ts';
import { createDraftProposal } from './proposals.ts';
import { testDb } from './sqlite-d1.ts';
import { BRIDGE_MARKER } from './visualprep.ts';

const OWNER: Member = { email: 'founder@example.test', role: 'owner', name: 'Founder' };
const COUNSEL: Member = { email: 'ada@firm.example', role: 'counsel', name: null };
const NOW = new Date('2026-11-06T12:00:00.000Z');
const CLIENT = { ip: '192.0.2.10', userAgent: 'test-agent' };
const ROOM: VisualRoom = { host: 'room.example.test', prefix: 'DOE' };

/** A kit's chronology as Claude would build it: cites as each result's link, one web link, a remote font. */
const CHRONOLOGY = [
  '<!doctype html><html><head><link rel="stylesheet" href="https://fonts.example.org/serif.css"></head><body>',
  '<h1>Doe v. Harbor Labs: chronology</h1><table>',
  '<tr><td>2026-03-01</td><td>Advisor agreement signed</td><td><a href="https://room.example.test/doc/?id=doe-1#page=3">DOE-000412 at 3</a></td></tr>',
  '<tr><td>2026-03-02</td><td>Board consent</td><td><a href="/doc/?id=doe-2">DOE-000413</a></td></tr>',
  '<tr><td>2026-03-09</td><td>Press note</td><td><a href="https://news.example.org/harbor" target="_blank">news</a></td></tr>',
  '<tr><td>2026-03-10</td><td>Memo</td><td><a href="https://room.example.test/doc/?id=doe-priv">DOE-000414</a></td></tr>',
  '</table><script>document.title = "Chronology";</script></body></html>',
].join('\n');

function room() {
  const { db, sqlite } = testDb();
  sqlite.exec(`
    INSERT INTO members (email, role, name) VALUES ('${OWNER.email}', 'owner', 'Founder'), ('${COUNSEL.email}', 'counsel', NULL);
    INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at, removed_at, control_seq) VALUES
      ('doe-1', 'Agreements/Doe advisor agreement.pdf', 'Agreements', 'Doe advisor agreement.pdf', 'pdf', 'application/pdf', 1, 'k1', 'mirror', '2026-03-01T00:00:00.000Z', NULL, 412),
      ('doe-2', 'Board/Harbor Labs consent.pdf', 'Board', 'Harbor Labs consent.pdf', 'pdf', 'application/pdf', 1, 'k2', 'mirror', '2026-03-02T00:00:00.000Z', NULL, 413),
      ('doe-priv', 'Privileged/Counsel memo.pdf', 'Privileged', 'Counsel memo.pdf', 'pdf', 'application/pdf', 1, 'k3', 'mirror', '2026-03-03T00:00:00.000Z', NULL, 414);
  `);
  return { db, sqlite };
}

async function propose(db: D1Database, member: Member, body = CHRONOLOGY, privileged = privilegedByDefault(member.role)): Promise<string> {
  const result = await createDraftProposal(
    db,
    { member, via: 'Claude', clientKind: 'claude' },
    { title: 'Chronology', why: 'Built with the chronology kit.', body, sources: [{ documentId: 'doe-1', page: 3 }], visual: { privileged } },
    NOW,
  );
  assert.ok(result.ok, JSON.stringify(result));
  return result.id;
}

const page = (sqlite: ReturnType<typeof testDb>['sqlite'], id: string) =>
  (sqlite.prepare('SELECT page FROM proposal_visuals WHERE proposal_id = ?').get(id) as { page: string | null }).page;

test('counsel saves privileged by default, the owner does not', () => {
  assert.equal(privilegedByDefault('counsel'), true);
  assert.equal(privilegedByDefault('owner'), false);
  assert.equal(privilegedByDefault('room_reader#1' as Member['role']), true, 'any other role fails closed');
});

test('a visual is a pending draft_document with its row, a visual event, and a preview; nothing lands yet', async () => {
  const { db, sqlite } = room();
  const id = await propose(db, COUNSEL);
  assert.deepEqual({ ...sqlite.prepare('SELECT kind, status FROM proposals WHERE id = ?').get(id) }, { kind: 'draft_document', status: 'pending' });
  assert.deepEqual({ ...sqlite.prepare('SELECT privileged, page FROM proposal_visuals WHERE proposal_id = ?').get(id) }, { privileged: 1, page: null });
  assert.equal((sqlite.prepare("SELECT detail_code FROM proposal_events WHERE proposal_id = ? AND action = 'proposed'").get(id) as { detail_code: string }).detail_code, 'visual');

  const [listed] = await listProposals(db, COUNSEL, 'pending', NOW);
  assert.equal(listed!.visual, true);
  const detail = (await getProposal(db, COUNSEL, id, NOW))!;
  assert.deepEqual([detail.visual, detail.privileged, detail.preview, detail.binder_slug], [true, true, visualSrc(id), null]);
  assert.deepEqual(detail.changes, changesOf('draft_document', true));
  assert.match(detail.changes[0]!, /binder/);

  assert.deepEqual(await savedVisuals(db, OWNER.role), []);
  assert.equal(await savedPage(db, COUNSEL.role, id), null);
});

test('approved: it lands in the binder sandboxed, cites to room documents become DOE cites, the web stays outside', async () => {
  const { db, sqlite } = room();
  const id = await propose(db, COUNSEL);
  assert.deepEqual(await approveProposal(db, COUNSEL, id, { title: null, body: null }, NOW, CLIENT, ROOM), { ok: true, status: 'approved', edited: false });

  const html = page(sqlite, id)!;
  assert.ok(html.includes(BRIDGE_MARKER), 'the bridge is in');
  assert.ok(html.includes('href="#legallas-cite=DOE-000412@3"'), 'an absolute /doc/ link with a page');
  assert.ok(html.includes('href="#legallas-cite=DOE-000413"'), 'a relative /doc/ link');
  assert.ok(html.includes('href="#legallas-cite=DOE-000414"'), 'counsel sees the privileged memo, so it is a cite');
  assert.ok(html.includes(`href="#legallas-out=${encodeURIComponent('https://news.example.org/harbor')}"`), 'the web is an explicit way out');
  // split, not includes: the host anywhere on the page fails, and CodeQL reads includes(host) as a URL check.
  assert.ok(html.split('fonts.example.org').length === 1 && !html.includes('target='), 'no remote stylesheet, no new window');
  assert.ok(html.includes('document.title = "Chronology";'), 'script bodies are left as written');

  assert.equal(await savedPage(db, OWNER.role, id), html, 'every member the binder serves sees it');
  const saved = await savedVisuals(db, OWNER.role);
  assert.deepEqual(saved.map((v) => [v.id, v.title, v.privileged]), [[id, 'Chronology', true]]);

  const binder = withSaved({ sections: [], visuals: [] }, saved);
  assert.deepEqual(binder.sections.map((s) => [s.slug, s.visuals]), [[SAVED_SECTION, [savedSlug(id)]]]);
  assert.equal(binder.visuals[0]!.src, visualSrc(id));
  assert.match(binder.visuals[0]!.summary ?? '', /^Marked privileged\. Saved by ada@firm\.example through Claude, 2026-11-06\.$/);
  assert.equal((await getProposal(db, COUNSEL, id, NOW))!.binder_slug, savedSlug(id));

  assert.throws(() => sqlite.prepare("UPDATE proposal_visuals SET page = 'x' WHERE proposal_id = ?").run(id), /approved page is fixed/);
  assert.throws(() => sqlite.prepare('UPDATE proposal_visuals SET privileged = 0 WHERE proposal_id = ?').run(id), /fixed/);
  assert.throws(() => sqlite.prepare('DELETE FROM proposal_visuals WHERE proposal_id = ?').run(id), /kept/);
});

test('the owner saves one into the binder, not privileged, with an edited title', async () => {
  const { db } = room();
  const id = await propose(db, OWNER);
  assert.deepEqual(await approveProposal(db, OWNER, id, { title: 'Chronology, March', body: null }, NOW, CLIENT, ROOM), { ok: true, status: 'approved', edited: true });
  assert.deepEqual((await savedVisuals(db, OWNER.role)).map((v) => [v.title, v.privileged]), [['Chronology, March', false]]);
});

test('rejected, left to expire, or approved without the room: nothing lands', async () => {
  const { db, sqlite } = room();
  const rejected = await propose(db, COUNSEL);
  assert.equal((await rejectProposal(db, COUNSEL, rejected, 'not_needed', NOW, CLIENT)).ok, true);
  assert.equal(page(sqlite, rejected), null);

  const left = await propose(db, COUNSEL);
  const later = new Date(NOW.getTime() + 31 * 24 * 3600 * 1000);
  assert.deepEqual(await approveProposal(db, COUNSEL, left, { title: null, body: null }, later, CLIENT, ROOM), { ok: false, error: 'expired' });
  assert.equal(page(sqlite, left), null);

  const noRoom = await propose(db, COUNSEL);
  assert.deepEqual(await approveProposal(db, COUNSEL, noRoom, { title: null, body: null }, NOW, CLIENT), { ok: false, error: 'not_served' });
  assert.equal((sqlite.prepare('SELECT status FROM proposals WHERE id = ?').get(noRoom) as { status: string }).status, 'pending');

  assert.deepEqual(await savedVisuals(db, OWNER.role), []);
});

test('the owner cannot approve counsel’s visual; a page over the limit is not served and nothing is written', async () => {
  const { db, sqlite } = room();
  const id = await propose(db, COUNSEL);
  assert.deepEqual(await approveProposal(db, OWNER, id, { title: null, body: null }, NOW, CLIENT, ROOM), { ok: false, error: 'not_yours' });

  // Under 60,000 characters of web links, each about 2.7 times as long once encoded as a way out: past VISUAL_PAGE_MAX.
  const links = `<a href="https://e.org/${'%'.repeat(100)}">x</a>`.repeat(460);
  assert.ok(links.length <= 60_000 && links.length * 2.6 > VISUAL_PAGE_MAX);
  const big = await propose(db, COUNSEL, links);
  assert.equal(await prepareProposedVisual(db, COUNSEL.role, links, big, ROOM), null);
  assert.deepEqual(await approveProposal(db, COUNSEL, big, { title: null, body: null }, NOW, CLIENT, ROOM), { ok: false, error: 'not_served' });
  assert.equal(page(sqlite, big), null);
});

test('only this room’s /doc/ links to numbered documents become cites', () => {
  const cite = docCites(ROOM, new Map([['doe-1', 412]]));
  assert.equal(cite('https://room.example.test/doc/?id=doe-1'), 'DOE-000412');
  assert.equal(cite('/doc?id=doe-1&page=7'), 'DOE-000412@7');
  assert.equal(cite('https://room.example.test/doc/?id=doe-1#page=0'), 'DOE-000412');
  assert.equal(cite('https://other.example.test/doc/?id=doe-1'), null, 'another host');
  assert.equal(cite('https://room.example.test/files/doe-1'), null, 'not the /doc/ page');
  assert.equal(cite('https://room.example.test/doc/?id=doe-9'), null, 'not a numbered, visible document');
  assert.equal(cite('javascript:alert(1)'), null);
  assert.deepEqual(linkedDocumentIds('<a href="/doc/?x=1&amp;id=a">a</a> <a href="https://h/doc?id=b#page=2">b</a> /doc/?id=a'), ['a', 'b']);
  assert.deepEqual(linkedDocumentIds('/doc/?'.repeat(20_000)), [], 'a 120,000-character page of /doc/? starts finds nothing');
});
