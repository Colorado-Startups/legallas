// SPDX-License-Identifier: Apache-2.0
// What a failed wrangler run turns into in sync's error message. Fixtures follow wrangler 4's real
// output layout (banner, progress line, red ERROR block, bug-report footer, log file pointer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { accountId, assertKey, errorTail, matterPutArgs, r2PutMatter, wranglerCommand, wranglerToken } from './wrangler.ts';

const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const BUG_FOOTER =
  `${RESET}If you think this is a bug then please create an issue at ` +
  'https://github.com/cloudflare/workers-sdk/issues/new/choose';
const LOG_LINE = '🪵  Logs were written to "/Users/example/Library/Preferences/.wrangler/logs/wrangler-2026-10-01_12-00-00_000.log"';
const BANNER = ['', ' ⛅️ wrangler 4.145.0', '───────────────────', 'Resource location: local', ''].join('\n');

test('errorTail: the local R2 500 shows the emulator error, not the progress line and footer', () => {
  const stdout = `${BANNER}\nCreating object "0f8e2b1c-3d4a-4b5c-9d6e-7f8091a2b3c4" in bucket "legallas-files".\n`;
  const stderr = [
    `${RED}✘ ${RESET}[ERROR] R2 error response does not contain the CF-R2-Error header.; response.statusCode = 500`,
    '',
    `  put: Unspecified error (0)${RESET}`,
    '',
    '',
    BUG_FOOTER,
    LOG_LINE,
  ].join('\n');
  assert.equal(
    errorTail(stderr, stdout),
    '✘ [ERROR] R2 error response does not contain the CF-R2-Error header.; response.statusCode = 500\n' +
      'put: Unspecified error (0)',
  );
});

test('errorTail: finds the useful line even when it is far from the end', () => {
  const stderr = [`${RED}✘ ${RESET}[ERROR] A request to the Cloudflare API failed. [code: 10007]`, BUG_FOOTER, LOG_LINE].join('\n');
  const stdout = [BANNER, 'Resource location: remote', 'Retrying 1 of 3', 'Retrying 2 of 3', 'Retrying 3 of 3', 'Giving up'].join('\n');
  const tail = errorTail(stderr, stdout);
  assert.equal(tail, '✘ [ERROR] A request to the Cloudflare API failed. [code: 10007]');
});

test('errorTail: keeps the API\'s reason under the headline, which has a code but no error word', () => {
  const stderr = [
    `${RED}✘ ${RESET}[ERROR] A request to the Cloudflare API (/accounts/0/workers/scripts/legallas-mcp) failed.`,
    '',
    '  Binding SEARCH names an instance that does not exist. [code: 10021]',
    '',
    BUG_FOOTER,
    LOG_LINE,
  ].join('\n');
  assert.equal(
    errorTail(stderr, ''),
    '✘ [ERROR] A request to the Cloudflare API (<path>) failed.\nBinding SEARCH names an instance that does not exist. [code: 10021]',
  );
});

test('errorTail: with no error-looking line, the last non-blank lines without the footer', () => {
  const stdout = [BANNER, 'step one', 'step two', '', 'step three', 'step four', 'step five', '', BUG_FOOTER].join('\n');
  assert.equal(errorTail('', stdout), 'step two\nstep three\nstep four\nstep five');
});

test('errorTail: keeps at most four error lines, headline first, and drops repeats', () => {
  const stderr = ['✘ [ERROR] first', '✘ [ERROR] first', 'error two', 'error three', 'error four', 'error five'].join('\n');
  assert.equal(errorTail(stderr, ''), '✘ [ERROR] first\nerror two\nerror three\nerror four');
});

test('errorTail: never carries local paths, bug-report prompts or very long lines', () => {
  const stderr = [
    "✘ [ERROR] ENOENT: no such file or directory, open '/Users/example/Library/Caches/legallas/snapshots/dummy-exhibit.pdf'",
    '✘ [ERROR] Could not read ~/legallas/dummy.sql',
    `✘ [ERROR] near "x": syntax error ${'y'.repeat(1000)}`,
    '? Would you like to report this error to Cloudflare? › (Y/n)',
    LOG_LINE,
  ].join('\n');
  const tail = errorTail(stderr, '');
  assert.doesNotMatch(tail, /Users|dummy-exhibit|dummy\.sql|Library|report this error/);
  assert.match(tail, /open '<path>'/);
  assert.match(tail, /Could not read <path>/);
  assert.ok(tail.split('\n').every((line) => line.length <= 240));
  // Bucket/key pairs and URLs are not local paths.
  const keyLine = 'put failed for legallas-index/text/0f8e2b1c-3d4a-4b5c-9d6e-7f8091a2b3c4.p1.md, see https://developers.cloudflare.com/r2/';
  assert.equal(errorTail(keyLine, ''), keyLine);
});

// Captured from wrangler 4.145.0 run through npx (paths replaced with dummies): the red ERROR badge uses
// background colors, and npx first echoes the whole command on stderr.
const ERROR_BADGE = '\x1b[31m✘ \x1b[41;31m[\x1b[41;97mERROR\x1b[41;31m]\x1b[0m \x1b[1m';

test('wranglerCommand runs the installed CLI when there is one, and npx when not', () => {
  const [installed, args] = wranglerCommand(['d1', 'list'], 'linux', true);
  assert.ok(installed.endsWith(path.join('node_modules', '.bin', 'wrangler')));
  assert.deepEqual(args, ['d1', 'list']);
  assert.deepEqual(wranglerCommand(['d1', 'list'], 'linux', false), ['npx', ['wrangler', 'd1', 'list']]);
});

test('errorTail: real npx output keeps the ERROR line and drops the echoed command', () => {
  const missing = '/Users/example/Library/Caches/legallas/dummy-exhibit.pdf';
  const stderr = [
    'npm notice run legallas-web@0.1.0 npx',
    `npm notice run 'wrangler' r2 object put legallas-files/00000000-0000-4000-8000-000000000000 --file ${missing} --local`,
    `${ERROR_BADGE}The file "${missing}" does not exist.${RESET}`,
    '',
    '',
    LOG_LINE,
  ].join('\n');
  assert.equal(errorTail(stderr, `${BANNER}\nUse --remote if you want to access the remote instance.\n`), '✘ [ERROR] The file "<path>" does not exist.');

  // A command whose own text has an error-looking word must still not be echoed back.
  const query = "npm notice run 'wrangler' d1 execute legallas --local --json --command SELECT id FROM jobs WHERE state = 'failed'";
  assert.equal(errorTail(`${query}\n`, 'step one\nstep two'), 'step one\nstep two');
  assert.equal(errorTail('npm error could not determine executable to run', ''), 'npm error could not determine executable to run');
});

test('matterPutArgs: the manifest goes only to legallas-files at meta/matter.json, never to legallas-index', () => {
  const file = '/Users/example/Library/Caches/legallas-sync/matter/build/matter.json';
  assert.deepEqual(matterPutArgs('remote', file), [
    'r2', 'object', 'put', 'legallas-files/meta/matter.json', '--file', file, '--content-type', 'application/json', '--remote',
  ]);
  assert.equal(matterPutArgs('local', file).at(-1), '--local');
  assert.ok(!matterPutArgs('remote', file).some((arg) => arg.includes('legallas-index')));
  assert.throws(() => matterPutArgs('remote', 'matter.json'), /built matter\.json/);
  assert.throws(() => matterPutArgs('remote', '/tmp/other.json'), /built matter\.json/);
  assert.throws(() => matterPutArgs('production' as 'remote', file), /unknown wrangler target/);
  // Sync's key check stays UUID-only: the manifest key cannot ride the generic r2Put.
  assert.throws(() => assertKey('meta/matter.json'), /did not generate/);
});

test('r2PutMatter: runs exactly the checked put', async () => {
  const calls: string[][] = [];
  await r2PutMatter('local', '/x/matter/build/matter.json', async (args) => {
    calls.push(args);
    return '';
  });
  assert.deepEqual(calls, [matterPutArgs('local', '/x/matter/build/matter.json')]);
  await assert.rejects(r2PutMatter('local', '/x/notes.txt', async () => ''), /built matter\.json/);
});

test('wrangler output: the token and the single account are read; ambiguity asks for CLOUDFLARE_ACCOUNT_ID', async () => {
  assert.equal(await wranglerToken(async () => 'npm notice run wrangler\n{"type":"oauth","token":"t-1"}'), 't-1');
  await assert.rejects(wranglerToken(async () => '{"type":"oauth"}'), /no token/);
  assert.equal(await accountId({}, async () => '{"accounts":[{"id":"acc"}]}'), 'acc');
  assert.equal(await accountId({ CLOUDFLARE_ACCOUNT_ID: 'env' }, async () => assert.fail('not called')), 'env');
  await assert.rejects(accountId({}, async () => '{"accounts":[{"id":"a"},{"id":"b"}]}'), /CLOUDFLARE_ACCOUNT_ID/);
});
