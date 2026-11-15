// SPDX-License-Identifier: Apache-2.0
// The live sample room's settings, from the committed examples. Pure, so a test can hold them to what the room's rules say. The two
// public names carry no product name, so the address stays neutral while the trademark search is pending: a workers.dev address,
// which also means no domain, no zone and no DNS to manage. Alert emails and the law library stay off: there is nobody to alert, and
// the invented record needs no law.
export const ROOM_WORKER = 'sample-room';
export const MCP_WORKER = 'sample-room-mcp';
export const LOGIN_WORKER = 'sample-room-login';

export interface RoomAddress {
  /** The account's workers.dev subdomain. */
  subdomain: string;
  /** The Zero Trust team, as in <team>.cloudflareaccess.com. */
  team: string;
}

export const hostOf = (worker: string, { subdomain }: RoomAddress) => `${worker}.${subdomain}.workers.dev`;

type Json = Record<string, unknown>;

/** The room config every script and the build read, on the example's other settings. Its paths are this run's scratch folders. */
export function roomConfig(example: Json, address: RoomAddress, paths: { source: string; inbox: string; cache: string }): Json {
  return {
    ...example,
    sourceRoot: paths.source, inboxDir: paths.inbox, cacheDir: paths.cache, matterTitle: 'Doe v. Harbor Labs, Inc.', controlPrefix: 'DOE',
    instanceName: 'Sample room', host: hostOf(ROOM_WORKER, address), mcpHost: hostOf(MCP_WORKER, address), accessHost: `${address.team}.cloudflareaccess.com`,
  };
}

/** The build's settings as Wrangler defines. A setting left unset keeps the code's default, so it isn't written. */
export const definedOnly = (defines: Record<string, string>) => Object.fromEntries(Object.entries(defines).filter(([, value]) => value !== 'undefined'));

const named = (list: unknown, drop: string) => (list as Json[]).filter((entry) => entry.binding !== drop);

/** What both Workers change alike: their public address, no alert mail, no law library. */
function common(example: Json, name: string, address: RoomAddress, define: Record<string, string>): Json {
  const { routes: _routes, send_email: _email, ...rest } = example;
  return {
    ...rest,
    name, workers_dev: true, preview_urls: false, define,
    vars: { ...(example.vars as Json), TEAM_DOMAIN: `https://${address.team}.cloudflareaccess.com`, ALERTS_ENABLED: '0', LAW_LIBRARY: '0' },
    r2_buckets: named(example.r2_buckets, 'LAW'),
    ai_search: named(example.ai_search, 'LAW_SEARCH'),
  };
}

const withDatabase = (databases: unknown, id: string) => (databases as Json[]).map((database) => ({ ...database, database_id: id }));

/** The room's Wrangler settings: the entries with pro's routes, whose pages read the case picture. */
export function roomWrangler(example: Json, address: RoomAddress, ids: { database: string; accessAud: string }, define: Record<string, string>): Json {
  const base = common(example, ROOM_WORKER, address, define);
  return {
    ...base,
    main: './worker/entry-pro.ts',
    durable_objects: { bindings: [{ name: 'RESEARCH', class_name: 'LegallasResearch' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['LegallasResearch'] }],
    vars: { ...(base.vars as Json), ACCESS_AUD: ids.accessAud },
    d1_databases: withDatabase(example.d1_databases, ids.database),
    services: (example.services as Json[]).map((service) => ({ ...service, service: MCP_WORKER })),
  };
}

/** The connector's. Its ACCESS_AUD is a secret, as its example says, so live/run.ts sets that apart. */
export function mcpWrangler(example: Json, address: RoomAddress, ids: { database: string; kv: string }, define: Record<string, string>): Json {
  return {
    ...common(example, MCP_WORKER, address, define),
    main: 'mcp/entry-pro.ts',
    d1_databases: withDatabase(example.d1_databases, ids.database),
    kv_namespaces: (example.kv_namespaces as Json[]).map((namespace) => ({ ...namespace, id: ids.kv })),
  };
}

/**
 * What the spend guard needs of a Worker's settings. Cloudflare has no hard stop, so this is the stop: the database its counters live in, a
 * daily cap of `cap`, the burst limit `limit` (with no such binding, worker/burst.ts lets every call through) and a CPU limit. worker/spend.ts
 * holds the meters, and worker/budget.ts their limits.
 */
export function spendGuardProblems(config: Json, cap: string, limit: string): string[] {
  const vars = (config.vars ?? {}) as Json;
  const limits = (config.limits ?? {}) as Json;
  return [
    ...((config.d1_databases as Json[] | undefined)?.some((database) => database.binding === 'DB') ? [] : ['no database for the spend counters']),
    ...(Number(vars[cap]) > 0 ? [] : [`no ${cap}`]),
    ...((config.ratelimits as Json[] | undefined)?.some((entry) => entry.name === limit) ? [] : [`no ${limit} rate limit`]),
    ...(Number(limits.cpu_ms) > 0 ? [] : ['no CPU limit']),
  ];
}

/** Local development's switches, which must never reach a deployed room (worker/config.test.ts holds a real room to the same). */
const DEV_ONLY = ['ALLOW_DEV_IDENTITY', 'DEV_IDENTITY_EMAIL', 'ASK_MOCK', 'MCP_SEARCH_MOCK', 'LEGALLAS_DEV_REMOTE_AI'];

/** What a room's rules ask of these settings, checked before anything deploys: Access configured, nothing of local development in them. */
export function safetyProblems(config: Json, needsAud: boolean): string[] {
  const vars = config.vars as Json;
  return [
    ...DEV_ONLY.filter((name) => JSON.stringify(config).includes(`"${name}"`)).map((name) => `${name} is a local development setting`),
    ...(String(vars.TEAM_DOMAIN ?? '').startsWith('https://') ? [] : ['no Access team']),
    ...(needsAud && !vars.ACCESS_AUD ? ['no Access audience'] : []),
    ...(config.preview_urls === false ? [] : ['preview addresses are on, and they skip the Access app']),
  ];
}
