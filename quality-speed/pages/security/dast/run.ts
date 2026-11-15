// SPDX-License-Identifier: Apache-2.0
// The automated dynamic scan: brings the fictional room up inside the CI job with the data-room lab's harness, proves
// who each target is, then runs OWASP ZAP (pinned in tools.ts) against the four targets in targets.ts and writes
// report.md and report.json. It is not a penetration test, and the report says so.
//
//   node quality-speed/pages/security/dast/run.ts --out <dir> --room <scratch dir> [--install]
//
// Nothing leaves the job: four `wrangler dev --local` servers on 127.0.0.1 from the committed examples, one per target
// (targets.ts), and ZAP in a container on the host's network, mapped so that STRANGER_HOST is 127.0.0.1 too. Any site in
// ZAP's report other than the four targets fails the run.
//
// The run fails on: an open High or Medium finding, a ZAP job that failed, a target that is not who it should be, a
// room route that answers a stranger, or a site outside the targets. report.md is written whenever ZAP ran.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { appendFile, chmod, mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { buildRoom, installWeb, MCP_PORT as LAB_MCP_PORT, ROOM_PORT as LAB_ROOM_PORT, seedRoom, timed, WEB_DIR } from '../../data-room/lab/room.ts';
import { mcpFlow, webModule, wrangler } from '../../data-room/lab/web.ts';
import { countUrls, mcpCalls, mcpToolCoverage } from './coverage.ts';
import { blocking, countBySeverity, judge, parseZapJson, validateTriage } from './findings.ts';
import { fillPath, mcpOpenApi, paramValues, roomOpenApi, seededNames, type RouteLike, type Seeded } from './openapi.ts';
import { ALERTS_FILE, MCP_HISTORY_FILE, memberWriteHeaders, TOKEN_VAR, urlsFile, WRK, zapPlan } from './plan.ts';
import { renderReport, type Coverage, type RunInfo } from './report.ts';
import { MCP_PORT, ROOM_PORT, serverArgs, STRANGER_HOST, strangerState, targetNamed, TARGETS, type Target } from './targets.ts';
import { MCP_ADDON, ZAP_IMAGE, ZAP_VERSION } from './tools.ts';

const USAGE = 'usage: node run.ts --out <dir> --room <scratch dir> [--install]';
const TRIAGE = path.join(import.meta.dirname, 'triage.json');

interface Options {
  out: string;
  room: string;
  install: boolean;
}

function parseArgs(args: readonly string[]): Options {
  const options: Options = { out: '', room: '', install: false };
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i + 1];
    if (args[i] === '--install') options.install = true;
    else if (args[i] === '--out' && value) options.out = path.resolve(args[(i += 1)]!);
    else if (args[i] === '--room' && value) options.room = path.resolve(args[(i += 1)]!);
    else throw new Error(USAGE);
  }
  if (!options.out || !options.room) throw new Error(USAGE);
  return options;
}

/** One request to 127.0.0.1 with the Host header given, which fetch does not allow. Resolves to the status code. */
function request(port: number, host: string, method: string, target: string, body?: string, extra: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = { Host: `${host}:${port}`, ...extra };
    if (body !== undefined) Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers, timeout: 20_000 }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`${method} ${target} timed out`)));
    req.end(body);
  });
}

/** Runs a command; its output goes to this process and to `log`, with `secret` replaced. Resolves to the exit code. */
function run(command: string, args: readonly string[], log: string | null, secret = '', env: NodeJS.ProcessEnv = process.env, cwd?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const file = log ? createWriteStream(log, { flags: 'a' }) : null;
    const child = spawn(command, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const pass = (chunk: Buffer) => {
      const text = secret ? chunk.toString('utf8').split(secret).join('[token]') : chunk.toString('utf8');
      process.stdout.write(text);
      file?.write(text);
    };
    child.stdout.on('data', pass);
    child.stderr.on('data', pass);
    child.on('error', reject);
    child.on('close', (code) => {
      file?.end();
      resolve(code ?? 1);
    });
  });
}

/**
 * The four servers, one after the other, each MCP server before its room: the room's MCP_GRANTS binding calls
 * legallas-mcp, and two starting at once can pick the same port for the socket that links them. Each in its own process
 * group, so stopping it also stops the workerd it starts.
 */
async function startWorkers(logs: string, room: string): Promise<{ stop(): Promise<void> }> {
  await mkdir(logs, { recursive: true });
  const started: ChildProcess[] = [];
  const stop = async () => {
    for (const child of started) {
      if (child.pid === undefined || child.exitCode !== null) continue;
      const gone = new Promise((resolve) => child.once('exit', resolve));
      process.kill(-child.pid, 'SIGTERM');
      await Promise.race([gone, new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
  };
  const serve = async (target: Target) => {
    const log = await open(path.join(logs, `${target.name}.log`), 'w');
    const child = spawn('npx', serverArgs(target, room), { cwd: WEB_DIR, stdio: ['ignore', log.fd, log.fd], detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    started.push(child);
    await log.close();
    for (let second = 0; second < 90; second += 1) {
      if (child.exitCode !== null) throw new Error(`${target.name} exited ${child.exitCode} before it answered: see logs/servers/${target.name}.log`);
      if (await request(target.port, target.host, 'GET', '/').then(() => true, () => false)) {
        process.stdout.write(`${target.name} answers on 127.0.0.1:${target.port} after ${second} s\n`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`${target.name} did not answer on 127.0.0.1:${target.port} after 90 s: see logs/servers/${target.name}.log`);
  };
  try {
    // The strangers' store gets the room's schema and nothing else.
    const migrate = await run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'legallas', '--local', '--persist-to', strangerState(room)], path.join(logs, 'stranger-migrations.log'), '', { ...process.env, WRANGLER_SEND_METRICS: 'false' }, WEB_DIR);
    if (migrate !== 0) throw new Error(`The strangers' D1 migrations exited ${migrate}: see logs/servers/stranger-migrations.log`);
    for (const name of ['mcp-member', 'room-member', 'mcp-stranger', 'room-stranger'] as const) await serve(targetNamed(name));
  } catch (error) {
    await stop();
    throw error;
  }
  return { stop };
}

/** One value from the seeded room, or undefined when the table is empty or absent. */
async function first(sql: string): Promise<string | undefined> {
  try {
    const [row] = await wrangler.cliWrangler('local').d1Query(sql);
    const value = row ? Object.values(row)[0] : undefined;
    return value === undefined || value === null ? undefined : String(value);
  } catch {
    return undefined;
  }
}

async function seededRows(): Promise<Seeded> {
  return {
    document: await first('SELECT id FROM documents WHERE removed_at IS NULL ORDER BY control_seq LIMIT 1'),
    comment: await first('SELECT id FROM comments LIMIT 1'),
    proposal: await first('SELECT id FROM proposals LIMIT 1'),
    room: await first('SELECT id FROM rooms LIMIT 1'),
  };
}

/** The room's settings as served: the example's vars under .dev.vars, which the lab wrote. */
async function servedFlags(): Promise<{ PROPOSALS_ENABLED: string; CHECKLIST_ENABLED: string }> {
  const vars = new Map<string, string>();
  for (const line of (await readFile(path.join(WEB_DIR, '.dev.vars'), 'utf8')).split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) vars.set(match[1]!, match[2]!);
  }
  return { PROPOSALS_ENABLED: vars.get('PROPOSALS_ENABLED') ?? '0', CHECKLIST_ENABLED: vars.get('CHECKLIST_ENABLED') ?? '0' };
}

/** Every route the served room answers, from its own table (web/worker/index.ts, the room with pro). */
async function roomRouteTable(): Promise<RouteLike[]> {
  const room = await webModule<{ roomRoutes(env: { PROPOSALS_ENABLED: string; CHECKLIST_ENABLED: string }): readonly RouteLike[] }>('worker/index.ts');
  return room.roomRoutes(await servedFlags()).map(({ method, path: at }) => ({ method, path: at }));
}

/**
 * The owner's plain GETs, and every route as a stranger, who must be refused (403) on all of them. Then one write as the
 * owner with the headers ZAP adds (plan.ts memberWriteHeaders), which must pass the room's same-origin check, or the
 * active scan would never reach a write handler.
 */
async function reachChecks(routes: readonly RouteLike[], seeded: Seeded): Promise<{ coverage: Pick<Coverage, 'roomRoutes' | 'strangerRoutes'>; leaks: string[] }> {
  const member = targetNamed('room-member');
  const stranger = targetNamed('room-stranger');
  let gets = 0;
  let getsOk = 0;
  let refused = 0;
  const leaks: string[] = [];
  // A request that errors or times out reads as status 0, so one slow route cannot stop the scan.
  const status = (t: Target, method: string, at: string, body?: string, extra?: Record<string, string>) => request(t.port, t.host, method, at, body, extra).catch(() => 0);
  for (const route of routes) {
    const target = fillPath(route.path, paramValues(route.path, seeded));
    if (route.method === 'GET') {
      gets += 1;
      const got = await status(member, 'GET', target);
      if (got >= 200 && got < 300) getsOk += 1;
    }
    const body = ['POST', 'PUT', 'PATCH'].includes(route.method) ? '{}' : undefined;
    const got = await status(stranger, route.method, target, body);
    if (got === 403) refused += 1;
    else leaks.push(`${route.method} ${route.path} ${got === 0 ? 'gave a stranger no answer' : `answered a stranger with ${got}`}`);
  }
  if (seeded.document) {
    const headers = Object.fromEntries(memberWriteHeaders(member).map((rule) => [rule.matchString, rule.replacementString]));
    const write = await status(member, 'POST', `/api/documents/${encodeURIComponent(seeded.document)}/key`, '{"key":true}', headers);
    if (write !== 200) leaks.push(`The owner's write with the scan's headers answered ${write}, not 200: the active scan would not reach write handlers`);
  }
  return { coverage: { roomRoutes: { total: routes.length, gets, getsOk }, strangerRoutes: { tried: routes.length, refused } }, leaks };
}

const PROBE = [
  'import sys, urllib.request, urllib.error',
  'for url in sys.argv[1:]:',
  '    try:',
  '        print(url, urllib.request.urlopen(url, timeout=15).status)',
  '    except urllib.error.HTTPError as error:',
  '        print(url, error.code)',
  '    except Exception as error:',
  "        print(url, 'error', type(error).__name__)",
].join('\n');

/** What each target must answer from inside ZAP's container, before ZAP runs: proof of reach, and of who each one is. */
const EXPECTED: readonly [string, number][] = [
  [`${targetNamed('room-member').origin}/api/me`, 200],
  [`${targetNamed('room-stranger').origin}/api/me`, 403],
  [`${targetNamed('mcp-member').origin}/connections`, 200],
  [`${targetNamed('mcp-stranger').origin}/connections`, 403],
];

const dockerNet = ['--network', 'host', '--add-host', `${STRANGER_HOST}:127.0.0.1`];

async function preflight(log: string): Promise<string[]> {
  const output: string[] = [];
  const child = spawn('docker', ['run', '--rm', ...dockerNet, ZAP_IMAGE, 'python3', '-c', PROBE, ...EXPECTED.map(([url]) => url)], { stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));
  const code = await new Promise<number>((resolve) => child.on('close', (c) => resolve(c ?? 1)));
  const text = output.join('');
  await writeFile(log, text);
  process.stdout.write(text);
  if (code !== 0) return [`the probe container exited ${code}`];
  const problems: string[] = [];
  for (const [url, want] of EXPECTED) {
    const line = text.split('\n').find((l) => l.startsWith(`${url} `));
    const got = line?.slice(url.length + 1).trim();
    if (got !== String(want)) problems.push(`${url} answered ${got ?? 'nothing'} inside the scanner's container, not ${want}`);
  }
  return problems;
}

async function sha256(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

/** ZAP's MCP add-on into ZAP's home, refused unless it is the pinned build. */
async function installAddon(home: string): Promise<void> {
  const plugin = path.join(home, 'plugin');
  await mkdir(plugin, { recursive: true });
  const response = await fetch(MCP_ADDON.url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`The MCP add-on download answered ${response.status}`);
  const file = path.join(plugin, MCP_ADDON.file);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
  const got = await sha256(file);
  if (got !== MCP_ADDON.sha256) throw new Error(`The MCP add-on's SHA-256 is ${got}, not the pinned ${MCP_ADDON.sha256}`);
}

async function readIf(file: string): Promise<string | null> {
  return readFile(file, 'utf8').catch(() => null);
}

/**
 * Replaces `secret` in every file the workflow uploads, so no artifact holds the token. ZAP's own home folder is left
 * alone: the workflow never uploads it, and its files belong to the container's user.
 */
async function scrub(dir: string, secret: string, skip: string): Promise<void> {
  if (!secret) return;
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  for (const entry of entries) {
    const file = path.join(entry.parentPath, entry.name);
    if (!entry.isFile() || file.startsWith(`${skip}${path.sep}`)) continue;
    try {
      if ((await stat(file)).size > 200 * 1024 * 1024) continue;
      const text = await readFile(file, 'latin1');
      if (text.includes(secret)) await writeFile(file, text.split(secret).join('[token]'), 'latin1');
    } catch (error) {
      process.stdout.write(`::warning title=Scrub::could not read ${path.relative(dir, file)} (${error instanceof Error ? error.name : 'error'})\n`);
    }
  }
}

/** Folders ZAP writes into, as its own user in the container. */
async function openFolder(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await chmod(dir, 0o777);
}

async function main(): Promise<void> {
  if (process.env.CI !== 'true') throw new Error('The scan runs in CI, never on a laptop: use the "Dynamic scan" workflow.');
  if (LAB_ROOM_PORT !== ROOM_PORT || LAB_MCP_PORT !== MCP_PORT) throw new Error('targets.ts and the lab disagree on the ports');
  const options = parseArgs(process.argv.slice(2));
  const triageCheck = validateTriage(JSON.parse(await readFile(TRIAGE, 'utf8')));
  if (triageCheck.errors.length > 0) throw new Error(`triage.json: ${triageCheck.errors.join('; ')}`);
  const started = performance.now();
  const seconds: Record<string, number> = {};
  const logs = path.join(options.out, 'logs');
  const wrk = path.join(options.out, 'zap');
  await mkdir(logs, { recursive: true });
  for (const dir of [wrk, path.join(wrk, 'out'), path.join(wrk, 'home')]) await openFolder(dir);
  process.env.WRANGLER_SEND_METRICS = 'false';

  if (options.install) await timed(seconds, 'install', installWeb);
  const seed = await seedRoom(options.room, seconds);
  if (seed.status !== 'ok') throw new Error(`The fictional room did not seed: ${JSON.stringify(seed)}`);
  await timed(seconds, 'build', buildRoom);
  const servers = await timed(seconds, 'serversUp', () => startWorkers(path.join(logs, 'servers'), options.room));
  let token = '';
  const failures: string[] = [];
  try {
    const seeded = await seededRows();
    process.stdout.write(`Seeded rows: ${Object.entries(seeded).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}\n`);
    const routes = await roomRouteTable();
    const reach = await timed(seconds, 'reach', () => reachChecks(routes, seeded));
    failures.push(...reach.leaks);
    if (reach.coverage.roomRoutes.getsOk === 0) failures.push('No room GET route answered the owner with 2xx');

    await timed(seconds, 'pull', async () => {
      if ((await run('docker', ['pull', '--quiet', ZAP_IMAGE], null)) !== 0) throw new Error(`docker pull ${ZAP_IMAGE} failed`);
    });
    const preflightProblems = await preflight(path.join(logs, 'preflight.txt'));
    if (preflightProblems.length > 0) throw new Error(`Preflight: ${preflightProblems.join('; ')}`);

    // A member's AI connection, as a real client makes it: register, consent as the dev identity, exchange the code.
    const report = new mcpFlow.Report();
    const grant = (await mcpFlow.localGrant(report, fetch, `http://localhost:${MCP_PORT}`, await mcpFlow.localOptions())) as
      | { accessToken: string; client: { clientId: string }; redirectUri: string; resource: string }
      | null;
    if (!grant) throw new Error(`The member's MCP grant failed: ${report.checks.filter((c) => c.outcome === 'fail').map((c) => c.name).join(', ')}`);
    token = grant.accessToken;
    // Masked in the Actions log before anything could print it, and replaced in every file this run keeps.
    process.stdout.write(`::add-mask::${token}\n`);

    await writeFile(path.join(wrk, 'room-openapi.json'), `${JSON.stringify(roomOpenApi(routes, seeded), null, 1)}\n`);
    await writeFile(
      path.join(wrk, 'mcp-openapi.json'),
      `${JSON.stringify(mcpOpenApi({ clientId: grant.client.clientId, redirectUri: grant.redirectUri, resource: grant.resource }), null, 1)}\n`,
    );
    const openapi = { 'room-member': 'room-openapi.json', 'room-stranger': 'room-openapi.json', 'mcp-member': 'mcp-openapi.json', 'mcp-stranger': 'mcp-openapi.json' } as const;
    const plan = zapPlan({ targets: TARGETS, openapi, mcpUrl: `http://localhost:${MCP_PORT}/mcp`, spiderMinutes: 2, ruleMinutes: 3 });
    await writeFile(path.join(wrk, 'plan.json'), `${JSON.stringify(plan, null, 1)}\n`);
    await installAddon(path.join(wrk, 'home'));
    for (const dir of ['home', 'home/plugin', 'out']) await chmod(path.join(wrk, dir), 0o777);

    const zapExit = await timed(seconds, 'zap', () =>
      run(
        'docker',
        ['run', '--rm', ...dockerNet, '-e', TOKEN_VAR, '-v', `${wrk}:${WRK}:rw`, ZAP_IMAGE, 'zap.sh', '-cmd', '-silent', '-dir', `${WRK}/home`, '-autorun', `${WRK}/plan.json`],
        path.join(logs, 'zap.log'),
        token,
        { ...process.env, [TOKEN_VAR]: token },
      ),
    );
    if (zapExit === 1) failures.push('A ZAP job failed (exit 1): see logs/zap.log');

    const zapOut = path.join(wrk, 'out');
    const alertsText = await readIf(path.join(zapOut, ALERTS_FILE));
    if (alertsText === null) throw new Error(`ZAP wrote no ${ALERTS_FILE}`);
    const parsed = parseZapJson(JSON.parse(alertsText), seededNames(seeded));
    for (const site of parsed.foreignSites) failures.push(`ZAP reported a site outside the targets: ${site}`);
    const harText = await readIf(path.join(zapOut, MCP_HISTORY_FILE));
    const har: unknown = harText === null ? null : JSON.parse(harText);
    const mcpTools = har === null ? null : mcpToolCoverage(har);
    // The HAR holds the token: keep only the tool names, statuses and outcomes, then delete it.
    if (har !== null) await writeFile(path.join(zapOut, 'mcp-calls.json'), `${JSON.stringify(mcpCalls(har), null, 1)}\n`);
    await rm(path.join(zapOut, MCP_HISTORY_FILE), { force: true });
    const requests: Coverage['requests'] = {};
    for (const target of TARGETS) requests[target.name] = countUrls(await readIf(path.join(zapOut, urlsFile(target.name))));

    const judged = judge(parsed.alerts, triageCheck.triage);
    const info: RunInfo = {
      date: new Date().toISOString().slice(0, 10),
      commit: process.env.SCAN_COMMIT || process.env.GITHUB_SHA || 'unknown',
      runUrl: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
      zapVersion: ZAP_VERSION,
      zapImage: ZAP_IMAGE,
      mcpAddon: MCP_ADDON.version,
      zapExit,
      minutes: Math.ceil((performance.now() - started) / 60_000),
      coverage: { requests, ...reach.coverage, mcpTools },
    };
    const markdown = renderReport(info, judged);
    await writeFile(path.join(options.out, 'report.md'), markdown);
    const open = blocking(judged.findings);
    for (const finding of open) failures.push(`Open ${finding.risk}: ${finding.name} (${finding.alertRef}) on ${finding.target}`);
    await writeFile(
      path.join(options.out, 'report.json'),
      `${JSON.stringify({ schema: 1, info, seconds, counts: countBySeverity(judged.findings), findings: judged.findings, notSeen: judged.notSeen, failures }, null, 1)}\n`,
    );
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  } finally {
    await servers.stop();
    await scrub(options.out, token, path.join(wrk, 'home'));
  }
  for (const failure of failures) process.stdout.write(`::error title=Dynamic scan::${failure}\n`);
  process.stdout.write(`Report: ${path.join(options.out, 'report.md')}${failures.length > 0 ? ` (${failures.length} problems)` : ''}\n`);
  if (failures.length > 0) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
