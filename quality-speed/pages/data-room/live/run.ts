// SPDX-License-Identifier: Apache-2.0
// Brings the live sample room up to date on Cloudflare: invented data only, on Colorado Startups' own account. It deploys and syncs and
// measures nothing. It does nothing when web/, this folder and the invented record are unchanged since the last deploy.
//
//   node quality-speed/pages/data-room/live/run.ts --out <dir>
//
// Reads CLOUDFLARE_API_TOKEN (the LIVE_ROOM_CLOUDFLARE_TOKEN value) and CLOUDFLARE_ACCOUNT_ID, and SAMPLE_ROOM_TEST_LOGIN_SECRET for the
// test login. Each call below names the token permission it needs, and README.md lists them. Writes <dir>/live-room.json: whether it deployed, and the two addresses. Addresses
// and tokens are never printed. Safe to rerun: every resource is looked up by name before it is made.
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { definedOnly, hostOf, LOGIN_WORKER, MCP_WORKER, mcpWrangler, ROOM_WORKER, roomConfig, roomWrangler, safetyProblems, spendGuardProblems, type RoomAddress } from './settings.ts';
import { CACHE_DIR, installCache } from '../lab/extract-cache.ts';
import { copyManifest, refuseRoomSettings } from '../lab/room.ts';
import { webModule } from '../lab/web.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const WEB_DIR = path.join(REPO_ROOT, 'web');
const API = 'https://api.cloudflare.com/client/v4';
/** A domain reserved for testing: nobody real can have an address there. Access lets only these in. */
const SAMPLE_DOMAIN = 'example.test';
const MEMBERS = [{ email: `founder@${SAMPLE_DOMAIN}`, role: 'owner', name: 'Sample Founder' }, { email: `counsel@${SAMPLE_DOMAIN}`, role: 'counsel', name: 'Sample Counsel' }];
const DATABASE = 'legallas';
const BUCKETS = ['legallas-files', 'legallas-index'];
const KV_TITLE = 'sample-room-mcp-oauth';
const BUCKET_PAGE = 1000;
const AI_SEARCH_PRESS = 'The sample room needs its AI Search instance, made once in the Cloudflare dashboard: AI Search > Create > R2 > bucket legallas-index > name legallas, with reranking and the similarity cache both off. Then rerun.';

const { parseWranglerJsonc } = await webModule<{ parseWranglerJsonc(raw: string): Record<string, unknown> }>('worker/wrangler-config.ts');
const { roomDefines } = await webModule<{ roomDefines(raw: unknown): Record<string, string> }>('scripts/config.ts');
const { errorTail } = await webModule<{ errorTail(stderr: string, stdout: string): string }>('scripts/wrangler.ts');
const { memberSql } = await webModule<{ memberSql(command: { kind: 'add'; email: string; role: string; name: string }): string }>('scripts/member.ts');

export function usage(args: readonly string[]): { out: string } {
  if (args.length === 2 && args[0] === '--out' && args[1]) return { out: path.resolve(args[1]) };
  throw new Error('usage: node run.ts --out <dir>');
}

/**
 * What decides a deploy: the trees of the room's code and of the invented record, so a commit elsewhere changes nothing, and the test
 * login's secret, so replacing it reaches the login on the next run. The hash goes in a deploy message, and a random 256-bit secret
 * can't be found from it.
 */
export function inputsHash(trees: readonly string[], loginSecret: string): string {
  return createHash('sha256').update(`${trees.join('\n')}\n${loginSecret}`).digest('hex').slice(0, 16);
}

export const deployMessage = (hash: string) => `live:${hash}`;

/** Whether the room's latest deployments already carry this hash. */
export function alreadyDeployed(deploymentsJson: string, hash: string): boolean {
  return deploymentsJson.includes(deployMessage(hash));
}

/** The fingerprint a dry run prints, which its --apply must repeat. */
export function fingerprintOf(output: string): string {
  const found = /Plan fingerprint: ([0-9a-f]{12,})/.exec(output)?.[1];
  if (!found) throw new Error('The dry run printed no plan fingerprint');
  return found;
}

/**
 * A stop that only a person's one-time step in Cloudflare clears. It waits on the owner, and nothing is broken, so in Actions it is a
 * warning and the job stays green (#905). Any other error fails the job.
 */
export class PersonStep extends Error {}

/** How a run that threw ends: a person's step is a warning on stdout and exit 0, anything else its message on stderr and exit 1. */
export function stopReport(error: unknown, inActions: boolean): { stream: 'stdout' | 'stderr'; text: string; exitCode: 0 | 1 } {
  const message = error instanceof Error ? error.message : String(error);
  if (!(error instanceof PersonStep)) return { stream: 'stderr', text: `${message}\n`, exitCode: 1 };
  // A workflow command's message escapes %, CR and LF, so a line break can't start a command of its own.
  const escaped = message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return { stream: 'stdout', text: inActions ? `::warning title=Sample room::${escaped}\n` : `${message}\n`, exitCode: 0 };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * What a failed command throws: wrangler's error lines, which it prints above its footer, so the second run (7 Nov) kept only the footer.
 * Never stdout, which can quote what the command was given.
 */
export function commandFailure(command: string, args: readonly string[], stderr: string): Error {
  return new Error(`${command} ${args.slice(0, 2).join(' ')} failed: ${errorTail(stderr, '').split('\n').join(' ').slice(0, 600)}`);
}

/** A deploy that fails on AI Search is the person's step of making the instance; anything else fails the job. */
export function deployStop(error: unknown): unknown {
  return /ai.?search/i.test(error instanceof Error ? error.message : '') ? new PersonStep(AI_SEARCH_PRESS) : error;
}

/** A command in web/. Its output comes back and goes nowhere else, because a wrangler error can quote what it was given. */
function capture(command: string, args: readonly string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, [...args], { cwd: WEB_DIR, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(commandFailure(command, args, String(stderr)));
      else resolve(stdout);
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

const wrangler = (args: readonly string[], input?: string) => capture('npx', ['wrangler', ...args], input);

function shown(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    spawn(command, args, { cwd: WEB_DIR, stdio: 'inherit' }).on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.slice(0, 2).join(' ')} exited ${code}`))));
  });
}

const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
/** The meters in use: their result is assigned or passed on, not just called. */
const METERED = /[=(,]\s*withSpendGuards\(/;

/**
 * Why the spend guard isn't on, if it isn't, read from what this run would deploy: the two routes that reach a billed binding must go through the
 * meters (worker/spend.ts), and each Worker's settings must hold what the guard needs. The owner agreed to this room's cost on the basis that
 * Cloudflare has no hard stop and this guard is the stop, so nothing starts without it.
 */
export async function spendGuardGaps(read: (file: string) => Promise<string>): Promise<string[]> {
  const unmetered = await Promise.all(['worker/routes/ask.ts', 'mcp/server.ts'].map(async (file) => (METERED.test(withoutComments(await read(file))) ? [] : [`${file} doesn't use the metered bindings`])));
  const address: RoomAddress = { subdomain: 'check', team: 'check' };
  const room = roomWrangler(parseWranglerJsonc(await read('wrangler.example.jsonc')), address, { database: 'check', accessAud: 'check' }, {});
  const mcp = mcpWrangler(parseWranglerJsonc(await read('wrangler.mcp.example.jsonc')), address, { database: 'check', kv: 'check' }, {});
  return [...unmetered.flat(), ...spendGuardProblems(room, 'DAILY_QUESTION_CAP', 'ASK_LIMIT'), ...spendGuardProblems(mcp, 'DAILY_TOOL_CAP', 'TOOL_LIMIT')];
}

/** Whether a list reply left rows out. Every list here decides something, and no row may be missed by reading one page. */
export function partOfAList(reply: { result?: unknown; result_info?: { total_count?: number } }): boolean {
  return Array.isArray(reply.result) && (reply.result_info?.total_count ?? 0) > reply.result.length;
}

/** R2's answer until the account has its plan. The first real run met it (7 Nov). */
const R2_NOT_ON = 10042;
export const R2_PRESS = 'R2 is not on for this account. A person turns it on once in the dashboard: R2 Object Storage > Add R2 subscription to my account ($0, billed only past the free monthly amounts). Then rerun.';

/**
 * What a failed call throws. R2 not on yet is a person's step; anything else fails the job, a missing permission (10000) included. The
 * message names the product and the code, never what was sent.
 */
export function cloudflareFailure(method: string, resource: string, status: number, code: number | undefined): Error {
  const product = resource.split('/')[0];
  if (product === 'r2' && code === R2_NOT_ON) return new PersonStep(R2_PRESS);
  return new Error(`Cloudflare ${method} ${product} failed: HTTP ${status}, code ${code ?? 'none'}`);
}

async function cloudflare<T>(method: string, resource: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}/accounts/${required('CLOUDFLARE_ACCOUNT_ID')}/${resource}`, {
    method, headers: { authorization: `Bearer ${required('CLOUDFLARE_API_TOKEN')}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const reply = (await response.json().catch(() => null)) as { success?: boolean; result?: T; result_info?: { total_count?: number }; errors?: { code?: number }[] } | null;
  if (!response.ok || !reply?.success) throw cloudflareFailure(method, resource, response.status, reply?.errors?.[0]?.code);
  if (partOfAList(reply)) throw new Error(`Cloudflare ${method} ${resource.split('/')[0]} returned only part of its list`);
  return reply.result as T;
}

/** The entry of a list that `matches` picks, or a new one made from `body`. */
async function lookupOrCreate<T>(resource: string, matches: (entry: T) => boolean, body: unknown): Promise<T> {
  return (await cloudflare<T[]>('GET', resource)).find(matches) ?? cloudflare<T>('POST', resource.split('?')[0]!, body); // safe: split always returns a first item
}

/** Saves `body` over the entry with its name, or as a new entry. */
async function saveByName<T>(resource: string, body: { name: string }): Promise<T> {
  const found = (await cloudflare<{ id: string; name: string }[]>('GET', resource)).find((entry) => entry.name === body.name);
  return cloudflare<T>(found ? 'PUT' : 'POST', found ? `${resource}/${found.id}` : resource, body);
}

/** Workers Scripts Edit. The account's workers.dev subdomain; a new account has none until one is made. */
async function workersSubdomain(): Promise<string> {
  const current = await cloudflare<{ subdomain?: string }>('GET', 'workers/subdomain').catch((error: Error) => {
    if (/HTTP 404/.test(error.message)) return null;
    throw error;
  });
  if (current?.subdomain) return current.subdomain;
  return (await cloudflare<{ subdomain: string }>('PUT', 'workers/subdomain', { subdomain: `sample-${randomBytes(4).toString('hex')}` })).subdomain;
}

/** Access: Organizations, Identity Providers, and Groups Edit. The team name. Only a person can create the organization. */
async function accessTeam(): Promise<string> {
  // Only "not there" means none: a refused token must say so, not send a person to make something that exists.
  const organization = await cloudflare<{ auth_domain?: string }>('GET', 'access/organizations').catch((error: Error) => {
    if (/HTTP 404/.test(error.message)) return null;
    throw error;
  });
  const team = organization?.auth_domain?.split('.')[0];
  if (!team) throw new PersonStep('This account has no Zero Trust organization. A person creates it once in the dashboard, on the Free plan: Zero Trust > Get started. Then rerun.');
  return team;
}

/**
 * Why this account's room names must be left alone, if they must. They are the names every room uses, and this script adopts what it finds:
 * it would run migrations, add an invented owner, and a sync would read every row missing from the invented folder as a removal. So a member
 * outside the invented domain means a real room, and so do buckets with no database, because this script makes the database first.
 */
export function realRoomProblem(found: { database: boolean; buckets: readonly string[]; members: readonly string[] }): string | null {
  const real = found.members.filter((email) => !email.endsWith(`@${SAMPLE_DOMAIN}`));
  if (real.length > 0) return `The ${DATABASE} database has ${real.length} member(s) outside @${SAMPLE_DOMAIN}, so it looks like a real room. Nothing was changed. Use an account with no room on it.`;
  if (!found.database && found.buckets.length > 0) return `This account has room bucket(s) but no ${DATABASE} database, so they aren't this script's. Nothing was changed. Use an account with no room on it.`;
  return null;
}

/** D1 Edit. Rows through the API, because Wrangler has no settings yet at this point. */
async function d1Rows(id: string, sql: string): Promise<Record<string, unknown>[]> {
  const [first] = await cloudflare<{ results?: Record<string, unknown>[] }[]>('POST', `d1/database/${id}/query`, { sql });
  return first?.results ?? [];
}

/**
 * Workers R2 Storage Edit. Which of the room's buckets exist. This reply is an object, which partOfAList can't read, so it asks for names like
 * these only, on the largest page, and a full page counts as cut short.
 */
async function roomBuckets(): Promise<string[]> {
  const { buckets: list } = await cloudflare<{ buckets: { name: string }[] }>('GET', `r2/buckets?name_contains=${DATABASE}&per_page=${BUCKET_PAGE}`);
  if (list.length >= BUCKET_PAGE) throw new Error('Cloudflare GET r2 returned only part of its list');
  return list.map((bucket) => bucket.name).filter((name) => BUCKETS.includes(name));
}

/** D1 Edit and Workers R2 Storage Edit. Reads only, and stops before anything of a real room is adopted. A database with no members table is new. */
async function refuseRealRoom(): Promise<void> {
  const found = (await cloudflare<{ name: string; uuid: string }[]>('GET', 'd1/database')).find((entry) => entry.name === DATABASE);
  const members = found && (await d1Rows(found.uuid, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'members'")).length > 0
    ? (await d1Rows(found.uuid, 'SELECT email FROM members')).map((row) => String(row.email))
    : [];
  const problem = realRoomProblem({ database: Boolean(found), buckets: await roomBuckets(), members });
  if (problem) throw new Error(problem);
}

/** D1 Edit. */
async function database(): Promise<string> {
  return (await lookupOrCreate<{ name: string; uuid: string }>('d1/database', (entry) => entry.name === DATABASE, { name: DATABASE })).uuid;
}

/** Workers R2 Storage Edit. Private buckets: no public address and no CORS. */
async function buckets(): Promise<void> {
  const existing = await roomBuckets();
  for (const name of BUCKETS) {
    if (!existing.includes(name)) await cloudflare('POST', 'r2/buckets', { name });
  }
}

/** Workers KV Storage Edit. */
async function kvNamespace(): Promise<string> {
  return (await lookupOrCreate<{ id: string; title: string }>('storage/kv/namespaces?per_page=100', (entry) => entry.title === KV_TITLE, { title: KV_TITLE })).id;
}

/** Workers Scripts Edit: the test login Worker and its secrets. A new signing key each deploy, and nothing else depends on the old one. */
async function deployLogin(address: RoomAddress, clientId: string, clientSecret: string): Promise<void> {
  const { privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', privateKey)), kid: randomBytes(8).toString('hex') };
  await wrangler(['deploy', path.join(import.meta.dirname, 'login.ts'), '--name', LOGIN_WORKER, '--compatibility-date', '2026-09-30', '--compatibility-flags', 'nodejs_compat', '--var', `CLIENT_ID:${clientId}`, '--var', `CALLBACK_URL:https://${address.team}.cloudflareaccess.com/cdn-cgi/access/callback`]);
  for (const [name, value] of [['LOGIN_SECRET', required('SAMPLE_ROOM_TEST_LOGIN_SECRET')], ['CLIENT_SECRET', clientSecret], ['SIGNING_JWK', JSON.stringify(jwk)]] as const) {
    await wrangler(['secret', 'put', name, '--name', LOGIN_WORKER], value);
  }
}

export const ACCESS_APP_NAMES = ['Sample room', 'Sample room connector sign-in'];

export interface AccessApp {
  id: string;
  name: string;
  type?: string;
  allowed_idps?: string[];
  domain?: string;
  destinations?: { uri?: string }[];
  policies?: { decision?: string; include?: Record<string, unknown>[] }[];
}

const OUR_ADDRESS = new RegExp(`^(${ROOM_WORKER}|${MCP_WORKER})\\.[^./]+\\.workers\\.dev(/|$)`);

/** Whether an app with one of our names really is ours: a name is only a name, so it must cover nothing but the room's own addresses. */
function isOurApp(app: AccessApp): boolean {
  const addresses = app.destinations?.map((destination) => destination.uri ?? '') ?? (app.domain ? [app.domain] : []);
  return ACCESS_APP_NAMES.includes(app.name) && addresses.length > 0 && addresses.every((address) => OUR_ADDRESS.test(address));
}

/** Apps using our names for other addresses. A run saves over an app by name, so it would overwrite these. */
export function appsUsingOurNames(apps: readonly AccessApp[]): AccessApp[] {
  return apps.filter((app) => ACCESS_APP_NAMES.includes(app.name) && !isOurApp(app));
}

/** Whether a rule admits only a real address or domain, which an invented @example.test address can't match. Any other rule might. */
function namesSomeoneElse(rule: Record<string, unknown>): boolean {
  const named = (rule.email as { email?: unknown } | undefined)?.email ?? (rule.email_domain as { domain?: unknown } | undefined)?.domain;
  return typeof named === 'string' && !/(^|[@.])example\.test$/i.test(named);
}

/**
 * The account's other apps that might accept the test login: every login method allowed, and an allow policy that isn't limited to real
 * addresses and domains. It fails closed, because this is the only stop on an account-wide login: a group, a login method rule, or a
 * policy or app whose rules did not come back all count as open. A bookmark has no sign-in, and a bypass or service policy involves no login.
 */
export function openToTestLogin(apps: readonly AccessApp[]): AccessApp[] {
  return apps.filter((app) => {
    if (isOurApp(app) || app.type === 'bookmark' || (app.allowed_idps?.length ?? 0) > 0) return false;
    if (!app.policies) return true;
    return app.policies.some((policy) => (policy.decision === 'allow' || policy.decision === undefined) && !(policy.include?.length && policy.include.every(namesSomeoneElse)));
  });
}

/** Access: Apps and Policies Edit. Stops before the test login exists or is kept, because a login method is account-wide. */
async function refuseOpenApps(): Promise<void> {
  const apps = await cloudflare<AccessApp[]>('GET', 'access/apps');
  const named = appsUsingOurNames(apps);
  if (named.length > 0) throw new Error(`${named.length} Access app(s) on this account use the sample room's names for other addresses (ids ${named.map((app) => app.id).join(', ')}), and a run would overwrite them. Nothing was changed. Rename them, or use another account.`);
  const open = openToTestLogin(apps);
  if (open.length > 0) throw new Error(`The test login would open ${open.length} other Access app(s) on this account (ids ${open.map((app) => app.id).join(', ')}): each allows every login method and a policy open to anyone, or its policies could not be read. Limit those apps' login methods or policies, then rerun.`);
}

/** Access: Organizations, Identity Providers, and Groups Edit. The test login as a login method. Its id goes on the sample room's apps only. */
async function loginMethod(address: RoomAddress, clientId: string, clientSecret: string): Promise<string> {
  const origin = `https://${hostOf(LOGIN_WORKER, address)}`;
  const body = {
    name: 'Sample room test login', type: 'oidc',
    config: { client_id: clientId, client_secret: clientSecret, auth_url: `${origin}/authorize`, token_url: `${origin}/token`, certs_url: `${origin}/certs`, email_claim_name: 'email', scopes: ['openid', 'email', 'profile'] },
  };
  return (await saveByName<{ id: string }>('access/identity_providers', body)).id;
}

/** Access: Apps and Policies Edit. An app that takes only the test login and only example.test. Returns its AUD. */
async function accessApp(name: string, destinations: readonly string[], loginId: string): Promise<string> {
  const body = {
    name, type: 'self_hosted', session_duration: '24h', allowed_idps: [loginId], auto_redirect_to_identity: true,
    destinations: destinations.map((uri) => ({ type: 'public', uri })), domain: destinations[0],
    policies: [{ name: 'Invented members', decision: 'allow', include: [{ email_domain: { domain: SAMPLE_DOMAIN } }] }],
  };
  return (await saveByName<{ aud: string }>('access/apps', body)).aud;
}

/** D1 Edit and Workers R2 Storage Edit, and Account Analytics Read for the sync's spend check. The whole invented record, through the same steps a real room takes. */
async function syncRecord(root: string, config: string): Promise<void> {
  const source = path.join(root, 'source');
  const inputs = path.join(root, 'inputs');
  const cache = path.join(root, 'cache');
  await capture('node', [path.join(REPO_ROOT, 'quality-speed/pages/data-room/gold/build.ts'), '--room', 'dispute', '--out', source, '--inputs', inputs]);
  await copyManifest(inputs);
  await installCache(CACHE_DIR, cache);
  const dry = await capture('npm', ['run', 'sync', '--', '--summary', '--config', config]);
  await shown('npm', ['run', 'sync', '--', '--apply', '--yes', '--summary', '--expect', fingerprintOf(dry), '--config', config]);
  const index = await capture('node', ['scripts/fts-index.ts']);
  await shown('node', ['scripts/fts-index.ts', '--apply', '--expect', fingerprintOf(index)]);
  const { seedMatter } = await webModule<{ seedMatter(cache: string, config: string, run: (command: string, args: string[]) => Promise<string>, log: (line: string) => void, inputs?: string, target?: 'local' | 'remote'): Promise<string> }>('scripts/matter/dev-seed.ts');
  await seedMatter(cache, config, (command, args) => capture(command, args), (line) => process.stdout.write(`${line}\n`), inputs, 'remote');
}

/** The sync's settings and both Workers' Wrangler settings, written only once they pass the safety and spend checks. Returns the sync settings' path. */
async function writeRoomSettings(root: string, address: RoomAddress, ids: { database: string; kv: string }, roomAud: string): Promise<string> {
  const config = path.join(WEB_DIR, 'room.config.json');
  const example = async (name: string) => parseWranglerJsonc(await readFile(path.join(WEB_DIR, name), 'utf8'));
  const settings = roomConfig(await example('legallas.config.example.json'), address, { source: path.join(root, 'source'), inbox: path.join(root, 'inbox'), cache: path.join(root, 'cache') });
  const define = definedOnly(roomDefines(settings));
  const room = roomWrangler(await example('wrangler.example.jsonc'), address, { database: ids.database, accessAud: roomAud }, define);
  const mcp = mcpWrangler(await example('wrangler.mcp.example.jsonc'), address, ids, define);
  const problems = [...safetyProblems(room, true), ...safetyProblems(mcp, false), ...spendGuardProblems(room, 'DAILY_QUESTION_CAP', 'ASK_LIMIT'), ...spendGuardProblems(mcp, 'DAILY_TOOL_CAP', 'TOOL_LIMIT')];
  if (problems.length > 0) throw new Error(`The room's settings are not safe to deploy: ${problems.join('; ')}`);
  await mkdir(settings.inboxDir as string, { recursive: true, mode: 0o700 });
  await writeFile(config, `${JSON.stringify(settings, null, 2)}\n`);
  await writeFile(path.join(WEB_DIR, 'wrangler.jsonc'), JSON.stringify(room, null, 2));
  await writeFile(path.join(WEB_DIR, 'wrangler.mcp.jsonc'), JSON.stringify(mcp, null, 2));
  return config;
}

async function main(): Promise<void> {
  const { out } = usage(process.argv.slice(2));
  await refuseRoomSettings();
  const gaps = await spendGuardGaps((file) => readFile(path.join(WEB_DIR, file), 'utf8'));
  if (gaps.length > 0) throw new Error(`The spend guard is the only stop on what this room can bill, and it isn't on: ${gaps.join('; ')}`);
  for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'SAMPLE_ROOM_TEST_LOGIN_SECRET']) required(name);
  await mkdir(out, { recursive: true });
  // Reads only, and first: everything after this can change the account. On every run too, even with nothing to deploy, because the login
  // stays on the account and another app can open up at any time. The team comes first for its clearer message on an account with no organization.
  const team = await accessTeam();
  await refuseOpenApps();
  await refuseRealRoom();
  const address: RoomAddress = { subdomain: await workersSubdomain(), team };
  const roomUrl = `https://${hostOf(ROOM_WORKER, address)}`;
  const mcpUrl = `https://${hostOf(MCP_WORKER, address)}`;
  const finish = (deployed: boolean) => writeFile(path.join(out, 'live-room.json'), `${JSON.stringify({ deployed, roomUrl, mcpUrl }, null, 1)}\n`);

  const trees = await capture('git', ['rev-parse', 'HEAD:web', 'HEAD:quality-speed/pages/data-room/gold', 'HEAD:quality-speed/pages/data-room/extract-cache', 'HEAD:quality-speed/pages/data-room/live']);
  const hash = inputsHash(trees.trim().split('\n'), required('SAMPLE_ROOM_TEST_LOGIN_SECRET'));
  const deployments = await wrangler(['deployments', 'list', '--name', ROOM_WORKER, '--json']).catch(() => '');
  if (alreadyDeployed(deployments, hash)) {
    process.stdout.write('The room is up to date: nothing to deploy.\n');
    return finish(false);
  }

  const ids = { database: await database(), kv: await kvNamespace() };
  await buckets();
  // Derived, so a rerun presents Access with the same client it already has. The login secret itself never leaves this run.
  const clientId = 'sample-room';
  const clientSecret = createHash('sha256').update(`client:${required('SAMPLE_ROOM_TEST_LOGIN_SECRET')}`).digest('base64url');
  await deployLogin(address, clientId, clientSecret);
  const loginId = await loginMethod(address, clientId, clientSecret);
  const [roomApp, mcpApp] = ACCESS_APP_NAMES as [string, string];
  const roomAud = await accessApp(roomApp, [hostOf(ROOM_WORKER, address)], loginId);
  const mcpAud = await accessApp(mcpApp, ['authorize', 'connections', 'admin'].map((part) => `${hostOf(MCP_WORKER, address)}/${part}`), loginId);

  const root = await mkdtemp(path.join(tmpdir(), 'sample-room-'));
  const config = await writeRoomSettings(root, address, ids, roomAud);

  await wrangler(['d1', 'migrations', 'apply', DATABASE, '--remote']);
  // The spend guard is the only stop on what this room can bill: without its table, nothing deploys.
  await wrangler(['d1', 'execute', DATABASE, '--remote', '--command', 'SELECT COUNT(*) FROM spend_counters']);
  for (const member of MEMBERS) await wrangler(['d1', 'execute', DATABASE, '--remote', '--command', memberSql({ kind: 'add', ...member })]);
  await syncRecord(root, config);
  await shown('npm', ['run', 'build']);
  const message = ['--message', deployMessage(hash)];
  try {
    await wrangler(['deploy', '-c', 'wrangler.mcp.jsonc', ...message]);
    await wrangler(['secret', 'put', 'ACCESS_AUD', '-c', 'wrangler.mcp.jsonc'], mcpAud);
    await wrangler(['deploy', ...message]);
  } catch (error) {
    throw deployStop(error);
  }
  process.stdout.write('The room is deployed and synced.\n');
  await finish(true);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const { stream, text, exitCode } = stopReport(error, process.env.GITHUB_ACTIONS === 'true');
    process[stream].write(text);
    process.exitCode = exitCode;
  });
}
