// SPDX-License-Identifier: Apache-2.0
// legallas_check_public_records end to end on real SQLite with recorded, invented source responses: listed only while
// the room has it on; the first call sends nothing and returns an approval link; only the member's own approval in
// the room lets it run; a decline is told, not asked again; the result reports records with their sources, links and
// dates, says what failed or was not searched, never concludes anything about anyone, and carries the FCRA notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from '../../worker/sqlite-d1.ts';
import { APPROVED_MINUTES, decideCheck, MAX_PENDING, PENDING_MINUTES, readCheck, sweepLapsedChecks } from '../../worker/public-records.ts';
import { COLORADO_ROWS, COURTLISTENER_DOCKETS, EDGAR_HITS, FIXTURE_COMPANY, FIXTURE_PERSON, recordedFetch, type Recorded } from '../../worker/public-records-fixtures.ts';
import { COMPACT_LIMITS, type McpEnv, type Props, type ResponseProfile, type ToolContext } from '../contract.ts';
import { forProfile } from '../format.ts';
import { RECORDS_INSTRUCTION, serveMcp } from '../server.ts';
import { listedTools } from './index.ts';
import { judgedView, NOT_A_CONSUMER_REPORT, RECORDS_TOOL_NAME, recordsReport, recordsTool, SOURCE_TEXT_IS_DATA, useRecordsFetcher, type RecordsView } from './public-records.ts';
import { FENCE, PLANTED_AI } from './untrusted-fixtures.ts';
import { UNTRUSTED_REMINDER } from '../../worker/prompt.ts';

const PROPS: Props = { email: 'counsel@example.test', role: 'counsel', clientId: 'c1', clientName: 'Claude' };
const OTHER = 'owner@example.test';
const NOW = new Date('2026-11-01T14:05:00.000Z');
const ALL_SET = { PUBLIC_RECORDS: '1', PUBLIC_RECORDS_CONTACT: 'owner@example.test', COURTLISTENER_TOKEN: 'b'.repeat(40) };
const GOOD: Record<string, Recorded> = {
  'efts.sec.gov': { body: EDGAR_HITS },
  'data.colorado.gov': { body: COLORADO_ROWS },
  'www.courtlistener.com': { body: COURTLISTENER_DOCKETS },
};
/** Words that would turn a record into a verdict about someone. The report states records; it never says these. */
const VERDICTS = /\b(fraud\w*|scam\w*|bad actor|risky|high[- ]risk|low[- ]risk|red flag|suspicious|trustworthy|untrustworthy|clean record|safe to|criminal record|guilty|dishonest)\b/i;

function room(settings: Partial<McpEnv> = ALL_SET) {
  const { db, sqlite } = testDb();
  for (const email of [PROPS.email, OTHER]) sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?, 'counsel', NULL)").run(email);
  const env = { DB: db, TEAM_DOMAIN: '', ACCESS_AUD: '', ...settings } as McpEnv;
  return { db, sqlite, env };
}

function ctx(env: McpEnv, options: { email?: string; now?: Date; profile?: ResponseProfile; readOnly?: boolean } = {}): ToolContext {
  const email = options.email ?? PROPS.email;
  return {
    env,
    props: { ...PROPS, email, ...(options.readOnly ? {} : { propose: true as const }) },
    member: { email, role: 'counsel', name: null },
    now: options.now ?? NOW,
    clientKind: 'claude',
    profile: options.profile ?? 'standard',
    audit: async () => undefined,
  };
}

const viewOf = (result: Awaited<ReturnType<typeof recordsTool.handler>>) => result.structuredContent as unknown as RecordsView;
const textOf = (result: Awaited<ReturnType<typeof recordsTool.handler>>) => (result.content[0] as { text: string }).text;
const idOf = (view: RecordsView) => (view.status === 'approval_needed' ? new URL(view.approve_at).searchParams.get('id')! : '');

/** The member consented to proposing when connecting (Props.propose), as listsRecords requires. */
const CONSENTED: Props = { ...PROPS, propose: true };

async function instructionsOf(env: McpEnv, props: Props = CONSENTED): Promise<string> {
  const request = new Request('https://mcp.example.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
  });
  const text = await (await serveMcp(request, env, props)).text();
  const data = text.split('\n').find((line) => line.startsWith('data: '))!;
  return JSON.parse(data.slice(6)).result.instructions as string;
}

async function listTools(env: McpEnv, props: Props = CONSENTED): Promise<{ name: string; annotations?: Record<string, unknown> }[]> {
  const request = new Request('https://mcp.example.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const text = await (await serveMcp(request, env, props)).text();
  const data = text.split('\n').find((line) => line.startsWith('data: '))!;
  return JSON.parse(data.slice(6)).result.tools;
}

test('listed only while the room turns it on and the member let the connection propose; the record tools never change', async () => {
  const record = listedTools().map((tool) => tool.name);
  assert.deepEqual((await listTools(room({}).env)).map((t) => t.name), record, 'unset: off');
  assert.deepEqual((await listTools(room({ PUBLIC_RECORDS: '0' }).env)).map((t) => t.name), record, '"0": off');
  assert.deepEqual((await listTools(room().env, PROPS)).map((t) => t.name), record, 'on, but a connection kept read-only: not listed');
  assert.ok(!(await instructionsOf(room().env, PROPS)).includes(RECORDS_TOOL_NAME));
  const on = await listTools(room().env);
  assert.deepEqual(on.map((t) => t.name), [...record, RECORDS_TOOL_NAME]);
  const listed = on.find((t) => t.name === RECORDS_TOOL_NAME)!;
  assert.equal(listed.annotations?.openWorldHint, true, 'it reaches sites outside the room');
  assert.equal(listed.annotations?.readOnlyHint, false, 'it stores a pending request');
  assert.equal(listed.annotations?.destructiveHint, false);
  assert.ok((await instructionsOf(room().env)).includes(RECORDS_INSTRUCTION), 'the instructions name it while it is listed');
  assert.ok(!(await instructionsOf(room({}).env)).includes(RECORDS_TOOL_NAME), 'and not while it is off');
  for (const tool of on.filter((t) => t.name !== RECORDS_TOOL_NAME)) {
    assert.equal(tool.annotations?.openWorldHint, false, tool.name);
    assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
  }
});

test('off, a read-only connection, or a malformed name: a coded error and nothing stored', async () => {
  const off = room({ PUBLIC_RECORDS: '0' });
  const refused = await recordsTool.handler({ name: FIXTURE_COMPANY, kind: 'company' }, ctx(off.env));
  assert.equal(refused.isError, true);
  assert.match(textOf(refused), /^unavailable:/);
  const r = room();
  const readOnly = await recordsTool.handler({ name: FIXTURE_COMPANY, kind: 'company' }, ctx(r.env, { readOnly: true }));
  assert.equal(readOnly.isError, true, 'the handler checks the consent itself, not only the listing');
  assert.match(textOf(readOnly), /^forbidden: This connection is read-only\./);
  for (const name of ['"Harbor Labs" OR *', 'Harbor\u0000Labs', 'Harbor <Labs>', '..']) {
    const bad = await recordsTool.handler({ name, kind: 'company' }, ctx(r.env));
    assert.equal(bad.isError, true, name);
    assert.match(textOf(bad), /^bad_request:/);
  }
  assert.equal(r.sqlite.prepare('SELECT COUNT(*) AS n FROM record_checks').get()!.n, 0);
});

test('the first call sends nothing: it asks the member to approve the name and the sites in the room', async (t) => {
  const recorded = recordedFetch(GOOD);
  useRecordsFetcher(recorded.fetcher);
  t.after(() => useRecordsFetcher());
  const r = room();
  const first = await recordsTool.handler({ name: ` ${FIXTURE_COMPANY} `, kind: 'company' }, ctx(r.env));
  const view = viewOf(first);
  assert.equal(view.status, 'approval_needed');
  assert.equal(recorded.calls.length, 0, 'no site hears the name before approval');
  if (view.status !== 'approval_needed') return;
  assert.match(view.approve_at, /^https:\/\/room\.example\.com\/checks\/\?id=[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(view.would_send_to.map((s) => s.host), ['efts.sec.gov', 'data.colorado.gov', 'www.courtlistener.com']);
  assert.equal(view.expires, new Date(NOW.getTime() + PENDING_MINUTES * 60_000).toISOString());
  assert.equal(view.notice, NOT_A_CONSUMER_REPORT);
  const text = textOf(first);
  assert.match(text, /approval needed/);
  assert.match(text, /Nothing has been sent yet\./);
  assert.ok(text.includes(view.approve_at));
  // Asking again before the member decides reuses the same request.
  const again = viewOf(await recordsTool.handler({ name: 'harbor labs inc', kind: 'company' }, ctx(r.env)));
  assert.equal(idOf(again), idOf(view));
  const stored = await readCheck(r.db, idOf(view), PROPS.email, NOW);
  assert.deepEqual(stored?.sources, ['sec_edgar', 'co_open_data', 'courtlistener']);
  assert.equal(stored?.via, 'Claude');
});

test('after the member approves in the room, the check runs and reports records with source, link and date checked', async (t) => {
  const recorded = recordedFetch(GOOD);
  useRecordsFetcher(recorded.fetcher);
  t.after(() => useRecordsFetcher());
  const r = room();
  const id = idOf(viewOf(await recordsTool.handler({ name: FIXTURE_COMPANY, kind: 'company' }, ctx(r.env))));
  await decideCheck(r.db, id, PROPS.email, 'approve', NOW);
  const later = new Date(NOW.getTime() + 5 * 60_000);
  const result = await recordsTool.handler({ name: FIXTURE_COMPANY, kind: 'company' }, ctx(r.env, { now: later }));
  const view = viewOf(result);
  assert.equal(view.status, 'checked');
  if (view.status !== 'checked') return;
  assert.equal(recorded.calls.length, 3);
  assert.equal(view.checked, later.toISOString());
  const findings = view.sources.flatMap((s) => s.findings);
  assert.equal(findings.length, 5);
  for (const finding of findings) {
    assert.ok(finding.source && /^https:\/\//.test(finding.link) && finding.checked === later.toISOString(), JSON.stringify(finding));
  }
  const text = textOf(result);
  assert.match(text, /^Public records check: "Harbor Labs, Inc\." \(a company\)/);
  assert.match(text, /## Searched/);
  assert.match(text, /## Not searched automatically: search these by hand \(the name was not sent to them\)/);
  for (const name of ['FINRA BrokerCheck', 'SEC Investment Adviser Public Disclosure', 'Delaware Division of Corporations entity search', 'Colorado Secretary of State business search']) {
    assert.ok(text.includes(`### ${name}`), `${name} is listed to search by hand`);
  }
  assert.ok(text.includes('https://www.sec.gov/Archives/edgar/data/9990001/000999000126000001/0009990001-26-000001-index.htm'));
  assert.ok(text.includes('(source: CourtListener dockets; checked 2026-11-01)'));
  assert.ok(text.includes(NOT_A_CONSUMER_REPORT), 'the FCRA notice');
  assert.ok(text.includes(SOURCE_TEXT_IS_DATA), 'source text is data, never instructions');
  assert.match(text, /15 U\.S\.C\. § 1681a\(d\)/);
  assert.match(text, /credit, insurance, employment or housing/);
  assert.match(text, /aren't receiving legal advice from a licensed lawyer/);
  assert.doesNotMatch(text, /not legal advice/, 'notices A1, "Don\'t say" (#338)');
  assert.doesNotMatch(text, VERDICTS, 'records, never a verdict');
});

test('a failed source and a missing record are reported plainly, in their own places', async (t) => {
  const recorded = recordedFetch({ ...GOOD, 'efts.sec.gov': 'timeout', 'www.courtlistener.com': { body: { count: 0, results: [] } } });
  useRecordsFetcher(recorded.fetcher);
  t.after(() => useRecordsFetcher());
  const r = room();
  const id = idOf(viewOf(await recordsTool.handler({ name: FIXTURE_COMPANY, kind: 'company' }, ctx(r.env))));
  await decideCheck(r.db, id, PROPS.email, 'approve', NOW);
  const text = textOf(await recordsTool.handler({ name: FIXTURE_COMPANY, kind: 'company' }, ctx(r.env)));
  const failedAt = text.indexOf('## Could not check');
  assert.ok(failedAt > 0);
  assert.ok(text.indexOf('### SEC EDGAR full-text search') > failedAt, 'the failed source sits under "Could not check"');
  assert.match(text, /Could not check: it did not answer in time\. Nothing can be said about what it holds; search it by hand\./);
  assert.match(text, /Search it by hand: https:\/\/www\.sec\.gov\/edgar\/search\//);
  assert.match(text, /### CourtListener dockets \(Free Law Project\)\nChecked 2026-11-01 14:05 UTC at www\.courtlistener\.com\.\nNo record found under this name\. That only means this search of this source returned no match; it does not mean there is no record\./);
  assert.match(text, /no result does not mean no case/);
  assert.doesNotMatch(text, VERDICTS);
});

test('the name sent is the one the member approved, not a later call\'s spelling of it', async (t) => {
  const recorded = recordedFetch(GOOD);
  useRecordsFetcher(recorded.fetcher);
  t.after(() => useRecordsFetcher());
  const r = room();
  const id = idOf(viewOf(await recordsTool.handler({ name: "O'Doe Holdings", kind: 'company' }, ctx(r.env))));
  await decideCheck(r.db, id, PROPS.email, 'approve', NOW);
  const view = viewOf(await recordsTool.handler({ name: 'O Doe Holdings', kind: 'company' }, ctx(r.env)));
  assert.equal(view.status, 'checked');
  assert.equal(view.name, "O'Doe Holdings");
  assert.equal(recorded.calls.length, 3);
  for (const call of recorded.calls) {
    const sent = decodeURIComponent(call.url);
    assert.ok(sent.includes("O'Doe Holdings") || sent.includes("O''DOE HOLDINGS"), sent);
    assert.ok(!sent.includes('O Doe Holdings') && !sent.includes('O DOE HOLDINGS'), sent);
  }
});

test('only the member who asked can approve, and only while the request is open', async (t) => {
  const recorded = recordedFetch(GOOD);
  useRecordsFetcher(recorded.fetcher);
  t.after(() => useRecordsFetcher());
  const r = room();
  const id = idOf(viewOf(await recordsTool.handler({ name: FIXTURE_COMPANY, kind: 'company' }, ctx(r.env))));
  assert.equal(await decideCheck(r.db, id, OTHER, 'approve', NOW), null, "another member's click does nothing");
  assert.equal(viewOf(await recordsTool.handler({ name: FIXTURE_COMPANY, kind: 'company' }, ctx(r.env))).status, 'approval_needed');
  const lapsed = new Date(NOW.getTime() + (PENDING_MINUTES + 1) * 60_000);
  assert.equal(await decideCheck(r.db, id, PROPS.email, 'approve', lapsed), null, 'a lapsed request cannot be approved');
  assert.equal(recorded.calls.length, 0);
  // Another member's approval of the same name never runs this member's check.
  const theirs = idOf(viewOf(await recordsTool.handler({ name: FIXTURE_COMPANY, kind: 'company' }, ctx(r.env, { email: OTHER }))));
  await decideCheck(r.db, theirs, OTHER, 'approve', NOW);
  assert.equal(viewOf(await recordsTool.handler({ name: FIXTURE_COMPANY, kind: 'company' }, ctx(r.env))).status, 'approval_needed');
  assert.equal(recorded.calls.length, 0);
});

test('an approval lasts its hour, then the next call asks again', async (t) => {
  const recorded = recordedFetch(GOOD);
  useRecordsFetcher(recorded.fetcher);
  t.after(() => useRecordsFetcher());
  const r = room();
  const id = idOf(viewOf(await recordsTool.handler({ name: FIXTURE_PERSON, kind: 'person' }, ctx(r.env))));
  await decideCheck(r.db, id, PROPS.email, 'approve', NOW);
  const within = new Date(NOW.getTime() + (APPROVED_MINUTES - 1) * 60_000);
  assert.equal(viewOf(await recordsTool.handler({ name: FIXTURE_PERSON, kind: 'person' }, ctx(r.env, { now: within }))).status, 'checked');
  assert.equal(viewOf(await recordsTool.handler({ name: FIXTURE_PERSON, kind: 'company' }, ctx(r.env, { now: within }))).status, 'approval_needed', 'the kind is part of what was approved');
  const after = new Date(NOW.getTime() + (APPROVED_MINUTES + 1) * 60_000);
  assert.equal(viewOf(await recordsTool.handler({ name: FIXTURE_PERSON, kind: 'person' }, ctx(r.env, { now: after }))).status, 'approval_needed');
  // The tool's only write is a request: it never deletes, not even a lapsed row (the room and the daily cron do).
  assert.equal(r.sqlite.prepare('SELECT COUNT(*) AS n FROM record_checks WHERE id = ?').get(id)!.n, 1);
  assert.equal(await sweepLapsedChecks(r.db, after), 1);
  assert.equal(r.sqlite.prepare('SELECT COUNT(*) AS n FROM record_checks WHERE id = ?').get(id)!.n, 0);
});

test('past MAX_PENDING waiting requests, a coded error and nothing stored', async () => {
  const r = room();
  for (let i = 0; i < MAX_PENDING; i++) assert.equal(viewOf(await recordsTool.handler({ name: `Doe Company ${i}`, kind: 'company' }, ctx(r.env))).status, 'approval_needed');
  const refused = await recordsTool.handler({ name: 'One Too Many', kind: 'company' }, ctx(r.env));
  assert.equal(refused.isError, true);
  assert.match(textOf(refused), /^too_many_pending: This member has 10 checks waiting for approval\./);
  assert.equal(r.sqlite.prepare('SELECT COUNT(*) AS n FROM record_checks').get()!.n, MAX_PENDING);
});

test('a decline is told to the AI, and it is not asked again while the request would have been open', async (t) => {
  const recorded = recordedFetch(GOOD);
  useRecordsFetcher(recorded.fetcher);
  t.after(() => useRecordsFetcher());
  const r = room();
  const id = idOf(viewOf(await recordsTool.handler({ name: FIXTURE_COMPANY, kind: 'company' }, ctx(r.env))));
  await decideCheck(r.db, id, PROPS.email, 'decline', NOW);
  const result = await recordsTool.handler({ name: FIXTURE_COMPANY, kind: 'company' }, ctx(r.env));
  assert.equal(viewOf(result).status, 'declined');
  assert.match(textOf(result), /declined this check, so the name was not sent anywhere/);
  assert.equal(recorded.calls.length, 0);
  assert.equal(r.sqlite.prepare("SELECT COUNT(*) AS n FROM record_checks WHERE state = 'pending'").get()!.n, 0);
});

test('when no site would receive the name, there is nothing to approve: the by-hand guidance comes at once', async (t) => {
  const recorded = recordedFetch({});
  useRecordsFetcher(recorded.fetcher);
  t.after(() => useRecordsFetcher());
  const r = room({ PUBLIC_RECORDS: '1' });
  const result = await recordsTool.handler({ name: FIXTURE_PERSON, kind: 'person' }, ctx(r.env));
  const view = viewOf(result);
  assert.equal(view.status, 'checked');
  if (view.status !== 'checked') return;
  assert.deepEqual(view.sources.map((s) => s.status), ['not_set_up', 'link_only', 'link_only', 'not_applicable', 'link_only', 'not_applicable', 'not_set_up']);
  assert.equal(recorded.calls.length, 0);
  assert.equal(r.sqlite.prepare('SELECT COUNT(*) AS n FROM record_checks').get()!.n, 0, 'nothing to approve, nothing stored');
  const text = textOf(result);
  assert.doesNotMatch(text, /## Searched/);
  assert.match(text, /## Not applicable\n- Colorado business entities \(Colorado Information Marketplace\): Not searched: it covers companies, not people\./);
  assert.ok(text.includes(NOT_A_CONSUMER_REPORT));
});

test('a record\'s own text can never become Markdown in the report', () => {
  const view: RecordsView = {
    status: 'checked',
    name: FIXTURE_COMPANY,
    kind: 'company',
    checked: NOW.toISOString(),
    notice: NOT_A_CONSUMER_REPORT,
    records_not_conclusions: 'r',
    source_text: 's',
    not_a_lawyer: 'l',
    sources: [
      {
        id: 'co_open_data',
        source: 'S',
        operator: 'O',
        status: 'searched',
        checked: NOW.toISOString(),
        sent_to: 'data.colorado.gov',
        findings: [{ source: 'S', title: '[click](https://evil.example) <b>', details: ['# heading', '*x*'], date: null, link: 'https://data.colorado.gov/resource/4ykn-tg5h.json?entityid=20269900001', checked: NOW.toISOString() }],
        total: null,
        link: 'https://data.colorado.gov/d/4ykn-tg5h',
        note: 'n',
        look_for: null,
        coverage: 'c',
      },
    ],
  };
  const text = recordsReport(view);
  assert.ok(text.includes('\\[click\\](https://evil.example) \\<b\\>'));
  assert.ok(text.includes('\\# heading. \\*x\\*'));
});

test('a compact caller (Copilot) gets the check within its budget', async (t) => {
  const many = { ...EDGAR_HITS, hits: { total: { value: 40, relation: 'eq' }, hits: Array.from({ length: 10 }, (_, i) => ({ _source: { ciks: ['0009990001'], display_names: [`Harbor Labs, Inc. filing number ${i} with a longer display name for size`], form: 'D', file_date: '2026-03-02', adsh: `0009990001-26-0000${String(i).padStart(2, '0')}` } })) } };
  const rows = Array.from({ length: 10 }, (_, i) => ({ ...COLORADO_ROWS[0], entityid: `202699000${String(i).padStart(2, '0')}`, entityname: `Harbor Labs Number ${i} LLC` }));
  const recorded = recordedFetch({ 'efts.sec.gov': { body: many }, 'data.colorado.gov': { body: rows }, 'www.courtlistener.com': { body: COURTLISTENER_DOCKETS } });
  useRecordsFetcher(recorded.fetcher);
  t.after(() => useRecordsFetcher());
  const r = room();
  const id = idOf(viewOf(await recordsTool.handler({ name: FIXTURE_COMPANY, kind: 'company' }, ctx(r.env))));
  await decideCheck(r.db, id, PROPS.email, 'approve', NOW);
  const standard = viewOf(await recordsTool.handler({ name: FIXTURE_COMPANY, kind: 'company' }, ctx(r.env)));
  assert.equal(standard.status === 'checked' && standard.sources[0].findings.length, 10);
  const compact = forProfile('compact', await recordsTool.handler({ name: FIXTURE_COMPANY, kind: 'company' }, ctx(r.env, { profile: 'compact' })));
  const text = (compact.content[0] as { text: string }).text;
  assert.ok(text.length <= COMPACT_LIMITS.maxChars, `${text.length} characters`);
  const parsed = JSON.parse(text) as RecordsView;
  assert.equal(parsed.status, 'checked');
  if (parsed.status !== 'checked') return;
  assert.ok(parsed.sources[0].findings.length < 10);
  assert.match(parsed.sources[0].note, /Showing \d of 10 here; open the source for all\./);
  assert.equal(parsed.notice, NOT_A_CONSUMER_REPORT, 'the notice survives the trim');
});

test('a finding that addresses an AI is fenced in the report and the fields, under the reminder (#701)', () => {
  const finding = (title: string) => ({ source: 'S', title, details: ['d'], date: null, link: 'https://data.colorado.gov/x', checked: NOW.toISOString() });
  const view = {
    status: 'checked', name: 'Harbor Labs', kind: 'company', checked: NOW.toISOString(), records_not_conclusions: 'r', source_text: SOURCE_TEXT_IS_DATA,
    notice: 'n', not_a_lawyer: 'l',
    sources: [{ id: 'co_open_data', source: 'S', operator: 'O', status: 'searched', checked: NOW.toISOString(), sent_to: 'data.colorado.gov',
      findings: [finding(PLANTED_AI), finding('Harbor Labs LLC')], total: null, link: 'https://data.colorado.gov/d', note: 'n', look_for: null, coverage: 'c' }],
  } as unknown as RecordsView;
  const text = recordsReport(view);
  assert.ok(text.includes(FENCE.ai) && text.includes(UNTRUSTED_REMINDER));
  const [planted, plain] = (judgedView(view) as any).sources[0].findings;
  assert.equal(planted.untrusted, 'addressed-to-ai');
  assert.ok(planted.title.startsWith(FENCE.ai));
  assert.equal(plain.title, 'Harbor Labs LLC');
});
