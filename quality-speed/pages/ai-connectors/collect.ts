// SPDX-License-Identifier: Apache-2.0
// The AI connectors lab: brings up legallas-mcp on a CI runner with an empty room, then measures what PLAN.md lists. It writes
// the contract's records to --out, and the page's drill-down (ids and numbers only) to $DETAIL_DIR/page/connectors.json, which
// the build puts beside page.ts (core/detail.ts). No key, no cost, invented data. Last, it reads this lane's own job minutes
// so far (core/lane/collect.ts): lane_minutes.
//
//   node quality-speed/pages/ai-connectors/collect.ts --out <records.json>   (core/collect.ts runs it, from lanes.json)
//
// It runs only in CI, after `npm ci` in web/, and refuses to run beside a room's own settings there.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, openSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { laneRecord } from '../../core/lane/collect.ts';
import { AIS, GUIDE_FILES, stepsByAi, worstSteps } from './guides.ts';
import { contract } from './smoke.ts';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const WEB = path.join(ROOT, 'web');

/** The parts of web/ this lab uses, loaded at run time: their own imports need Workers types this folder's type check lacks. */
interface WebCode {
  MCP_RESOURCE: string;
  TOOL_NAMES: readonly string[];
  LAW_TOOL_NAME: string;
  SCOPE_READ: string;
  SERVER_NAME: string;
  DEFAULT_DAILY_TOOL_CAP: number;
  REFRESH_TOKEN_TTL_SECONDS: number;
  LIST_PAGE_SIZE: number;
  COMPACT_LIMITS: { maxItems: number; maxChars: number };
  MAX_PAGES_PER_READ: number;
  MAX_CHARS_PER_READ: number;
  DAILY_DOWNLOAD_CAP: number;
  DEFAULT_REDIRECT_ALLOW: readonly string[];
}
const load = <T>(rel: string): Promise<T> => import(path.join(WEB, rel)) as Promise<T>;
let code: WebCode; // loaded in main(), so a test can import this file without web/
const run = promisify(execFile);
const PORT = 8790;
const BASE = `http://localhost:${PORT}`;
const PAGE = 'ai-connectors';
/** The room's tool list as every connected AI loads it: the server's tools/list result, pinned for Copilot and held equal to the server by mcp-tools.test.ts. */
export const TOOL_LIST = 'web/connect/copilot/appPackage/mcp-tools.json';

/**
 * Tokens a connected AI loads for the room's tool list: the tools/list result as compact JSON, four characters a token (the
 * data room's rule, data-room/lab/journeys.ts). Null when the list is missing, unreadable or empty, so it reads missing.
 */
export function toolListTokens(text: string | null): { tokens: number; tools: number } | null {
  if (text === null) return null;
  try {
    const list = JSON.parse(text) as { tools?: unknown };
    return Array.isArray(list.tools) && list.tools.length > 0 ? { tokens: Math.ceil(JSON.stringify(list).length / 4), tools: list.tools.length } : null;
  } catch {
    return null;
  }
}

/**
 * The only variables the lab's child processes get: what npm, npx and wrangler need to run, never the job's token or anything
 * else in the job's environment. The smoke reads its settings from web/.dev.vars.
 */
export function labEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'CI'];
  return { ...Object.fromEntries(keep.filter((k) => env[k] !== undefined).map((k) => [k, env[k]])), WRANGLER_SEND_METRICS: 'false' };
}

/**
 * The lab's room: its one owner, who has ticked the current full notice. Without the tick, sign-in and every tool call stop
 * at "Read the notice first" (mcp/authorize.ts, mcp/server.ts), so the smoke and the client-document probe prove nothing.
 */
export function seedSql(owner: string, noticeVersion: string): string {
  if (!/^[a-z0-9.+-]+@[a-z0-9.-]+$/.test(owner) || !/^[A-Za-z0-9-]+$/.test(noticeVersion)) throw new Error('seedSql takes a plain email and notice version.');
  return `INSERT OR IGNORE INTO members (email, role, name) VALUES ('${owner}', 'owner', 'Dev Owner'); INSERT OR IGNORE INTO notice_acks (email, version) VALUES ('${owner}', '${noticeVersion}');`;
}

/** A fresh random label each run, so a deny of the exact addresses tried here can't pass the gate. */
const fresh = () => `qs${randomUUID().slice(0, 8)}`;

/**
 * What the gate tries, each callback also listed in MCP_REDIRECT_ALLOW, plainly and as an owner entry: the two published
 * callbacks, ChatGPT's per-app form with a random id, and a random subdomain of every denied host. Nine registrations with the
 * control, inside REGISTER_LIMIT's 10 a minute.
 */
export const REGISTER_PROBES: readonly [id: string, uri: string][] = [
  ['chatgpt_stable', 'https://chatgpt.com/connector_platform_oauth_redirect'],
  ['chatgpt_per_app', `https://chatgpt.com/connector/oauth/${fresh()}`],
  ['gemini_enterprise', 'https://vertexaisearch.cloud.google.com/oauth-redirect'],
  ['openai_subdomain', `https://${fresh()}.openai.com/oauth/callback`],
  ['google_subdomain', `https://${fresh()}.google.com/oauth/callback`],
  ['grok_subdomain', `https://${fresh()}.grok.com/oauth/callback`],
  ['x_ai_subdomain', `https://${fresh()}.x.ai/oauth/callback`],
  ['x_com_subdomain', `https://${fresh()}.x.com/oauth/callback`],
];
/** A supported AI's callback, registered in the same run: unless it gets 201, a refusal could be the server refusing everyone. */
export const CONTROL = 'https://claude.ai/api/mcp/auth_callback';
export const CIMD_PROBE = { id: 'chatgpt_client_document', clientId: 'https://chatgpt.com/oauth/client.json', redirect: REGISTER_PROBES[0]![1] };

type Verdict = 'refused' | 'admitted' | 'unproven';

function args(argv: readonly string[]): { out: string } {
  const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : undefined;
  if (!out) throw new Error('usage: node collect.ts --out <records.json>');
  return { out: path.resolve(out) };
}

/** The run's own link, which every record cites. Only a GitHub Actions run of this repository has one. */
function runUrl(env: NodeJS.ProcessEnv): string {
  const { CI, GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = env;
  if (CI !== 'true' || !GITHUB_RUN_ID || GITHUB_REPOSITORY?.toLowerCase() !== 'colorado-startups/legallas') throw new Error('Runs only in this repository\'s CI.');
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

/** The examples, made into the lab's settings: the full product, loopback on as for desktop apps, and the probes allowed. */
async function settings(): Promise<string> {
  for (const file of ['.dev.vars', 'wrangler.jsonc', 'wrangler.mcp.jsonc', 'legallas.config.json', 'room.config.json']) {
    if (existsSync(path.join(WEB, file))) throw new Error(`web/${file} exists: a room's own settings are never touched.`);
  }
  const probes = [...REGISTER_PROBES.map(([, uri]) => uri), CIMD_PROBE.redirect];
  const allow = ['http://127.0.0.1', 'http://localhost', ...probes, ...probes.map((uri) => `=${uri}`)].join(',');
  const vars = await readFile(path.join(WEB, '.dev.vars.example'), 'utf8');
  if (!/^MCP_REDIRECT_ALLOW=/m.test(vars)) throw new Error('.dev.vars.example has no MCP_REDIRECT_ALLOW line.');
  await writeFile(path.join(WEB, '.dev.vars'), vars.replace(/^MCP_REDIRECT_ALLOW=.*$/m, `MCP_REDIRECT_ALLOW=${allow}`));
  await copyFile(path.join(WEB, 'wrangler.example.jsonc'), path.join(WEB, 'wrangler.jsonc'));
  const mcp = await readFile(path.join(WEB, 'wrangler.mcp.example.jsonc'), 'utf8');
  if (!mcp.includes('"main": "mcp/entry-pro.ts",')) throw new Error('wrangler.mcp.example.jsonc no longer runs the full product.');
  await writeFile(path.join(WEB, 'wrangler.mcp.jsonc'), mcp);
  const owner = /^DEV_IDENTITY_EMAIL=(.+)$/m.exec(vars)?.[1]?.trim();
  if (!owner || !/^[a-z0-9.+-]+@[a-z0-9.-]+$/.test(owner)) throw new Error('.dev.vars.example names no plain dev identity.');
  return owner;
}

async function startMcp(log: string): Promise<ChildProcess> {
  if (await fetch(`${BASE}/`).then(() => true, () => false)) throw new Error(`Something already answers on port ${PORT}.`);
  const fd = openSync(log, 'a');
  const child = spawn('npx', ['wrangler', 'dev', '-c', 'wrangler.mcp.jsonc', '--local', '--port', String(PORT), '--inspector-port', '9230', '--show-interactive-dev-session=false'], {
    cwd: WEB, detached: true, stdio: ['ignore', fd, fd], env: labEnv(process.env),
  });
  for (let i = 0; i < 90; i++) {
    if (await fetch(`${BASE}/`).then(() => true, () => false)) return child;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await stopMcp(child);
  throw new Error('legallas-mcp did not answer within 90 s.');
}

/** Stops the server's whole process group, then waits until nothing answers on the port, so the next server starts fresh. */
async function stopMcp(child: ChildProcess): Promise<void> {
  if (child.exitCode === null) process.kill(-child.pid!, 'SIGTERM'); // safe: spawned detached, so it leads its own group
  for (let i = 0; i < 30; i++) {
    if (!(await fetch(`${BASE}/`).then(() => true, () => false))) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('legallas-mcp still answers 30 s after it was stopped.');
}

/** Refused only by the allowlist's own answer (400, invalid_redirect_uri); a 201 admitted it; anything else proves nothing. */
export function registerVerdict(status: number, body: unknown): Verdict {
  if (status === 201) return 'admitted';
  return status === 400 && (body as { error?: unknown } | null)?.error === 'invalid_redirect_uri' ? 'refused' : 'unproven';
}

async function registerProbe(endpoint: string, uri: string): Promise<Verdict> {
  const body = { client_name: 'qs-gate', redirect_uris: [uri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] };
  const reply = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }), () => ({ status: 0, json: null }));
  return registerVerdict(reply.status, reply.json);
}

/** /authorize for a client document on an unsupported host: refused only on the "App not allowed" page; the consent form admits. */
async function cimdProbe(): Promise<Verdict> {
  const query = new URLSearchParams({
    response_type: 'code', client_id: CIMD_PROBE.clientId, redirect_uri: CIMD_PROBE.redirect, state: 'qsgate',
    code_challenge: 'qsgateqsgateqsgateqsgateqsgateqsgateqsgateq', code_challenge_method: 'S256', scope: code.SCOPE_READ,
  });
  const reply = await fetch(`${BASE}/authorize?${query}`).then(async (r) => ({ status: r.status, text: await r.text() }), () => null);
  if (!reply) return 'unproven';
  if (reply.status === 400 && reply.text.includes('App not allowed')) return 'refused';
  return reply.text.includes('name="handle"') ? 'admitted' : 'unproven';
}

/** Loopback lets any program on a computer sign in, so it must be off in the defaults and the example production settings. */
function loopbackOffByDefault(): boolean {
  const example = readFileSync(path.join(WEB, 'wrangler.mcp.example.jsonc'), 'utf8');
  const configured = /"MCP_REDIRECT_ALLOW":\s*"([^"]*)"/.exec(example)?.[1];
  return configured !== undefined && !/localhost|127\.0\.0\.1/.test(configured) && code.DEFAULT_REDIRECT_ALLOW.every((entry) => !entry.startsWith('http:'));
}

async function gate(): Promise<{ probes: { id: string; verdict: Verdict }[]; loopbackOff: boolean }> {
  const meta = (await fetch(`${BASE}/.well-known/oauth-authorization-server`).then((r) => r.json(), () => ({}))) as { registration_endpoint?: string };
  const endpoint = meta.registration_endpoint;
  const controlAdmitted = endpoint ? (await registerProbe(endpoint, CONTROL)) === 'admitted' : false;
  const probes: { id: string; verdict: Verdict }[] = [];
  for (const [id, uri] of REGISTER_PROBES) probes.push({ id, verdict: endpoint ? await registerProbe(endpoint, uri) : 'unproven' });
  // A server that refuses Claude too proves nothing by refusing these; one it let in is still let in.
  for (const probe of probes) if (!controlAdmitted && probe.verdict === 'refused') probe.verdict = 'unproven';
  probes.push({ id: CIMD_PROBE.id, verdict: await cimdProbe() });
  return { probes, loopbackOff: loopbackOffByDefault() };
}

function runSmoke(log: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', 'mcp:smoke'], { cwd: WEB, stdio: ['ignore', 'pipe', 'pipe'], env: labEnv(process.env) });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('close', () => writeFile(log, out).then(() => resolve(out)));
  });
}

function readGuides(): Map<string, string | null> {
  return new Map(GUIDE_FILES.map((file) => [file, existsSync(path.join(ROOT, file)) ? readFileSync(path.join(ROOT, file), 'utf8') : null]));
}

async function main(): Promise<void> {
  const { out } = args(process.argv.slice(2));
  const source = runUrl(process.env);
  code = await load<WebCode>('mcp/contract.ts');
  // Server and smoke logs stay on the runner (the job log shows the smoke's table); only the drill-down leaves the lane.
  const logs = mkdtempSync(path.join(tmpdir(), 'ai-connectors-'));
  const owner = await settings();
  const wrangler = (...rest: string[]) => run('npx', ['wrangler', ...rest], { cwd: WEB, env: labEnv(process.env) });
  await wrangler('d1', 'migrations', 'apply', code.SERVER_NAME, '--local');
  const { NOTICE_VERSION } = await load<{ NOTICE_VERSION: string }>('worker/full-notice.ts');
  await wrangler('d1', 'execute', code.SERVER_NAME, '--local', '--command', seedSql(owner, NOTICE_VERSION));

  // The smoke ends by using up the registration limit (10 a minute, kept across restarts), so the gate waits out its window.
  const server = await startMcp(path.join(logs, 'mcp.log'));
  const table = await runSmoke(path.join(logs, 'smoke.txt'));
  console.log(table); // statuses, codes and lengths only (mcp-smoke.ts), so a failed stage can be read from the job log
  const smoke = contract(table);
  await new Promise((resolve) => setTimeout(resolve, 65_000));
  const gated = await gate();
  await stopMcp(server);

  const files = readGuides();
  const steps = stepsByAi(files);

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const ok = (id: string, value: number, n: number) => ({ id, page: PAGE, value, status: 'ok', stage: 'lab', measured_at: now, source_url: source, sample_size: n });
  const missing = (id: string) => ({ id, page: PAGE, value: null, status: 'missing', stage: 'lab', measured_at: null, source_url: null, sample_size: null });
  const verdicts = gated.probes.map((p) => p.verdict);
  const worst = worstSteps(steps);
  const listed = toolListTokens(existsSync(path.join(ROOT, TOOL_LIST)) ? readFileSync(path.join(ROOT, TOOL_LIST), 'utf8') : null);
  // One AI let in, or loopback on by default, fails the gate outright; short of that, a probe that proved nothing leaves it missing.
  const failedGate = verdicts.includes('admitted') || !gated.loopbackOff;
  const records: Record<string, unknown>[] = [
    failedGate || !verdicts.includes('unproven') ? ok('unsupported_ai_refused', failedGate ? 0 : 1, verdicts.length) : missing('unsupported_ai_refused'),
    smoke ? ok('supported_ais_connecting', (100 * AIS.filter((ai) => smoke.connects[ai]).length) / AIS.length, AIS.length) : missing('supported_ais_connecting'),
    worst === null ? missing('setup_steps_worst_ai') : ok('setup_steps_worst_ai', worst, AIS.length),
    listed ? ok('tool_list_tokens', listed.tokens, listed.tools) : missing('tool_list_tokens'),
    // After the smoke, the gate and the guides, so it times the whole lane.
    { ...(await laneRecord(PAGE)) },
  ];
  const verdict = { refused: 1, admitted: 0, unproven: null } as const;
  const drill = {
    measured_at: now,
    steps,
    stages: smoke?.grid ?? null,
    probes: Object.fromEntries(gated.probes.map((p) => [p.id, verdict[p.verdict]])),
    loopback_off: gated.loopbackOff ? 1 : 0,
  };
  await writeFile(out, `${JSON.stringify(records, null, 1)}\n`);
  const detail = process.env.DETAIL_DIR ? path.join(process.env.DETAIL_DIR, 'page') : path.dirname(out);
  await mkdir(detail, { recursive: true });
  await writeFile(path.join(detail, 'connectors.json'), `${JSON.stringify(drill)}\n`);
  console.log(records.map((r) => `${String(r.id)} ${String(r.status)} ${String(r.value)}`).join('\n'));
}

if (import.meta.main) await main();
