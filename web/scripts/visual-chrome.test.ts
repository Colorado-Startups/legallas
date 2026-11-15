// SPDX-License-Identifier: Apache-2.0
// The visual renderer's Chrome: a pipe, never a DevTools port, and flags that keep every byte on the machine. The pipe
// client is tested over in-memory streams standing in for Chrome's fds 3 and 4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { PipeCdp, visualChromeArgs, type CdpEvent } from './visual-chrome.ts';

test('Chrome runs over a pipe with name resolution, proxies and non-proxied UDP shut off', () => {
  const args = visualChromeArgs('/tmp/profile');
  assert.ok(args.includes('--remote-debugging-pipe'));
  assert.ok(!args.some((arg) => arg.startsWith('--remote-debugging-port')), 'no DevTools port for other accounts to reach');
  for (const flag of ['--headless=new', '--user-data-dir=/tmp/profile', '--host-resolver-rules=MAP * ~NOTFOUND', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--no-proxy-server', '--disable-background-networking']) {
    assert.ok(args.includes(flag), flag);
  }
});

function pipe() {
  const toChrome = new PassThrough();
  const fromChrome = new PassThrough();
  const written: string[] = [];
  toChrome.setEncoding('utf8');
  toChrome.on('data', (chunk: string) => written.push(...chunk.split('\0').filter(Boolean)));
  return { cdp: new PipeCdp(toChrome, fromChrome), fromChrome, written };
}

test('commands go out as NUL-ended JSON, replies and events come back split anywhere, even inside a character', async () => {
  const { cdp, fromChrome, written } = pipe();
  const events: CdpEvent[] = [];
  cdp.on((event) => events.push(event));
  const reply = cdp.send('Page.navigate', { url: 'https://visual.invalid/page-1.html' }, 's1');
  const failing = cdp.send('Page.bad', {}, 's1');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(written.map((line) => JSON.parse(line)), [
    { id: 1, method: 'Page.navigate', params: { url: 'https://visual.invalid/page-1.html' }, sessionId: 's1' },
    { id: 2, method: 'Page.bad', params: {}, sessionId: 's1' },
  ]);
  const message = Buffer.from(
    `${JSON.stringify({ method: 'Page.loadEventFired', params: { title: 'Doe Roe €' }, sessionId: 's1' })}\0` +
      `${JSON.stringify({ id: 1, result: { frameId: 'f1' } })}\0${JSON.stringify({ id: 2, error: { message: 'no such method' } })}\0`,
  );
  const euro = message.indexOf(Buffer.from('€'));
  fromChrome.write(message.subarray(0, euro + 1));
  fromChrome.write(message.subarray(euro + 1, euro + 40));
  fromChrome.write(message.subarray(euro + 40));
  assert.deepEqual(await reply, { frameId: 'f1' });
  await assert.rejects(failing, /no such method/);
  assert.deepEqual(events, [{ method: 'Page.loadEventFired', params: { title: 'Doe Roe €' }, sessionId: 's1' }]);
});

test('when Chrome closes the pipe, waiting commands and later ones reject', async () => {
  const { cdp, fromChrome } = pipe();
  const waiting = cdp.send('Target.createTarget', { url: 'about:blank' });
  fromChrome.end();
  fromChrome.resume();
  await assert.rejects(waiting, /closed the DevTools pipe/);
  await assert.rejects(cdp.send('Page.enable'), /closed the DevTools pipe/);
});
