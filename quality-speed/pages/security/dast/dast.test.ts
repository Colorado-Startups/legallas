// SPDX-License-Identifier: Apache-2.0
// The automated dynamic scan's pure parts: the API definitions, the ZAP plan, findings and triage, coverage and the
// report. run.ts needs Docker and a seeded room, so it runs only in the "Dynamic scan" workflow.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { countUrls, mcpCalls, mcpToolCoverage, rpcReply } from './coverage.ts';
import { blocking, countBySeverity, judge, normalizePath, parseZapJson, validateTriage, type Alert, type Triage } from './findings.ts';
import { BODY_EXAMPLES, fillPath, mcpOpenApi, openApiPath, paramValues, pathParams, roomOpenApi, seededNames } from './openapi.ts';
import { JOB_MINUTES, memberWriteHeaders, RULE_MINUTES, SETUP_MINUTES, SPIDER_MINUTES, TOKEN_VAR, worstCaseMinutes, zapPlan } from './plan.ts';
import { renderReport, type RunInfo } from './report.ts';
import { serverArgs, STRANGER_HOST, strangerState, targetNamed, TARGETS, targetOfSite } from './targets.ts';
import { MCP_ADDON, ZAP_IMAGE } from './tools.ts';

const seeded = { document: 'doc-1111', comment: 'cmt-2222', room: 'room-3333' };
type Ops = Record<string, Record<string, { parameters?: { name: string; schema: { example: string } }[]; requestBody?: unknown }>>;

test('routes become OpenAPI paths with each id filled by its kind', () => {
  assert.equal(openApiPath('/api/documents/:id/comments'), '/api/documents/{id}/comments');
  assert.deepEqual(pathParams('/api/rooms/:room/documents/:id'), ['room', 'id']);
  assert.equal(paramValues('/api/comments/:id', seeded).id, 'cmt-2222');
  assert.equal(paramValues('/api/proposals/:id', seeded).id, 'scan', 'no proposal seeded');
  assert.equal(paramValues('/api/doc/:id', seeded).id, 'doc-1111');
  assert.equal(fillPath('/api/rooms/:room/files/:id', paramValues('/api/rooms/:room/files/:id', seeded)), '/api/rooms/room-3333/files/doc-1111');
  const spec = roomOpenApi(
    [
      { method: 'GET', path: '/api/documents/:id/comments' },
      { method: 'POST', path: '/api/documents/:id/comments' },
      { method: 'HEAD', path: '/api/documents' },
      { method: 'PATCH', path: '/api/comments/:id' },
      { method: 'POST', path: '/api/unlisted' },
    ],
    seeded,
  ) as { paths: Ops };
  const comments = spec.paths['/api/documents/{id}/comments']!;
  assert.deepEqual(Object.keys(comments).sort(), ['get', 'post'], 'two methods on one path are one entry');
  assert.equal(comments.get!.parameters![0]!.schema.example, 'doc-1111');
  assert.equal(spec.paths['/api/comments/{id}']!.patch!.parameters![0]!.schema.example, 'cmt-2222');
  assert.equal(spec.paths['/api/documents'], undefined, 'HEAD is left out');
  const body = (comments.post!.requestBody as { content: Record<string, { schema: { example: unknown } }> }).content['application/json']!.schema.example;
  assert.deepEqual(body, BODY_EXAMPLES['POST /api/documents/:id/comments']);
  assert.ok(spec.paths['/api/unlisted']!.post!.requestBody, 'a write with no listed body still gets one');
});

test('the MCP definition carries the registered client and no secret', () => {
  const spec = mcpOpenApi({ clientId: 'client-abc', redirectUri: 'http://127.0.0.1:50000/cb', resource: 'http://localhost:8790/mcp' }) as { paths: Record<string, unknown> };
  for (const at of ['/register', '/token', '/authorize', '/.well-known/oauth-authorization-server', '/connect']) assert.ok(spec.paths[at], at);
  const text = JSON.stringify(spec);
  assert.match(text, /client-abc/);
  assert.match(text, /application\/x-www-form-urlencoded/);
  assert.doesNotMatch(text, /Bearer|access_token"|client_secret"/);
});

test('the four targets are the job\'s own servers and nothing else', () => {
  assert.match(STRANGER_HOST, /\.test$/, 'RFC 2606 reserves .test');
  assert.equal(new Set(TARGETS.map((t) => t.name)).size, 4);
  for (const target of TARGETS) assert.match(target.origin, new RegExp(`^http://(localhost|${STRANGER_HOST.replace('.', '\\.')}):\\d+$`));
  assert.equal(targetOfSite('http://localhost:8789')?.name, 'room-member');
  assert.equal(targetOfSite('http://ANON.test:8792/')?.name, 'mcp-stranger');
  assert.equal(targetOfSite('https://room.example.com'), null);
  assert.equal(targetOfSite('https://localhost:8789')?.name, 'room-member', 'ZAP\'s https probe of the same server');
  assert.equal(targetOfSite('http://localhost:9999'), null);
  assert.equal(targetOfSite('not a url'), null);
  assert.equal(new Set(TARGETS.map((t) => t.port)).size, 4, 'one server per target');
});

test('each server stands for its target\'s host, and strangers get their own empty store', () => {
  const arg = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
  const member = serverArgs(targetNamed('room-member'), '/tmp/room');
  assert.equal(arg(member, '--local-upstream'), 'localhost:8789');
  assert.equal(arg(member, '--ip'), '127.0.0.1');
  assert.ok(!member.includes('--persist-to'), 'the member reads the seeded room');
  assert.ok(!member.includes('-c'));
  const mcp = serverArgs(targetNamed('mcp-stranger'), '/tmp/room');
  assert.equal(arg(mcp, '-c'), 'wrangler.mcp.jsonc');
  assert.equal(arg(mcp, '--local-upstream'), `${STRANGER_HOST}:8792`);
  assert.equal(arg(mcp, '--persist-to'), strangerState('/tmp/room'));
  assert.equal(arg(mcp, '--name'), 'legallas-mcp-stranger');
  const inspectors = TARGETS.map((t) => arg(serverArgs(t, '/tmp/room'), '--inspector-port'));
  assert.equal(new Set(inspectors).size, 4);
});

test('the plan scans only the targets, with the token by reference', () => {
  const openapi = { 'room-member': 'room-openapi.json', 'mcp-stranger': 'mcp-openapi.json' } as const;
  const plan = zapPlan({ targets: TARGETS, openapi, mcpUrl: 'http://localhost:8790/mcp', spiderMinutes: 2, ruleMinutes: 3 }) as {
    env: { contexts: { name: string; includePaths: string[] }[]; parameters: Record<string, unknown> };
    jobs: { type: string; parameters: Record<string, unknown>; rules?: unknown[] }[];
  };
  assert.deepEqual(plan.env.contexts.map((c) => c.name), TARGETS.map((t) => t.name));
  assert.deepEqual(plan.env.contexts[0]!.includePaths, ['http://localhost:8789/.*']);
  assert.deepEqual(plan.env.contexts[1]!.includePaths, ['http://anon\\.test:8791/.*'], 'the dot is escaped');
  // Every URL anywhere in the plan, include patterns unescaped, starts with a target's origin.
  const urls = JSON.stringify(plan).replace(/\\\\/g, '').match(/https?:\/\/[^"\\/]+/g) ?? [];
  assert.ok(urls.length >= 9, 'contexts, imports and the MCP import name URLs');
  const origins = new Set(TARGETS.map((t) => t.origin));
  for (const url of urls) assert.ok(origins.has(url), `${url} is not a target`);
  const of = (type: string) => plan.jobs.filter((job) => job.type === type);
  assert.equal(of('activeScan').length, 4);
  assert.deepEqual(of('spider').map((job) => job.parameters.url), ['http://localhost:8789/', 'http://anon.test:8791/welcome/', 'http://localhost:8790/connect', 'http://anon.test:8792/connect']);
  for (const job of of('activeScan')) assert.ok(Number(job.parameters.maxScanDurationInMins) > 0, 'every active scan has a limit');
  assert.deepEqual(of('openapi').map((job) => job.parameters.context), ['room-member', 'mcp-stranger']);
  const mcp = of('mcp-import')[0]!;
  assert.equal(mcp.parameters.securityKey, `Bearer \${${TOKEN_VAR}}`);
  assert.deepEqual(of('report').map((job) => job.parameters.template), ['traditional-json', 'traditional-html']);
  const types = plan.jobs.map((job) => job.type);
  assert.ok(types.indexOf('mcp-import') < types.indexOf('activeScan'), 'tools are imported before the active scan');
  assert.ok(types.lastIndexOf('passiveScan-wait') < types.indexOf('report'), 'reports wait for the passive scanner');
  assert.equal(of('replacer')[0]!.rules!.length, 2, 'write headers for the member room only');
});

test('only a member of the room gets the same-origin write headers', () => {
  const [member, stranger, mcp] = TARGETS;
  assert.deepEqual(memberWriteHeaders(member!).map((rule) => [rule.matchString, rule.replacementString]), [
    ['Origin', 'http://localhost:8789'],
    ['Sec-Fetch-Site', 'same-origin'],
  ]);
  assert.deepEqual(memberWriteHeaders(stranger!), []);
  assert.deepEqual(memberWriteHeaders(mcp!), []);
});

test('the scanner and its add-on are pinned', () => {
  assert.match(ZAP_IMAGE, /^ghcr\.io\/zaproxy\/zaproxy:[\d.]+@sha256:[0-9a-f]{64}$/);
  assert.match(MCP_ADDON.sha256, /^[0-9a-f]{64}$/);
  assert.ok(MCP_ADDON.url.startsWith('https://github.com/zaproxy/zap-extensions/releases/download/'));
  assert.ok(MCP_ADDON.url.endsWith(`/${MCP_ADDON.file}`));
});

const names = seededNames(seeded);
const zapReport = {
  '@version': '2.17.0',
  site: [
    {
      '@name': 'http://localhost:8789',
      alerts: [
        {
          pluginid: '10038',
          alertRef: '10038-1',
          name: 'Content Security Policy (CSP) Header Not Set',
          riskcode: '2',
          confidence: '3',
          cweid: '693',
          instances: [
            { uri: 'http://localhost:8789/api/doc/doc-1111?x=1', method: 'GET', param: '' },
            { uri: 'http://localhost:8789/_astro/index.Bx1_a.js', method: 'GET', param: '' },
          ],
        },
        { pluginid: '10027', alertRef: '10027', name: 'Information Disclosure - Suspicious Comments', riskcode: '0', confidence: '1', instances: [{ uri: 'http://localhost:8789/_astro/a.js', method: 'GET' }] },
      ],
    },
    { '@name': 'http://anon.test:8791', alerts: [{ pluginid: '40012', alertRef: '40012', name: 'Cross Site Scripting (Reflected)', riskcode: '3', confidence: '2', instances: [{ uri: 'http://anon.test:8791/x', method: 'GET', param: 'q' }] }] },
    { '@name': 'https://elsewhere.example', alerts: [] },
  ],
};

test('ZAP\'s alerts are read with paths put back to routes', () => {
  assert.equal(normalizePath('http://localhost:8789/api/rooms/room-3333/files/doc-1111', names), '/api/rooms/:room/files/:id');
  assert.equal(normalizePath('http://localhost:8789/_astro/page.C0ffee.css', names), '/_astro/*');
  assert.equal(normalizePath('http://localhost:8789/api/doc/abc', names), '/api/doc/abc', 'a short or unknown segment stays');
  const { alerts, foreignSites } = parseZapJson(zapReport, names);
  assert.deepEqual(foreignSites, ['https://elsewhere.example']);
  assert.equal(alerts.length, 3);
  const csp = alerts.find((a) => a.alertRef === '10038-1')!;
  assert.equal(csp.risk, 'Medium');
  assert.equal(csp.confidence, 'High');
  assert.equal(csp.target, 'room-member');
  assert.deepEqual(csp.instances.map((i) => i.path), ['/api/doc/:id', '/_astro/*']);
  assert.equal(alerts.find((a) => a.alertRef === '40012')!.target, 'room-stranger');
});

const triage = (entries: Triage['entries']): Triage => ({ schema: 1, entries });
const reason = 'A reason long enough to say why this is acceptable here.';

test('a finding is accepted only where a judgment covers every place it was seen', () => {
  const { alerts } = parseZapJson(zapReport, names);
  const partial = judge(alerts, triage([{ alert: '10038-1', paths: '^/_astro/', status: 'accepted', reason, decided: '2026-11-05' }]));
  const csp = partial.findings.find((f) => f.alertRef === '10038-1')!;
  assert.equal(csp.status, 'open');
  assert.deepEqual(csp.uncovered, ['GET /api/doc/:id']);
  assert.match(csp.reason, /no judgment covers/);
  const full = judge(alerts, triage([{ alert: '10038-1', status: 'accepted', reason, decided: '2026-11-05', targets: ['room-member'] }]));
  assert.equal(full.findings.find((f) => f.alertRef === '10038-1')!.status, 'accepted');
  const elsewhere = judge(alerts, triage([{ alert: '10038-1', status: 'accepted', reason, decided: '2026-11-05', targets: ['mcp-member'] }]));
  assert.equal(elsewhere.findings.find((f) => f.alertRef === '10038-1')!.status, 'open', 'a judgment for another target does not count');
  assert.equal(elsewhere.notSeen.length, 1);
});

test('a fixed finding seen again is an open regression, and one not seen is listed as fixed', () => {
  const { alerts } = parseZapJson(zapReport, names);
  const fixedEntry = { alert: '40012', status: 'fixed' as const, reason, decided: '2026-11-05', fixedIn: '#700', name: 'Cross Site Scripting (Reflected)', risk: 'High' as const };
  const regressed = judge(alerts, triage([fixedEntry]));
  const xss = regressed.findings.find((f) => f.alertRef === '40012')!;
  assert.equal(xss.status, 'open');
  assert.match(xss.reason, /Regression.*#700/);
  const clean = judge(alerts.filter((a) => a.alertRef !== '40012'), triage([fixedEntry]));
  const fixed = clean.findings.find((f) => f.alertRef === '40012')!;
  assert.equal(fixed.status, 'fixed');
  assert.equal(fixed.target, null, 'a judgment for every target says so');
  const counts = countBySeverity(clean.findings);
  assert.deepEqual(counts.High, { open: 0, accepted: 0, fixed: 1 });
  assert.deepEqual(counts.Medium, { open: 1, accepted: 0, fixed: 0 });
});

test('only open High and Medium findings block', () => {
  const { alerts } = parseZapJson(zapReport, names);
  const judged = judge(alerts, triage([]));
  assert.deepEqual(blocking(judged.findings).map((f) => f.alertRef).sort(), ['10038-1', '40012']);
  assert.deepEqual(judged.findings.map((f) => f.risk), ['High', 'Medium', 'Informational'], 'worst first');
  const quiet: Alert[] = alerts.filter((a) => a.risk === 'Informational');
  assert.deepEqual(blocking(judge(quiet, triage([])).findings), []);
});

test('a judgment needs a reason, a date, and a valid pattern', () => {
  assert.deepEqual(validateTriage({ schema: 1, entries: [{ alert: '10038-1', status: 'accepted', reason, decided: '2026-11-05' }] }).errors, []);
  const bad = validateTriage({
    schema: 1,
    entries: [
      { alert: 'csp', status: 'ignored', reason: 'fine', decided: '5 Nov', paths: '(' },
      { alert: '40012', status: 'fixed', reason, decided: '2026-11-05' },
      { alert: '10038', status: 'accepted', reason, decided: '2026-11-05', targets: ['production'] },
    ],
  }).errors.join('\n');
  for (const want of ['alert reference', 'accepted or fixed', 'at least 30', 'YYYY-MM-DD', 'regular expression', 'fixedIn', 'name is required', 'risk is required', 'target names']) {
    assert.ok(bad.includes(want), want);
  }
  assert.notDeepEqual(validateTriage({ schema: 2, entries: [] }).errors, []);
});

test('the committed triage file passes', () => {
  const file = JSON.parse(readFileSync(path.join(import.meta.dirname, 'triage.json'), 'utf8')) as unknown;
  assert.deepEqual(validateTriage(file).errors, []);
});

test('coverage is read from ZAP\'s exports', () => {
  assert.equal(countUrls(null), null);
  assert.equal(countUrls('http://localhost:8789/\nhttp://localhost:8789/api/me\n\n'), 2);
  assert.deepEqual(rpcReply('event: message\ndata: {"jsonrpc":"2.0","method":"note"}\ndata: {"jsonrpc":"2.0","id":2,"result":{}}\n'), { jsonrpc: '2.0', id: 2, result: {} });
  const entry = (sent: object, reply: object, status = 200) => ({ request: { postData: { text: JSON.stringify(sent) } }, response: { status, content: { text: JSON.stringify(reply) } } });
  const har = {
    log: {
      entries: [
        entry({ method: 'tools/list' }, { id: 1, result: { tools: [{ name: 'search' }, { name: 'read_page' }, { name: 'list' }] } }),
        entry({ method: 'tools/call', params: { name: 'search' } }, { id: 2, result: { content: [] } }),
        entry({ method: 'tools/call', params: { name: 'read_page' } }, { id: 3, result: { isError: true } }),
        entry({ method: 'tools/call', params: { name: 'list' } }, { id: 4, error: { code: -32602 } }),
        { request: {}, response: { status: 200, content: { text: Buffer.from(JSON.stringify({ id: 5, result: { content: [] } })).toString('base64'), encoding: 'base64' } } },
      ],
    },
  };
  assert.deepEqual(mcpCalls(har)?.calls.map((c) => [c.name, c.outcome]), [['search', 'result'], ['read_page', 'tool-error'], ['list', 'rpc-error']]);
  assert.deepEqual(mcpToolCoverage(har), { listed: 3, reached: 2, toolErrors: 1 }, 'a tool error still ran the tool; a JSON-RPC error never did');
  assert.doesNotMatch(JSON.stringify(mcpCalls(har)), /content|isError|code/, 'no argument or result is kept');
  assert.equal(mcpToolCoverage({ log: { entries: [] } }), null, 'no tool list, nothing to claim');
});

test('the report names itself an automated dynamic scan, never a penetration test', () => {
  const { alerts } = parseZapJson(zapReport, names);
  const info: RunInfo = {
    date: '2026-11-05',
    commit: '0123456789abcdef',
    runUrl: 'https://github.com/o/r/actions/runs/1',
    zapVersion: '2.17.0',
    zapImage: ZAP_IMAGE,
    mcpAddon: MCP_ADDON.version,
    zapExit: 0,
    minutes: 40,
    coverage: {
      requests: { 'room-member': 12345, 'room-stranger': 10, 'mcp-member': null },
      roomRoutes: { total: 60, gets: 30, getsOk: 25 },
      strangerRoutes: { tried: 60, refused: 60 },
      mcpTools: { listed: 6, reached: 6, toolErrors: 0 },
    },
  };
  const md = renderReport(info, judge(alerts, triage([])));
  assert.match(md, /^# Automated dynamic scan, 2026-11-05\n/);
  assert.match(md, /It is not a penetration test/);
  assert.equal(md.match(/penetration test/g)?.length, 2, 'only the two sentences that say what it is not');
  assert.match(md, /\| High \| 1 \| 0 \| 0 \|/);
  assert.match(md, /\| \*\*Total\*\* \| \*\*3\*\* \| \*\*0\*\* \| \*\*0\*\* \|/);
  assert.match(md, /12,345/);
  assert.match(md, /MCP server, with a member's AI token \| not recorded/);
  assert.match(md, /\| 25 of 30 \|/);
  assert.match(md, /\[40012\]\(https:\/\/www\.zaproxy\.org\/docs\/alerts\/40012\/\)/);
  assert.doesNotMatch(md, /\u2014/, 'no em dashes');
  assert.doesNotMatch(md, /elsewhere\.example/);
});

test("the plan's worst case and the setup fit the job's limit, and the workflow sets that limit", () => {
  const openapi = { 'room-member': 'room-openapi.json', 'room-stranger': 'room-openapi.json', 'mcp-member': 'mcp-openapi.json', 'mcp-stranger': 'mcp-openapi.json' } as const;
  const plan = zapPlan({ targets: TARGETS, openapi, mcpUrl: 'http://localhost:8790/mcp', spiderMinutes: SPIDER_MINUTES, ruleMinutes: RULE_MINUTES });
  const worst = worstCaseMinutes(plan as { jobs: { type: string; parameters?: Record<string, unknown> }[] });
  assert.equal(worst, 47, '4 spiders of 2, 2 passive waits of 3, active scans of 15, 3, 12 and 3');
  assert.ok(worst + SETUP_MINUTES <= JOB_MINUTES, `${worst} + ${SETUP_MINUTES} minutes over ${JOB_MINUTES}`);
  const workflow = readFileSync(new URL('../../../../.github/workflows/dynamic-scan.yml', import.meta.url), 'utf8');
  assert.deepEqual([...workflow.matchAll(/^\s*timeout-minutes:\s*(\d+)/gm)].map((m) => Number(m[1])), [JOB_MINUTES]);
});
