// SPDX-License-Identifier: Apache-2.0
// The owner's backup command (backup.ts) with a fake Cloudflare API: its arguments, its checks before a run, and that
// it prints counts and hashes only, whatever a run returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupCommand, checkedConfigs, checkLocations, cloudflareApi, formatError, formatOutput, parseArgs, type Api } from './backup.ts';
import { readWranglerConfig } from '../worker/wrangler-config.ts';

const RUN = '20261105T070000Z-abc12345';
const H = 'a'.repeat(64);
const backupConfig = readWranglerConfig('wrangler.backup', true).config;

test('arguments: a backup by default, a drill, and a restore only with its parts and --yes', () => {
  assert.deepEqual(parseArgs([]), { params: { action: 'backup' }, wait: true });
  assert.deepEqual(parseArgs(['--drill']), { params: { action: 'drill' }, wait: true });
  assert.deepEqual(parseArgs(['--drill', '--run', RUN, '--no-wait']), { params: { action: 'drill', run: RUN }, wait: false });
  assert.deepEqual(parseArgs(['--restore', RUN, '--only', 'files,d1,files', '--yes']), { params: { action: 'restore', run: RUN, only: ['files', 'd1'] }, wait: true });
  for (const bad of [['--restore', RUN, '--only', 'files'], ['--restore', RUN, '--yes'], ['--restore', 'latest', '--only', 'files', '--yes'], ['--only', 'files'], ['--drill', '--only', 'd1'], ['--run', RUN], ['--only', 'everything'], ['--wipe']]) {
    assert.throws(() => parseArgs(bad), /usage|--only/, bad.join(' '));
  }
});

test('a run starts only when wrangler.backup.jsonc exists and passes every rule', () => {
  const read = (base: string) => readWranglerConfig(base as 'wrangler', true);
  assert.throws(() => checkedConfigs(read as never, () => false), /No wrangler.backup.jsonc/);
  const bad = (base: string) => {
    const config = readWranglerConfig(base as 'wrangler', true);
    return base === 'wrangler.backup' ? { ...config, config: { ...config.config, workers_dev: true } } : config;
  };
  assert.throws(() => checkedConfigs(bad as never, () => true), /workers.dev/);
  assert.doesNotThrow(() => checkedConfigs(read as never, () => true));
});

function fakeApi(locations: Record<string, string>, statuses: unknown[]): { api: Api; calls: string[] } {
  const calls: string[] = [];
  const api: Api = async (method, path, body) => {
    calls.push(`${method} ${path}`);
    const bucket = /\/r2\/buckets\/([^/]+)$/.exec(path);
    if (bucket) return { location: locations[decodeURIComponent(bucket[1]!)] };
    if (method === 'POST') {
      assert.deepEqual(body, { params: { action: 'drill' } });
      return { id: 'instance-1' };
    }
    return statuses.shift();
  };
  return { api, calls };
}

test('the backup bucket must sit in another location than the room files', async () => {
  await assert.rejects(checkLocations(fakeApi({ 'legallas-files': 'wnam', 'legallas-backup': 'WNAM' }, []).api, 'acct', backupConfig), /same location/);
  assert.equal(await checkLocations(fakeApi({ 'legallas-files': 'WNAM', 'legallas-backup': 'ENAM' }, []).api, 'acct', backupConfig), 'room files in WNAM, backup in ENAM');
});

const drillOutput = {
  action: 'drill',
  run: RUN,
  ok: true,
  sources: {
    files: { expected: { objects: 8, bytes: 400, pages: 3, hash: H }, restored: { objects: 8, bytes: 400, hash: H }, failed: 0, stray: '0b5c1d2e-0000-4000-8000-000000000001' },
    index: { expected: { objects: 4, bytes: 200, pages: 2, hash: H }, restored: { objects: 4, bytes: 200, hash: H }, failed: 0 },
    law: { expected: { objects: 1, bytes: 12, pages: 1, hash: H }, restored: { objects: 1, bytes: 12, hash: H }, failed: 0 },
  },
  d1: { tables: 20, expectedRows: 30, restoredRows: 30, mismatched: [], derived: 2, expectedHash: H, restoredHash: H },
  seconds: { restore: 12, total: 15 },
  cleanedUp: true,
  note: 'owner@example.test',
};

test('the drill runs in the account, waits, and prints counts and hashes only', async () => {
  const { api, calls } = fakeApi({ 'legallas-files': 'WNAM', 'legallas-backup': 'ENAM' }, [{ status: 'running' }, { status: 'complete', output: drillOutput }]);
  const lines: string[] = [];
  const ok = await backupCommand({ params: { action: 'drill' }, wait: true }, { api, account: 'acct', backup: backupConfig, log: (line) => lines.push(line), pause: async () => undefined });
  assert.equal(ok, true);
  assert.deepEqual(calls.slice(2), ['POST /accounts/acct/workflows/legallas-backup/instances', 'GET /accounts/acct/workflows/legallas-backup/instances/instance-1', 'GET /accounts/acct/workflows/legallas-backup/instances/instance-1']);
  const text = lines.join('\n');
  assert.match(text, /Drill of 20261105T070000Z-abc12345: PASSED/);
  assert.match(text, /files  8\/8 objects, 400\/400 bytes, 0 failed the SHA-256 check; manifest sha256 matches a{64}/);
  assert.match(text, /scratch copies emptied: yes/);
  assert.doesNotMatch(text, /owner@example|0b5c1d2e/);
});

test('whatever a run returns, only numbers, hashes, run ids and table names print', () => {
  const tampered = { ...drillOutput, ok: false, run: '../../etc', d1: { ...drillOutput.d1, mismatched: ['audit_log', 'DOE-000001 board minutes.pdf'], restoredHash: 'not a hash' } };
  const text = formatOutput(tampered).join('\n');
  assert.match(text, /Drill of \?: FAILED/);
  assert.match(text, /differing tables: audit_log, \?/);
  assert.match(text, /sha256 DIFFERS \?/);
  assert.doesNotMatch(text, /DOE-000001|etc/);
  const backup = formatOutput({ action: 'backup', run: RUN, ok: true, seconds: 40, sources: { files: { objects: 8, bytes: 400, copied: 8, copiedBytes: 400, skipped: 0, hash: H } }, d1: { tables: 20, rows: 30, derived: 2, hash: H }, storage: { usedBytes: 1.8e9, capBytes: 9e9 }, pruned: 0 }).join('\n');
  assert.match(backup, /files  8 objects, 400 bytes; 8 new \(400 bytes\)/);
  assert.match(backup, /1\.80 GB of the 9\.00 GB cap/);
});

test("a failed run prints the backup's own reason, never the runtime's text", () => {
  assert.equal(formatError({ status: 'errored', error: { name: 'BackupError', message: 'storage-cap: 12 new objects (900 bytes) would pass the free-tier storage cap' } }), 'The run errored: storage-cap: 12 new objects (900 bytes) would pass the free-tier storage cap');
  assert.match(formatError({ status: 'errored', error: { name: 'Error', message: 'put: key 0b5c1d2e-0000-4000-8000-000000000001 failed' } }), /Cloudflare dashboard/);
  assert.match(formatError({ status: 'errored', error: { name: 'Error', message: 'unknown-code: anything' } }), /Cloudflare dashboard/);
});

test('API failures carry the status and error codes, never the path or token', async () => {
  const fetchImpl = (async (url: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer tok');
    assert.ok(url.startsWith('https://api.cloudflare.com/client/v4/accounts/'));
    return new Response(JSON.stringify({ success: false, errors: [{ code: 10006, message: 'bucket legallas-backup not found' }] }), { status: 404 });
  }) as typeof fetch;
  const api = cloudflareApi(async () => 'tok', fetchImpl);
  await assert.rejects(api('GET', '/accounts/acct/r2/buckets/legallas-backup'), (error: Error) => {
    assert.equal(error.message, 'Cloudflare API GET answered 404 (codes 10006)');
    return true;
  });
});
