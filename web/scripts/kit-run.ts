// SPDX-License-Identifier: Apache-2.0
// Runs the six room kits (mcp/kits.ts) on the local fixture room as one role, the way a connected AI would: the kit's
// prompt from prompts/get, then each tool step in its reference (connect/skill/legallas/references/), following
// cursors. Then Anthropic's claude-for-legal skills that read the room (PLUGIN_SKILLS), each through the tools
// connect/claude-ai.md maps it to. It also reads both views (mcp/apps/views.ts) through resources/read. Every call and
// its structured result is saved per kit or skill, and scripts/kit-checks.ts checks the citations.
//
//   node --import ./scripts/room-preload.ts scripts/kit-run.ts --as owner|counsel|investor --out <dir>
//     [--fixture case|company] [--base http://localhost:8790] [--room-base http://localhost:8789 --room <deal-room-id>]
//
// Fixture room only: it refuses any base that is not localhost, since it saves page text. It does no reasoning;
// the saved results are what the AI would write its board, grid or matrix from. fixture-room.yml runs it per role,
// restarting both servers as that role's dev identity (.dev.vars DEV_IDENTITY_EMAIL).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
// mcp/contract.ts, mcp/prompts.ts and worker/burst.ts declare Workers binding types this tsconfig (Node types only)
// cannot resolve, so their values come from mirrors (config.ts, kit-checks.ts) that kit-checks.test.ts holds equal.
import { KITS, type Kit } from '../mcp/kits.ts';
import { sqlLiteral } from '../worker/sql.ts';
import { CONTROL_PREFIX_FALLBACK } from './config.ts';
import {
  addTally,
  daysBefore,
  emptyTally,
  privilegedPaths,
  roomApiFailures,
  tallyCites,
  tallyFailures,
  type CiteTally,
  type RoomApiResult,
} from './kit-checks.ts';
import { type CallRecord, Calls, hitPages, listAll, readHits, rows, searchAll, type Value } from './kit-calls.ts';
import { kitNote, STEPS } from './kit-steps.ts';
import { LEGACY_VERSION, McpSession } from './mcp-client.ts';
import { devVar, formatReport, localGrant, localOptions, Report, type Grant } from './mcp-flow.ts';
import { d1 } from './room.ts';

// Moved to kit-steps.ts; still exported from here.
export { kitNote };

const ROLES = ['owner', 'counsel', 'investor'] as const;
type Role = (typeof ROLES)[number];

const FIXTURES = ['case', 'company'] as const;
type Fixture = (typeof FIXTURES)[number];

/**
 * The room's ids for the case fixture's privileged work product (`privilegedPaths`). Sync gives every document a new id, so the fixture's own ids name nothing in the
 * room and a check on them would always pass. The company fixture holds none. A missing one fails the run.
 */
async function roomPrivilegedIds(fixture: Fixture): Promise<ReadonlySet<string>> {
  if (fixture === 'company') return new Set();
  const read = async (name: string) => JSON.parse(await readFile(path.join(import.meta.dirname, '..', 'fixtures', name), 'utf8'));
  const paths = privilegedPaths(await read('doc-ids.json'), await read('matter.example.json'));
  const rows = d1(`SELECT id FROM documents WHERE path IN (${paths.map((rel) => sqlLiteral(rel)).join(', ')})`, '--local', true);
  const ids = new Set(rows.map((row) => String(row.id)));
  if (paths.length === 0 || ids.size !== paths.length) throw new Error(`the room holds ${ids.size} of the fixture's ${paths.length} privileged documents`);
  return ids;
}

/** REGISTER_LIMIT's period (wrangler.mcp.example.jsonc). */
const REGISTER_WINDOW_SECONDS = 60;

interface KitRecord {
  /** A kit's prompt name, or a plugin skill's plugin:skill name. */
  kit: string;
  title: string;
  role: Role;
  prompt: { ok: boolean; code: string | null; chars: number; text: string | null };
  calls: CallRecord[];
  tally: CiteTally;
  /** Kit-specific outcomes (cite check's verdicts, entity matrix's law rows). */
  extra: Value;
  failures: string[];
}

/**
 * Anthropic's claude-for-legal skills that read the room, each through the tools connect/claude-ai.md maps it to.
 * Their chronology and tabular-review are the chronology and review grid kits above. Each returns its outcome, and a
 * note in one line with what in it fails.
 */
interface PluginSkill {
  name: string;
  title: string;
  /** The fixtures it reads. The company fixture has no matter, nothing privileged and boilerplate pages. */
  fixtures: readonly Fixture[];
  steps: (calls: Calls, today: Date) => Promise<Value>;
  note: (extra: Value, guest: boolean) => { note: string; failures: string[] };
}

export const PLUGIN_SKILLS: readonly PluginSkill[] = [
  {
    name: 'litigation-legal:claim-chart',
    title: 'Claim chart',
    fixtures: ['case'],
    // A breach of fiduciary duty: one search per element, then the pin cite's page.
    async steps(calls) {
      const elements = ['duty owed', 'breach', 'causation', 'damages'];
      const pins: { id: string; page: number }[] = [];
      for (const element of elements) pins.push(...hitPages(await searchAll(calls, [element], 3), 1));
      await readHits(calls, pins);
      return { elements: elements.length, pinned: pins.length };
    },
    // A deal room holds no matter documents, so a guest's chart may find none; a member's must find one.
    note: (extra, guest) => ({
      note: `${extra.pinned}/${extra.elements} elements pin-cited${guest ? ' (deal room: no matter documents)' : ''}`,
      failures: !guest && Number(extra.pinned) === 0 ? ['no element found a page'] : [],
    }),
  },
  {
    name: 'litigation-legal:privilege-log-review',
    title: 'Privilege log review',
    fixtures: ['case'],
    async steps(calls) {
      const docs = await listAll(calls);
      const privileged = docs.filter((doc) => doc.privileged === true);
      await readHits(calls, privileged.slice(0, 3).flatMap((doc) => (typeof doc.id === 'string' ? [{ id: doc.id, page: 1 }] : [])));
      return { listed: docs.length, flagged: docs.filter((doc) => typeof doc.privileged === 'boolean').length, privileged: privileged.length };
    },
    note(extra, guest) {
      const failures: string[] = [];
      if (Number(extra.listed) > 0 && Number(extra.flagged) === 0) failures.push('no document row says whether it is privileged');
      if (!guest && Number(extra.privileged) === 0) failures.push('a member saw no privileged document to log');
      return { note: `${extra.privileged} privileged of ${extra.listed}`, failures };
    },
  },
  {
    name: 'litigation-legal:legal-hold',
    title: 'Legal hold',
    fixtures: ['case'],
    // The trigger and the custodians: who holds what, from when.
    async steps(calls) {
      const hits = hitPages(await searchAll(calls, ['dispute', 'preserve documents', 'email', 'resignation'], 3), 4);
      await readHits(calls, hits);
      return { pages: hits.length };
    },
    // A deal room holds no dispute or custodian documents, so a guest's search may find none, like its claim chart.
    note: (extra, guest) => ({
      note: `${extra.pages} trigger and custodian pages${guest ? ' (deal room: no dispute documents)' : ''}`,
      failures: !guest && Number(extra.pages) === 0 ? ['no trigger or custodian page found'] : [],
    }),
  },
  {
    name: 'corporate-legal:diligence-issue-extraction',
    title: 'Diligence issues',
    fixtures: ['case'],
    async steps(calls) {
      const docs = await listAll(calls);
      const terms = ['change of control', 'assignment', 'consent required', 'indemnification', 'litigation', 'invention assignment', 'vesting', 'option pool'];
      const issues = hitPages(await searchAll(calls, terms, 3), 8);
      await readHits(calls, issues);
      return { documents: docs.length, terms: terms.length, issues: issues.length };
    },
    note: (extra) => ({ note: `${extra.issues} issue pages from ${extra.terms} terms over ${extra.documents} documents`, failures: Number(extra.issues) === 0 ? ['no issue found a page'] : [] }),
  },
  {
    name: 'corporate-legal:closing-checklist',
    title: 'Closing checklist',
    fixtures: FIXTURES,
    async steps(calls, today) {
      const recent = rows(await calls.all('legallas_list_documents', { since: daysBefore(today, 30) }, 'next_cursor'), 'documents');
      const docs = recent.length > 0 ? recent : await listAll(calls);
      for (const doc of docs.slice(0, 5)) if (typeof doc.id === 'string') await calls.call('legallas_get_document', { id: doc.id });
      return { recent: recent.length, checked: Math.min(docs.length, 5) };
    },
    note: (extra) => ({ note: `${extra.recent} new in 30 days, ${extra.checked} documents checked`, failures: Number(extra.checked) === 0 ? ['no document to check'] : [] }),
  },
];

interface Args {
  role: Role;
  out: string;
  base: string;
  roomBase: string | null;
  room: string | null;
  fixture: Fixture;
}

export function parseArgs(argv: readonly string[]): Args {
  const value = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const role = value('--as');
  if (!role || !(ROLES as readonly string[]).includes(role)) throw new Error(`--as takes ${ROLES.join(', ')}`);
  const out = value('--out');
  if (!out) throw new Error('--out <dir> is required');
  const base = value('--base') ?? 'http://localhost:8790';
  const roomBase = value('--room-base');
  for (const url of [base, roomBase]) {
    if (url !== null && !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('kit-run is for the local fixture room only');
  }
  const fixture = value('--fixture') ?? 'case';
  if (!(FIXTURES as readonly string[]).includes(fixture)) throw new Error(`--fixture takes ${FIXTURES.join(', ')}`);
  return { role: role as Role, out, base, roomBase, room: value('--room'), fixture: fixture as Fixture };
}

/**
 * A guest's room as the room serves it (worker/routes/rooms.ts): its document list must name no privileged id, and each
 * privileged document's file and viewer must answer 404. Statuses and ids only; `roomApiFailures` judges them.
 */
async function roomApiCheck(roomBase: string, room: string, privilegedIds: ReadonlySet<string>): Promise<RoomApiResult> {
  const at = `${roomBase}/api/rooms/${encodeURIComponent(room)}`;
  const list = await fetch(`${roomBase}/api/rooms`);
  await list.body?.cancel();
  const docs = await fetch(`${at}/documents`);
  const body = await docs.text();
  const listed = [...privilegedIds].filter((id) => body.includes(id));
  const direct: RoomApiResult['direct'] = [];
  for (const id of privilegedIds) {
    const file = await fetch(`${at}/files/${id}`, { redirect: 'manual' });
    const viewer = await fetch(`${roomBase}/rooms/${encodeURIComponent(room)}/view/${id}`, { redirect: 'manual' });
    await Promise.all([file.body?.cancel(), viewer.body?.cancel()]);
    direct.push({ id, file: file.status, viewer: viewer.status });
  }
  const opened = direct.filter((row) => row.file === 200 || row.viewer === 200).map((row) => row.id);
  let visible: number | null = null;
  try {
    visible = (JSON.parse(body) as { documents?: unknown[] }).documents?.length ?? null;
  } catch {
    // Not JSON: the status says why.
  }
  return { rooms_status: list.status, documents_status: docs.status, documents: visible, direct, privileged: [...new Set([...listed, ...opened])] };
}

/** The local OAuth grant. A rate-limited registration waits out its window once; any other failure is saved to grant.txt and stops the run. */
async function obtainGrant(args: Args, dir: string): Promise<Grant> {
  let report = new Report();
  let grant = await localGrant(report, fetch, args.base, await localOptions());
  // REGISTER_LIMIT allows 10 registrations a 60 s window (wrangler.mcp.example.jsonc) and a grant registers 3 clients;
  // the smoke just before can use the window up, so a rate-limited grant waits it out once.
  if (!grant && report.checks.some((check) => check.outcome === 'fail' && check.detail.includes('rate_limited'))) {
    console.error(`${args.role}: client registration rate limited; waiting ${REGISTER_WINDOW_SECONDS + 1} s`);
    await new Promise((resolve) => setTimeout(resolve, (REGISTER_WINDOW_SECONDS + 1) * 1000));
    report = new Report();
    grant = await localGrant(report, fetch, args.base, await localOptions());
  }
  if (!grant) {
    await writeFile(path.join(dir, 'grant.txt'), formatReport(report));
    throw new Error(`${args.role}: the local OAuth flow failed (grant.txt)`);
  }
  return grant;
}

/** What the AI connection offers this role. */
interface Offer {
  session: McpSession;
  offered: ReadonlySet<string>;
  /** Each tool's view, read through resources/read. */
  views: Value[];
  prompts: ReadonlySet<string>;
}

/** Reads the view each tool points at (its `_meta.ui.resourceUri`). */
async function readViews(session: McpSession, tools: readonly Value[]): Promise<Value[]> {
  const views: Value[] = [];
  for (const tool of tools) {
    const ui = (tool._meta as { ui?: { resourceUri?: unknown } } | undefined)?.ui?.resourceUri;
    if (typeof ui !== 'string') continue;
    const read = await session.request('resources/read', { uri: ui });
    const contents = (read.result?.contents as Value[] | undefined) ?? [];
    views.push({ tool: tool.name, uri: ui, ok: read.error === null && contents.length > 0, mime: contents[0]?.mimeType ?? null, chars: String(contents[0]?.text ?? '').length });
  }
  return views;
}

/** Opens the MCP session on the grant's token and lists what it offers: tools, their views and prompts. */
async function connect(args: Args, accessToken: string): Promise<Offer> {
  const session = new McpSession(fetch, `${args.base}/mcp`, accessToken, LEGACY_VERSION);
  const opened = await session.open();
  if (!opened.agreed) throw new Error(`${args.role}: initialize failed (${opened.error ?? opened.status})`);
  const listed = await session.listTools();
  const tools = (listed.result?.tools as Value[] | undefined) ?? [];
  const views = await readViews(session, tools);
  const promptList = await session.request('prompts/list');
  const prompts = new Set(((promptList.result?.prompts as Value[] | undefined) ?? []).map((p) => String(p.name)));
  return { session, offered: new Set(tools.map((tool) => String(tool.name))), views, prompts };
}

/** One run's settings and what it has found so far. */
interface Run {
  args: Args;
  dir: string;
  session: McpSession;
  offered: ReadonlySet<string>;
  guest: boolean;
  prefix: string;
  privilegedIds: ReadonlySet<string>;
  summary: Value[];
  failed: boolean;
}

/** Runs one kit or plugin skill's steps, checks the cites, and saves the record under its name. */
async function runOne(
  run: Run,
  name: string,
  title: string,
  prompt: KitRecord['prompt'] | null,
  steps: (calls: Calls) => Promise<Value>,
  note: (extra: Value) => { note: string; failures: string[] },
): Promise<void> {
  const calls = new Calls(run.session, run.offered);
  const extra = await steps(calls);
  const tally = calls.log.reduce((sum, call) => addTally(sum, tallyCites(call.value, run.prefix, run.privilegedIds)), emptyTally());
  const own = note(extra);
  const failures = [...tallyFailures(tally, run.guest), ...own.failures];
  for (const call of calls.log) if (!call.ok) failures.push(`${call.tool} failed: ${call.code}`);
  if (prompt && !prompt.ok) failures.push(`prompts/get ${name}: ${prompt.code ?? 'not listed'}`);
  const record: KitRecord = { kit: name, title, role: run.args.role, prompt: prompt ?? { ok: true, code: 'plugin_skill', chars: 0, text: null }, calls: calls.log, tally, extra, failures };
  await writeFile(path.join(run.dir, `${name.replace(':', '--')}.json`), `${JSON.stringify(record, null, 2)}\n`);
  if (failures.length > 0) run.failed = true;
  const refused = [...new Set(calls.log.filter((c) => c.code).map((c) => `${c.tool.replace('legallas_', '')}:${c.code}`))];
  run.summary.push({ kit: title, calls: calls.log.length, cited: tally.cited, page_links: tally.pageLinks, law_rows: tally.lawRows, privileged: tally.privileged.length, refused, note: own.note, failures });
}

/** A kit's prompt from prompts/get: whether it came, its error, and its text. */
async function promptRecord(session: McpSession, prompts: ReadonlySet<string>, name: Kit['prompt']): Promise<KitRecord['prompt']> {
  const got = prompts.has(name) ? await session.request('prompts/get', { name, arguments: {} }) : null;
  const messages = (got?.result?.messages as { content?: { text?: unknown } }[] | undefined) ?? [];
  const text = messages.map((m) => (typeof m.content?.text === 'string' ? m.content.text : '')).join('\n\n');
  return { ok: Boolean(got && !got.error), code: got ? got.error : 'not listed', chars: text.length, text: text || null };
}

/** Runs every kit, then every plugin skill the fixture has the documents for. */
async function runKits(run: Run, prompts: ReadonlySet<string>, today: Date): Promise<void> {
  for (const kit of KITS) {
    const prompt = await promptRecord(run.session, prompts, kit.prompt);
    await runOne(run, kit.prompt, kit.title, prompt, (calls) => STEPS[kit.prompt](calls, today), (extra) => kitNote(kit.prompt, extra));
  }
  for (const skill of PLUGIN_SKILLS) {
    if (skill.fixtures.includes(run.args.fixture)) await runOne(run, skill.name, skill.title, null, (calls) => skill.steps(calls, today), (extra) => skill.note(extra, run.guest));
    else run.summary.push({ kit: skill.title, calls: 0, cited: 0, page_links: 0, law_rows: 0, privileged: 0, refused: [], note: `not run on the ${run.args.fixture} fixture`, failures: [], skipped: true });
  }
}

/** The guest's view of the room API, and what in it fails. */
interface GuestRoom {
  room: RoomApiResult | null;
  failures: string[];
  summary: Value | null;
}

/** A guest run must name its room: without --room-base and --room the room-API check would not run and pass unseen. */
async function checkGuestRoom(run: Run): Promise<GuestRoom> {
  const { args, guest } = run;
  const room = guest && args.roomBase && args.room ? await roomApiCheck(args.roomBase, args.room, run.privilegedIds) : null;
  const failures = room ? roomApiFailures(room) : guest ? ['not checked: a guest run needs --room-base and --room'] : [];
  if (failures.length > 0) run.failed = true;
  return { room, failures, summary: room || guest ? { ...room, failures } : null };
}

function roomLine({ room, failures }: GuestRoom): string {
  const seen = room
    ? `rooms ${room.rooms_status}, documents ${room.documents_status} (${room.documents ?? 'no JSON'} listed), privileged file and view 404 ${room.direct.filter((row) => row.file === 404 && row.viewer === 404).length}/${room.direct.length}`
    : 'not run';
  return `Room API as the guest: ${seen}. ${failures.length ? `FAIL: ${failures.join('; ')}` : 'pass'}.`;
}

function summaryRow(row: Value): string {
  const failures = row.failures as string[];
  return `| ${row.kit} | ${row.calls} | ${row.cited} | ${row.page_links} | ${row.law_rows} | ${row.privileged} | ${(row.refused as string[]).join(' ') || '-'} | ${row.note || '-'} | ${failures.length ? `FAIL: ${failures.join('; ')}` : row.skipped ? 'skip' : 'pass'} |`;
}

/** The report: what the connection offered, the guest's room check, and one table row per kit and skill. */
function reportLines(role: Role, offer: Offer, guestRoom: GuestRoom, summary: readonly Value[]): string[] {
  const views = offer.views.map((v) => `${v.uri} ${v.ok ? 'ok' : 'FAIL'}`).join(', ') || 'none';
  const lines = [`## ${role}`, '', `Tools offered: ${offer.offered.size}. Prompts: ${offer.prompts.size}. Views: ${views}.`, ''];
  if (guestRoom.summary) lines.push(roomLine(guestRoom), '');
  lines.push('| Kit | Calls | Cited rows | Page links | Law rows | Privileged | Refused | Kit outcome | Result |', '|---|---|---|---|---|---|---|---|---|');
  for (const row of summary) lines.push(summaryRow(row));
  return lines;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dir = path.join(args.out, args.role);
  await mkdir(dir, { recursive: true });
  const grant = await obtainGrant(args, dir);
  const offer = await connect(args, grant.accessToken);
  const privilegedIds = await roomPrivilegedIds(args.fixture);
  const prefix = (await devVar('CONTROL_PREFIX')) ?? CONTROL_PREFIX_FALLBACK;
  const run: Run = { args, dir, session: offer.session, offered: offer.offered, guest: args.role === 'investor', prefix, privilegedIds, summary: [], failed: false };
  await runKits(run, offer.prompts, new Date());
  const guestRoom = await checkGuestRoom(run);
  await writeFile(path.join(dir, 'summary.json'), `${JSON.stringify({ role: args.role, tools: [...offer.offered], prompts: [...offer.prompts], views: offer.views, room: guestRoom.summary, kits: run.summary }, null, 2)}\n`);

  const lines = reportLines(args.role, offer, guestRoom, run.summary);
  await writeFile(path.join(dir, 'report.md'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
  if (run.failed) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
