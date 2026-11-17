// SPDX-License-Identifier: Apache-2.0
// An internal, AI-assisted run of 25 OWASP WSTG v4.2 checks against the fictional sample room, inside a CI job.
// Not a penetration test. Same servers as run.ts (targets.ts), plus a room that answers as the seeded counsel member,
// so the role checks have a second identity. Fixture data only; every server is `wrangler dev --local` on 127.0.0.1.
//
//   node quality-speed/pages/security/dast/wstg.ts --out <dir> --room <scratch dir>
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, open, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { buildRoom, seedRoom, timed, WEB_DIR } from '../../data-room/lab/room.ts';
import { mcpFlow, webModule, wrangler } from '../../data-room/lab/web.ts';
import { MCP_PORT, serverArgs, strangerState, targetNamed, type Target } from './targets.ts';

const COUNSEL_PORT = 8793;
const COUNSEL_EMAIL = 'dev-counsel@example.test';
const EVIL = 'https://evil.example';

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** One request to 127.0.0.1 with the Host header given. Keeps the first 64 KiB of the body. */
function req(port: number, host: string, method: string, at: string, body?: string | Buffer, extra: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve) => {
    const headers: Record<string, string | number> = { Host: `${host}:${port}`, ...extra };
    if (body !== undefined) {
      if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const r = http.request({ host: '127.0.0.1', port, method, path: at, headers, timeout: 30_000 }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        if (size < 65_536) chunks.push(c);
        size += c.length;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', (e) => resolve({ status: 0, headers: {}, body: String(e) }));
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.end(body);
  });
}

const on = (t: Target) => (method: string, at: string, body?: string | Buffer, extra?: Record<string, string>) => req(t.port, t.host, method, at, body, extra);
const writeHeaders = (origin: string) => ({ Origin: origin, 'Sec-Fetch-Site': 'same-origin' });
const h = (r: Reply, name: string) => String(r.headers[name.toLowerCase()] ?? '');
const STACK = /(\bat [\w.<>]+ \(|\.ts:\d+:\d+|\.js:\d+:\d+|Traceback|SQLITE_|D1_ERROR)/;

function spawnServer(name: string, port: number, args: string[], logs: string): Promise<ChildProcess> {
  return (async () => {
    const log = await open(path.join(logs, `${name}.log`), 'w');
    const child = spawn('npx', args, { cwd: WEB_DIR, stdio: ['ignore', log.fd, log.fd], detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    await log.close();
    const host = args[args.indexOf('--local-upstream') + 1]!.split(':')[0]!;
    for (let s = 0; s < 90; s += 1) {
      if (child.exitCode !== null) throw new Error(`${name} exited ${child.exitCode}: see logs/${name}.log`);
      if ((await req(port, host, 'GET', '/')).status > 0) return child;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`${name} did not answer on ${port}`);
  })();
}

async function first(sql: string): Promise<string | undefined> {
  try {
    const [row] = await wrangler.cliWrangler('local').d1Query(sql);
    const v = row ? Object.values(row)[0] : undefined;
    return v === undefined || v === null ? undefined : String(v);
  } catch {
    return undefined;
  }
}

function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd: WEB_DIR, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    c.on('close', (code) => resolve(code ?? 1));
  });
}

interface Check {
  id: string;
  area: string;
  tried: string;
  pass: boolean;
  evidence: string;
}

async function main(): Promise<void> {
  if (process.env.CI !== 'true') throw new Error('Runs in CI only, never on a laptop.');
  const args = process.argv.slice(2);
  const out = path.resolve(args[args.indexOf('--out') + 1]!);
  const room = path.resolve(args[args.indexOf('--room') + 1]!);
  const logs = path.join(out, 'logs');
  await mkdir(logs, { recursive: true });
  const seconds: Record<string, number> = {};

  const seed = await seedRoom(room, seconds);
  if (seed.status !== 'ok') throw new Error(`seed: ${JSON.stringify(seed)}`);
  await timed(seconds, 'build', buildRoom);
  if ((await run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'legallas', '--local', '--persist-to', strangerState(room)])) !== 0) throw new Error('stranger migrations');

  const owner = targetNamed('room-member');
  const stranger = targetNamed('room-stranger');
  const mcpMember = targetNamed('mcp-member');
  const mcpStranger = targetNamed('mcp-stranger');
  const counsel: Target = { ...owner, name: 'room-member', port: COUNSEL_PORT, origin: `http://localhost:${COUNSEL_PORT}`, label: 'Room, as counsel' };

  const started: ChildProcess[] = [];
  try {
    for (const t of [mcpMember, owner, mcpStranger, stranger]) started.push(await spawnServer(t.name, t.port, serverArgs(t, room), logs));
    started.push(
      await spawnServer(
        'room-counsel',
        COUNSEL_PORT,
        ['wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(COUNSEL_PORT), '--inspector-port', '9240', '--local-upstream', `localhost:${COUNSEL_PORT}`,
          '--show-interactive-dev-session=false', '--name', 'legallas-web-counsel', '--var', `DEV_IDENTITY_EMAIL:${COUNSEL_EMAIL}`],
        logs,
      ),
    );

    const O = on(owner), S = on(stranger), C = on(counsel), M = on(mcpMember), MS = on(mcpStranger);
    const doc = await first('SELECT id FROM documents WHERE removed_at IS NULL ORDER BY control_seq LIMIT 1');
    const meOwner = await O('GET', '/api/me');
    const meCounsel = await C('GET', '/api/me');
    const pre = [`owner /api/me ${meOwner.status}`, `counsel /api/me ${meCounsel.status} role ${/"role":"(\w+)"/.exec(meCounsel.body)?.[1] ?? '?'}`, `seeded document ${doc ? 'found' : 'missing'}`];
    const counselOk = meCounsel.status === 200 && meCounsel.body.includes('"counsel"');

    const checks: Check[] = [];
    const add = (id: string, area: string, tried: string, pass: boolean, evidence: string) => checks.push({ id, area, tried, pass, evidence });

    // ---- Authentication
    const roomMod = await webModule<{ roomRoutes(env: Record<string, string>): readonly { method: string; path: string }[] }>('worker/index.ts');
    const routes = roomMod.roomRoutes({ PROPOSALS_ENABLED: '1', CHECKLIST_ENABLED: '1' });
    let refused = 0;
    const leaks: string[] = [];
    for (const r of routes) {
      const at = r.path.replace(/:[a-z]+/g, doc ?? 'x');
      const got = await S(r.method, at, ['POST', 'PUT', 'PATCH'].includes(r.method) ? '{}' : undefined);
      if (got.status === 403) refused += 1;
      else leaks.push(`${r.method} ${r.path} ${got.status}`);
    }
    add('WSTG-ATHN-04', 'Authentication', 'Every room route, no identity', leaks.length === 0, `${refused}/${routes.length} refused 403${leaks.length ? `; not refused: ${leaks.join(', ')}` : ''}`);

    const forged = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(`{"email":"dev-owner@example.test","aud":["x"],"exp":${Math.floor(Date.now() / 1000) + 3600}}`).toString('base64url')}.`;
    const f1 = await S('GET', '/api/me', undefined, { 'Cf-Access-Jwt-Assertion': forged, Cookie: `CF_Authorization=${forged}` });
    add('WSTG-ATHN-04', 'Authentication', 'Forged unsigned Access JWT (alg none) in header and cookie', f1.status === 403, `/api/me ${f1.status}`);

    const f2 = await S('GET', '/api/me', undefined, { Host: `localhost:${stranger.port}`, 'X-Forwarded-Host': 'localhost', 'X-Forwarded-For': '127.0.0.1' });
    add('WSTG-ATHN-04', 'Authentication', 'Host and X-Forwarded-* spoofed to localhost, to borrow the dev identity', f2.status === 403, `/api/me ${f2.status}`);

    // ---- Authorization
    const trav = ['/files/..%2F..%2Fwrangler.jsonc', '/files/%2e%2e%2f%2e%2e%2fpackage.json', '/api/documents/..%2f..%2f..%2fetc%2fpasswd', '/api/rooms/..%2f..%2f/files/x'];
    const travR = await Promise.all(trav.map((p) => O('GET', p)));
    const travOk = travR.every((r) => r.status >= 400 && r.status < 500 && !/compatibility_date|"dependencies"|root:x:0/.test(r.body));
    add('WSTG-ATHZ-01', 'Authorization', 'Path traversal in file and document ids (encoded ../)', travOk, travR.map((r, i) => `${trav[i]} ${r.status}`).join('; '));

    const a1 = await C('GET', '/api/activity');
    add('WSTG-ATHZ-02', 'Authorization', 'Counsel reads the owner-only activity log', counselOk && a1.status === 403, counselOk ? `/api/activity ${a1.status}` : `not run: ${pre[1]}`);

    const a2 = await C('PUT', '/api/checklist/company', '{"company":"x"}', writeHeaders(counsel.origin));
    add('WSTG-ATHZ-03', 'Authorization', 'Counsel calls an owner-only write (set company)', counselOk && a2.status === 403, counselOk ? `PUT /api/checklist/company ${a2.status}` : `not run: ${pre[1]}`);

    const ids = [randomUUID(), '1', '0', '-1'];
    const idor = await Promise.all(ids.flatMap((id) => [O('GET', `/files/${id}`), O('GET', `/api/documents/${id}`)]));
    add('WSTG-ATHZ-04', 'Authorization', 'Guessed and sequential document ids', idor.every((r) => r.status === 404 || r.status === 400), idor.map((r) => r.status).join(', '));

    // ---- API (MCP server and its OAuth)
    const rpc = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}';
    const n1 = await MS('POST', '/mcp', rpc, { Accept: 'application/json, text/event-stream' });
    add('WSTG-ATHN-04', 'API', 'MCP tools/list with no token', n1.status === 401, `${n1.status}; WWW-Authenticate ${h(n1, 'www-authenticate') ? 'present' : 'absent'}`);
    const n2 = await MS('POST', '/mcp', rpc, { Accept: 'application/json, text/event-stream', Authorization: `Bearer ${forged}` });
    const n3 = await MS('POST', '/mcp', rpc, { Accept: 'application/json, text/event-stream', Authorization: 'Bearer x:y:z' });
    add('WSTG-ATHN-04', 'API', 'MCP tools/list with forged and malformed bearer tokens', n2.status === 401 && n3.status === 401, `${n2.status}, ${n3.status}`);

    const report = new mcpFlow.Report();
    const grant = (await mcpFlow.localGrant(report, fetch, `http://localhost:${MCP_PORT}`, await mcpFlow.localOptions())) as
      | { accessToken: string; client: { clientId: string }; redirectUri: string; resource: string }
      | null;
    if (grant) process.stdout.write(`::add-mask::${grant.accessToken}\n`);
    const ok = grant ? await M('POST', '/mcp', rpc, { Accept: 'application/json, text/event-stream', Authorization: `Bearer ${grant.accessToken}` }) : null;
    pre.push(`member MCP grant ${grant ? 'made' : 'failed'}; tools/list with it ${ok?.status ?? 'not run'}`);

    if (grant) {
      const q = new URLSearchParams({ response_type: 'code', client_id: grant.client.clientId, redirect_uri: `${EVIL}/cb`, code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256', resource: grant.resource, state: 's' });
      const z1 = await M('GET', `/authorize?${q}`);
      add('WSTG-ATHZ-05', 'API', 'OAuth authorize with an unregistered redirect_uri', z1.status >= 400 && !h(z1, 'location').startsWith(EVIL), `${z1.status}; Location ${h(z1, 'location') ? h(z1, 'location').slice(0, 40) : 'none'}`);
    } else add('WSTG-ATHZ-05', 'API', 'OAuth authorize with an unregistered redirect_uri', false, 'not run: no grant');

    const reg = await M('POST', '/register', JSON.stringify({ client_name: 'x', redirect_uris: [`${EVIL}/cb`], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] }));
    const reg2 = await M('POST', '/register', JSON.stringify({ client_name: 'x', redirect_uris: ['javascript:alert(1)'], token_endpoint_auth_method: 'none' }));
    add('WSTG-ATHZ-05', 'API', 'Dynamic client registration with an outside and a javascript: redirect', reg.status >= 400 && reg2.status >= 400, `${reg.status}, ${reg2.status}`);

    const tok = await M('POST', '/token', new URLSearchParams({ grant_type: 'authorization_code', code: 'bogus', client_id: grant?.client.clientId ?? 'x', redirect_uri: grant?.redirectUri ?? 'http://localhost/cb', code_verifier: 'x'.repeat(43) }).toString(), { 'Content-Type': 'application/x-www-form-urlencoded' });
    add('WSTG-ATHZ-05', 'API', 'Token exchange with a made-up code', tok.status >= 400 && !tok.body.includes('access_token'), `${tok.status}`);

    // ---- Session
    const pages = await Promise.all(['/connections', '/admin/clients'].map((p) => M('GET', p)));
    const cookies = pages.flatMap((r) => ([] as string[]).concat(r.headers['set-cookie'] ?? []));
    const flags = cookies.map((c) => `${c.split('=')[0]}: ${['HttpOnly', 'SameSite', 'Secure'].filter((f) => new RegExp(f, 'i').test(c)).join('+') || 'none'}`);
    add('WSTG-SESS-02', 'Session', 'Cookie attributes on the MCP server\'s form pages', cookies.length > 0 && cookies.every((c) => /HttpOnly/i.test(c) && /SameSite=(Strict|Lax)/i.test(c)), flags.join('; ') || 'no cookie set');

    const cs1 = doc ? await O('POST', `/api/documents/${doc}/key`, '{"key":true}', { Origin: EVIL, 'Sec-Fetch-Site': 'cross-site' }) : null;
    const cs2 = doc ? await O('POST', `/api/documents/${doc}/key`, '{"key":true}', { 'Sec-Fetch-Site': 'cross-site' }) : null;
    const cs3 = doc ? await O('POST', `/api/documents/${doc}/key`, 'key=true', { ...writeHeaders(owner.origin), 'Content-Type': 'application/x-www-form-urlencoded' }) : null;
    add('WSTG-SESS-05', 'Session', 'Cross-site write: outside Origin; no Origin with Sec-Fetch-Site cross-site; form-encoded body', !!doc && [cs1, cs2, cs3].every((r) => r!.status >= 400), doc ? `${cs1!.status}, ${cs2!.status}, ${cs3!.status}` : 'not run');

    const before = doc ? await O('POST', `/api/documents/${doc}/key`, '{"key":true}', writeHeaders(owner.origin)) : null;
    pre.push(`owner same-origin write (control) ${before?.status ?? 'not run'}`);

    // ---- Input validation
    const xss = '<script>alert(1)</script>';
    const r1 = await S('GET', `/welcome/?q=${encodeURIComponent(xss)}&next=${encodeURIComponent(`"><svg onload=alert(1)>`)}`);
    const r2 = await O('GET', `/api/nope?q=${encodeURIComponent(xss)}`);
    add('WSTG-INPV-01', 'Input validation', 'Reflected script in query strings, public page and API', !r1.body.includes(xss) && !r1.body.includes('<svg onload') && !r2.body.includes(xss), `/welcome/ ${r1.status} reflected ${r1.body.includes(xss) ? 'yes' : 'no'}; /api/nope ${r2.status} ${h(r2, 'content-type').split(';')[0]}`);

    const payload = '<img src=x onerror=alert(1)>';
    const sc = doc ? await O('POST', `/api/documents/${doc}/comments`, JSON.stringify({ body: payload }), writeHeaders(owner.origin)) : null;
    const back = doc ? await O('GET', `/api/documents/${doc}/comments`) : null;
    const stored = !!back && back.body.includes('onerror');
    const safe = !!back && /application\/json/.test(h(back, 'content-type')) && h(back, 'x-content-type-options') === 'nosniff' && /default-src 'none'/.test(h(back, 'content-security-policy'));
    add('WSTG-INPV-02', 'Input validation', 'Stored script in a comment, read back', safe, doc ? `save ${sc!.status}; read ${back!.status} ${h(back!, 'content-type').split(';')[0]}, nosniff, CSP default-src 'none'; stored as data ${stored ? 'yes' : 'no'}` : 'not run');

    const sqli = ["/api/documents/'%20OR%20'1'%3D'1", "/api/rooms/x'%20OR%201%3D1--/documents", "/api/litigation/as-of?at='%20OR%201%3D1--", "/api/proposals?view='%20UNION%20SELECT%20sqlite_version()--", '/api/documents/1;DROP%20TABLE%20documents'];
    const sq = await Promise.all(sqli.map((p) => O('GET', p)));
    const still = await O('GET', '/api/documents');
    add('WSTG-INPV-05', 'Input validation', 'SQL injection in path ids and query values', sq.every((r) => r.status < 500 && !STACK.test(r.body) && !/sqlite_version|\d+\.\d+\.\d+"?\]/.test(r.body)) && still.status === 200, `${sq.map((r) => r.status).join(', ')}; documents after ${still.status}`);

    const hs = await O('PUT', '/api/uploads', Buffer.from('%PDF-1.4\n'), { ...writeHeaders(owner.origin), 'X-Upload-Name': 'a.pdf%0d%0aSet-Cookie:%20x=1', 'Content-Type': 'application/pdf' });
    add('WSTG-INPV-15', 'Input validation', 'CRLF in the upload file name header', !h(hs, 'set-cookie').includes('x=1') && hs.status >= 400, `${hs.status}; injected header ${h(hs, 'set-cookie').includes('x=1') ? 'yes' : 'no'}`);

    // ---- File upload
    const up = (name: string, body: Buffer | string, type: string) => O('PUT', '/api/uploads', body, { ...writeHeaders(owner.origin), 'X-Upload-Name': encodeURIComponent(name), 'Content-Type': type });
    const u1 = await up('page.html', '<html><script>alert(1)</script></html>', 'text/html');
    const u2 = await up('run.exe', Buffer.from('MZ\x90\x00'), 'application/octet-stream');
    const u3 = await up('icon.svg', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', 'image/svg+xml');
    add('WSTG-BUSL-08', 'File upload', 'Upload of HTML, Windows executable and SVG', [u1, u2, u3].every((r) => r.status === 415 || r.status === 422), `${u1.status}, ${u2.status}, ${u3.status}`);
    const u4 = await up('memo.pdf', '<html><script>alert(1)</script></html>', 'application/pdf');
    const u5 = await up('memo.pdf.html', '%PDF-1.4\n', 'application/pdf');
    add('WSTG-BUSL-09', 'File upload', 'HTML disguised as PDF; double extension', [u4, u5].every((r) => r.status === 415 || r.status === 422), `${u4.status} ${/"error":"(\w+)"/.exec(u4.body)?.[1] ?? ''}, ${u5.status}`);
    // ---- Business logic
    const b1 = doc ? await O('POST', `/api/documents/${doc}/key`, '{"key":"yes","__proto__":{"admin":true}}', writeHeaders(owner.origin)) : null;
    const b2 = doc ? await O('POST', `/api/documents/${doc}/comments`, JSON.stringify({ body: 'x'.repeat(200_000) }), writeHeaders(owner.origin)) : null;
    add('WSTG-BUSL-01', 'Business logic', 'Wrong types, prototype keys and an oversized comment', !!doc && b1!.status === 400 && b2!.status >= 400 && b2!.status < 500, doc ? `key "yes" ${b1!.status}; 200 kB comment ${b2!.status}` : 'not run');

    // ---- Error handling
    const e1 = await O('POST', '/api/ask', '{', writeHeaders(owner.origin));
    const e2 = await O('GET', '/api/does-not-exist');
    const e3 = await M('POST', '/mcp', '{"jsonrpc":', { Accept: 'application/json, text/event-stream', Authorization: `Bearer ${grant?.accessToken ?? 'x'}` });
    add('WSTG-ERRH-01', 'Error handling', 'Malformed JSON, unknown route, broken JSON-RPC', [e1, e2, e3].every((r) => r.status >= 400 && r.status < 500 && !STACK.test(r.body)), `${e1.status}, ${e2.status}, ${e3.status}; stack trace ${[e1, e2, e3].some((r) => STACK.test(r.body)) ? 'yes' : 'none'}`);

    // ---- Crypto
    const hsts = h(meOwner, 'strict-transport-security');
    add('WSTG-CRYP-03', 'Crypto', 'HSTS and no-store on an API answer that names the member', /max-age=(\d{8,})/.test(hsts) && /no-store/.test(h(meOwner, 'cache-control')), `HSTS "${hsts}"; Cache-Control "${h(meOwner, 'cache-control')}"`);

    // ---- Client side
    const page = await O('GET', '/');
    const csp = h(page, 'content-security-policy');
    add('WSTG-CLNT-09', 'Client side', 'Framing of the room by another site', /frame-ancestors 'none'/.test(csp) || /DENY/i.test(h(page, 'x-frame-options')), `frame-ancestors ${/frame-ancestors ([^;]+)/.exec(csp)?.[1] ?? 'unset'}; X-Frame-Options ${h(page, 'x-frame-options') || 'unset'}`);
    const cors = await O('OPTIONS', '/api/me', undefined, { Origin: EVIL, 'Access-Control-Request-Method': 'GET' });
    const cors2 = await O('GET', '/api/me', undefined, { Origin: EVIL });
    add('WSTG-CLNT-07', 'Client side', 'CORS preflight and read from an outside origin', !h(cors, 'access-control-allow-origin') && !h(cors2, 'access-control-allow-origin'), `ACAO ${h(cors, 'access-control-allow-origin') || 'none'} / ${h(cors2, 'access-control-allow-origin') || 'none'}`);

    const commit = (process.env.SCAN_COMMIT || process.env.GITHUB_SHA || 'unknown').slice(0, 12);
    const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';
    const lines = [
      `# Internal WSTG run, ${new Date().toISOString().slice(0, 10)}`,
      '',
      'Internal, AI-assisted assessment; not a third-party penetration test. Fictional sample room, served inside the CI job on 127.0.0.1.',
      '',
      `| Code | Run | Checks | Pass | Fail |`,
      '|---|---|---|---|---|',
      `| \`${commit}\` | ${runUrl} | ${checks.length} | ${checks.filter((c) => c.pass).length} | ${checks.filter((c) => !c.pass).length} |`,
      '',
      `Preconditions: ${pre.join('; ')}.`,
      '',
      '| # | WSTG | Area | Tried | Result | Evidence |',
      '|---|---|---|---|---|---|',
      ...checks.map((c, i) => `| ${i + 1} | ${c.id} | ${c.area} | ${c.tried} | ${c.pass ? 'Pass' : 'Fail'} | ${c.evidence.replace(/\|/g, '\\|')} |`),
      '',
    ];
    await writeFile(path.join(out, 'wstg.md'), lines.join('\n'));
    await writeFile(path.join(out, 'wstg.json'), `${JSON.stringify({ commit, runUrl, preconditions: pre, checks }, null, 1)}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
    process.stdout.write(lines.join('\n'));
  } finally {
    for (const c of started) if (c.pid !== undefined && c.exitCode === null) process.kill(-c.pid, 'SIGTERM');
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exitCode = 1;
});
