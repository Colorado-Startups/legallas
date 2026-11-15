// SPDX-License-Identifier: Apache-2.0
// Known-SSN hashes and `npm run pii -- --add-hash`, against scratch configs under the system temp directory only.
// The numbers are synthetic (area 666 is never issued) and joined at run time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addKnownHash, nineDigitsOf, parsePiiArgs } from './pii-cli.ts';
import { DEFAULT_SCRYPT, hashNine, hashNineAsync, KnownSsnHashes, loadKnownHashes, parsePiiHashes, withHash } from './pii-hash.ts';
import { findPii } from './pii.ts';

const SECRET = ['666', '12', '3456'].join('');
const OTHER = ['666', '98', '7654'].join('');
const SALT = Buffer.alloc(16, 7);
const BASE = { sourceRoot: '/scratch/source', inboxDir: '/scratch/inbox', cacheDir: '/scratch/cache', banner: 'x' };
const CLI = path.join(import.meta.dirname, 'pii-cli.ts');

async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'legallas-pii-'));
}

test('piiHashes: absent is null; a malformed key is an error, never ignored', () => {
  assert.equal(parsePiiHashes(BASE), null);
  const good = { salt: SALT.toString('base64'), ...DEFAULT_SCRYPT, hashes: [] };
  assert.deepEqual(parsePiiHashes({ piiHashes: good }), good);
  const bad = [
    'nope',
    { ...good, salt: Buffer.alloc(8).toString('base64') },
    { ...good, N: 3000 },
    { ...good, N: 1024 },
    { ...good, r: 0 },
    { ...good, hashes: ['abc'] },
    { ...good, hashes: 'x' },
  ];
  for (const piiHashes of bad) assert.throws(() => parsePiiHashes({ piiHashes }), /piiHashes/, JSON.stringify(piiHashes));
});

test('withHash: a fresh salt and the default cost, other keys kept, the same number added once', async () => {
  const first = withHash(BASE, SECRET, SALT);
  assert.equal(first.added, true);
  const config = parsePiiHashes(first.config);
  assert.ok(config);
  assert.deepEqual({ ...first.config, piiHashes: undefined }, { ...BASE, piiHashes: undefined });
  assert.equal(config.salt, SALT.toString('base64'));
  assert.deepEqual([config.N, config.r, config.p, config.keylen], [DEFAULT_SCRYPT.N, DEFAULT_SCRYPT.r, DEFAULT_SCRYPT.p, DEFAULT_SCRYPT.keylen]);
  assert.deepEqual(config.hashes, [hashNine(SECRET, config)]);
  assert.equal(await hashNineAsync(SECRET, config), config.hashes[0]);
  assert.equal(JSON.stringify(first.config).includes(SECRET), false, 'the digits are never stored');
  assert.equal(withHash(first.config, SECRET).added, false);
  const second = withHash(first.config, OTHER, Buffer.alloc(16, 9));
  assert.equal(parsePiiHashes(second.config)?.salt, config.salt, 'one salt per config');
  assert.equal(parsePiiHashes(second.config)?.hashes.length, 2);
  assert.throws(() => hashNine('12345678', config), /nine digits/);
});

test('KnownSsnHashes: finds the number in any grouping and hashes each distinct run once', async () => {
  const config = parsePiiHashes(withHash(BASE, SECRET, SALT).config);
  assert.ok(config);
  const known = new KnownSsnHashes(config);
  const text = `${SECRET}; ${['66', '6123456'].join('-')}; ${SECRET.split('').join(' ')}; ${['666', '12', '3456'].join('\n')}; ${OTHER}`;
  const hits = await findPii(text, known);
  assert.equal(hits.filter((hit) => hit.rule === 'known-hash').length, 4);
  assert.equal(known.matchesSync(SECRET), true);
  assert.equal(known.matchesSync(OTHER), false);
  const hashedBefore = known.hashed;
  await findPii(text, known);
  assert.equal(known.hashed, hashedBefore, 'a second pass is served from the cache');
  assert.equal(known.size, 1);
});

test('loadKnownHashes: null without hashes, a matcher with them', async () => {
  const dir = await scratch();
  try {
    const file = path.join(dir, 'legallas.config.json');
    await writeFile(file, JSON.stringify(BASE));
    assert.equal(await loadKnownHashes(file), null);
    await writeFile(file, JSON.stringify(withHash(BASE, SECRET, SALT).config));
    assert.equal((await loadKnownHashes(file))?.matchesSync(SECRET), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the CLI takes --add-hash and an optional --config; typed separators are dropped', () => {
  assert.throws(() => parsePiiArgs([]), /usage/);
  assert.throws(() => parsePiiArgs(['--add-hash', '--remove']), /usage/);
  assert.equal(parsePiiArgs(['--add-hash', '--config', '/scratch/c.json']).config, '/scratch/c.json');
  assert.equal(nineDigitsOf(` ${['666', '12', '3456'].join('-')}\n`), SECRET);
  for (const typed of ['12345678', '1234567890', 'abc']) {
    assert.throws(() => nineDigitsOf(typed), (error: Error) => /nine digits/.test(error.message) && !error.message.includes(typed));
  }
});

test('addKnownHash writes through a worktree symlink, keeps it, and sets mode 600', async () => {
  const dir = await scratch();
  try {
    const real = path.join(dir, 'real.json');
    const link = path.join(dir, 'legallas.config.json');
    await writeFile(real, JSON.stringify(BASE), { mode: 0o644 });
    await symlink(real, link);
    assert.deepEqual(await addKnownHash(link, SECRET), { added: true, count: 1 });
    assert.deepEqual(await addKnownHash(link, SECRET), { added: false, count: 1 });
    assert.ok((await lstat(link)).isSymbolicLink());
    assert.equal(await readlink(link), real);
    assert.equal((await stat(real)).mode & 0o777, 0o600);
    const text = await readFile(real, 'utf8');
    assert.equal(text.includes(SECRET), false);
    assert.equal(JSON.parse(text).banner, 'x');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function runCli(args: string[], input: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [CLI, ...args], { encoding: 'utf8' }, (error, stdout, stderr) =>
      resolve({ code: error ? Number(error.code ?? 1) : 0, out: `${stdout}${stderr}` }));
    child.stdin?.end(input);
  });
}

test('npm run pii -- --add-hash: a piped number is hashed, never printed or stored', async () => {
  const dir = await scratch();
  try {
    const file = path.join(dir, 'legallas.config.json');
    await writeFile(file, JSON.stringify(BASE));
    const added = await runCli(['--add-hash', '--config', file], `${['666', '12', '3456'].join('-')}\n`);
    assert.equal(added.code, 0, added.out);
    assert.match(added.out, /Added a known-SSN hash/);
    const again = await runCli(['--add-hash', '--config', file], SECRET);
    assert.match(again.out, /already/);
    const short = await runCli(['--add-hash', '--config', file], '12345678');
    assert.equal(short.code, 1);
    for (const run of [added, again, short]) assert.equal(/\d{4}/.test(run.out.replace(file, '')), false, 'no digits echoed');
    const config = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(config.piiHashes.hashes.length, 1);
    assert.equal(JSON.stringify(config).includes(SECRET), false);
    assert.equal((await loadKnownHashes(file))?.matchesSync(SECRET), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('KnownSsnHashes: the fingerprint follows the list, not its length (#275)', () => {
  const config = parsePiiHashes(withHash(BASE, SECRET, SALT).config);
  assert.ok(config);
  const same = new KnownSsnHashes({ ...config, hashes: [...config.hashes] });
  const edited = new KnownSsnHashes({ ...config, hashes: config.hashes.map((hash) => hash.replace(/^./, (c) => (c === 'a' ? 'b' : 'a'))) });
  assert.equal(new KnownSsnHashes(config).fingerprint, same.fingerprint);
  assert.equal(edited.size, same.size);
  assert.notEqual(edited.fingerprint, same.fingerprint);
});
