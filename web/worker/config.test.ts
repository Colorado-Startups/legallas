// SPDX-License-Identifier: Apache-2.0
// Guards on wrangler.jsonc: production must never be reachable without Access or with the dev identity. A checkout
// without the room's own file holds wrangler.example.jsonc to the same rules (wrangler-config.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuredRoomDefines } from '../scripts/config.ts';
import { NEURON_RATES } from './budget.ts';
import { MFA_SETTINGS } from './mfa.ts';
import { assistantNameProblem } from './room-names.ts';
import { roomsEnabled } from './rooms.ts';
import { DEFAULT_STORED_NAME } from './stored-name.ts';
import { definedSetting, entryExport, hasRoomConfig, readWranglerConfig, withoutRoomExtras, withoutRoomFields } from './wrangler-config.ts';

const { raw, config, example } = readWranglerConfig('wrangler');
/** For a guard on what only a room's own file has (its entry, the research chat's Durable Object), not the example. */
const roomOnly = { skip: example && 'only in a room\'s own config, not in the example' };

/** The Worker's own source files, relative to worker/: no tests and no generated types. */
function workerSources(): string[] {
  return readdirSync(import.meta.dirname, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts'));
}
test('no workers.dev or preview URLs: the custom domain behind Access is the only way in', () => {
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
});

test('the Worker runs before every asset', () => {
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.assets.binding, 'ASSETS');
});

test('the dev identity is never configured for production', () => {
  assert.equal(raw.includes('ALLOW_DEV_IDENTITY"'), false);
  assert.equal(raw.includes('DEV_IDENTITY_EMAIL"'), false);
  assert.equal(config.vars.ALLOW_DEV_IDENTITY, undefined);
});

test('REQUIRE_MFA is "0", "1" or unset, in the config and in the example: any other value would leave MFA off silently', () => {
  for (const vars of [config.vars, readWranglerConfig('wrangler', true).config.vars]) {
    assert.ok(vars.REQUIRE_MFA === undefined || MFA_SETTINGS.includes(vars.REQUIRE_MFA), `REQUIRE_MFA ${JSON.stringify(vars.REQUIRE_MFA)}`);
  }
});

test('the local opt-in to billed AI bindings is never configured for production (.dev.vars only)', () => {
  assert.equal(raw.includes('LEGALLAS_DEV_REMOTE_AI"'), false);
});

test('traces stay off so spans never record R2 keys or URLs', () => {
  assert.equal(config.observability.traces.enabled, false);
});

test('invocation logs stay off so request URLs never reach Cloudflare logs', () => {
  assert.equal(config.observability.logs.invocation_logs, false);
});

test('Ask has a per-member burst limit in front of the daily cap, in its own rate-limit namespace', () => {
  assert.deepEqual(config.ratelimits, [{ name: 'ASK_LIMIT', namespace_id: '1004', simple: { limit: 6, period: 60 } }]);
});

test('each request is capped at 5 s of CPU as a cost guard', () => {
  assert.deepEqual(config.limits, { cpu_ms: 5000 });
});

test('stack traces map to the source', () => {
  assert.equal(config.upload_source_maps, true);
});

test('Workers Issues stays off in the room: occurrences keep request details, like invocation logs', () => {
  assert.equal(config.observability.issues.enabled, false);
});

test('outbound fetch stays on the public internet, like legallas-mcp', () => {
  assert.deepEqual(config.compatibility_flags, ['nodejs_compat', 'nodejs_compat_do_not_populate_process_env', 'global_fetch_strictly_public']);
});

/**
 * The node: built-ins reachable from `entries` through the agents and @cloudflare/ai-chat code they import (relative
 * imports, and those packages' own entry points), read from the installed dist files.
 */
function nodeBuiltinsReachedFrom(entries: string[]): Set<string> {
  const ownPackage = (spec: string) => spec === 'agents' || spec.startsWith('agents/') || spec.startsWith('@cloudflare/ai-chat');
  const seen = new Set<string>();
  const builtins = new Set<string>();
  const queue = entries.map((spec) => fileURLToPath(import.meta.resolve(spec)));
  while (queue.length > 0) {
    const file = queue.pop()!; // safe: length checked
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*"([^"]+)"/g)) {
      if (spec!.startsWith('node:')) builtins.add(spec!);
      else if (spec!.startsWith('.')) queue.push(resolve(dirname(file), spec!));
      else if (ownPackage(spec!)) queue.push(fileURLToPath(import.meta.resolve(spec!)));
    }
  }
  return builtins;
}

test('nodejs_compat is there because the research chat\'s own imports need it, and process.env stays empty', () => {
  assert.ok(config.compatibility_flags.includes('nodejs_compat_do_not_populate_process_env'), 'secrets never sit in process.env');
  // The reason (worker/agent/SPIKE.md): what 5b imports, AIChatAgent and the agents entry, reaches Node built-ins beyond
  // AsyncLocalStorage. When it stops, drop nodejs_compat (keep the process.env flag while the date implies Node compat).
  const reached = nodeBuiltinsReachedFrom(['@cloudflare/ai-chat', 'agents']);
  assert.ok(reached.has('node:async_hooks'), [...reached].join(', '));
  assert.ok(reached.has('node:crypto') || reached.has('node:diagnostics_channel'), `only ${[...reached].join(', ')}: drop nodejs_compat`);
});

test('generation never goes through an AI gateway: no Worker code imports the AI SDK\'s gateway provider', () => {
  // `ai` depends on @ai-sdk/gateway (Vercel's AI Gateway, used for a string model id). Legallas passes a
  // createAI model object (worker/agent/model.ts) over the metered AI binding instead (worker/spend.ts), with no gateway.
  for (const name of workerSources()) {
    const text = readFileSync(join(import.meta.dirname, name), 'utf8');
    assert.doesNotMatch(text, /from\s+'@ai-sdk\/gateway'|import\s*\{[^}]*\b(gateway|createGateway)\b[^}]*\}\s*from\s+'ai'/, name);
  }
});

test('the research chat ships dark, and so do the visuals in Ask', () => {
  assert.equal(config.vars.RESEARCH_ENABLED, '0');
  assert.equal(config.vars.ASK_VISUALS, '0');
});

test('deal rooms ship off: the example never sets ROOMS_ENABLED, so a room turns guests on deliberately', { skip: !example && 'a room config is in this checkout' }, () => {
  assert.equal(config.vars.ROOMS_ENABLED, undefined);
  assert.equal(raw.includes('ROOMS_ENABLED'), false);
});

test('deal rooms are on in both Workers or in neither: a guest\'s AI never connects where the room has rooms off (#10)', () => {
  // Both room files, or both examples: a checkout with only one room file compares nothing it deploys together.
  const example = !hasRoomConfig('wrangler') || !hasRoomConfig('wrangler.mcp');
  const [room, mcp] = (['wrangler', 'wrangler.mcp'] as const).map((base) => roomsEnabled(readWranglerConfig(base, example).config.vars));
  assert.equal(mcp, room, `ROOMS_ENABLED: room Worker ${room ? 'on' : 'off'}, MCP Worker ${mcp ? 'on' : 'off'}`);
  if (example) assert.equal(room, false, 'the examples ship deal rooms off');
});

test('the control prefix is a secret, never a var', () => {
  assert.equal(config.vars.CONTROL_PREFIX, undefined);
  assert.equal(raw.includes('"CONTROL_PREFIX"'), false);
});

test('the research Durable Object is one SQLite class bound as RESEARCH, with append-only migrations', () => {
  // One name in all three places: the binding, the migration that created the class, and what the entry exports. A class
  // renamed after its migration would lose its data with no error. The entry may give the product's class the name the
  // room created it under.
  const className: string = config.durable_objects.bindings[0].class_name;
  assert.deepEqual(config.durable_objects, { bindings: [{ name: 'RESEARCH', class_name: className }] });
  assert.deepEqual(config.migrations, [{ tag: 'v1', new_sqlite_classes: [className] }]);
  assert.deepEqual(entryExport(config.main, className), { className: 'LegallasResearch', module: 'worker/agent/research.ts' });
  // The neutral name (entry-pro.ts) is an export only until a room's first Legallas release renames the class.
  assert.equal(raw.includes('ResearchAgent'), false, 'ResearchAgent is neither bound nor in a migration yet');
});

test('the product\'s entry exports the research class under its bound name and its neutral one', () => {
  const research = { className: 'LegallasResearch', module: 'worker/agent/research.ts' };
  assert.deepEqual(entryExport('worker/entry-pro.ts', 'LegallasResearch'), research);
  assert.deepEqual(entryExport('worker/entry-pro.ts', 'ResearchAgent'), research);
  assert.equal(entryExport('worker/entry-pro.ts', 'OtherResearch'), null);
  assert.equal(entryExport('worker/room.ts', 'LegallasResearch'), null, 'the core room exports no Durable Object');
});

/** A room's two entries (#294): core, the room alone, or pro, with Ask and the research chat (README). */
const ROOM_ENTRIES: readonly string[] = ['./worker/room.ts', './worker/entry-pro.ts'];

/**
 * A room with a brand of its own deploys its own entry instead: it registers its mark and signature (extensions.ts),
 * may export the research class under the name the room created it with, and serves one of the two.
 */
const OWN_ENTRY = './worker/entry.ts';
const SERVES_A_ROOM_ENTRY = /^export \{ default \} from '\.\/(?:room|entry-pro)\.ts';$/m;

/** Why `main` is not an entry a room may deploy, or null when it is one. `read` gives an entry's text by its path. */
function entryProblem(main: string, read: (entry: string) => string): string | null {
  if (ROOM_ENTRIES.includes(main)) return null;
  if (main !== OWN_ENTRY) return `main is ${main}`;
  return SERVES_A_ROOM_ENTRY.test(read(main)) ? null : `${main} must export its default from ./room.ts or ./entry-pro.ts`;
}

test('the entry is the core room, the pro entry, or the room\'s own entry over one of them', roomOnly, () => {
  const read = (entry: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', entry), 'utf8');
  assert.equal(entryProblem(String(config.main), read), null);
  // That entry-pro.ts exports the Durable Object class: entry-pro.test.ts.
});

test('a room\'s own entry adds to the core room or the pro entry and replaces neither', () => {
  const text = (body: string) => () => body;
  const branded = "import './brand.ts';\n\nexport * from './entry-pro.ts';\nexport { default } from './entry-pro.ts';\n";
  assert.equal(entryProblem(OWN_ENTRY, text(branded)), null);
  assert.equal(entryProblem(OWN_ENTRY, text("import './brand.ts';\nexport { default } from './room.ts';\n")), null);
  assert.match(entryProblem(OWN_ENTRY, text('export default { fetch: () => new Response() };\n')) ?? '', /must export its default/);
  assert.match(entryProblem(OWN_ENTRY, text("export { default } from './other.ts';\n")) ?? '', /must export its default/);
  assert.match(entryProblem('./worker/other.ts', text(branded)) ?? '', /main is \.\/worker\/other\.ts/);
});

test('each room entry exists, and the example uses one', () => {
  for (const entry of ROOM_ENTRIES) assert.ok(existsSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', entry)), entry);
  if (example) assert.ok(ROOM_ENTRIES.includes(String(config.main)), `the example's main is ${String(config.main)}`);
});

test('the core room stays loadable under plain Node', async () => {
  // Loading room.ts here, under Node, fails if anything it imports reaches cloudflare:workers or agents.
  const room = await import('./room.ts');
  assert.equal(typeof room.handle, 'function');
});

test('no Worker code mounts the Agents SDK\'s public /agents/* routes', () => {
  for (const name of workerSources()) {
    const text = readFileSync(join(import.meta.dirname, name), 'utf8');
    assert.doesNotMatch(text, /routeAgentRequest\s*\(|import[^;]*\brouteAgentRequest\b/, name);
  }
});

test('Ask runs a Workers AI model with neuron rates, so case text never leaves Cloudflare and the budget holds', () => {
  const model: string = config.vars.LEGALLAS_MODEL;
  assert.match(model, /^@cf\//, 'a Cloudflare-hosted model, so case text never leaves Cloudflare');
  assert.ok(Object.hasOwn(NEURON_RATES, model), `add ${model} to NEURON_RATES in worker/budget.ts (Workers AI pricing page)`);
});

test('the law library is on, in its own bucket and AI Search instance, apart from the record (T21)', () => {
  const storedName = definedSetting(config, 'ROOM_STORED_NAME', DEFAULT_STORED_NAME);
  assert.equal(config.vars.LAW_LIBRARY, '1');
  assert.deepEqual(
    config.r2_buckets.map((b: { binding: string; bucket_name: string }) => [b.binding, b.bucket_name]),
    [['FILES', `${storedName}-files`], ['INDEX', `${storedName}-index`], ['LAW', `${storedName}-law`]],
  );
  assert.deepEqual(config.ai_search, [
    { binding: 'SEARCH', instance_name: storedName, remote: true },
    { binding: 'LAW_SEARCH', instance_name: `${storedName}-law`, remote: true },
  ]);
});

test('the Worker and its database carry the stored name, so they vary with it and nothing else', () => {
  const storedName = definedSetting(config, 'ROOM_STORED_NAME', DEFAULT_STORED_NAME);
  assert.equal(config.name, `${storedName}-web`);
  assert.deepEqual(config.d1_databases.map((d: { database_name: string }) => d.database_name), [storedName]);
});

/**
 * What a room fills in when it copies the example, and `main`, the entry it deploys (the room alone, or with
 * pro's routes); everything else is the product's setting.
 */
const ROOM_FIELDS = ['name', 'main', 'routes', 'vars.TEAM_DOMAIN', 'vars.ACCESS_AUD', 'vars.ASK_GROQ', 'vars.ASK_HOST', 'd1_databases[].database_id', 'd1_databases[].database_name', 'r2_buckets[].bucket_name', 'ai_search[].instance_name', 'services[].service', 'send_email[].destination_address', 'send_email[].allowed_sender_addresses'];

/**
 * Vars a room may set or leave out: the names a room may change (room-names.ts), its alerts' time zone, whether it
 * requires a second factor at sign-in (mfa.ts), and whether it has deal rooms on (rooms.ts; the same in both Workers).
 */
const ROOM_VARS = ['INSTANCE_NAME', 'ASSISTANT_NAME', 'TIME_ZONE', 'REQUIRE_MFA', 'ROOMS_ENABLED'];

test('neither Worker names its assistant anything that could pass for a lawyer (A1, "Assistant names")', () => {
  for (const base of ['wrangler', 'wrangler.mcp'] as const) {
    const name = (readWranglerConfig(base).config.vars ?? {}).ASSISTANT_NAME;
    if (typeof name === 'string') assert.equal(assistantNameProblem(name), null, `${base} ASSISTANT_NAME`);
  }
});

/** Blocks a room running the room alone (worker/room.ts) leaves out: the research chat's Durable Object and its migrations. */
const PACKAGE_BLOCKS = ['durable_objects', 'migrations'];

test('the example is the room\'s own config apart from the fields a room fills in', { skip: !hasRoomConfig('wrangler') && 'no room config in this checkout' }, () => {
  const example = readWranglerConfig('wrangler', true);
  const product = (parsed: Record<string, unknown>) => withoutRoomFields(withoutRoomExtras(Object.fromEntries(Object.entries(parsed).filter(([key]) => !PACKAGE_BLOCKS.includes(key))), ROOM_VARS), ROOM_FIELDS);
  assert.deepEqual(product(example.config), product(readWranglerConfig('wrangler', false).config));
  assert.ok(PACKAGE_BLOCKS.every((key) => key in example.config), 'the example declares the research Durable Object: the product\'s entry exports it');
  assert.equal(example.config.main, './worker/entry-pro.ts', 'the product\'s entry: the full product, Ask included');
  // Filled in, the example fails closed: no Access team or AUD means every request is refused.
  assert.deepEqual([example.config.vars.TEAM_DOMAIN, example.config.vars.ACCESS_AUD], ['', '']);
  // And Groq stays off: a room confirms its own Groq organization's Zero Data Retention.
  assert.deepEqual(example.config.vars.ASK_GROQ, { enabled: false, zdr_confirmed: false, eval_runs: [] });
  // And so does the room's own model host: Ask runs on Workers AI until a room describes, confirms and evaluates one.
  assert.deepEqual(example.config.vars.ASK_HOST, { enabled: false, zdr_confirmed: false, eval_runs: [], url: '', model: '' });
});

test('both Workers define what the room config sets, so the Workers and the pages agree', () => {
  const set = Object.entries(configuredRoomDefines()).filter(([key, value]) => value !== 'undefined' && !(key === 'ROOM_STORED_NAME' && value === JSON.stringify(DEFAULT_STORED_NAME)));
  for (const base of ['wrangler', 'wrangler.mcp'] as const) {
    const defined = (readWranglerConfig(base).config.define ?? {}) as Record<string, string>;
    for (const [key, value] of set) assert.equal(defined[key], value, `${base} ${key}`);
  }
});
