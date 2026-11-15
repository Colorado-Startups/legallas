// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pullCounselUploads, quarantineValue, sanitizeFilename, setQuarantine } from './pull.ts';
import { PENDING_PULLS_SQL } from './sqlplan.ts';
import type { Wrangler } from './wrangler.ts';

// The quarantine xattr is macOS only; on Linux (CI) the test records the call instead.
const MAC = process.platform === 'darwin';

test('sanitizeFilename strips separators, "..", controls, bidi tricks and leading dots', () => {
  const s = (name: string) => sanitizeFilename(name, new Set());
  assert.equal(s('../../etc/passwd'), 'etc_passwd');
  assert.equal(s('..\\..\\Windows\\evil.exe'), 'Windows_evil.exe');
  assert.equal(s('a/b:c.pdf'), 'a_b_c.pdf');
  assert.equal(s('.hidden'), 'hidden');
  assert.equal(s('...'), 'upload');
  assert.equal(s('memo\u0000\u0007\u001b.pdf'), 'memo.pdf');
  assert.equal(s('invoice‮fdp.exe'), 'invoicefdp.exe');
  assert.equal(s('trailing dots...'), 'trailing dots');
  assert.equal(s('Résumé.pdf'), 'Résumé.pdf');
  assert.equal(s(''), 'upload');
});

test('sanitizeFilename keeps the extension when truncating long names', () => {
  const name = sanitizeFilename(`${'é'.repeat(300)}.pdf`, new Set());
  assert.ok(new TextEncoder().encode(name).length <= 200);
  assert.ok(name.endsWith('.pdf'));
});

test('sanitizeFilename de-duplicates case-insensitively', () => {
  const taken = new Set(['memo.pdf']);
  assert.equal(sanitizeFilename('Memo.pdf', taken), 'Memo (2).pdf');
  assert.equal(sanitizeFilename('MEMO.pdf', taken), 'MEMO (3).pdf');
  assert.equal(sanitizeFilename('notes', taken), 'notes');
  assert.equal(sanitizeFilename('notes', taken), 'notes (2)');
});

test('quarantine values follow the flags;time;agent;uuid format', () => {
  assert.match(quarantineValue(0x5f000000 * 1000, 'abc-def'), /^0081;5f000000;Legallas sync;ABC-DEF$/);
});

function fakeWrangler(rows: Record<string, unknown>[], bodies: Record<string, string>, calls: string[]): Wrangler {
  return {
    target: 'local',
    async d1Query(sql) {
      calls.push(`query ${sql === PENDING_PULLS_SQL ? 'pending' : sql}`);
      return rows;
    },
    async d1File() {},
    async r2Put() {},
    async r2Get(bucket, key, file) {
      calls.push(`get ${bucket}/${key}`);
      if (!(key in bodies)) throw new Error('missing object');
      await writeFile(file, bodies[key]);
    },
    async r2Delete() {},
    async aiSearchJobsAvailable() {
      return false;
    },
    async aiSearchJobCreate() {},
  };
}

test('pulls land in the inbox with safe unique names, quarantine set, never overwriting', async () => {
  const inbox = await mkdtemp(path.join(tmpdir(), 'legallas-inbox-'));
  try {
    await writeFile(path.join(inbox, 'memo.pdf'), 'already here');
    const rows = [
      { id: 'c1', name: 'memo.pdf', r2_key: 'k1' },
      { id: 'c2', name: '../../escape.txt', r2_key: 'k2' },
      { id: 'c3', name: 'lost.pdf', r2_key: 'k3' },
    ];
    const calls: string[] = [];
    const log: string[] = [];
    let quarantined = 0;
    const quarantine = MAC ? setQuarantine : async () => void (quarantined += 1);
    const result = await pullCounselUploads(fakeWrangler(rows, { k1: 'new memo', k2: 'escaped?' }, calls), inbox, '2026-09-30T00:00:00Z', (l) => log.push(l), quarantine);
    assert.deepEqual([result.pulled, result.failed], [2, 1]);
    assert.deepEqual((await readdir(inbox)).sort(), ['escape.txt', 'memo (2).pdf', 'memo.pdf']);
    assert.equal(await readFile(path.join(inbox, 'memo.pdf'), 'utf8'), 'already here');
    assert.equal(await readFile(path.join(inbox, 'memo (2).pdf'), 'utf8'), 'new memo');
    if (MAC) {
      const xattr = execFileSync('/usr/bin/xattr', ['-p', 'com.apple.quarantine', path.join(inbox, 'escape.txt')], { encoding: 'utf8' });
      assert.match(xattr, /^0081;[0-9a-f]+;Legallas sync;/);
    } else {
      assert.equal(quarantined, 2);
    }
    assert.match(result.sql, /'c1'/);
    assert.match(result.sql, /'c2'/);
    assert.doesNotMatch(result.sql, /'c3'/);
    assert.equal(log.length, 1);
    assert.equal(log[0].includes('lost.pdf'), false, 'failure logs never name the file');
  } finally {
    await rm(inbox, { recursive: true, force: true });
  }
});

test('no pending uploads means no inbox writes and no SQL', async () => {
  const inbox = path.join(tmpdir(), `legallas-never-created-${process.pid}`);
  const result = await pullCounselUploads(fakeWrangler([], {}, []), inbox, 'now', () => {});
  assert.deepEqual(result, { pulled: 0, failed: 0, sql: '' });
  await assert.rejects(readdir(inbox));
});
