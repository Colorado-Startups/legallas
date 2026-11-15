// SPDX-License-Identifier: Apache-2.0
// Card F9. A minimal Chrome DevTools Protocol client for dev:shoot: launch headless Chrome with a throwaway
// profile, connect over Node's built-in WebSocket, and open one page session (flattened, so every command and
// event carries its sessionId). No dependencies.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT_FILE_WAIT_MS = 15_000;
const POLL_MS = 100;
const COMMAND_TIMEOUT_MS = 60_000;

type Params = Record<string, unknown>;
export type CdpEvent = { method: string; params: Params; sessionId?: string };

/**
 * Flags that keep Chrome quiet: no first-run UI, sync, extensions or background fetches of its own. The mock
 * keychain and basic password store keep it off the macOS login Keychain, which a throwaway profile never needs:
 * without them the first request waits for the Keychain, forever where there is none (CI's private HOME).
 */
export function chromeArgs(profile: string): string[] {
  return [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
    '--disable-default-apps', '--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb', '--use-mock-keychain',
    '--password-store=basic', 'about:blank',
  ];
}

/** Chrome writes "<port>\n/devtools/browser/<id>" to DevToolsActivePort once it listens. */
export function parseActivePort(text: string): string | null {
  const [port, wsPath] = text.trim().split('\n');
  return /^\d+$/.test(port ?? '') && wsPath?.startsWith('/devtools/browser/') ? `ws://127.0.0.1:${port}${wsPath}` : null;
}

export class Cdp {
  private next = 1;
  private readonly pending = new Map<number, { resolve: (value: Params) => void; reject: (error: Error) => void }>();
  private readonly listeners = new Set<(event: CdpEvent) => void>();
  private readonly socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (message) => {
      const data = JSON.parse(String(message.data)) as { id?: number; result?: Params; error?: { message: string } } & CdpEvent;
      if (data.id !== undefined) {
        const waiter = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) waiter?.reject(new Error(data.error.message));
        else waiter?.resolve(data.result ?? {});
      } else {
        for (const listener of this.listeners) listener(data);
      }
    });
    socket.addEventListener('close', () => {
      for (const waiter of this.pending.values()) waiter.reject(new Error('Chrome closed the DevTools connection'));
      this.pending.clear();
    });
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => resolve(new Cdp(socket)), { once: true });
      socket.addEventListener('error', () => reject(new Error('Could not connect to Chrome DevTools')), { once: true });
    });
  }

  send(method: string, params: Params = {}, sessionId?: string): Promise<Params> {
    const id = this.next++;
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
    });
  }

  on(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.socket.close();
  }
}

export interface Browser {
  cdp: Cdp;
  /** The page session every command targets. */
  session: string;
  close(): Promise<void>;
}

async function waitForPortFile(profile: string, chrome: ChildProcess): Promise<string> {
  const deadline = Date.now() + PORT_FILE_WAIT_MS;
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null) throw new Error(`Chrome exited (${chrome.exitCode}) before DevTools started`);
    const url = parseActivePort(await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => ''));
    if (url) return url;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error('Chrome did not start DevTools in time');
}

/** Launches headless Chrome on a fresh profile and attaches to one blank page. */
export async function launch(chromePath = DEFAULT_CHROME): Promise<Browser> {
  const profile = await mkdtemp(path.join(tmpdir(), 'legallas-shoot-'));
  const chrome = spawn(chromePath, chromeArgs(profile), { stdio: 'ignore' });
  const cleanup = async () => {
    if (chrome.exitCode === null) {
      const exited = new Promise((resolve) => chrome.once('exit', resolve));
      chrome.kill('SIGTERM');
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
      if (chrome.exitCode === null) chrome.kill('SIGKILL');
    }
    // Chrome's helper processes can still be writing to the profile for a moment after it exits (ENOTEMPTY);
    // rm retries those errors.
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  try {
    const cdp = await Cdp.connect(await waitForPortFile(profile, chrome));
    const { targetId } = (await cdp.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
    const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string };
    return { cdp, session: sessionId, close: async () => { cdp.close(); await cleanup(); } };
  } catch (error) {
    // The launch error is the one to report, not a failed cleanup after it.
    await cleanup().catch(() => undefined);
    throw error;
  }
}
