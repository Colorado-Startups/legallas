// SPDX-License-Identifier: Apache-2.0
// Offboarding in one step (scripts/member.ts `remove`). When the owner has set ACCESS_TOKEN_ENV to a Cloudflare API token
// of their own (web/README.md, "Security model", names its two permissions), removing a member also:
//   1. removes their email from the Access policies of the room's applications, then reads each policy back to confirm;
//   2. ends their Access sessions in every application (revoke_user), so a page already open stops working.
// Without the token, member.ts prints the two steps for the dashboard, as before.
//
// Cloudflare's API, read 2026-11-05 (developers.cloudflare.com/api/resources/zero_trust/...):
//   GET  /accounts/{account}/access/apps                                  applications/methods/list
//   GET, PUT /accounts/{account}/access/policies/{id}                     access/subresources/policies (reusable)
//   GET, PUT /accounts/{account}/access/apps/{app}/policies/{id}          applications/subresources/policies (legacy)
//   POST /accounts/{account}/access/organizations/revoke_user {email}     organizations/methods/revoke_users
// A PUT replaces the whole policy, so it sends back everything the GET returned except the read-only fields: a field
// this code does not know (an MFA or approval setting) is kept, never dropped. If the API refuses that, nothing changed
// and the owner gets the manual steps.
//
// Only the room's applications are touched: those whose AUD tag is the room's ACCESS_AUD, or whose hostname is one the
// room's Workers serve (the routes in wrangler.jsonc and wrangler.mcp.jsonc). A reusable policy that other applications
// also use is left alone and reported, since editing it would change who reaches them. The token is held in memory,
// sent only in the Authorization header to api.cloudflare.com, and never printed, logged or put in an error.
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The environment variable that holds the owner's optional Access API token. */
export const ACCESS_TOKEN_ENV = 'LEGALLAS_ACCESS_API_TOKEN';

const API = 'https://api.cloudflare.com/client/v4';
const WEB_DIR = path.resolve(import.meta.dirname, '..');
/** The room's two Wrangler configs, which name its hostnames and the room Worker's Access AUD. */
export const ROOM_CONFIGS: readonly string[] = [path.join(WEB_DIR, 'wrangler.jsonc'), path.join(WEB_DIR, 'wrangler.mcp.jsonc')];

const ACCOUNT = /^[0-9a-f]{32}$/;
const ID = /^[A-Za-z0-9-]{1,64}$/;
const MAX_PAGES = 20;
/** What a policy GET returns that a PUT may not send back. */
const READ_ONLY = new Set(['id', 'uid', 'account_id', 'app_count', 'created_at', 'updated_at', 'reusable', 'policy_resolution_account_id']);
/** Include rules that never match a person's sign-in: service tokens and client certificates. */
const NOT_A_PERSON = new Set(['any_valid_service_token', 'service_token', 'certificate', 'common_name', 'linked_app_token']);

export class AccessApiError extends Error {
  override name = 'AccessApiError';
}

/** One Cloudflare API call; `what` names it in an error, which carries the HTTP status and Cloudflare's error codes only. */
export type AccessApi = (method: 'GET' | 'PUT' | 'POST', resource: string, what: string, body?: unknown) => Promise<Envelope>;

export interface Envelope {
  success?: unknown;
  result?: unknown;
  result_info?: { page?: unknown; total_pages?: unknown } | null;
  errors?: unknown;
}

/** The API on the owner's token. Never puts the token anywhere but the Authorization header. */
export function accessApi(token: string, fetcher: typeof fetch = fetch): AccessApi {
  if (!token || /\s/.test(token)) throw new AccessApiError(`${ACCESS_TOKEN_ENV} is set but empty or contains spaces`);
  return async (method, resource, what, body) => {
    const response = await fetcher(`${API}${resource}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let envelope: Envelope = {};
    try {
      envelope = (await response.json()) as Envelope;
    } catch {
      // Not JSON: reported by status below.
    }
    if (!response.ok || envelope?.success !== true) {
      const codes = (Array.isArray(envelope?.errors) ? envelope.errors : [])
        .map((error: { code?: unknown }) => error?.code)
        .filter((code): code is number => Number.isInteger(code));
      const hint = response.status === 403 ? `: the token lacks a permission (web/README.md, "Security model")` : '';
      throw new AccessApiError(`${what} answered ${response.status}${codes.length ? ` (Cloudflare error ${codes.join(', ')})` : ''}${hint}`);
    }
    return envelope;
  };
}

/** A room config's object, with whole-line comments and trailing commas dropped (as scripts/ask-replica-groq.ts reads it). */
function readConfig(file: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(file, 'utf8');
    const lines = raw.split('\n').filter((line) => !line.trimStart().startsWith('//'));
    return JSON.parse(lines.join('\n').replace(/,(\s*[}\]])/g, '$1')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The host of "room.example.com", "room.example.com/authorize" or "https://room.example.com:443/x", lower case. */
export function hostOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const [authority = ''] = value.trim().replace(/^[a-z]+:\/\//i, '').split('/');
  const [name = ''] = authority.split(':');
  const host = name.toLowerCase();
  return /^[a-z0-9.-]+$/.test(host) && host.includes('.') ? host : null;
}

/** What identifies the room's Access applications: the hostnames its Workers serve and the room Worker's AUD tags. */
export interface RoomTargets {
  hosts: string[];
  auds: string[];
}

/** RoomTargets from the room's Wrangler configs (ROOM_CONFIGS). A missing file adds nothing. */
export function roomTargets(files: readonly string[] = ROOM_CONFIGS): RoomTargets {
  const hosts = new Set<string>();
  const auds = new Set<string>();
  for (const file of files) {
    const config = readConfig(file);
    if (!config) continue;
    for (const route of Array.isArray(config.routes) ? config.routes : []) {
      const host = hostOf((route as { pattern?: unknown })?.pattern ?? route);
      if (host) hosts.add(host);
    }
    const aud = (config.vars as { ACCESS_AUD?: unknown } | undefined)?.ACCESS_AUD;
    if (typeof aud === 'string') for (const tag of aud.split(',').map((t) => t.trim()).filter(Boolean)) auds.add(tag);
  }
  return { hosts: [...hosts], auds: [...auds] };
}

type Rule = Record<string, unknown>;
interface PolicyRef {
  id: string;
  name: string;
  reusable: boolean;
  appId: string;
}
interface AccessApp {
  id: string;
  name: string;
  policies: PolicyRef[];
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The room's applications among `apps`: an AUD the room uses, or a hostname it serves. */
export function roomApps(apps: readonly Record<string, unknown>[], targets: RoomTargets): AccessApp[] {
  const hosts = new Set(targets.hosts);
  const auds = new Set(targets.auds);
  const found: AccessApp[] = [];
  for (const app of apps) {
    const id = stringOf(app.id);
    if (!ID.test(id)) continue;
    const domains = [app.domain, ...(Array.isArray(app.self_hosted_domains) ? app.self_hosted_domains : []), ...(Array.isArray(app.destinations) ? app.destinations.map((d: { uri?: unknown }) => d?.uri) : [])];
    if (!auds.has(stringOf(app.aud)) && !domains.some((domain) => hosts.has(hostOf(domain) ?? ''))) continue;
    const policies = (Array.isArray(app.policies) ? app.policies : [])
      .map((p: Record<string, unknown>) => ({ id: stringOf(p?.id), name: stringOf(p?.name) || 'unnamed policy', reusable: p?.reusable === true, appId: id }))
      .filter((p) => ID.test(p.id));
    found.push({ id, name: stringOf(app.name) || 'unnamed application', policies });
  }
  return found;
}

/** Whether an include rule names exactly this email. */
export function namesEmail(rule: Rule, email: string): boolean {
  const value = (rule.email as { email?: unknown } | undefined)?.email;
  return typeof value === 'string' && value.trim().toLowerCase() === email;
}

/**
 * Whether an include rule other than one naming this email could still let this person in: an email domain that is
 * theirs, everyone, or any group, list, identity provider, network or country rule. Another person's email, another
 * domain, and service-token or certificate rules cannot.
 */
export function mayStillAllow(rule: Rule, email: string): boolean {
  const kinds = Object.keys(rule);
  const kind = kinds[0];
  if (kinds.length !== 1 || kind === undefined) return true;
  if (NOT_A_PERSON.has(kind)) return false;
  if (kind === 'email') return namesEmail(rule, email);
  if (kind === 'email_domain') {
    const domain = stringOf((rule.email_domain as { domain?: unknown } | undefined)?.domain).trim().toLowerCase().replace(/^@/, '');
    return domain === email.slice(email.lastIndexOf('@') + 1);
  }
  return true;
}

function policyPath(account: string, ref: PolicyRef): string {
  return ref.reusable ? `/accounts/${account}/access/policies/${ref.id}` : `/accounts/${account}/access/apps/${ref.appId}/policies/${ref.id}`;
}

function rulesOf(policy: Record<string, unknown>): Rule[] {
  return (Array.isArray(policy.include) ? policy.include : []).filter((rule): rule is Rule => typeof rule === 'object' && rule !== null);
}

/** What offboarding did. `problems` are sentences for the owner; empty means every step was done and confirmed. */
export interface OffboardResult {
  /** Policies the email was removed from, confirmed by reading each back. */
  removedFrom: string[];
  /** Whether Access ended the person's sessions. */
  sessionsEnded: boolean;
  /** Codes for access_events.detail_code (a-z, 0-9, _), one per problem kind, for member.ts to record. */
  failures: string[];
  problems: string[];
}

/** All of the account's Access applications, page by page, stopping when a page adds nothing new. */
async function listApps(api: AccessApi, account: string): Promise<Record<string, unknown>[]> {
  const byId = new Map<string, Record<string, unknown>>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const envelope = await api('GET', `/accounts/${account}/access/apps?page=${page}&per_page=50`, 'Listing Access applications');
    const result = Array.isArray(envelope.result) ? (envelope.result as Record<string, unknown>[]) : [];
    const before = byId.size;
    for (const app of result) byId.set(stringOf(app?.id), app);
    const total = envelope.result_info?.total_pages;
    if (result.length === 0 || byId.size === before || (typeof total === 'number' && page >= total)) break;
  }
  return [...byId.values()];
}

/** Records one failed step: its code once, its sentence every time. */
type Fail = (code: string, problem: string) => void;

function failer(result: OffboardResult): Fail {
  return (code, problem) => {
    if (!result.failures.includes(code)) result.failures.push(code);
    result.problems.push(problem);
  };
}

/** The room's applications, or none with the reason recorded. */
async function findApps(api: AccessApi, account: string, targets: RoomTargets, fail: Fail): Promise<AccessApp[]> {
  try {
    const apps = roomApps(await listApps(api, account), targets);
    if (apps.length === 0) fail('apps_not_found', 'None of the room\'s Access applications were found: check the routes and ACCESS_AUD in wrangler.jsonc and wrangler.mcp.jsonc.');
    return apps;
  } catch (error) {
    fail('apps_unread', `${(error as Error).message}.`);
    return [];
  }
}

/** Each policy once, with the room applications that use it. */
function policyRefs(apps: readonly AccessApp[]): Map<string, { ref: PolicyRef; roomUses: number }> {
  const refs = new Map<string, { ref: PolicyRef; roomUses: number }>();
  for (const app of apps) {
    for (const ref of app.policies) {
      const key = ref.reusable ? ref.id : `${ref.appId}/${ref.id}`;
      const seen = refs.get(key);
      if (seen) seen.roomUses++;
      else refs.set(key, { ref, roomUses: 1 });
    }
  }
  return refs;
}

function stillAllowed(fail: Fail, name: string, email: string): void {
  fail('still_allowed', `The policy "${name}" may still let ${email} in through a rule other than their email (a group, domain or list): check it by hand.`);
}

/** Removes `email` from one policy and reads it back. Returns whether the policy was changed. */
async function removeFromPolicy(api: AccessApi, account: string, email: string, ref: PolicyRef, roomUses: number, fail: Fail): Promise<boolean> {
  const where = policyPath(account, ref);
  const policy = (await api('GET', where, `Reading the policy "${ref.name}"`)).result as Record<string, unknown>;
  if (policy?.decision !== 'allow') return false;
  const rules = rulesOf(policy);
  const kept = rules.filter((rule) => !namesEmail(rule, email));
  if (kept.length === rules.length) {
    if (rules.some((rule) => mayStillAllow(rule, email))) stillAllowed(fail, ref.name, email);
    return false;
  }
  if (kept.length === 0) {
    fail('only_rule', `The policy "${ref.name}" allows ${email} alone, so removing them would leave it empty: remove or change it by hand.`);
    return false;
  }
  // Fails closed: a reusable policy edits only when its app_count shows the room's applications are its only users.
  // No count, or any other shape, may mean other applications use it, so it is left alone.
  if (ref.reusable && !(typeof policy.app_count === 'number' && policy.app_count <= roomUses)) {
    fail('shared_policy', `The policy "${ref.name}" may also be used by applications outside the room, so it was left alone: remove ${email} from it by hand.`);
    return false;
  }
  const body = Object.fromEntries(Object.entries(policy).filter(([key]) => !READ_ONLY.has(key)));
  await api('PUT', where, `Updating the policy "${ref.name}"`, { ...body, include: kept });
  const check = (await api('GET', where, `Reading back the policy "${ref.name}"`)).result as Record<string, unknown>;
  const after = rulesOf(check ?? {});
  if (after.some((rule) => namesEmail(rule, email))) {
    fail('policy_unchanged', `The policy "${ref.name}" still names ${email} after the update: remove it by hand.`);
    return false;
  }
  if (after.some((rule) => mayStillAllow(rule, email))) stillAllowed(fail, ref.name, email);
  return true;
}

/** After the policies: a revoked person who is still allowed could simply sign in again. */
async function endSessions(api: AccessApi, account: string, email: string, result: OffboardResult, fail: Fail): Promise<void> {
  try {
    const envelope = await api('POST', `/accounts/${account}/access/organizations/revoke_user`, 'Ending their Access sessions', { email });
    if (envelope.result === false) fail('sessions_not_ended', 'Access did not end their sessions: use Zero Trust > Team & Resources > Users > Revoke.');
    else result.sessionsEnded = true;
  } catch (error) {
    fail('sessions_not_ended', `${(error as Error).message}. End their sessions in Zero Trust > Team & Resources > Users > Revoke.`);
  }
}

/**
 * Removes `email` from the room's Access policies, confirms, then ends their sessions. Never throws for an API failure:
 * each one becomes a problem, and the steps after it still run where they safely can.
 */
export async function offboard(api: AccessApi, account: string, email: string, targets: RoomTargets): Promise<OffboardResult> {
  const result: OffboardResult = { removedFrom: [], sessionsEnded: false, failures: [], problems: [] };
  const fail = failer(result);
  if (!ACCOUNT.test(account)) {
    fail('bad_account', 'The Cloudflare account id is not 32 hex characters: set CLOUDFLARE_ACCOUNT_ID.');
    return result;
  }
  const apps = await findApps(api, account, targets, fail);
  for (const { ref, roomUses } of policyRefs(apps).values()) {
    try {
      if (await removeFromPolicy(api, account, email, ref, roomUses, fail)) result.removedFrom.push(ref.name);
    } catch (error) {
      fail('policy_failed', `${(error as Error).message}. Remove ${email} from "${ref.name}" by hand.`);
    }
  }
  await endSessions(api, account, email, result, fail);
  return result;
}
