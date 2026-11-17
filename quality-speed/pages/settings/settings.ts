// SPDX-License-Identifier: Apache-2.0
// Turns a snapshot (reads.ts) and the workflows on main into one reading per expected setting, and compares each with
// expected-settings.json. A reading is either a value or unread: a failed or refused read never becomes a value.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ACTIONS_APP_ID, type EnvBody, type Json, type Read, type RulesetBody, type Snapshot } from './reads.ts';

export type Value = boolean | number | string | string[];
export type Reading = { read: true; value: Value } | { read: false };
export const OPS = ['equals', 'one_of', 'min', 'max'] as const;
export type Op = (typeof OPS)[number];

export interface ExpectedSetting {
  id: string;
  area: string;
  read: string;
  expect: { op: Op; value: Value | Value[] };
  observed: { value: Value; how: 'read' | 'brief' } | null;
  gate: boolean;
  why: string;
  source: string;
}
export interface Expected {
  repo: string;
  org: string;
  reviewed: string;
  settings: ExpectedSetting[];
  /** Not applied while the repository is public: GitHub offers push rulesets on private and internal ones only. guard.ts still keeps the list from shrinking. */
  push_ruleset: { name: string; note?: string; restricted_file_paths: string[]; max_file_size_mb: number };
  not_scored: { id: string; why: string; source: string }[];
  baseline: { standard: string; exempt: { id: string; why: string }[] };
  changes: Change[];
}
/** The only way past guard.ts: an entry naming exactly what loosened. */
export interface Change {
  date: string;
  setting: string;
  field: 'expect' | 'gate' | 'removed' | 'push_ruleset';
  from: unknown;
  to: unknown;
  reason: string;
  issue: number;
  signoff_comment?: number;
}
/** What the workflows on main use: every `uses:` reference, every secret and environment name, and, once resolved, every action
 * those actions call in turn. */
export interface WorkflowFacts {
  uses: string[];
  secrets: string[];
  environments: string[];
  /** uses plus every action a composite action or reusable workflow calls, or null when not resolved. */
  all_uses: string[] | null;
}

export const STATUS = ['match', 'drift', 'unread'] as const;
export type Status = (typeof STATUS)[number];

const ID = /^[a-z][a-z0-9_]{0,79}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const sorted = (a: string[]) => [...a].sort();

/** Reads expected-settings.json and refuses anything malformed, so a typo can't quietly pass a check. */
export function loadExpected(file: string): Expected {
  const e = JSON.parse(readFileSync(file, 'utf8')) as Expected;
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const s of e.settings) {
    if (!ID.test(s.id) || ids.has(s.id)) errors.push(`setting id ${s.id} is not a unique id`);
    ids.add(s.id);
    if (!(OPS as readonly string[]).includes(s.expect?.op)) errors.push(`${s.id}: unknown op`);
    if ((s.expect.op === 'min' || s.expect.op === 'max') && typeof s.expect.value !== 'number') errors.push(`${s.id}: min and max take a number`);
    if (s.expect.op === 'one_of' && !Array.isArray(s.expect.value)) errors.push(`${s.id}: one_of takes a list`);
    if (s.expect.op === 'equals' && Array.isArray(s.expect.value) && JSON.stringify(s.expect.value) !== JSON.stringify(sorted(s.expect.value as string[]))) {
      errors.push(`${s.id}: a list value must be sorted`);
    }
    if (typeof s.gate !== 'boolean' || !s.why || !s.source) errors.push(`${s.id}: needs gate, why and source`);
    if (!(s.id in EXTRACTORS)) errors.push(`${s.id}: no extractor`);
  }
  for (const id of Object.keys(EXTRACTORS)) if (!ids.has(id)) errors.push(`extractor ${id} has no expected setting`);
  if (!Array.isArray(e.changes)) errors.push('changes must be a list');
  if (errors.length) throw new Error(`expected-settings.json: ${errors.join('; ')}`);
  return e;
}

const USES = /^\s*(?:-\s+)?uses:\s*['"]?([^\s'"#]+)/;
/** Every `uses:` in a workflow or action file, skipping comments. */
export function usesIn(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split('\n')) {
    if (/^\s*#/.test(line)) continue;
    const u = USES.exec(line);
    if (u?.[1]) out.add(u[1]);
  }
  return sorted([...out]);
}

/** Every `uses:`, `secrets.NAME` and environment name in .github/workflows. GITHUB_TOKEN is the job's own token, not a stored secret. */
export function workflowFacts(dir: string): WorkflowFacts {
  const uses = new Set<string>();
  const secrets = new Set<string>();
  const environments = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n)).sort()) {
    const text = readFileSync(path.join(dir, f), 'utf8');
    for (const u of usesIn(text)) uses.add(u);
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (/^\s*#/.test(line)) return;
      for (const m of line.matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)) if (m[1] && m[1] !== 'GITHUB_TOKEN') secrets.add(m[1]);
      const env = /^(\s*)environment:\s*(.*?)\s*(#.*)?$/.exec(line);
      if (!env) return;
      const inline = env[2] ?? '';
      if (inline && !inline.includes('${{')) environments.add(inline.replace(/^['"]|['"]$/g, ''));
      else if (!inline) {
        const indent = (env[1] ?? '').length;
        for (const next of lines.slice(i + 1)) {
          const ind = /^(\s*)/.exec(next)?.[1]?.length ?? 0;
          if (next.trim() && ind <= indent) break;
          const name = /^\s*name:\s*['"]?([^'"#\s]+)/.exec(next);
          if (name?.[1] && !name[1].includes('${{')) environments.add(name[1]);
        }
      }
    });
  }
  return { uses: sorted([...uses]), secrets: sorted([...secrets]), environments: sorted([...environments]), all_uses: null };
}

/** GETs a public file's text, or null on any failure. */
export type TextFetcher = (url: string) => Promise<string | null>;
const RAW = 'https://raw.githubusercontent.com';

/** Follows composite actions and reusable workflows, at their pinned commits, down to every action they call. Null if any file
 * can't be read, so an unread action can never pass the allowlist check. */
export async function resolveNested(uses: string[], fetchText: TextFetcher, depth = 4): Promise<string[] | null> {
  const seen = new Set<string>();
  let frontier = uses.filter((u) => !u.startsWith('./') && !u.startsWith('docker://'));
  for (let level = 0; level <= depth && frontier.length; level++) {
    const next: string[] = [];
    for (const ref of frontier) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      const at = ref.lastIndexOf('@');
      if (at < 0) return null;
      const [owner, repo, ...rest] = ref.slice(0, at).split('/');
      const sha = ref.slice(at + 1);
      if (!owner || !repo) return null;
      const sub = rest.join('/');
      let text: string | null;
      if (/\.ya?ml$/.test(sub)) text = await fetchText(`${RAW}/${owner}/${repo}/${sha}/${sub}`);
      else {
        const dir = sub ? `${sub}/` : '';
        text = (await fetchText(`${RAW}/${owner}/${repo}/${sha}/${dir}action.yml`)) ?? (await fetchText(`${RAW}/${owner}/${repo}/${sha}/${dir}action.yaml`));
      }
      if (text === null) return null;
      for (const u of usesIn(text)) if (!u.startsWith('./') && !u.startsWith('docker://')) next.push(u);
    }
    frontier = next;
    if (level === depth && frontier.some((u) => !seen.has(u))) return null;
  }
  return sorted([...new Set([...uses, ...seen])]);
}

// ---- reading helpers

type Ctx = { snap: Snapshot; wf: WorkflowFacts | null; expected: Expected; now: Date };
const UNREAD: Reading = { read: false };
const val = (value: Value): Reading => ({ read: true, value });

/** The projected body of a read whose status is one of `ok`, or null. */
function body(ctx: Ctx, id: string, ok = [200]): Record<string, Json> | Json[] | null {
  const r: Read | undefined = ctx.snap.reads[id];
  if (!r || !ok.includes(r.status) || r.body === null) return null;
  return r.body as Record<string, Json> | Json[];
}
function field(ctx: Ctx, id: string, name: string, ok = [200]): Reading {
  const b = body(ctx, id, ok);
  if (!isObj(b)) return UNREAD;
  const v = b[name];
  return typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string' ? val(v) : UNREAD;
}

/** Every ruleset in full, or null if any of them couldn't be read. */
function rulesets(ctx: Ctx): RulesetBody[] | null {
  const items = body(ctx, 'rulesets');
  if (!Array.isArray(items)) return null;
  const out: RulesetBody[] = [];
  for (const item of items) {
    if (!isObj(item) || item.status !== 200 || !isObj(item.body)) return null;
    out.push(item.body as unknown as RulesetBody);
  }
  return out;
}
const activeOf = (all: RulesetBody[], target: string) => all.filter((r) => r.target === target && r.enforcement === 'active');
const coversDefault = (r: RulesetBody) => (r.include ?? []).some((i) => i === '~DEFAULT_BRANCH' || i === '~ALL' || i === 'refs/heads/main');
function branchRulesets(ctx: Ctx): RulesetBody[] | null {
  const all = rulesets(ctx);
  return all ? activeOf(all, 'branch').filter(coversDefault) : null;
}
function branchRules(ctx: Ctx, type: string) {
  const rs = branchRulesets(ctx);
  return rs ? rs.flatMap((r) => r.rules.filter((x) => x.type === type)) : null;
}
const hasBranchRule = (ctx: Ctx, type: string): Reading => {
  const rules = branchRules(ctx, type);
  return rules ? val(rules.length > 0) : UNREAD;
};
function everyRule<T>(ctx: Ctx, type: string, test: (rule: T) => boolean | null): Reading {
  const rules = branchRules(ctx, type) as T[] | null;
  if (!rules) return UNREAD;
  if (rules.length === 0) return val(false);
  const results = rules.map(test);
  return results.includes(null) ? UNREAD : val(results.every(Boolean));
}
function bypassOf(list: RulesetBody[]): Reading {
  if (list.some((r) => r.bypass === null)) return UNREAD;
  return val(sorted([...new Set(list.flatMap((r) => r.bypass ?? []))]));
}
function tagRulesets(ctx: Ctx): RulesetBody[] | null {
  const all = rulesets(ctx);
  if (!all) return null;
  return activeOf(all, 'tag').filter(
    (r) => (r.include ?? []).includes('~ALL') && ['creation', 'update', 'deletion'].every((t) => r.rules.some((x) => x.type === t)),
  );
}

/** The actions policy as read, or null. `selected` is null when the policy isn't "selected" (the API answers 409). */
function actionsPolicy(ctx: Ctx): { allowed: string; selected: Record<string, Json> | null } | null {
  const allowed = field(ctx, 'actions_permissions', 'allowed_actions');
  if (!allowed.read || typeof allowed.value !== 'string') return null;
  if (allowed.value !== 'selected') return { allowed: allowed.value, selected: null };
  const sel = body(ctx, 'actions_selected');
  return isObj(sel) ? { allowed: 'selected', selected: sel } : null;
}
function selectedField(ctx: Ctx, name: string): Reading {
  const p = actionsPolicy(ctx);
  if (!p) return UNREAD;
  if (!p.selected) return val('not_selected');
  const v = p.selected[name];
  if (Array.isArray(v)) return v.every((x) => typeof x === 'string') ? val(sorted(v as string[])) : UNREAD;
  return typeof v === 'boolean' ? val(v) : UNREAD;
}

const GLOB = (pattern: string) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
/** True when every action on main is SHA-pinned and allowed by the actions policy. */
export function allowlistCovers(uses: string[], allowed: string, selected: Record<string, Json> | null): boolean {
  for (const ref of uses) {
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    const at = ref.lastIndexOf('@');
    if (at < 0 || !/^[0-9a-f]{40}$/.test(ref.slice(at + 1))) return false;
    if (allowed === 'all') continue;
    if (allowed !== 'selected' || !selected) return false;
    const owner = ref.split('/')[0];
    const githubOwned = selected.github_owned_allowed === true && (owner === 'actions' || owner === 'github');
    const patterns = Array.isArray(selected.patterns_allowed) ? (selected.patterns_allowed as string[]) : [];
    if (!githubOwned && !patterns.some((p) => GLOB(p).test(ref) || GLOB(p).test(ref.slice(0, at)))) return false;
  }
  return true;
}

/** Every environment with its policy, branch policies and secret names, or null if any part couldn't be read. */
function environments(ctx: Ctx): EnvBody[] | null {
  const list = body(ctx, 'environments');
  if (!Array.isArray(list)) return null;
  return list.every(isObj) ? (list as unknown as EnvBody[]) : null;
}
function allSecrets(ctx: Ctx): { name: string; updated_at: string }[] | null {
  const repo = body(ctx, 'secrets_repo');
  const org = body(ctx, 'secrets_org');
  const dependabot = body(ctx, 'dependabot_secrets');
  const envs = environments(ctx);
  if (!Array.isArray(repo) || !Array.isArray(org) || !Array.isArray(dependabot) || !envs) return null;
  const out = [...repo, ...org, ...dependabot] as unknown as { name: string; updated_at: string }[];
  for (const env of envs) {
    if (!env.secrets || env.secrets.status !== 200 || !Array.isArray(env.secrets.body)) return null;
    out.push(...(env.secrets.body as unknown as { name: string; updated_at: string }[]));
  }
  return out;
}
interface Budget {
  amount: number | null;
  stop: boolean | null;
  scope: string | null;
  type: string | null;
  sku: string | null;
}
/** A $0, stopping budget on a whole product, for the organization or the enterprise: the kind that caps this repository's spend. */
const productStop = (x: Budget) =>
  x.amount === 0 && x.stop === true && x.type === 'ProductPricing' && (x.scope === 'organization' || x.scope === 'enterprise');
function budgets(ctx: Ctx): Budget[] | null {
  const b = body(ctx, 'budgets');
  if (!Array.isArray(b) || !b.every(isObj)) return null;
  return b as unknown as Budget[];
}
/** A Pages setting. A 404 means no site only when the repository also says it has none; otherwise it may be a refused read. */
function pagesField(ctx: Ctx, pickValue: (p: Record<string, Json>) => Value | null, noSite: Value): Reading {
  const p = body(ctx, 'pages', [200, 404]);
  if (!isObj(p)) return UNREAD;
  if (p.exists === false) {
    const hasPages = field(ctx, 'repo', 'has_pages');
    return hasPages.read && hasPages.value === false ? val(noSite) : UNREAD;
  }
  const v = pickValue(p);
  return v === null ? UNREAD : val(v);
}
const count = (ctx: Ctx, id: string, name = 'count'): Reading => field(ctx, id, name);
const repoField = (name: string) => (ctx: Ctx) => field(ctx, 'repo', name);
const mergeField = (name: string) => (ctx: Ctx) => field(ctx, 'merge', name);
const DAY_MS = 86_400_000;

// ---- one extractor per expected setting

export const EXTRACTORS: Record<string, (ctx: Ctx) => Reading> = {
  repo_visibility: repoField('visibility'),
  default_branch: repoField('default_branch'),
  allow_forking: repoField('allow_forking'),
  has_wiki: repoField('has_wiki'),
  has_discussions: repoField('has_discussions'),
  has_issues: repoField('has_issues'),
  has_projects: repoField('has_projects'),
  web_commit_signoff_required: repoField('web_commit_signoff_required'),
  allow_squash_merge: mergeField('allow_squash_merge'),
  allow_merge_commit: mergeField('allow_merge_commit'),
  allow_rebase_merge: mergeField('allow_rebase_merge'),
  allow_auto_merge: mergeField('allow_auto_merge'),
  allow_update_branch: mergeField('allow_update_branch'),
  delete_branch_on_merge: mergeField('delete_branch_on_merge'),
  squash_merge_commit_message: mergeField('squash_merge_commit_message'),
  dependabot_security_updates: repoField('dependabot_security_updates'),
  secret_scanning: repoField('secret_scanning'),
  secret_scanning_push_protection: repoField('secret_scanning_push_protection'),
  vulnerability_alerts: (ctx) => (ctx.snap.reads.actions_permissions?.status === 200 ? field(ctx, 'vulnerability_alerts', 'enabled', [204, 404]) : UNREAD),
  immutable_releases: (ctx) => field(ctx, 'immutable_releases', 'enabled'),
  actions_enabled: (ctx) => field(ctx, 'actions_permissions', 'enabled'),
  actions_allowed: (ctx) => field(ctx, 'actions_permissions', 'allowed_actions'),
  actions_sha_pinning_required: (ctx) => field(ctx, 'actions_permissions', 'sha_pinning_required'),
  actions_github_owned_allowed: (ctx) => selectedField(ctx, 'github_owned_allowed'),
  actions_verified_allowed: (ctx) => selectedField(ctx, 'verified_allowed'),
  actions_patterns_allowed: (ctx) => selectedField(ctx, 'patterns_allowed'),
  actions_allowlist_covers_main: (ctx) => {
    const p = actionsPolicy(ctx);
    return p && ctx.wf?.all_uses ? val(allowlistCovers(ctx.wf.all_uses, p.allowed, p.selected)) : UNREAD;
  },
  workflow_default_permissions: (ctx) => field(ctx, 'actions_workflow', 'default_workflow_permissions'),
  workflow_can_approve_prs: (ctx) => field(ctx, 'actions_workflow', 'can_approve_pull_request_reviews'),
  fork_pr_approval: (ctx) => field(ctx, 'fork_pr_approval', 'approval_policy'),
  claude_review_enabled: (ctx) => field(ctx, 'claude_enabled', 'value'),
  artifact_log_retention_days: (ctx) => field(ctx, 'actions_retention', 'days'),
  branch_ruleset_active: (ctx) => {
    const rs = branchRulesets(ctx);
    return rs ? val(rs.length > 0) : UNREAD;
  },
  branch_ruleset_covers_release: (ctx) => {
    const all = rulesets(ctx);
    return all ? val(activeOf(all, 'branch').some((r) => (r.include ?? []).some((i) => i === 'refs/heads/release/*' || i === '~ALL'))) : UNREAD;
  },
  branch_rule_signatures: (ctx) => hasBranchRule(ctx, 'required_signatures'),
  branch_rule_pull_request: (ctx) => hasBranchRule(ctx, 'pull_request'),
  branch_rule_squash_only: (ctx) =>
    everyRule<{ allowed_merge_methods?: string[] | null }>(ctx, 'pull_request', (r) =>
      r.allowed_merge_methods ? r.allowed_merge_methods.length === 1 && r.allowed_merge_methods[0] === 'squash' : null,
    ),
  branch_rule_merge_queue: (ctx) => hasBranchRule(ctx, 'merge_queue'),
  branch_rule_no_deletion: (ctx) => hasBranchRule(ctx, 'deletion'),
  branch_rule_no_force_push: (ctx) => hasBranchRule(ctx, 'non_fast_forward'),
  branch_rule_linear_history: (ctx) => hasBranchRule(ctx, 'required_linear_history'),
  branch_required_checks: (ctx) => {
    const rules = branchRules(ctx, 'required_status_checks');
    return rules ? val(sorted([...new Set(rules.flatMap((r) => (r.checks ?? []).map((c) => c.context)))])) : UNREAD;
  },
  branch_checks_from_actions_app: (ctx) => {
    const rules = branchRules(ctx, 'required_status_checks');
    if (!rules) return UNREAD;
    const checks = rules.flatMap((r) => r.checks ?? []);
    return val(checks.length > 0 && checks.every((c) => c.integration_id === ACTIONS_APP_ID));
  },
  branch_checks_strict: (ctx) => everyRule<{ strict?: boolean | null }>(ctx, 'required_status_checks', (r) => r.strict ?? null),
  branch_checks_enforced_on_create: (ctx) =>
    everyRule<{ do_not_enforce_on_create?: boolean | null }>(ctx, 'required_status_checks', (r) =>
      typeof r.do_not_enforce_on_create === 'boolean' ? !r.do_not_enforce_on_create : null,
    ),
  branch_dismiss_stale_reviews: (ctx) =>
    everyRule<{ dismiss_stale_reviews_on_push?: boolean | null }>(ctx, 'pull_request', (r) => r.dismiss_stale_reviews_on_push ?? null),
  branch_required_approvals: (ctx) => {
    const rules = branchRules(ctx, 'pull_request');
    if (!rules) return UNREAD;
    const counts = rules.map((r) => r.required_approving_review_count);
    if (counts.some((c) => typeof c !== 'number')) return UNREAD;
    return val(Math.max(0, ...(counts as number[])));
  },
  branch_bypass: (ctx) => {
    const rs = branchRulesets(ctx);
    return rs ? bypassOf(rs) : UNREAD;
  },
  tag_ruleset_active: (ctx) => {
    const rs = tagRulesets(ctx);
    return rs ? val(rs.length > 0) : UNREAD;
  },
  tag_bypass: (ctx) => {
    const rs = tagRulesets(ctx);
    return rs ? bypassOf(rs) : UNREAD;
  },
  environments_main_only: (ctx) => {
    const envs = environments(ctx);
    if (!envs) return UNREAD;
    for (const env of envs) {
      if (!env.policy || !env.policy.custom_branch_policies) return val(false);
      const bp = env.branch_policies;
      if (!bp || bp.status !== 200 || !Array.isArray(bp.body)) return UNREAD;
      const policies = bp.body as { name: string | null; type: string }[];
      if (policies.length !== 1 || policies[0]?.name !== 'main' || policies[0]?.type !== 'branch') return val(false);
    }
    return val(true);
  },
  pages_build_type: (ctx) => pagesField(ctx, (p) => (typeof p.build_type === 'string' ? p.build_type : null), 'none'),
  admin_count: (ctx) => count(ctx, 'collaborators_admin'),
  outside_collaborators: (ctx) => count(ctx, 'collaborators_outside'),
  deploy_keys: (ctx) => count(ctx, 'deploy_keys'),
  hooks_without_secret: (ctx) => count(ctx, 'hooks', 'no_secret'),
  hooks_without_ssl: (ctx) => count(ctx, 'hooks', 'no_ssl'),
  secrets_unused: (ctx) => {
    const all = allSecrets(ctx);
    if (!all || !ctx.wf) return UNREAD;
    const used = new Set(ctx.wf.secrets);
    return val(all.filter((s) => !used.has(s.name)).length);
  },
  secrets_repo_level: (ctx) => {
    const repo = body(ctx, 'secrets_repo');
    return Array.isArray(repo) ? val(sorted((repo as { name: string }[]).map((s) => s.name))) : UNREAD;
  },
  secrets_org_visible: (ctx) => {
    const org = body(ctx, 'secrets_org');
    return Array.isArray(org) ? val(org.length) : UNREAD;
  },
  dependabot_secrets: (ctx) => {
    const d = body(ctx, 'dependabot_secrets');
    return Array.isArray(d) ? val(sorted((d as { name: string }[]).map((s) => s.name))) : UNREAD;
  },
  secrets_stale: (ctx) => {
    const all = allSecrets(ctx);
    if (!all) return UNREAD;
    const cutoff = ctx.now.getTime() - 365 * DAY_MS;
    const times = all.map((s) => Date.parse(s.updated_at));
    return times.some((t) => !Number.isFinite(t)) ? UNREAD : val(times.filter((t) => t < cutoff).length);
  },
  org_two_factor_required: (ctx) => field(ctx, 'org', 'two_factor_requirement_enabled'),
  org_default_repository_permission: (ctx) => field(ctx, 'org', 'default_repository_permission'),
  org_members_can_create_public_repositories: (ctx) => field(ctx, 'org', 'members_can_create_public_repositories'),
  org_members_can_fork_private_repositories: (ctx) => field(ctx, 'org', 'members_can_fork_private_repositories'),
  org_members_can_create_public_pages: (ctx) => field(ctx, 'org', 'members_can_create_public_pages'),
  org_members_can_change_repo_visibility: (ctx) => field(ctx, 'org', 'members_can_change_repo_visibility'),
  org_hooks_without_secret: (ctx) => count(ctx, 'org_hooks', 'no_secret'),
  org_hooks_without_ssl: (ctx) => count(ctx, 'org_hooks', 'no_ssl'),
  stop_budgets: (ctx) => {
    const b = budgets(ctx);
    if (!b || b.some((x) => x.amount === null || x.stop === null || x.sku === null)) return UNREAD;
    return val(new Set(b.filter(productStop).map((x) => x.sku)).size);
  },
  stop_budget_actions: (ctx) => {
    const b = budgets(ctx);
    if (!b || b.some((x) => x.amount === null || x.stop === null || x.sku === null)) return UNREAD;
    return val(b.some((x) => productStop(x) && x.sku === 'actions'));
  },
  budgets_not_stopping: (ctx) => {
    const b = budgets(ctx);
    if (!b) return UNREAD;
    if (b.some((x) => x.amount === null || x.stop === null)) return UNREAD;
    return val(b.filter((x) => (x.amount as number) > 0 || x.stop !== true).length);
  },
};

export function matches(reading: Value, expect: ExpectedSetting['expect']): boolean {
  switch (expect.op) {
    case 'equals':
      return JSON.stringify(reading) === JSON.stringify(expect.value);
    case 'one_of':
      return (expect.value as Value[]).some((v) => JSON.stringify(v) === JSON.stringify(reading));
    case 'min':
      return typeof reading === 'number' && reading >= (expect.value as number);
    case 'max':
      return typeof reading === 'number' && reading <= (expect.value as number);
  }
}

export interface SettingResult {
  id: string;
  status: Status;
}

/** One result per expected setting, in the file's order. */
export function evaluate(expected: Expected, snap: Snapshot, wf: WorkflowFacts | null, now: Date): SettingResult[] {
  const ctx: Ctx = { snap, wf, expected, now };
  return expected.settings.map((s) => {
    const extractor = EXTRACTORS[s.id];
    const reading = extractor ? extractor(ctx) : UNREAD;
    if (!reading.read) return { id: s.id, status: 'unread' };
    return { id: s.id, status: matches(reading.value, s.expect) ? 'match' : 'drift' };
  });
}

/** For the drill and tests only: the raw readings, so a planted value can be checked against what was read. */
export function readings(expected: Expected, snap: Snapshot, wf: WorkflowFacts | null, now: Date): Record<string, Reading> {
  const ctx: Ctx = { snap, wf, expected, now };
  return Object.fromEntries(expected.settings.map((s) => [s.id, EXTRACTORS[s.id]?.(ctx) ?? UNREAD]));
}
