// SPDX-License-Identifier: Apache-2.0
// The headless Chrome that renders visual pages (scripts/visual-render.ts), driven over a pipe, never a port. A machine
// may be shared and the pages are case material, so DevTools is not opened on a localhost TCP port
// (--remote-debugging-pipe: Chrome reads commands on fd 3 and writes replies on fd 4, each a JSON message ended by a
// NUL byte), and the profile is a fresh private temp folder. Nothing may leave the machine even before the renderer's
// Fetch interception refuses every request but the page: every host name resolves to nothing, WebRTC may not send UDP
// outside a proxy (so no STUN), and there is no proxy. dev:shoot keeps its own launcher (scripts/dev-cdp.ts).
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { DEFAULT_CHROME } from './dev-cdp.ts';

type Params = Record<string, unknown>;
export type CdpEvent = { method: string; params: Params; sessionId?: string };

/** What the renderer needs of a DevTools connection; PipeCdp and the tests' fakes fit. */
export interface CdpClient {
  send(method: string, params?: Params, sessionId?: string): Promise<Params>;
  on(listener: (event: CdpEvent) => void): () => void;
}

export interface VisualBrowser {
  cdp: CdpClient;
  /** The page session every command targets. */
  session: string;
  close(): Promise<void>;
}

const COMMAND_TIMEOUT_MS = 60_000;

/** Flags for a quiet, offline headless Chrome on a pipe. No --remote-debugging-port, ever. */
export function visualChromeArgs(profile: string): string[] {
  return [
    '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
    '--disable-default-apps', '--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb', '--no-proxy-server',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--host-resolver-rules=MAP * ~NOTFOUND', 'about:blank',
  ];
}

/** A DevTools client over Chrome's debugging pipe: NUL-ended JSON messages, flattened sessions. */
export class PipeCdp implements CdpClient {
  private next = 1;
  private buffer = '';
  private closed = false;
  private readonly pending = new Map<number, { resolve: (value: Params) => void; reject: (error: Error) => void }>();
  private readonly listeners = new Set<(event: CdpEvent) => void>();
  private readonly input: Writable;

  constructor(input: Writable, output: Readable) {
    this.input = input;
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => this.receive(chunk));
    output.on('close', () => this.fail(new Error('Chrome closed the DevTools pipe')));
    input.on('error', () => this.fail(new Error('Chrome closed the DevTools pipe')));
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    for (let end = this.buffer.indexOf('\0'); end >= 0; end = this.buffer.indexOf('\0')) {
      const message = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (message) this.dispatch(JSON.parse(message) as { id?: number; result?: Params; error?: { message: string } } & CdpEvent);
    }
  }

  private dispatch(data: { id?: number; result?: Params; error?: { message: string } } & CdpEvent): void {
    if (data.id === undefined) {
      for (const listener of this.listeners) listener(data);
      return;
    }
    const waiter = this.pending.get(data.id);
    this.pending.delete(data.id);
    if (data.error) waiter?.reject(new Error(data.error.message));
    else waiter?.resolve(data.result ?? {});
  }

  /** Rejects every command still waiting; later sends reject at once. */
  fail(error: Error): void {
    this.closed = true;
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }

  send(method: string, params: Params = {}, sessionId?: string): Promise<Params> {
    if (this.closed) return Promise.reject(new Error('Chrome closed the DevTools pipe'));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.input.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  }

  on(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.input.end();
  }
}

/** Launches headless Chrome on a fresh private profile, over a pipe, and attaches to one blank page. */
export async function launchVisualChrome(chromePath = DEFAULT_CHROME): Promise<VisualBrowser> {
  const profile = await mkdtemp(path.join(tmpdir(), 'legallas-visual-'));
  const chrome = spawn(chromePath, visualChromeArgs(profile), { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const [input, output] = [chrome.stdio[3], chrome.stdio[4]];
  if (!input || !output) {
    chrome.kill('SIGKILL');
    await rm(profile, { recursive: true, force: true });
    throw new Error('Chrome did not start');
  }
  const cdp = new PipeCdp(input as Writable, output as Readable);
  chrome.once('error', () => cdp.fail(new Error('Chrome did not start')));
  chrome.once('exit', () => cdp.fail(new Error('Chrome exited')));
  const cleanup = async () => {
    if (chrome.exitCode === null && chrome.signalCode === null) {
      const exited = new Promise((resolve) => chrome.once('exit', resolve));
      chrome.kill('SIGTERM');
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
      if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill('SIGKILL');
    }
    // Chrome can still be writing its profile as it exits (ENOTEMPTY): retry a moment.
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  try {
    const { targetId } = (await cdp.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
    const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string };
    return { cdp, session: sessionId, close: async () => { cdp.close(); await cleanup(); } };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
