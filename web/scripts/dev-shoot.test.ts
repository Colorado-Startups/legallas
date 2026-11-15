// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromeArgs, parseActivePort } from './dev-cdp.ts';
import { DEFAULT_WIDTHS, isLocalUrl, mediaFor, metricsFor, parseShootArgs, routeSlug, shiftedShots, shotName, verdict, widerShots, type ShotRecord } from './dev-shoot.ts';

test('parseShootArgs: port and routes required; widths, variants, out and strict are optional', () => {
  const options = parseShootArgs(['--port', '8810', '/', '/doc/?id=abc'], '/shots');
  assert.equal(options.port, 8810);
  assert.deepEqual(options.routes, ['/', '/doc/?id=abc']);
  assert.deepEqual(options.widths, DEFAULT_WIDTHS);
  assert.deepEqual(options.variants, ['light', 'print']);
  assert.equal(options.out, '/shots');
  assert.equal(options.strict, false);
  const custom = parseShootArgs(['/ask', '--port', '8810', '--widths', '390', '--variants', 'print', '--out', '/o', '--strict'], '/shots');
  assert.deepEqual([custom.widths, custom.variants, custom.out, custom.strict], [[390], ['print'], '/o', true]);
  for (const bad of [['/'], ['--port', '8810'], ['--port', 'x', '/'], ['--port', '8810', 'ask'], ['--port', '8810', '/', '--variants', 'sepia'], ['--port', '8810', '/', '--widths', '0']]) {
    assert.throws(() => parseShootArgs(bad, '/shots'), /usage/, bad.join(' '));
  }
});

test('parseShootArgs: --max-shift takes a decimal score and is off by default', () => {
  assert.equal(parseShootArgs(['--port', '8810', '/'], '/shots').maxShift, null);
  for (const [text, want] of [['0.1', 0.1], ['0', 0], ['0.025', 0.025], ['1', 1], ['0.1000', 0.1]] as const) {
    assert.equal(parseShootArgs(['--port', '8810', '/', '--max-shift', text], '/shots').maxShift, want, text);
  }
  for (const text of ['', '.1', '-0.1', '0.12345', '1e-2', '0,1', 'x', '1000']) {
    assert.throws(() => parseShootArgs(['--port', '8810', '/', '--max-shift', text], '/shots'), /usage/, text);
  }
  assert.throws(() => parseShootArgs(['--port', '8810', '/', '--max-shift'], '/shots'), /usage/);
});

test('isLocalUrl allows localhost and in-page schemes, and nothing else', () => {
  for (const url of ['http://localhost:8810/', 'http://127.0.0.1:8810/x', 'http://[::1]:8810/', 'ws://localhost:8810/hmr', 'http://app.localhost/', 'data:image/png;base64,AA', 'blob:http://localhost:8810/1', 'about:blank']) {
    assert.ok(isLocalUrl(url), url);
  }
  for (const url of ['https://fonts.googleapis.com/css', 'http://localhost.example.com/', 'https://room.example.com/', 'chrome-extension://x/y', 'not a url']) {
    assert.ok(!isLocalUrl(url), url);
  }
});

test('shot names are file-safe and say route, width and variant', () => {
  assert.equal(routeSlug('/'), 'home');
  assert.equal(routeSlug('/documents/'), 'documents');
  assert.equal(routeSlug('/doc/?id=4c149f06-8b0d'), 'doc-id-4c149f06-8b0d');
  assert.equal(shotName('/ask', 390, 'print'), 'ask-390-print.png');
  assert.ok(routeSlug(`/${'x'.repeat(200)}`).length <= 64);
});

test('mediaFor emulates screen or print, light unless asked for dark, with reduced motion; phones are mobile at DPR 2', () => {
  const features = [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }];
  assert.deepEqual(mediaFor('light'), { media: '', features });
  assert.deepEqual(mediaFor('print'), { media: 'print', features });
  assert.deepEqual(mediaFor('dark'), { media: '', features: [{ name: 'prefers-color-scheme', value: 'dark' }, features[1]] });
  assert.deepEqual(metricsFor(390, 844), { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  assert.deepEqual(metricsFor(1024, 900), { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false });
});

const record = (over: Partial<ShotRecord> = {}): ShotRecord => ({
  file: 'f.png', url: 'http://localhost:1/', width: 390, variant: 'light', console: [], csp: [], httpErrors: [], external: [],
  layoutShift: 0, shiftSources: [], contentWidth: 390, ...over,
});

test('verdict fails on any request off localhost, and on other issues only with --strict', () => {
  assert.equal(verdict([record()], true).failed, false);
  assert.equal(verdict([record({ external: ['https://cdn.example/x.js'] })], false).failed, true);
  assert.equal(verdict([record({ console: ['boom'] })], false).failed, false);
  assert.equal(verdict([record({ csp: ['{}'] })], true).failed, true);
  assert.deepEqual(verdict([record({ console: ['a'] }), record({ httpErrors: ['404 x'] })], false).totals, { shots: 2, console: 1, csp: 0, httpErrors: 1, external: 0, maxShift: 0, wide: 0 });
});

test('verdict: maxShift is the largest on-screen shift, and --max-shift fails the run only with --strict', () => {
  const shots = [
    record({ variant: 'light', layoutShift: 0.04, shiftSources: ['header.room-header'] }),
    record({ variant: 'light', layoutShift: 0.12, shiftSources: ['main#main', 'div.guide'] }),
    record({ variant: 'print', layoutShift: 0.9 }),
  ];
  assert.equal(verdict(shots, false).totals.maxShift, 0.12, 'print shots are left out');
  assert.equal(verdict([record({ variant: 'print', layoutShift: 0.5 })], false).totals.maxShift, 0);
  assert.equal(verdict(shots, true).failed, false, 'no limit, no failure');
  assert.equal(verdict(shots, false, 0.1).failed, false, 'without --strict the shift is reported only');
  assert.equal(verdict(shots, true, 0.1).failed, true);
  assert.equal(verdict(shots, true, 0.12).failed, false, 'the limit itself passes');
  assert.equal(verdict(shots, true, 0.5).failed, false, 'the print shot over the limit does not count');
  assert.equal(verdict([record({ layoutShift: 0.01 })], true, 0).failed, true, '--max-shift 0 allows no shift at all');
  assert.deepEqual(shiftedShots(shots, 0.1).map((r) => r.shiftSources), [['main#main', 'div.guide']]);
});

test('verdict: a page wider than its shot scrolls sideways and fails only with --strict; print shots never count (#292, #308)', () => {
  const phone = record({ width: 375, contentWidth: 540, file: 'law-375-light.png' });
  assert.equal(verdict([phone], false).failed, false, 'without --strict the width is reported only');
  assert.equal(verdict([phone], true).failed, true);
  assert.equal(verdict([phone], false).totals.wide, 1);
  assert.equal(verdict([record({ variant: 'dark', width: 390, contentWidth: 522 })], true).failed, true, 'dark is on screen too');
  for (const fits of [record({ width: 375, contentWidth: 375 }), record({ width: 1440, contentWidth: 1425 }), record({ variant: 'print', width: 375, contentWidth: 540 })]) {
    assert.equal(verdict([fits], true).failed, false, `${fits.variant} ${fits.contentWidth} at ${fits.width}`);
  }
  assert.deepEqual(widerShots([record(), phone]).map((r) => r.file), ['law-375-light.png']);
});

test('Chrome runs headless on a throwaway profile, and its DevToolsActivePort file gives the socket', () => {
  const args = chromeArgs('/tmp/profile');
  assert.ok(args.includes('--headless=new'));
  assert.ok(args.includes('--remote-debugging-port=0'));
  assert.ok(args.includes('--user-data-dir=/tmp/profile'));
  assert.equal(parseActivePort('53211\n/devtools/browser/abc-123\n'), 'ws://127.0.0.1:53211/devtools/browser/abc-123');
  assert.equal(parseActivePort(''), null);
  assert.equal(parseActivePort('x\n/devtools/browser/a'), null);
});
