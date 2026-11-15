// SPDX-License-Identifier: Apache-2.0
// Test support only (never imported by the Worker): a recording fake of the OAuth helpers, a locally signed
// Access token, and an McpEnv over the SQLite-backed D1. Lets the OAuth routes run in plain `node --test`.
import { SignJWT, generateKeyPair, type CryptoKey } from 'jose';
import type { AuthRequest, ClientInfo, ConsentDescription } from '@cloudflare/workers-oauth-provider';
import { testDb } from '../worker/sqlite-d1.ts';
import { MCP_ORIGIN, MCP_RESOURCE, type McpEnv, type OAuthHelpersLike } from './contract.ts';

export const TEAM = 'https://legallas-test.cloudflareaccess.com';
export const AUD = 'mcp-aud-1';
export const OWNER = 'owner@example.test';
export const COUNSEL = 'counsel@example.test';
export const STRANGER = 'stranger@example.test';
export const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
/** Claude's Client ID Metadata Document URL shape: the client ID is an HTTPS URL on its own domain. */
export const CIMD_CLIENT = 'https://claude.ai/oauth/mcp-oauth-client-metadata';

const keys = await generateKeyPair('RS256');
const otherKeys = await generateKeyPair('RS256');
export const getKey = async () => keys.publicKey;

/** A Cf-Access-Jwt-Assertion for `email`, signed by the test team unless told otherwise; `claims` adds to it (amr). */
export async function accessToken(email: string, opts: { aud?: string; forged?: boolean; claims?: Record<string, unknown> } = {}): Promise<string> {
  const key: CryptoKey = opts.forged ? otherKeys.privateKey : keys.privateKey;
  return new SignJWT({ ...opts.claims, email, type: 'app' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(TEAM)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

/** One recorded helper call. */
export interface Call {
  name: string;
  args: unknown[];
}

/** A fake parseAuthRequest error, shaped like the library's AuthorizationError. */
export class FakeAuthorizationError extends Error {
  code: string;
  redirectUri?: string;
  redirectTo?: string;
  constructor(code: string, redirectUri?: string) {
    super(code);
    this.name = 'AuthorizationError';
    this.code = code;
    if (redirectUri) {
      this.redirectUri = redirectUri;
      this.redirectTo = `${redirectUri}?error=${code}`;
    }
  }
}

export interface FakeOAuth {
  helpers: OAuthHelpersLike;
  calls: Call[];
  names(): string[];
  clients: ClientInfo[];
  kv: FakeKv;
  /**
   * Adds `count` dynamically registered clients straight to the store, as a /register flood would: each also gets
   * the library's expiring `client:<id>` key. `client` overrides the defaults (a Claude-named public client).
   */
  register(count: number, client?: Partial<ClientInfo>): void;
}

/** A Map-backed KV with the list/get/put/delete subset this server uses, counting every operation. */
export interface FakeKv {
  namespace: KVNamespace;
  store: Map<string, string>;
  /** Expiry (seconds since the epoch) of the keys put with one; KV list returns it with the key, as here. */
  expirations: Map<string, number>;
  /** KV operations so far, including the reads the fake library helpers stand for. */
  ops: number;
}

/** KV list, as Workers pages it: sorted keys after an opaque cursor (here, the last key returned). */
function listPage(store: Map<string, string>, expirations: Map<string, number>, options: { prefix?: string; limit?: number; cursor?: string } = {}) {
  const names = [...store.keys()].filter((name) => name.startsWith(options.prefix ?? '')).sort();
  const start = options.cursor ? names.findIndex((name) => name > (options.cursor as string)) : 0;
  const rest = start < 0 ? [] : names.slice(start);
  const page = rest.slice(0, options.limit ?? 1000);
  const complete = page.length === rest.length;
  const key = (name: string) => (expirations.has(name) ? { name, expiration: expirations.get(name) } : { name });
  return { keys: page.map(key), list_complete: complete, ...(complete ? {} : { cursor: page[page.length - 1] }) };
}

export function fakeKv(): FakeKv {
  const store = new Map<string, string>();
  const expirations = new Map<string, number>();
  const kv: FakeKv = { store, expirations, ops: 0, namespace: {} as KVNamespace };
  kv.namespace = {
    async get(key: string) {
      kv.ops++;
      return store.get(key) ?? null;
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      kv.ops++;
      store.set(key, value);
      if (options?.expirationTtl) expirations.set(key, Math.floor(Date.now() / 1000) + options.expirationTtl);
      else expirations.delete(key);
    },
    async delete(key: string) {
      kv.ops++;
      store.delete(key);
      expirations.delete(key);
    },
    async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
      kv.ops++;
      return listPage(store, expirations, options);
    },
  } as unknown as KVNamespace;
  return kv;
}

function describeFor(request: AuthRequest): ConsentDescription {
  const url = new URL(request.redirectUri);
  const cimd = request.clientId.startsWith('https://');
  return {
    clientId: request.clientId,
    clientName: cimd ? 'Claude' : `App ${request.clientId}`,
    ...(cimd ? { clientDomain: new URL(request.clientId).hostname } : {}),
    redirectUri: request.redirectUri,
    redirectHost: url.hostname,
    redirectIsLoopback: url.hostname === 'localhost' || url.hostname === '127.0.0.1',
    scope: request.scope,
  };
}

function parse(request: Request): AuthRequest {
  const q = new URL(request.url).searchParams;
  const redirectUri = q.get('redirect_uri') ?? '';
  if (q.get('fail')) throw new FakeAuthorizationError('invalid_request', q.get('fail') === 'redirect' ? redirectUri : undefined);
  return { responseType: 'code', clientId: q.get('client_id') ?? 'client-1', redirectUri, scope: [], state: q.get('state') ?? 's1', resource: MCP_RESOURCE };
}

/** Writes one helper call into the fake's log. */
type Recorder = (name: string, ...args: unknown[]) => unknown;

/** The consent half of the helpers: parse, describe, begin, approve, deny and complete. A handle works once. */
function consentHelpers(record: Recorder) {
  const pending = new Map<string, AuthRequest>();
  const take = (handle: string): AuthRequest => {
    const request = pending.get(handle);
    if (!request) throw new FakeAuthorizationError('invalid_request');
    pending.delete(handle);
    return request;
  };
  return {
    async parseAuthRequest(request: Request) {
      record('parseAuthRequest');
      return parse(request);
    },
    async describeConsent(request: AuthRequest) {
      record('describeConsent');
      return describeFor(request);
    },
    async beginConsent(request: AuthRequest) {
      record('beginConsent');
      const handle = `h${pending.size + 1}`;
      pending.set(handle, request);
      return { handle, headers: new Headers({ 'set-cookie': `__Host-oauth-consent=${handle}; Path=/; Secure` }) };
    },
    async approveConsent(_request: Request, handle: string, options?: { scope?: string[] }) {
      record('approveConsent', handle, options);
      const request = take(handle);
      return { request: { ...request, scope: options?.scope ?? request.scope }, headers: new Headers({ 'cache-control': 'no-store' }) };
    },
    async denyConsent(_request: Request, handle: string) {
      record('denyConsent', handle);
      const request = take(handle);
      const redirectTo = `${request.redirectUri}?error=access_denied&state=${request.state}`;
      return { request, redirectTo, headers: new Headers({ location: redirectTo }) };
    },
    async completeAuthorization(options: { request: AuthRequest }) {
      record('completeAuthorization', options);
      return { redirectTo: `${options.request.redirectUri}?code=c1&state=${options.request.state}` };
    },
  };
}

/** The client half of the helpers: create, look up, list, update and delete, each charged to the KV's operation count. */
function clientHelpers(record: Recorder, clients: ClientInfo[], kv: FakeKv) {
  return {
    async createClient(info: Partial<ClientInfo>) {
      record('createClient', info);
      kv.ops++;
      const client = { ...info, clientId: `static-${clients.length + 1}`, redirectUris: info.redirectUris ?? [], tokenEndpointAuthMethod: 'client_secret_basic', registrationDate: 1 };
      clients.push(client);
      // Like the library's createClient: a `client:` key with no expiry (only /register's records expire).
      kv.store.set(`client:${client.clientId}`, JSON.stringify(client));
      return { ...client, clientSecret: 'shown-once' };
    },
    async lookupClient(clientId: string) {
      record('lookupClient', clientId);
      kv.ops++;
      return clients.find((client) => client.clientId === clientId) ?? null;
    },
    // Like the library: one KV list, then one read per client returned.
    async listClients(options: { limit?: number; cursor?: string } = {}) {
      record('listClients', options);
      const start = Number(options.cursor ?? 0);
      const items = clients.slice(start, start + (options.limit ?? 1000));
      kv.ops += 1 + items.length;
      const next = start + items.length;
      return { items, ...(next < clients.length ? { cursor: String(next) } : {}) };
    },
    async updateClient(clientId: string, updates: Partial<ClientInfo>) {
      record('updateClient', clientId, updates);
      kv.ops += 2;
      const client = clients.find((entry) => entry.clientId === clientId);
      if (!client) return null;
      Object.assign(client, updates);
      return { ...client };
    },
    async deleteClient(clientId: string) {
      record('deleteClient', clientId);
      kv.ops++;
      const index = clients.findIndex((client) => client.clientId === clientId);
      if (index >= 0) clients.splice(index, 1);
      kv.store.delete(`client:${clientId}`);
      kv.expirations.delete(`client:${clientId}`);
    },
  };
}

/** Adds `count` dynamically registered clients straight to the store, each with the library's expiring `client:` key. */
function registerClients(clients: ClientInfo[], kv: FakeKv, count: number, extra: Partial<ClientInfo>): void {
  for (let i = 0; i < count; i++) {
    const client = { clientId: `dcr-${clients.length + 1}`, clientName: 'Claude', redirectUris: ['https://claude.ai/api/mcp/auth_callback'], tokenEndpointAuthMethod: 'none', ...extra };
    clients.push(client);
    kv.store.set(`client:${client.clientId}`, JSON.stringify(client));
    kv.expirations.set(`client:${client.clientId}`, Math.floor(Date.now() / 1000) + 30 * 24 * 3600);
  }
}

/** A recording fake of the helpers the routes use. Consent handles work once, like the library's. */
export function fakeOAuth(): FakeOAuth {
  const calls: Call[] = [];
  const clients: ClientInfo[] = [];
  const kv = fakeKv();
  const record: Recorder = (name, ...args) => calls.push({ name, args });
  const helpers = { ...consentHelpers(record), ...clientHelpers(record, clients, kv) };
  const register = (count: number, extra: Partial<ClientInfo> = {}) => registerClients(clients, kv, count, extra);
  return { helpers: helpers as unknown as OAuthHelpersLike, calls, clients, kv, register, names: () => calls.map((call) => call.name) };
}

/** An McpEnv with owner and counsel members, the test Access team and the fake helpers. */
export function fakeEnv(oauth: FakeOAuth = fakeOAuth(), extra: Partial<McpEnv> = {}): McpEnv {
  const { db, sqlite } = testDb();
  const add = sqlite.prepare('INSERT INTO members (email, role, name) VALUES (?, ?, ?)');
  add.run(OWNER, 'owner', 'Owner');
  add.run(COUNSEL, 'counsel', 'Counsel');
  return { DB: db, TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ALERTS_ENABLED: '0', OAUTH_PROVIDER: oauth.helpers, OAUTH_KV: oauth.kv.namespace, ...extra } as unknown as McpEnv;
}

/** A request on the production origin, signed in as `email` (or anonymous). */
export async function signedRequest(path: string, email: string | null, init: RequestInit = {}): Promise<Request> {
  const headers = new Headers(init.headers);
  if (email) headers.set('Cf-Access-Jwt-Assertion', await accessToken(email));
  return new Request(new URL(path, MCP_ORIGIN), { ...init, headers });
}
