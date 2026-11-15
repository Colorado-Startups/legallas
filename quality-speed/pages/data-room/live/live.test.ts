// SPDX-License-Identifier: Apache-2.0
// The parts of the live room that can be proved with no Cloudflare: its settings, when it deploys, and the whole test login, from
// the form to a signed token. Imports node: built-ins only, through ../lab/web.ts, so it runs with no install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, type webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { handle, type LoginEnv } from './login.ts';
import { ACCESS_APP_NAMES, alreadyDeployed, appsUsingOurNames, cloudflareFailure, commandFailure, deployMessage, deployStop, fingerprintOf, inputsHash, openToTestLogin, partOfAList, PersonStep, R2_PRESS, realRoomProblem, spendGuardGaps, stopReport, usage } from './run.ts';
import { definedOnly, hostOf, mcpWrangler, roomConfig, roomWrangler, safetyProblems, type RoomAddress } from './settings.ts';

const address: RoomAddress = { subdomain: 'sample-abc', team: 'team-x' };
const roomExample = {
  name: 'legallas-web', main: './worker/room.ts', workers_dev: false, preview_urls: false, routes: [{ pattern: 'room.example.com', custom_domain: true }], send_email: [{ name: 'EMAIL' }],
  vars: { TEAM_DOMAIN: '', ACCESS_AUD: '', ALERTS_ENABLED: '1', LAW_LIBRARY: '1', ASK_VISUALS: '0' },
  d1_databases: [{ binding: 'DB', database_id: 'REPLACE' }], r2_buckets: [{ binding: 'FILES' }, { binding: 'LAW' }], ai_search: [{ binding: 'SEARCH' }, { binding: 'LAW_SEARCH' }], services: [{ binding: 'MCP_GRANTS', service: 'legallas-mcp' }],
};

test('the room is on a neutral workers.dev address, with no route, mail or law library', () => {
  const config = roomWrangler(roomExample, address, { database: 'db1', accessAud: 'aud1' }, { ROOM_HOST: '"x"' });
  assert.equal(config.name, 'sample-room');
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false, 'preview addresses would skip the Access app');
  assert.equal('routes' in config, false);
  assert.equal('send_email' in config, false);
  assert.deepEqual((config.ai_search as object[]), [{ binding: 'SEARCH' }]);
  assert.deepEqual((config.r2_buckets as object[]), [{ binding: 'FILES' }]);
  assert.deepEqual((config.services as object[]), [{ binding: 'MCP_GRANTS', service: 'sample-room-mcp' }]);
  assert.deepEqual(config.vars, { TEAM_DOMAIN: 'https://team-x.cloudflareaccess.com', ACCESS_AUD: 'aud1', ALERTS_ENABLED: '0', LAW_LIBRARY: '0', ASK_VISUALS: '0' });
  assert.equal(JSON.stringify(config).includes('legallas-web'), false, 'no product name in a public address');
});

test('the connector takes its database and namespace, and keeps ACCESS_AUD out of its vars', () => {
  const example = { name: 'legallas-mcp', routes: [], send_email: [], vars: { TEAM_DOMAIN: '' }, d1_databases: [{ binding: 'DB' }], r2_buckets: [], ai_search: [], kv_namespaces: [{ binding: 'OAUTH_KV', id: 'REPLACE' }] };
  const config = mcpWrangler(example, address, { database: 'db1', kv: 'kv1' }, {});
  assert.equal(config.name, 'sample-room-mcp');
  assert.deepEqual(config.kv_namespaces, [{ binding: 'OAUTH_KV', id: 'kv1' }]);
  assert.equal(JSON.stringify(config.vars).includes('ACCESS_AUD'), false);
});

test('the room config names the same hosts the settings do', () => {
  const config = roomConfig({ banner: 'From the example', host: 'room.example.com' }, address, { source: '/s', inbox: '/i', cache: '/c' });
  assert.equal(config.banner, 'From the example');
  assert.equal(config.host, hostOf('sample-room', address));
  assert.equal(config.host, 'sample-room.sample-abc.workers.dev');
  assert.equal(config.accessHost, 'team-x.cloudflareaccess.com');
});

test('a setting left unset is not written as a define', () => {
  assert.deepEqual(definedOnly({ ROOM_HOST: '"x"', ROOM_OWNER_NAME: 'undefined' }), { ROOM_HOST: '"x"' });
});

test('settings with a local development switch, or without Access, are refused before anything deploys', () => {
  const safe = roomWrangler(roomExample, address, { database: 'db1', accessAud: 'aud1' }, {});
  assert.deepEqual(safetyProblems(safe, true), []);
  assert.match(safetyProblems({ ...safe, vars: { ...(safe.vars as object), ASK_MOCK: '1' } }, true).join(), /ASK_MOCK/);
  assert.match(safetyProblems({ ...safe, vars: { ...(safe.vars as object), ACCESS_AUD: '' } }, true).join(), /no Access audience/);
  assert.deepEqual(safetyProblems({ ...safe, vars: { ...(safe.vars as object), ACCESS_AUD: '' } }, false), [], 'the connector keeps its audience in a secret');
  assert.match(safetyProblems({ ...safe, vars: { ...(safe.vars as object), TEAM_DOMAIN: '' } }, true).join(), /no Access team/);
  assert.match(safetyProblems({ ...safe, preview_urls: true }, true).join(), /preview addresses/);
});

test('a deploy is decided by the inputs and the login secret alone', () => {
  const hash = inputsHash(['tree-a', 'tree-b'], 'secret');
  assert.equal(hash, inputsHash(['tree-a', 'tree-b'], 'secret'));
  assert.notEqual(hash, inputsHash(['tree-a', 'tree-c'], 'secret'));
  assert.notEqual(hash, inputsHash(['tree-a', 'tree-b'], 'replaced'), 'a replaced login secret has to reach the login');
  assert.equal(alreadyDeployed(`[{"annotations":{"workers/message":"${deployMessage(hash)}"}}]`, hash), true);
  assert.equal(alreadyDeployed('[]', hash), false);
  assert.equal(fingerprintOf('x\nPlan fingerprint: abcdef012345\n'), 'abcdef012345');
  assert.throws(() => fingerprintOf('nothing'), /no plan fingerprint/);
  assert.throws(() => usage([]), /usage/);
});

test('the run stops on any other app the account-wide test login could open', () => {
  const everyone = { decision: 'allow', include: [{ everyone: {} }] };
  const people = { decision: 'allow', include: [{ email: { email: 'someone@example.com' } }] };
  const open = (app: object) => openToTestLogin([{ id: 'a', name: 'Other', ...app }]).length === 1;
  assert.equal(open({ policies: [everyone] }), true, 'every login method and open to anyone');
  assert.equal(open({ allowed_idps: [], policies: [everyone] }), true, 'an empty list allows every login method');
  assert.equal(open({}), true, 'policies that did not come back cannot be shown safe');
  assert.equal(open({ policies: [people] }), false, 'a policy naming real people would refuse an invented address');
  assert.equal(open({ allowed_idps: ['idp1'], policies: [everyone] }), false, 'it names its own login methods');
  assert.equal(open({ policies: [{ decision: 'bypass', include: [{ everyone: {} }] }] }), false, 'a bypass involves no login');
  assert.equal(open({ type: 'bookmark' }), false, 'a bookmark has no sign-in');
  const allow = (...include: object[]) => ({ policies: [{ decision: 'allow', include }] });
  assert.equal(open(allow({ email_domain: { domain: 'real.example.com' } })), false, 'a real domain refuses an invented address');
  assert.equal(open(allow({ email_domain: { domain: 'example.test' } })), true, 'the invented domain is the test login\'s own');
  assert.equal(open(allow({ email: { email: 'founder@example.test' } })), true, 'so is an invented address');
  assert.equal(open(allow({ login_method: { id: 'idp' } })), true, 'a login method rule admits anyone who signs in with it');
  assert.equal(open(allow({ group: { id: 'g' } })), true, 'a group can\'t be shown safe from here');
  assert.equal(open(allow({ email: { email: 'someone@example.com' } }, { everyone: {} })), true, 'one open rule is enough');
  assert.equal(open(allow()), true, 'no rules can\'t be shown safe');
  assert.equal(open({ policies: [{ id: 'reusable' }] }), true, 'a reusable policy whose rules did not come back can\'t be shown safe');
  const ours = (name: string, uri: string) => ({ id: 'a', name, destinations: [{ uri }] });
  for (const name of ACCESS_APP_NAMES) assert.equal(openToTestLogin([ours(name, 'sample-room.sample-abc.workers.dev')]).length, 0, 'our own apps are not the question');
  assert.equal(openToTestLogin([{ id: 'a', name: ACCESS_APP_NAMES[0]!, destinations: [{ uri: 'app.example.com' }], policies: [everyone] }]).length, 1, 'a name alone does not make an app ours');
});

test('an app using our name for another address stops the run, because a run saves over apps by name', () => {
  const [room, connector] = ACCESS_APP_NAMES as [string, string];
  const app = (name: string, ...uris: string[]) => ({ id: 'a', name, destinations: uris.map((uri) => ({ uri })) });
  assert.deepEqual(appsUsingOurNames([app(room, 'sample-room.sample-abc.workers.dev')]), []);
  assert.deepEqual(appsUsingOurNames([app(connector, 'sample-room-mcp.sample-abc.workers.dev/authorize', 'sample-room-mcp.sample-abc.workers.dev/admin')]), []);
  assert.deepEqual(appsUsingOurNames([{ id: 'a', name: room, domain: 'sample-room.sample-abc.workers.dev' }]), [], 'the older field is read too');
  assert.deepEqual(appsUsingOurNames([app('Other', 'app.example.com')]), [], 'any other name is the open-apps check\'s to read');
  for (const other of [app(room, 'app.example.com'), app(room, 'sample-room.sample-abc.workers.dev', 'app.example.com'), app(room, 'sample-room.evil.example.com'), app(room)]) {
    assert.equal(appsUsingOurNames([other]).length, 1, JSON.stringify(other.destinations));
  }
});

test('the run starts only with the spend guard on, in the code and settings it would deploy', async () => {
  const web = path.resolve(import.meta.dirname, '..', '..', '..', '..', 'web');
  const real = (file: string) => readFile(path.join(web, file), 'utf8');
  assert.deepEqual(await spendGuardGaps(real), [], 'the guard is on in this checkout');
  const changed = (file: string, from: string | RegExp, to: string) => spendGuardGaps(async (name) => (name === file ? (await real(name)).replace(from, to) : real(name)));
  assert.deepEqual(await changed('worker/routes/ask.ts', /withSpendGuards\(/g, 'unmetered('), ["worker/routes/ask.ts doesn't use the metered bindings"]);
  assert.deepEqual(await changed('mcp/server.ts', /withSpendGuards\(/g, 'unmetered('), ["mcp/server.ts doesn't use the metered bindings"]);
  assert.deepEqual(await changed('wrangler.example.jsonc', /"DAILY_QUESTION_CAP": "\d+"/, '"DAILY_QUESTION_CAP": "0"'), ['no DAILY_QUESTION_CAP']);
  assert.deepEqual(await changed('wrangler.mcp.example.jsonc', /"DAILY_TOOL_CAP": "\d+",?/, ''), ['no DAILY_TOOL_CAP']);
  assert.deepEqual(await changed('wrangler.example.jsonc', /"limits": \{ "cpu_ms": \d+ \},?/, ''), ['no CPU limit']);
  assert.deepEqual(await changed('wrangler.example.jsonc', /"ratelimits": \[[^\]]*\],?/, ''), ['no ASK_LIMIT rate limit']);
  assert.deepEqual(await changed('wrangler.mcp.example.jsonc', /"name": "TOOL_LIMIT"/, '"name": "OTHER_LIMIT"'), ['no TOOL_LIMIT rate limit'], 'another limit is no stop on tool calls');
  assert.deepEqual(await changed('worker/routes/ask.ts', /^.*withSpendGuards\(.*$/gm, '// withSpendGuards(env)'), ["worker/routes/ask.ts doesn't use the metered bindings"], 'a call in a comment meters nothing');
  assert.deepEqual(await changed('worker/routes/ask.ts', /=\s*withSpendGuards\(/, '= c.env; withSpendGuards('), ["worker/routes/ask.ts doesn't use the metered bindings"], 'a result thrown away meters nothing');
});

test('the run leaves a real room alone: it shares these names', () => {
  const none = { database: false, buckets: [], members: [] };
  assert.equal(realRoomProblem(none), null, 'a new account');
  assert.equal(realRoomProblem({ ...none, database: true }), null, 'a database with no members yet');
  assert.equal(realRoomProblem({ database: true, buckets: ['legallas-files'], members: ['founder@example.test', 'counsel@example.test'] }), null, 'the sample room itself');
  assert.match(realRoomProblem({ database: true, buckets: [], members: ['founder@example.test', 'someone@example.com'] }) ?? '', /1 member/);
  assert.match(realRoomProblem({ database: true, buckets: [], members: ['someone@example.test.evil.com'] }) ?? '', /1 member/);
  assert.match(realRoomProblem({ ...none, buckets: ['legallas-files'] }) ?? '', /bucket/, 'buckets with no database were not made by this script');
});

test('a list Cloudflare cut short is refused, so a later page can\'t hide an open app', () => {
  assert.equal(partOfAList({ result: [1, 2], result_info: { total_count: 3 } }), true);
  assert.equal(partOfAList({ result: [1, 2], result_info: { total_count: 2 } }), false);
  assert.equal(partOfAList({ result: [1, 2] }), false);
  assert.equal(partOfAList({ result: { subdomain: 'x' }, result_info: { total_count: 3 } }), false, 'only a list can be cut short');
});

test('a stop that waits on a person\'s step is a warning and exit 0; any other error fails the job', () => {
  const step = new PersonStep('Zero Trust > Get started. 100% free\nthen rerun');
  assert.deepEqual(stopReport(step, true), { stream: 'stdout', text: '::warning title=Sample room::Zero Trust > Get started. 100%25 free%0Athen rerun\n', exitCode: 0 }, 'escaped, so a line break starts no command');
  assert.deepEqual(stopReport(step, false), { stream: 'stdout', text: 'Zero Trust > Get started. 100% free\nthen rerun\n', exitCode: 0 });
  assert.deepEqual(stopReport(new Error('Cloudflare GET d1 failed: HTTP 403, code 10000'), true), { stream: 'stderr', text: 'Cloudflare GET d1 failed: HTTP 403, code 10000\n', exitCode: 1 });
  assert.equal(stopReport('not an error', true).exitCode, 1);
});

test('a failed deploy keeps wrangler\'s error above its footer, so a missing AI Search instance is a person\'s step', () => {
  const footer = ['', '  If you think this is a bug, please open an issue at: https://github.com/cloudflare/workers-sdk/issues/new/choose', '', '🪵  Logs were written to "/home/runner/.config/.wrangler/logs/wrangler.log"', ''];
  const stderr = (reason: string) => ['✘ [ERROR] A request to the Cloudflare API (/accounts/0/workers/scripts/legallas-mcp) failed.', '', `  ${reason}`, ...footer].join('\n');
  const deploy = ['wrangler', 'deploy', '-c', 'wrangler.mcp.jsonc'];
  const missing = commandFailure('npx', deploy, stderr('The ai_search binding SEARCH names an instance that does not exist. [code: 10021]'));
  assert.equal(missing.message, 'npx wrangler deploy failed: ✘ [ERROR] A request to the Cloudflare API (<path>) failed. The ai_search binding SEARCH names an instance that does not exist. [code: 10021]');
  const stop = deployStop(missing);
  assert.ok(stop instanceof PersonStep);
  assert.equal(stopReport(stop, true).exitCode, 0);
  const other = commandFailure('npx', deploy, stderr('The script is too large. [code: 10027]'));
  assert.equal(deployStop(other), other, 'any other reason still fails the job');
  assert.doesNotMatch(other.message, /Logs were written|If you think/, 'no footer');
  assert.equal(commandFailure('git', ['rev-parse', 'HEAD:web'], 'one\ntwo\n').message, 'git rev-parse HEAD:web failed: one two', 'with no error line, the last lines');
});

test('R2 not on yet (code 10042) is a person\'s step; a missing permission or any other code still fails', () => {
  const off = cloudflareFailure('GET', 'r2/buckets?name_contains=legallas&per_page=1000', 403, 10042);
  assert.ok(off instanceof PersonStep);
  assert.equal(off.message, R2_PRESS);
  assert.equal(stopReport(off, true).exitCode, 0);
  const denied = cloudflareFailure('GET', 'r2/buckets?name_contains=legallas', 403, 10000);
  assert.ok(!(denied instanceof PersonStep));
  assert.equal(denied.message, 'Cloudflare GET r2 failed: HTTP 403, code 10000', 'names the product, never the query');
  assert.ok(!(cloudflareFailure('GET', 'd1/database', 403, 10042) instanceof PersonStep), 'only R2 answers 10042 for this');
  assert.equal(cloudflareFailure('POST', 'workers/scripts/x', 500, undefined).message, 'Cloudflare POST workers failed: HTTP 500, code none');
});

const WORKFLOW = path.resolve(import.meta.dirname, '..', '..', '..', '..', '.github', 'workflows', 'quality-speed.yml');
/** A job's lines in the workflow, up to the next job. */
const jobOf = (workflow: string, name: string) => workflow.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[\w-]+:\n/)[0] ?? '';
const gateOf = (job: string) => /^ {4}if: (.+)$/m.exec(job)?.[1] ?? '';

test('the live room starts on what a job\'s if can read, never on the environment\'s variables or secrets (#905)', async () => {
  const workflow = await readFile(WORKFLOW, 'utf8');
  const ready = jobOf(workflow, 'live-room-ready');
  const room = jobOf(workflow, 'live-room');
  // CLOUDFLARE_ACCOUNT_ID is the quality-speed environment's: gating on it skipped the job on every run.
  for (const job of [ready, room]) assert.doesNotMatch(gateOf(job), /\b(vars|secrets)\./);
  for (const job of workflow.split(/\n {2}(?=[\w-]+:\n)/)) assert.doesNotMatch(gateOf(job), /vars\.CLOUDFLARE_ACCOUNT_ID/);
  assert.equal(gateOf(room), "needs.live-room-ready.outputs.ready == 'true'");
  assert.match(room, /^ {4}needs: live-room-ready$/m);
  assert.match(ready, /^ {4}environment: quality-speed$/m, 'only a job on the environment can read its names');
});

test('the jobs against the room start on live-room\'s up, and the address never reaches a step\'s env', async () => {
  const workflow = await readFile(WORKFLOW, 'utf8');
  assert.match(jobOf(workflow, 'live-room'), /^ {6}up: \$\{\{ steps\.up\.outputs\.up \}\}$/m);
  assert.equal(gateOf(jobOf(workflow, 'key-job-input')), "needs.live-room-ready.outputs.ready == 'true'");
  const journeys = jobOf(workflow, 'live-journeys');
  assert.equal(gateOf(journeys), "needs.key-job-input.outputs.id != '' && needs.live-room.outputs.up == 'true'");
  // A step's env shows in the log; the step reads live-room.json and masks the address first.
  assert.doesNotMatch(journeys, /SAMPLE_ROOM_URL: /);
  assert.match(journeys, /::add-mask::\$SAMPLE_ROOM_URL/);
});

test('the switch checks every name live-room hands run.ts, as true or false only', async () => {
  const workflow = await readFile(WORKFLOW, 'utf8');
  const handed = [...jobOf(workflow, 'live-room').matchAll(/\$\{\{ ((?:vars|secrets)\.\w+) \}\}/g)].map((m) => m[1]).sort();
  assert.deepEqual(handed, ['secrets.LIVE_ROOM_CLOUDFLARE_TOKEN', 'secrets.SAMPLE_ROOM_TEST_LOGIN_SECRET', 'vars.CLOUDFLARE_ACCOUNT_ID']);
  const ready = jobOf(workflow, 'live-room-ready');
  const checks = /\$\{\{ ((?:vars|secrets)\.\w+) != '' \}\}/g;
  assert.deepEqual([...ready.matchAll(checks)].map((m) => m[1]).sort(), handed);
  assert.doesNotMatch(ready.replace(checks, ''), /\b(vars|secrets)\./, 'no value reaches the switch');
});

async function loginEnv(): Promise<LoginEnv> {
  const { privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    LOGIN_SECRET: 'the-secret', CLIENT_ID: 'sample-room', CLIENT_SECRET: 'client-secret', CALLBACK_URL: 'https://team-x.cloudflareaccess.com/cdn-cgi/access/callback',
    SIGNING_JWK: JSON.stringify({ ...(await crypto.subtle.exportKey('jwk', privateKey)), kid: 'k1' }),
  };
}

const NOW = 1_800_000_000;
const signIn = (env: LoginEnv, fields: Record<string, string>) => handle(new Request('https://login.test/authorize', { method: 'POST', body: new URLSearchParams(fields) }), env, NOW);
const good = (env: LoginEnv) => ({ email: 'founder@example.test', secret: 'the-secret', redirect_uri: env.CALLBACK_URL, state: 's1', nonce: 'n1' });
const trade = (env: LoginEnv, code: string, secret = 'client-secret', now = NOW) => handle(new Request('https://login.test/token', { method: 'POST', body: new URLSearchParams({ client_id: 'sample-room', client_secret: secret, code }) }), env, now);

test('the test login goes from the form to a token Access can verify, carrying the email the room requires', async () => {
  const env = await loginEnv();
  const page = await handle(new Request('https://login.test/authorize?redirect_uri=x&state=s1&nonce=n1'), env, NOW);
  assert.match(await page.text(), /data-test-email/);
  const back = await signIn(env, good(env));
  assert.equal(back.status, 302);
  const location = new URL(back.headers.get('location')!);
  assert.equal(location.origin + location.pathname, env.CALLBACK_URL);
  assert.equal(location.searchParams.get('state'), 's1');
  const reply = (await (await trade(env, location.searchParams.get('code')!)).json()) as { id_token: string };
  const [head, payload, signature] = reply.id_token.split('.') as [string, string, string];
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  assert.equal(claims.email, 'founder@example.test');
  assert.equal(claims.aud, 'sample-room');
  assert.equal(claims.nonce, 'n1');
  const { keys } = (await (await handle(new Request('https://login.test/certs'), env, NOW)).json()) as { keys: webcrypto.JsonWebKey[] };
  assert.equal(keys[0]!.d, undefined, 'the private half never leaves');
  const key = await crypto.subtle.importKey('jwk', keys[0]!, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${head}.${payload}`)));
});

test('the test login refuses a wrong secret, a real-looking address and a return address of anyone else', async () => {
  const env = await loginEnv();
  for (const change of [{ secret: 'wrong' }, { email: 'someone@example.com' }, { email: 'a@example.test.evil.com' }, { redirect_uri: 'https://evil.example/cb' }]) {
    assert.equal((await signIn(env, { ...good(env), ...change })).status, 403, JSON.stringify(change));
  }
});

test('a code is refused with the wrong client secret, when altered, or once expired', async () => {
  const env = await loginEnv();
  const code = new URL((await signIn(env, good(env))).headers.get('location')!).searchParams.get('code')!;
  assert.equal((await trade(env, code, 'wrong')).status, 401);
  assert.equal((await trade(env, `${code}x`)).status, 400);
  assert.equal((await trade(env, code, 'client-secret', NOW + 3600)).status, 400);
  assert.equal((await trade(env, code)).status, 200);
});

test('a body that isn\'t a form gets the same refusal as a wrong one', async () => {
  const env = await loginEnv();
  const post = (route: string) => handle(new Request(`https://login.test${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }), env, NOW);
  assert.equal((await post('/authorize')).status, 403);
  assert.equal((await post('/token')).status, 401);
});

test('a signed code that holds no claims is refused like any other bad code', async () => {
  const env = await loginEnv();
  const body = Buffer.from('not json').toString('base64url');
  const signature = createHmac('sha256', env.CLIENT_SECRET).update(body).digest('base64url');
  assert.equal((await trade(env, `${body}.${signature}`)).status, 400);
});
