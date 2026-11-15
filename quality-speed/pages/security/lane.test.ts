// SPDX-License-Identifier: Apache-2.0
// The rule these tests hold: a failed read is no reading, and no reading is `missing`, never a zero.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRecords } from '../../contract/validate.ts';
import { githubList, noEvents, reading, record, runContext } from './lane.ts';

process.env.GITHUB_RUN_ID = '12345';
const context = runContext(new Date('2031-03-20T01:02:03.456Z'));
const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));

test('no value writes missing, and a real zero stays a zero with its proof', () => {
  const none = record(context, 'alerts_critical_high_open', null);
  assert.equal(none.status, 'missing');
  assert.equal(none.value, null, 'never turned into a zero');
  assert.equal(none.source_url, null);
  const zero = record(context, 'alerts_critical_high_open', 0);
  assert.equal(zero.status, 'ok');
  assert.equal(zero.value, 0);
  assert.match(zero.source_url ?? '', /\/actions\/runs\/12345$/);
  assert.equal(zero.measured_at, '2031-03-20T01:02:03Z');
  assert.equal(zero.stage, 'live');
});

test('no events has no value and no samples, and still says which run looked', () => {
  const events = noEvents(context, 'time_to_fix_critical_high_hours');
  assert.equal(events.status, 'no_events');
  assert.equal(events.value, null);
  assert.equal(events.sample_size, 0);
  assert.match(events.source_url ?? '', /\/actions\/runs\/12345$/);
});

test('the records the lanes write pass the contract', () => {
  const records = [record(context, 'alerts_critical_high_open', 0), record(context, 'osv_vulnerabilities_open', null), noEvents(context, 'time_to_fix_medium_low_hours')];
  // A list with no sign-off keeps no records, so this reads as a signed one.
  const checked = validateRecords(records, { ...manifest, signoff_comment: 1 }, new Date('2031-03-21T00:00:00Z'));
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.records.length, 3);
});

const answer = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

function stubFetch(t: TestContext, answers: Response[]): string[] {
  const asked: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    asked.push(url);
    const next = answers.shift();
    if (!next) throw new Error('asked more than expected');
    return next;
  });
  process.env.GH_TOKEN = 'invented';
  return asked;
}

test('a listing follows its pages, and reads a wrapped list by its key', async (t) => {
  const asked = stubFetch(t, [answer({ jobs: [1, 2] }, { headers: { link: '<https://api.github.com/next>; rel="next"' } }), answer({ jobs: [3] })]);
  assert.deepEqual(await githubList<number>('/first', 'jobs'), [1, 2, 3]);
  assert.deepEqual(asked, ['https://api.github.com/first', 'https://api.github.com/next']);
});

test('a refused read throws, so an error can never look like an empty list', async (t) => {
  stubFetch(t, [new Response('{"message":"no"}', { status: 403 })]);
  await assert.rejects(githubList('/refused'), /GitHub answered 403/);
});

test('an answer with no list throws, even with a good status', async (t) => {
  stubFetch(t, [answer({ message: 'no list here' })]);
  await assert.rejects(githubList('/odd', 'jobs'), /no list/);
});

test('a listing longer than expected throws rather than reading part of it', async (t) => {
  stubFetch(t, [answer([1], { headers: { link: '<https://api.github.com/more>; rel="next"' } })]);
  await assert.rejects(githubList('/long', undefined, 1), /longer than expected/);
});

test('no token throws', async () => {
  const saved = process.env.GH_TOKEN;
  delete process.env.GH_TOKEN;
  await assert.rejects(githubList('/any'), /GH_TOKEN/);
  process.env.GH_TOKEN = saved;
});

test('a read that fails gives no reading, and one that succeeds gives its value, even a zero or an empty list', async (t) => {
  t.mock.method(console, 'error', () => {});
  assert.equal(await reading('x', () => { throw new Error('boom'); }), null);
  assert.equal(await reading('x', async () => { throw new Error('boom'); }), null);
  assert.equal(await reading('x', () => 0), 0);
  assert.deepEqual(await reading('x', async () => []), []);
});

