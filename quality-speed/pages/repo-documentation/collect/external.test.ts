// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deadReading, demoteBlockedHosts, isOwnRepo, isPlaceholder, pageOf, verdictOf } from './external.ts';

test('only a definite answer counts: alive, dead, or unverified', () => {
  assert.equal(verdictOf(200, null), 'alive');
  assert.equal(verdictOf(301, null), 'alive');
  assert.equal(verdictOf(404, null), 'dead');
  assert.equal(verdictOf(410, null), 'dead');
  assert.equal(verdictOf(403, null), 'unverified');
  assert.equal(verdictOf(429, null), 'unverified');
  assert.equal(verdictOf(503, null), 'unverified');
  assert.equal(verdictOf(null, 'getaddrinfo ENOTFOUND gone.example'), 'dead');
  assert.equal(verdictOf(null, 'TimeoutError'), 'unverified');
});

test('one fetch per page; this organization\'s private repositories are left out', () => {
  assert.equal(pageOf('https://example.com/a#b'), 'https://example.com/a');
  assert.equal(isOwnRepo('https://github.com/Colorado-Startups/legallas/issues'), true);
  assert.equal(isOwnRepo('https://github.com/orgs/Colorado-Startups/projects/1'), true);
  assert.equal(isOwnRepo('https://github.com/other/repo'), false);
  assert.equal(isPlaceholder('https://mcp.room.example.com/connect'), true);
  assert.equal(isPlaceholder('https://a.example.test/x'), true);
  assert.equal(isPlaceholder('https://www.sec.gov/'), false);
});

test('a host whose home page is not alive cannot prove a page dead', () => {
  const results = [
    { url: 'https://blocked.example/a', verdict: 'dead' as const, status: 404 },
    { url: 'https://fine.example/b', verdict: 'dead' as const, status: 404 },
    { url: 'https://fine.example/c', verdict: 'alive' as const, status: 200 },
  ];
  const out = demoteBlockedHosts(results, new Map([['blocked.example', false], ['fine.example', true]]));
  assert.deepEqual(out.map((r) => r.verdict), ['unverified', 'dead', 'alive']);
});

test('a host that no longer resolves stays dead: only an HTTP 404 or 410 can be a refusal', () => {
  const results = [
    { url: 'https://gone.example/a', verdict: 'dead' as const, status: null },
    { url: 'https://blocked.example/b', verdict: 'dead' as const, status: 404 },
  ];
  const out = demoteBlockedHosts(results, new Map([['gone.example', false], ['blocked.example', false]]));
  assert.deepEqual(out.map((r) => r.verdict), ['dead', 'unverified']);
});

test('the reading is missing with too few definite answers, or with none alive', () => {
  const alive = { url: 'https://fine.example/', verdict: 'alive' as const, status: 200 };
  const gone = { url: 'https://gone.example/', verdict: 'dead' as const, status: null };
  const unsure = { url: 'https://slow.example/', verdict: 'unverified' as const, status: null };
  assert.deepEqual(deadReading([alive, gone], 0.9), { dead: 1, definite: 2 });
  assert.equal(deadReading([gone, gone], 0.9), null);
  assert.equal(deadReading([alive, unsure], 0.9), null);
  assert.equal(deadReading([], 0.9), null);
});
