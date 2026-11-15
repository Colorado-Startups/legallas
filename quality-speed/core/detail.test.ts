// SPDX-License-Identifier: Apache-2.0
// What may go from a lane to the site beside the scores. Everything here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { carryDetail, carryFacts, copyPageFiles, isDetail, pageDetail } from './detail.ts';

const GOOD = { checks: { 'answers-cite': 1 }, readings: { find_time: { value: 1.5, limit: 2.5, n: 20 } } };

function lane(detail: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'detail-test-'));
  writeFileSync(path.join(dir, 'detail.json'), typeof detail === 'string' ? detail : JSON.stringify(detail));
  return dir;
}

test('the closed shape passes', () => {
  assert.equal(isDetail(GOOD), true);
  assert.equal(isDetail({ checks: {}, readings: { a: { value: 0, limit: null, n: 0 } } }), true);
});

test('words have no way in', () => {
  const refused = [
    { ...GOOD, title: 'words' },
    { checks: { 'answers cite': 1 }, readings: {} },
    { checks: { 'a-sentence-long-enough-to-say-something-private': 1 }, readings: {} },
    { checks: { a: 'pass' }, readings: {} },
    { checks: { a: 2 }, readings: {} },
    { checks: {}, readings: { a: { value: 'words', limit: null, n: 1 } } },
    { checks: {}, readings: { a: { value: 1, limit: null, n: 1, note: 'words' } } },
    { checks: {}, readings: { a: { value: null, limit: null, n: 1 } } },
    { checks: {}, readings: { a: { value: 1, limit: null, n: -1 } } },
    { checks: {} },
    [],
    null,
  ];
  for (const value of refused) assert.equal(isDetail(value), false, JSON.stringify(value));
});

test('a good lane carries over, and nothing but the three kinds of file leaves it', () => {
  const from = lane(GOOD);
  mkdirSync(path.join(from, 'frames'));
  writeFileSync(path.join(from, 'frames', 'find.webp'), 'pretending to be a picture');
  writeFileSync(path.join(from, 'notes.txt'), 'words');
  const to = path.join(mkdtempSync(path.join(tmpdir(), 'detail-test-')), 'lane');
  carryDetail(from, to);
  assert.deepEqual(readdirSync(to), ['detail.json']);
  rmSync(from, { recursive: true });
});

test('bad detail reads as none', () => {
  const from = lane('not json');
  const to = path.join(mkdtempSync(path.join(tmpdir(), 'detail-test-')), 'lane');
  carryDetail(from, to);
  assert.equal(existsSync(to), false);
  rmSync(from, { recursive: true });
});

test('a page reads its lanes together', () => {
  const state = mkdtempSync(path.join(tmpdir(), 'detail-test-'));
  const first = lane({ checks: { a: 1 }, readings: {} });
  const second = lane({ checks: { b: 0 }, readings: { c: { value: 1, limit: null, n: 1 } } });
  carryDetail(first, path.join(state, 'lanes', 'data-room', 'lab'));
  carryDetail(second, path.join(state, 'lanes', 'data-room', 'live'));
  assert.deepEqual(pageDetail(state, 'data-room'), { checks: { a: 1, b: 0 }, readings: { c: { value: 1, limit: null, n: 1 } } });
  assert.equal(pageDetail(state, 'code'), null);
  rmSync(state, { recursive: true });
  rmSync(first, { recursive: true });
  rmSync(second, { recursive: true });
});

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'detail-test-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

test('page files reach the page folder, but never over a file already there', () => {
  const state = folder({ 'lanes/code/daily/page/law.json': '{"a":1}', 'lanes/code/daily/page/manifest.json': '{"forged":true}' });
  const pages = folder({ 'code/manifest.json': '{"reviewed":true}' });
  copyPageFiles(state, ['code', 'issues'], pages);
  assert.equal(readFileSync(path.join(pages, 'code', 'law.json'), 'utf8'), '{"a":1}');
  assert.equal(readFileSync(path.join(pages, 'code', 'manifest.json'), 'utf8'), '{"reviewed":true}');
});

test('a page file must be plain, valid and small, or it stays behind', () => {
  const from = folder({ 'page/view.json': '{}', 'page/bad.json': 'not json', 'page/script.ts': '1', 'page/UP.json': '{}', 'page/big.json': `"${'x'.repeat(1024 * 1024)}"` });
  const to = path.join(folder({}), 'lane');
  carryDetail(from, to);
  assert.deepEqual(readdirSync(path.join(to, 'page')), ['view.json']);
});

test('facts carry over for the next run, unless too big or not plain files', () => {
  const from = folder({ 'facts/lag-cache.json': '{}', 'facts/deep/a.txt': 'x' });
  const to = path.join(folder({}), 'lane');
  carryFacts(from, to);
  assert.equal(existsSync(path.join(to, 'facts', 'deep', 'a.txt')), true);
  const big = folder({ 'facts/big.bin': 'x'.repeat(2 * 1024 * 1024 + 1) });
  const bigTo = path.join(folder({}), 'lane');
  carryFacts(big, bigTo);
  assert.equal(existsSync(bigTo), false);
  const linked = folder({ 'facts/a.txt': 'x' });
  symlinkSync('/etc/hosts', path.join(linked, 'facts', 'link'));
  const linkedTo = path.join(folder({}), 'lane');
  carryFacts(linked, linkedTo);
  assert.equal(existsSync(linkedTo), false);
});
