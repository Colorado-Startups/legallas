// SPDX-License-Identifier: Apache-2.0
// A view's link to whoever shows it, in one of two modes, so one HTML serves both:
//
// | Mode     | Shown by                                   | Data                         | A cite                       | A link                    |
// |----------|--------------------------------------------|------------------------------|------------------------------|---------------------------|
// | `host`   | the AI (MCP Apps: Claude, Copilot)         | ui/notifications/tool-result | tools/call legallas_read_pages | ui/open-link            |
// | `binder` | the room's binder frame (/visual/)         | the page's own data block    | the binder bridge's `cite`   | the binder bridge's `out` |
//
// MCP Apps is JSON-RPC 2.0 over postMessage to the parent frame (modelcontextprotocol/ext-apps specification
// 2026-01-26, read 2026-11-06). The view fetches nothing itself: every byte of data comes through the parent. Only
// messages from the parent frame are read. The binder messages are the ones scripts/visualprep.ts's bridge posts and
// src/scripts/visual-viewer.ts reads.
import { CONFIG_ID, DATA_ID } from './ids.ts';
import { isObj, type Obj } from './model.ts';

export interface ToolResult {
  content?: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
}

/** What the server writes into the page (mcp/apps/views.ts viewHtml): the room's tool names and stored name. */
export interface ViewConfig {
  tools: { overview: string; list: string; read: string };
  storedName: string;
}

export type Mode = 'host' | 'binder';

export interface Host {
  mode: Mode;
  config: ViewConfig;
  /** Calls one of the room's tools through the AI's host; binder mode has none and rejects. */
  callTool(name: string, args: Obj): Promise<ToolResult>;
  openLink(url: string): void;
  /** A cite in binder mode: the binder opens the exhibit. */
  openBinderCite(ref: string): void;
  /** Asks the AI to show the view full screen (Claude and Copilot both offer it). */
  fullscreen(): void;
}

/** The MCP Apps version this view speaks. */
export const PROTOCOL_VERSION = '2026-01-26';
const CALL_TIMEOUT_MS = 60_000;

const DEFAULT_CONFIG: ViewConfig = {
  tools: { overview: 'legallas_case_overview', list: 'legallas_list_documents', read: 'legallas_read_pages' },
  storedName: 'legallas',
};

function readBlock(id: string): Obj | null {
  const text = document.getElementById(id)?.textContent;
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isObj(value) ? value : null;
  } catch {
    return null;
  }
}

function readConfig(): ViewConfig {
  const block = readBlock(CONFIG_ID) ?? {};
  const tools: Obj = isObj(block.tools) ? block.tools : {};
  const name = (key: keyof ViewConfig['tools']) => (typeof tools[key] === 'string' ? (tools[key] as string) : DEFAULT_CONFIG.tools[key]);
  return {
    tools: { overview: name('overview'), list: name('list'), read: name('read') },
    storedName: typeof block.storedName === 'string' ? block.storedName : DEFAULT_CONFIG.storedName,
  };
}

/**
 * Connects the view. `onResult` gets each tool result the parent sends, with the arguments the tool was called with
 * when the host sent them. In binder mode it gets the page's own result once, at once.
 */
export function connect(onResult: (result: ToolResult, args: Obj | null) => void): Host {
  const config = readConfig();
  const embedded = readBlock(DATA_ID);
  const parent = window.parent;
  const post = (message: Obj) => {
    if (parent !== window) parent.postMessage(message, '*');
  };

  if (embedded) {
    const binder = (message: Obj) => post({ ...message, [config.storedName]: 1 });
    // The binder turns pages with the arrow keys; a key the view itself uses (grid cells, the timeline) stays here.
    document.addEventListener('keydown', (event) => {
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && event.target === document.body) binder({ type: 'key', key: event.key });
    });
    queueMicrotask(() => onResult(isObj(embedded.result) ? (embedded.result as ToolResult) : {}, isObj(embedded.args) ? embedded.args : null));
    return {
      mode: 'binder',
      config,
      callTool: () => Promise.reject(new Error('The binder shows this view as saved.')),
      openLink: (url) => binder({ type: 'out', url }),
      openBinderCite: (ref) => binder({ type: 'cite', ref }),
      fullscreen: () => undefined,
    };
  }

  let nextId = 1;
  let args: Obj | null = null;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const request = (method: string, params: Obj): Promise<unknown> => {
    const id = nextId++;
    post({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error('The AI did not answer.'));
      }, CALL_TIMEOUT_MS);
    });
  };
  const notify = (method: string, params?: Obj) => post({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });

  window.addEventListener('message', (event) => {
    if (event.source !== parent) return;
    const message: unknown = event.data;
    if (!isObj(message) || message.jsonrpc !== '2.0') return;
    const { id, method } = message;
    if (typeof id === 'number' && !method && pending.has(id)) {
      const waiting = pending.get(id)!;
      pending.delete(id);
      if (isObj(message.error)) waiting.reject(new Error(typeof message.error.message === 'string' ? message.error.message : 'The AI refused.'));
      else waiting.resolve(message.result);
      return;
    }
    if (typeof method !== 'string') return;
    const params = isObj(message.params) ? message.params : {};
    if (method === 'ui/notifications/tool-input') args = isObj(params.arguments) ? params.arguments : null;
    else if (method === 'ui/notifications/tool-result') onResult(params as ToolResult, args);
    // A request the view does not serve still gets an answer, so the host never waits on it (teardown, ping).
    else if (id !== undefined) {
      const known = method === 'ui/resource-teardown' || method === 'ping';
      post({ jsonrpc: '2.0', id, ...(known ? { result: {} } : { error: { code: -32601, message: 'Method not found' } }) });
    }
  });

  // The handshake: initialize, then initialized; only then does a host send the tool's input and result.
  void request('ui/initialize', {
    protocolVersion: PROTOCOL_VERSION,
    appInfo: { name: 'Legallas room view', version: '1.0.0' },
    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
  })
    .then(() => notify('ui/notifications/initialized'))
    .catch(() => undefined);

  // The view's height, as it changes, so the host sizes its frame to fit (no scroll box inside the chat).
  let queued = false;
  const size = () => {
    queued = false;
    const root = document.documentElement;
    notify('ui/notifications/size-changed', { width: Math.ceil(root.scrollWidth), height: Math.ceil(root.scrollHeight) });
  };
  new ResizeObserver(() => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(size);
    }
  }).observe(document.body);

  return {
    mode: 'host',
    config,
    callTool: async (name, toolArgs) => {
      const result = await request('tools/call', { name, arguments: toolArgs });
      return isObj(result) ? (result as ToolResult) : {};
    },
    openLink: (url) => void request('ui/open-link', { url }).catch(() => undefined),
    openBinderCite: () => undefined,
    fullscreen: () => void request('ui/request-display-mode', { mode: 'fullscreen' }).catch(() => undefined),
  };
}
