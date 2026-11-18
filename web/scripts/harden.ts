// SPDX-License-Identifier: Apache-2.0
// The owner's edge and account security check (web/README.md, "Edge rules"). It reads each setting below from the
// Cloudflare API, in the room's own account and zone, and says pass, drift or unreadable. --apply fixes only the rows
// marked Apply; every other row prints the one step to take by hand.
//
//   npm run harden -- --check             exit 0 all pass, 1 drift, 2 a row unreadable (403 or another error)
//   npm run harden -- --apply             apply the Apply rows, then check again
//   npm run harden -- --check --report <file>
//                                         also write a self-contained HTML page: tiles and the drill-age bar
//
// | Row                     | Read from                                                              | Apply |
// |-------------------------|------------------------------------------------------------------------|-------|
// | Backup bucket lock      | GET /accounts/{a}/r2/buckets/{backup}/lock                             | yes   |
// | security.txt            | GET /zones/{z}/security-center/securitytxt                             | only when none exists |
// | Custom firewall rules   | GET /zones/{z}/rulesets/phases/http_request_firewall_custom/entrypoint | missing ones, one POST each |
// | Sign-in rate limit      | GET /zones/{z}/rulesets/phases/http_ratelimit/entrypoint               | only when the slot is empty |
// | Managed and OWASP       | GET /zones/{z}/rulesets/phases/http_request_firewall_managed/entrypoint | step |
// | Account 2FA             | GET /accounts/{a} settings.enforce_twofactor                           | step |
// | Access MFA              | GET /accounts/{a}/access/apps, /access/organizations: mfa_config       | step |
// | TLS, HTTPS, HSTS        | GET /zones/{z}/settings/{min_tls_version,always_use_https,security_header} | step |
// | Bot Fight Mode off      | GET /zones/{z}/bot_management fight_mode                               | step |
// | Backup running          | GET /accounts/{a}/workflows/legallas-backup/instances, then each one   | step |
// | Restore drill age       | GET /accounts/{a}/r2/buckets/{backup}/objects?prefix=drills/           | none |
// | Retention keys          | wrangler.mcp.jsonc vars (no API)                                       | none: warns |
//
// Never: a PUT of a whole phase entrypoint (it would replace every rule the owner has), a change outside the zone that
// serves the room's hosts, or a zone in another account. Output, errors and the report carry counts, ages and
// statuses only: never a hostname, account or zone id, bucket name or token.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cloudflareApi, CloudflareApiError, type Api } from './backup.ts';
import { ROOM_CONFIGS, roomApps, roomTargets, type RoomTargets } from './access-offboard.ts';
import { wranglerTokens } from './law/replica.ts';
import { accountId } from './wrangler.ts';
import { hasRoomConfig, readWranglerConfig } from '../worker/wrangler-config.ts';
import { bucketName, WORKFLOW_NAME } from '../worker/backup/config-rules.ts';
import { DRILLS } from '../worker/backup/layout.ts';
import { reportHtml } from './harden-report.ts';

const USAGE = 'usage: npm run harden -- --check | --apply [--report <file>]';
const DAY = 86_400_000;
/** README "Backup and restore": daily with the schedule on. Two days allows one missed run. */
export const BACKUP_MAX_HOURS = 48;
/** README "Backup and restore": a drill at least every 90 days. */
export const DRILL_MAX_DAYS = 90;
/** README "Backup and restore": the backup's objects are locked 30 days. */
export const LOCK_DAYS = 30;
/** Warn this long before security.txt expires. */
export const SECURITY_TXT_WARN_DAYS = 30;
/** An operator's security contact for --apply, as a mailto: or https: URI. Read only when security.txt is missing. */
export const CONTACT_ENV = 'LEGALLAS_SECURITY_CONTACT';
/** Cloudflare's own managed rulesets (public ids, the same in every account). */
export const MANAGED_RULESETS = { 'Cloudflare Managed Ruleset': 'efb7b8c949ac4650a09736fc376e9aee', 'Cloudflare OWASP Core Ruleset': '4814384a9e5d4991b9815dcfc25d2f1f' } as const;
const STRONG_FACTORS = new Set(['security_key', 'biometrics']);
const PLACEHOLDER_ROOM = 'room.example.com';
const PLACEHOLDER_MCP = 'mcp.room.example.com';

export type Status = 'pass' | 'drift' | 'warn' | 'error';

export interface Row {
  key: string;
  title: string;
  status: Status;
  /** Counts, ages and settings only. */
  detail: string;
  /** The one step by hand, when the row is not pass. */
  step?: string;
  /** For the drill-age bar. */
  days?: number;
  /** Set on rows --apply may fix while they drift. */
  apply?: () => Promise<string>;
}

export interface EdgeRule {
  ref: string;
  description: string;
  action: string;
  expression: string;
  ratelimit?: Record<string, unknown>;
}

export interface EdgeRules {
  rateLimit: EdgeRule;
  custom: EdgeRule[];
}

export function readEdgeRules(file = path.join(import.meta.dirname, 'edge-rules.json')): EdgeRules {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as EdgeRules;
  return { rateLimit: parsed.rateLimit, custom: parsed.custom };
}

/** The room's two hosts: the room Worker's first route and the MCP Worker's. */
export interface Hosts {
  room?: string;
  mcp?: string;
}

/** A rule's expression for this room, or null when it names a host the configs don't give. */
export function forRoom(expression: string, hosts: Hosts): string | null {
  if (expression.includes(PLACEHOLDER_MCP) && !hosts.mcp) return null;
  const swapped = hosts.mcp ? expression.split(PLACEHOLDER_MCP).join(hosts.mcp) : expression;
  if (swapped.includes(PLACEHOLDER_ROOM) && !hosts.room) return null;
  return hosts.room ? swapped.split(PLACEHOLDER_ROOM).join(hosts.room) : swapped;
}

export interface Context {
  api: Api;
  account: string;
  zone: string;
  hosts: Hosts;
  targets: RoomTargets;
  /** The backup bucket's name from wrangler.backup.jsonc, or undefined when the room has no backup config. */
  backupBucket?: string;
  /** wrangler.mcp.jsonc's vars, or null when the room has no such file. */
  mcpVars: Record<string, unknown> | null;
  rules: EdgeRules;
  contact?: string;
  now: number;
}

const obj = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const arr = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(obj) : []);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const statusOf = (error: unknown): number => (error instanceof CloudflareApiError ? error.status : 0);

/** A GET that returns null on 404: the thing is not there. */
async function getOrNull(api: Api, where: string): Promise<unknown> {
  try {
    return await api('GET', where);
  } catch (error) {
    if (statusOf(error) === 404) return null;
    throw error;
  }
}

function unreadable(key: string, title: string, error: unknown): Row {
  const status = statusOf(error);
  const message = error instanceof CloudflareApiError ? error.message : 'the read failed';
  const hint = status === 403 ? ': the token lacks this row\'s permission (web/README.md, "Edge rules", Token)' : '';
  return { key, title, status: 'error', detail: `${message}${hint}` };
}

// ---- Rows ----------------------------------------------------------------------------------------------------------

const LOCK_RULE = { id: 'keep-objects-30-days', prefix: 'objects/', enabled: true, condition: { type: 'Age', maxAgeSeconds: LOCK_DAYS * 86_400 } };

/** A lock rule that keeps every backed-up object at least LOCK_DAYS. */
export function locksObjects(rule: Record<string, unknown>): boolean {
  const prefix = str(rule.prefix);
  const condition = obj(rule.condition);
  const long = condition.type === 'Indefinite' || (condition.type === 'Age' && typeof condition.maxAgeSeconds === 'number' && condition.maxAgeSeconds >= LOCK_DAYS * 86_400);
  return rule.enabled === true && (prefix === '' || prefix === 'objects/') && long;
}

async function lockRow(ctx: Context): Promise<Row> {
  const key = 'lock';
  const title = 'Backup bucket lock';
  if (!ctx.backupBucket) return { key, title, status: 'drift', detail: 'no wrangler.backup.jsonc', step: 'Set up the backup (web/README.md, "Backup and restore"), then run this again.' };
  const where = `/accounts/${ctx.account}/r2/buckets/${encodeURIComponent(ctx.backupBucket)}/lock`;
  let rules: Record<string, unknown>[];
  try {
    rules = arr(obj(await ctx.api('GET', where)).rules);
  } catch (error) {
    return unreadable(key, title, error);
  }
  if (rules.some(locksObjects)) return { key, title, status: 'pass', detail: `objects/ locked ${LOCK_DAYS}+ days` };
  return {
    key,
    title,
    status: 'drift',
    detail: `${rules.length} lock rules; none keeps objects/ ${LOCK_DAYS} days`,
    step: `npx wrangler r2 bucket lock add <backup bucket> --name keep-objects-30-days --prefix objects/ --retention-days ${LOCK_DAYS}`,
    // The PUT replaces the bucket's rules, so it sends back every rule it read, plus the one it adds.
    apply: async () => {
      const kept = rules.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => ['id', 'prefix', 'enabled', 'condition'].includes(k))));
      await ctx.api('PUT', where, { rules: [...kept, LOCK_RULE] });
      return `added lock rule ${LOCK_RULE.id}`;
    },
  };
}

async function securityTxtRow(ctx: Context): Promise<Row> {
  const key = 'security_txt';
  const title = 'security.txt';
  const where = `/zones/${ctx.zone}/security-center/securitytxt`;
  let txt: Record<string, unknown>;
  try {
    txt = obj(await getOrNull(ctx.api, where));
  } catch (error) {
    return unreadable(key, title, error);
  }
  const contacts = Array.isArray(txt.contact) ? txt.contact.length : 0;
  const expires = Date.parse(str(txt.expires));
  const none = txt.enabled !== true && contacts === 0;
  const step = 'Security > Settings > security.txt: turn it on with a Contact and an Expires a year out.';
  if (none) {
    const contact = ctx.contact;
    return {
      key,
      title,
      status: 'drift',
      detail: 'none',
      step: contact ? step : `${step} Or set ${CONTACT_ENV} (mailto: or https:) and run --apply.`,
      ...(contact
        ? {
            apply: async () => {
              await ctx.api('PUT', where, { enabled: true, contact: [contact], expires: new Date(ctx.now + 365 * DAY).toISOString() });
              return 'security.txt turned on, expires in 365 days';
            },
          }
        : {}),
    };
  }
  if (txt.enabled !== true || contacts === 0 || !Number.isFinite(expires)) return { key, title, status: 'drift', detail: `enabled ${txt.enabled === true}, ${contacts} contacts, expires ${Number.isFinite(expires) ? 'set' : 'missing'}`, step };
  const days = Math.floor((expires - ctx.now) / DAY);
  if (days < 0) return { key, title, status: 'drift', detail: `expired ${-days} days ago`, step: 'Security > Settings > security.txt: move Expires a year out.' };
  if (days <= SECURITY_TXT_WARN_DAYS) return { key, title, status: 'warn', detail: `expires in ${days} days`, step: 'Security > Settings > security.txt: move Expires a year out.' };
  return { key, title, status: 'pass', detail: `${contacts} contacts, expires in ${days} days` };
}

interface Entrypoint {
  id: string | null;
  rules: Record<string, unknown>[];
}

async function entrypoint(ctx: Context, phase: string): Promise<Entrypoint> {
  const result = await getOrNull(ctx.api, `/zones/${ctx.zone}/rulesets/phases/${phase}/entrypoint`);
  if (result === null) return { id: null, rules: [] };
  return { id: str(obj(result).id) || null, rules: arr(obj(result).rules) };
}

/** Adds rules one at a time. With no entrypoint yet, the first creates the zone's phase ruleset; never a PUT. */
async function addRules(ctx: Context, phase: string, start: Entrypoint, rules: Record<string, unknown>[]): Promise<void> {
  let id = start.id;
  for (const rule of rules) {
    if (id) await ctx.api('POST', `/zones/${ctx.zone}/rulesets/${id}/rules`, rule);
    else id = str(obj(await ctx.api('POST', `/zones/${ctx.zone}/rulesets`, { name: 'default', kind: 'zone', phase, rules: [rule] })).id) || null;
  }
}

function ruleBody(rule: EdgeRule, expression: string): Record<string, unknown> {
  return { ref: rule.ref, description: rule.description, action: rule.action, expression, enabled: true, ...(rule.ratelimit ? { ratelimit: rule.ratelimit } : {}) };
}

/** Whether `have` holds `rule`: the same ref, or (a rule added by hand) the same expression. */
function holds(have: Record<string, unknown>[], rule: EdgeRule, hosts: Hosts): Record<string, unknown> | undefined {
  const expression = forRoom(rule.expression, hosts);
  return have.find((r) => r.ref === rule.ref || (expression !== null && r.expression === expression));
}

async function customRulesRow(ctx: Context): Promise<Row> {
  const key = 'custom_rules';
  const title = 'Custom firewall rules';
  const phase = 'http_request_firewall_custom';
  let start: Entrypoint;
  try {
    start = await entrypoint(ctx, phase);
  } catch (error) {
    return unreadable(key, title, error);
  }
  const found = ctx.rules.custom.map((rule) => ({ rule, have: holds(start.rules, rule, ctx.hosts) }));
  const missing = found.filter((f) => !f.have).map((f) => f.rule);
  const off = found.filter((f) => f.have && f.have.enabled === false).length;
  const total = ctx.rules.custom.length;
  if (missing.length === 0 && off === 0) return { key, title, status: 'pass', detail: `${total} of ${total} on` };
  const addable = missing.filter((rule) => forRoom(rule.expression, ctx.hosts) !== null);
  return {
    key,
    title,
    status: 'drift',
    detail: `${total - missing.length - off} of ${total} on; ${missing.length} missing, ${off} off`,
    step: 'Security > Security rules: add or turn on the rules in web/README.md, "Edge rules" (rules 2 to 5).',
    ...(addable.length
      ? {
          apply: async () => {
            await addRules(ctx, phase, start, addable.map((rule) => ruleBody(rule, forRoom(rule.expression, ctx.hosts)!)));
            return `added ${addable.length} custom rules${addable.length < missing.length ? `; ${missing.length - addable.length} need a host the Wrangler configs don't give` : ''}`;
          },
        }
      : {}),
  };
}

async function rateLimitRow(ctx: Context): Promise<Row> {
  const key = 'rate_limit';
  const title = 'Sign-in rate limit';
  const phase = 'http_ratelimit';
  let start: Entrypoint;
  try {
    start = await entrypoint(ctx, phase);
  } catch (error) {
    return unreadable(key, title, error);
  }
  const rule = ctx.rules.rateLimit;
  const have = start.rules.find((r) => r.ref === rule.ref || str(r.expression).includes('"/token"'));
  if (have && have.enabled !== false) return { key, title, status: 'pass', detail: 'on' };
  const step = 'Security > Security rules: add rule 1 in web/README.md, "Edge rules". Free plan: one rate limiting rule, so replace or edit the one there.';
  if (have) return { key, title, status: 'drift', detail: 'off', step };
  if (start.rules.length > 0) return { key, title, status: 'drift', detail: `slot holds ${start.rules.length} other rule(s)`, step };
  return {
    key,
    title,
    status: 'drift',
    detail: 'none',
    step,
    apply: async () => {
      await addRules(ctx, phase, start, [ruleBody(rule, rule.expression)]);
      return 'added the sign-in rate limit';
    },
  };
}

async function managedRow(ctx: Context): Promise<Row> {
  const key = 'managed';
  const title = 'Managed and OWASP rulesets';
  let start: Entrypoint;
  try {
    start = await entrypoint(ctx, 'http_request_firewall_managed');
  } catch (error) {
    return unreadable(key, title, error);
  }
  const deployed = new Set(start.rules.filter((r) => r.action === 'execute' && r.enabled !== false).map((r) => str(obj(r.action_parameters).id)));
  const missing = Object.entries(MANAGED_RULESETS).filter(([, id]) => !deployed.has(id)).map(([name]) => name);
  if (missing.length === 0) return { key, title, status: 'pass', detail: 'both deployed' };
  return { key, title, status: 'drift', detail: `not deployed: ${missing.join(', ')}`, step: 'Security > WAF > Managed rules: deploy both (Pro plan or above).' };
}

async function twoFactorRow(ctx: Context): Promise<Row> {
  const key = 'account_2fa';
  const title = 'Account 2FA enforced';
  try {
    const on = obj(obj(await ctx.api('GET', `/accounts/${ctx.account}`)).settings).enforce_twofactor === true;
    if (on) return { key, title, status: 'pass', detail: 'enforce_twofactor on' };
    return { key, title, status: 'drift', detail: 'enforce_twofactor off', step: 'Manage Account > Members > Members 2FA enforcement: on (every member sets up 2FA first).' };
  } catch (error) {
    return unreadable(key, title, error);
  }
}

/** The second factors Access asks for on `app`: policy, then app, then organization (Cloudflare's precedence). */
export function appFactors(app: Record<string, unknown>, org: Record<string, unknown>): string[] {
  const appMfa = obj(app.mfa_config);
  if (appMfa.mfa_disabled === true) return [];
  if (arr(app.policies).some((p) => obj(p.mfa_config).mfa_disabled === true)) return [];
  const listed = (config: Record<string, unknown>) => (Array.isArray(config.allowed_authenticators) ? config.allowed_authenticators.filter((a): a is string => typeof a === 'string') : []);
  if (listed(appMfa).length) return listed(appMfa);
  if (org.mfa_required_for_all_apps === true) return listed(obj(org.mfa_config));
  return [];
}

async function accessMfaRow(ctx: Context): Promise<Row> {
  const key = 'access_mfa';
  const title = 'Access MFA on room apps';
  const step = 'Order matters, or the owner is locked out: 1. enrol your own security key or biometric at https://<team>.cloudflareaccess.com/AddMfaDevice; 2. Zero Trust > Access controls > Access settings: allow security keys and biometrics; 3. on each room application, Custom MFA settings with those two.';
  try {
    const apps: Record<string, unknown>[] = [];
    for (let page = 1; page <= 20; page++) {
      const batch = arr(await ctx.api('GET', `/accounts/${ctx.account}/access/apps?page=${page}&per_page=50`));
      apps.push(...batch);
      if (batch.length < 50) break;
    }
    const org = obj(await ctx.api('GET', `/accounts/${ctx.account}/access/organizations`));
    const ids = new Set(roomApps(apps, ctx.targets).map((a) => a.id));
    const room = apps.filter((app) => ids.has(str(app.id)));
    if (room.length === 0) return { key, title, status: 'drift', detail: 'no room application found', step: 'Check the routes and ACCESS_AUD in wrangler.jsonc and wrangler.mcp.jsonc.' };
    const strong = room.filter((app) => appFactors(app, org).some((f) => STRONG_FACTORS.has(f))).length;
    if (strong === room.length) return { key, title, status: 'pass', detail: `${strong} of ${room.length} apps ask for a key or biometric` };
    return { key, title, status: 'drift', detail: `${strong} of ${room.length} apps ask for a key or biometric`, step };
  } catch (error) {
    return unreadable(key, title, error);
  }
}

async function tlsRow(ctx: Context): Promise<Row> {
  const key = 'zone_tls';
  const title = 'Min TLS, Always HTTPS, HSTS';
  try {
    const setting = async (id: string) => obj(await ctx.api('GET', `/zones/${ctx.zone}/settings/${id}`)).value;
    const [tls, https, header] = await Promise.all([setting('min_tls_version'), setting('always_use_https'), setting('security_header')]);
    const tlsOk = tls === '1.2' || tls === '1.3';
    const httpsOk = https === 'on';
    const hstsOk = obj(obj(header).strict_transport_security).enabled === true;
    const detail = `min TLS ${typeof tls === 'string' ? tls : '?'}, always HTTPS ${httpsOk ? 'on' : 'off'}, HSTS ${hstsOk ? 'on' : 'off'}`;
    if (tlsOk && httpsOk && hstsOk) return { key, title, status: 'pass', detail };
    return { key, title, status: 'drift', detail, step: 'SSL/TLS > Edge Certificates: Minimum TLS 1.2, Always Use HTTPS on, HSTS on (include subdomains off: web/README.md, "Edge rules").' };
  } catch (error) {
    return unreadable(key, title, error);
  }
}

async function botFightRow(ctx: Context): Promise<Row> {
  const key = 'bot_fight';
  const title = 'Bot Fight Mode off';
  try {
    const on = obj(await ctx.api('GET', `/zones/${ctx.zone}/bot_management`)).fight_mode === true;
    if (!on) return { key, title, status: 'pass', detail: 'off' };
    return { key, title, status: 'drift', detail: 'on: can break AI connectors', step: 'Security > Settings > Bot Fight Mode: off.' };
  } catch (error) {
    return unreadable(key, title, error);
  }
}

/** Newest finished backup's age, reading instances as scripts/backup.ts waitFor does. Not a Worker cron: config-rules.ts refuses one. */
async function backupRow(ctx: Context): Promise<Row> {
  const key = 'backup_running';
  const title = 'Backup running';
  const step = `Add "schedules": ["23 8 * * *"] to the Workflow in wrangler.backup.jsonc and run npm run backup:deploy (web/README.md, "Backup and restore").`;
  const base = `/accounts/${ctx.account}/workflows/${WORKFLOW_NAME}/instances`;
  try {
    const listed = await getOrNull(ctx.api, `${base}?status=complete&per_page=50`);
    if (listed === null) return { key, title, status: 'drift', detail: 'the backup Workflow is not deployed', step: 'Set up the backup (web/README.md, "Backup and restore").' };
    const done = arr(listed)
      .map((i) => ({ id: str(i.id), ended: Date.parse(str(i.ended_on) || str(i.modified_on)) }))
      .filter((i) => i.id && Number.isFinite(i.ended))
      .sort((a, b) => b.ended - a.ended)
      .slice(0, 5);
    for (const run of done) {
      const instance = obj(await ctx.api('GET', `${base}/${encodeURIComponent(run.id)}`));
      if (obj(instance.output).action !== 'backup') continue;
      const hours = Math.floor((ctx.now - run.ended) / 3_600_000);
      if (hours <= BACKUP_MAX_HOURS) return { key, title, status: 'pass', detail: `newest backup ${hours} h ago` };
      return { key, title, status: 'drift', detail: `newest backup ${hours} h ago`, step };
    }
    return { key, title, status: 'drift', detail: 'no finished backup among the newest runs', step };
  } catch (error) {
    return unreadable(key, title, error);
  }
}

const DRILL_KEY = new RegExp(`^${DRILLS}(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})Z\\.json$`);

async function drillRow(ctx: Context): Promise<Row> {
  const key = 'drill_age';
  const title = 'Restore drill age';
  const step = 'npm run backup -- --drill';
  if (!ctx.backupBucket) return { key, title, status: 'drift', detail: 'no wrangler.backup.jsonc', step: 'Set up the backup (web/README.md, "Backup and restore").' };
  try {
    const objects = arr(await ctx.api('GET', `/accounts/${ctx.account}/r2/buckets/${encodeURIComponent(ctx.backupBucket)}/objects?prefix=${encodeURIComponent(DRILLS)}&per_page=1000`));
    const times = objects
      .map((o) => DRILL_KEY.exec(str(o.key)))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`));
    if (times.length === 0) return { key, title, status: 'drift', detail: 'no drill recorded', step };
    const days = Math.floor((ctx.now - Math.max(...times)) / DAY);
    if (days <= DRILL_MAX_DAYS) return { key, title, status: 'pass', detail: `${days} days ago`, days };
    return { key, title, status: 'drift', detail: `${days} days ago`, step, days };
  } catch (error) {
    return unreadable(key, title, error);
  }
}

function retentionRow(ctx: Context): Row {
  const key = 'retention';
  const title = 'Retention keys set';
  const step = 'Set RETAIN_SIGNINS_DAYS and RETAIN_AUDIT_DAYS_AFTER_CLOSE in wrangler.mcp.jsonc (web/README.md, "Retention and close-out"), then deploy.';
  if (!ctx.mcpVars) return { key, title, status: 'warn', detail: 'no wrangler.mcp.jsonc', step };
  const blank = ['RETAIN_SIGNINS_DAYS', 'RETAIN_AUDIT_DAYS_AFTER_CLOSE'].filter((name) => {
    const value = ctx.mcpVars![name];
    return value === undefined || value === '' || value === '0';
  });
  if (blank.length === 0) return { key, title, status: 'pass', detail: 'both set' };
  return { key, title, status: 'warn', detail: `blank: ${blank.join(', ')} (the room keeps everything)`, step };
}

/** Every row, read once. */
export async function checkAll(ctx: Context): Promise<Row[]> {
  return Promise.all([lockRow(ctx), securityTxtRow(ctx), customRulesRow(ctx), rateLimitRow(ctx), managedRow(ctx), twoFactorRow(ctx), accessMfaRow(ctx), tlsRow(ctx), botFightRow(ctx), backupRow(ctx), drillRow(ctx), Promise.resolve(retentionRow(ctx))]);
}

/** 0 every row passes (warns allowed), 1 a row drifts, 2 a row is unreadable. */
export function exitCode(rows: readonly Row[]): number {
  if (rows.some((r) => r.status === 'error')) return 2;
  return rows.some((r) => r.status === 'drift') ? 1 : 0;
}

// ---- Zone and account ----------------------------------------------------------------------------------------------

/** The zone that serves `hosts`: for each host, the account zone with the longest name it ends with. One zone only. */
export async function findZone(api: Api, account: string, hosts: readonly string[]): Promise<string> {
  if (hosts.length === 0) throw new Error('No room hostname: wrangler.jsonc and wrangler.mcp.jsonc have no routes.');
  const zones: Record<string, unknown>[] = [];
  for (let page = 1; page <= 20; page++) {
    const batch = arr(await api('GET', `/zones?account.id=${account}&per_page=50&page=${page}`));
    zones.push(...batch);
    if (batch.length < 50) break;
  }
  const chosen = new Map<string, Record<string, unknown>>();
  for (const host of hosts) {
    const zone = zones
      .filter((z) => host === str(z.name) || host.endsWith(`.${str(z.name)}`))
      .sort((a, b) => str(b.name).length - str(a.name).length)[0];
    if (!zone) throw new Error('No zone in this account serves the room\'s hosts.');
    chosen.set(str(zone.id), zone);
  }
  if (chosen.size !== 1) throw new Error('The room\'s hosts sit in more than one zone; harden reads one.');
  const [zone] = chosen.values();
  // Account safety: never read or change a zone another account owns.
  if (str(obj(zone!.account).id) !== account) throw new Error("The zone's account is not this account (CLOUDFLARE_ACCOUNT_ID): stopped.");
  return str(zone!.id);
}

// ---- Command -------------------------------------------------------------------------------------------------------

export interface Options {
  mode: 'check' | 'apply';
  report?: string;
}

export function parseArgs(args: readonly string[]): Options {
  let mode: Options['mode'] | undefined;
  let report: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--check' || arg === '--apply') && !mode) mode = arg === '--check' ? 'check' : 'apply';
    else if (arg === '--report' && args[i + 1] && !report) report = args[++i];
    else throw new Error(USAGE);
  }
  if (!mode) throw new Error(USAGE);
  return report ? { mode, report } : { mode };
}

const MARK: Record<Status, string> = { pass: 'PASS ', drift: 'DRIFT', warn: 'WARN ', error: 'ERROR' };

export function formatRows(rows: readonly Row[]): string[] {
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(`${MARK[row.status]}  ${row.title.padEnd(30)} ${row.detail}`);
    if (row.status !== 'pass' && row.step) lines.push(`       step: ${row.step}`);
  }
  return lines;
}

/** Checks; with apply, fixes the Apply rows that drift and checks again. Returns the exit code. */
export async function harden(options: Options, ctx: Context, log: (line: string) => void, write: (file: string, html: string) => void = (f, h) => writeFileSync(f, h)): Promise<number> {
  let rows = await checkAll(ctx);
  if (options.mode === 'apply') {
    const todo = rows.filter((r) => r.status !== 'pass' && r.apply);
    for (const row of todo) {
      try {
        log(`APPLY  ${row.title.padEnd(30)} ${await row.apply!()}`);
      } catch (error) {
        log(`APPLY  ${row.title.padEnd(30)} failed: ${error instanceof CloudflareApiError ? error.message : 'error'}`);
      }
    }
    if (todo.length) rows = await checkAll(ctx);
  }
  for (const line of formatRows(rows)) log(line);
  if (options.report) {
    write(options.report, reportHtml(rows, ctx.now, DRILL_MAX_DAYS));
    log(`Report: ${options.report}`);
  }
  return exitCode(rows);
}

function hostsOf(file: string): string | undefined {
  return roomTargets([file]).hosts[0];
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const account = await accountId();
  const tokens = wranglerTokens();
  const api = cloudflareApi(() => tokens.get());
  const targets = roomTargets();
  const zone = await findZone(api, account, targets.hosts);
  const room = hostsOf(ROOM_CONFIGS[0]!);
  const mcp = hostsOf(ROOM_CONFIGS[1]!);
  const backupBucket = hasRoomConfig('wrangler.backup') ? bucketName(readWranglerConfig('wrangler.backup', false).config, 'BACKUP') : undefined;
  const mcpVars = hasRoomConfig('wrangler.mcp') ? obj(readWranglerConfig('wrangler.mcp', false).config.vars) : null;
  const contact = process.env[CONTACT_ENV];
  const ctx: Context = {
    api,
    account,
    zone,
    hosts: { ...(room ? { room } : {}), ...(mcp ? { mcp } : {}) },
    targets,
    ...(backupBucket ? { backupBucket } : {}),
    mcpVars,
    rules: readEdgeRules(),
    ...(contact && /^(mailto:|https:\/\/)\S+$/.test(contact) ? { contact } : {}),
    now: Date.now(),
  };
  process.exitCode = await harden(options, ctx, (line) => console.log(line));
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`Harden stopped: ${error instanceof Error ? error.message.slice(0, 400) : 'error'}`);
    process.exitCode = 2;
  });
}
