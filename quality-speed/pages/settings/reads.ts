// SPDX-License-Identifier: Apache-2.0
// Reads this repository's settings through GitHub's REST API, plus one GraphQL query, and keeps closed fields only. Each answer is
// projected the moment it arrives: people become counts, secrets become names and dates, a budget loses its alert list, and Actions variables are never read.
// Nothing here logs a response body, so a login or a value can't reach a CI log.

export const OWNER = 'Colorado-Startups';
export const REPO = 'legallas';
const R = `/repos/${OWNER}/${REPO}`;
/** The GitHub Actions app: a required check must come from it. */
export const ACTIONS_APP_ID = 15368;
/** A list this long may have a second page, so it isn't trusted as complete. */
const PAGE = 100;

export interface Answer {
  status: number;
  body: unknown;
}
/** GET one REST path, or with a query POST it to /graphql, and return the HTTP status and parsed body. A network failure is status 0. */
export type Fetcher = (path: string, query?: string) => Promise<Answer>;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
/** One read as stored in snapshot.json: the status, and the projected body only when the status was expected. */
export interface Read {
  status: number;
  body: Json;
}
export interface RulesetBody {
  target: string | null;
  enforcement: string | null;
  include: string[] | null;
  exclude: string[] | null;
  /** "ActorType:actor_id:bypass_mode", or null when the key can't see who may bypass. */
  bypass: string[] | null;
  rules: Rule[];
}
export interface Rule {
  type: string;
  allowed_merge_methods?: string[] | null;
  dismiss_stale_reviews_on_push?: boolean | null;
  required_approving_review_count?: number | null;
  checks?: { context: string; integration_id: number | null }[];
  strict?: boolean | null;
  do_not_enforce_on_create?: boolean | null;
  restricted_file_paths?: string[];
  max_file_size?: number | null;
}
export interface EnvBody {
  name: string;
  /** null: no policy, so any branch may deploy. */
  policy: { protected_branches: boolean; custom_branch_policies: boolean } | null;
  branch_policies?: Read;
  secrets?: Read;
}
export interface Snapshot {
  taken_at: string;
  reads: Record<string, Read>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strs = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...v] : null);
const pick = (body: unknown, fields: readonly string[]): Record<string, Json> => {
  const o = isObj(body) ? body : {};
  const out: Record<string, Json> = {};
  for (const f of fields) {
    const v = o[f];
    out[f] = typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? v : null;
  }
  return out;
};
/** A full list, or null when it may be cut off at a page. */
const fullList = (v: unknown): unknown[] | null => (Array.isArray(v) && v.length < PAGE ? v : null);

export const REPO_FIELDS = [
  'visibility',
  'default_branch',
  'allow_forking',
  'has_wiki',
  'has_discussions',
  'has_issues',
  'has_projects',
  'has_pages',
  'web_commit_signoff_required',
] as const;

/** The merge settings, by their REST names. REST left all seven out for the read-only key (8 Nov run); GraphQL shows them to any
 * reader, and gave the same values as REST for an admin (2026-11-09). */
export const MERGE_FIELDS = {
  allow_squash_merge: 'squashMergeAllowed',
  allow_merge_commit: 'mergeCommitAllowed',
  allow_rebase_merge: 'rebaseMergeAllowed',
  allow_auto_merge: 'autoMergeAllowed',
  allow_update_branch: 'allowUpdateBranch',
  delete_branch_on_merge: 'deleteBranchOnMerge',
  squash_merge_commit_message: 'squashMergeCommitMessage',
} as const;
export const GRAPHQL = '/graphql';
export const MERGE_QUERY = `query { repository(owner: "${OWNER}", name: "${REPO}") { ${Object.values(MERGE_FIELDS).join(' ')} } }`;
/** GraphQL answers 200 with `errors` and no data when it refuses, so each field is kept only when the repository came back. */
function projectMerge(b: unknown): Json {
  const repo = isObj(b) && isObj(b.data) && isObj(b.data.repository) ? b.data.repository : null;
  const out: Record<string, Json> = {};
  for (const [rest, gql] of Object.entries(MERGE_FIELDS)) out[rest] = pick(repo, [gql])[gql] ?? null;
  return out;
}

/** Names a workflow on main uses. Any other secret or environment name is stored as "unreferenced", since a name could hold anything. */
export interface Known {
  secrets: string[];
  environments: string[];
}
const UNREFERENCED = 'unreferenced';

const secretList = (body: unknown, known: Known | null): Json => {
  if (!isObj(body) || !Array.isArray(body.secrets)) return null;
  const total = num(body.total_count);
  if (total === null || total !== body.secrets.length || total >= PAGE) return null;
  const out: Json[] = [];
  for (const s of body.secrets) {
    const name = isObj(s) ? str(s.name) : null;
    const updated = isObj(s) ? str(s.updated_at) : null;
    if (name === null || updated === null) return null;
    out.push({ name: known?.secrets.includes(name) ? name : UNREFERENCED, updated_at: updated });
  }
  return out;
};
function hookCounts(b: unknown): Json {
  const list = fullList(b);
  if (!list) return { count: null, no_secret: null, no_ssl: null };
  const configs = list.map((h) => (isObj(h) && isObj(h.config) ? h.config : {}));
  return {
    count: list.length,
    no_secret: configs.filter((c) => typeof c.secret !== 'string' || c.secret === '').length,
    no_ssl: configs.filter((c) => String(c.insecure_ssl ?? '0') !== '0').length,
  };
}

function projectRule(rule: unknown): Rule | null {
  if (!isObj(rule) || typeof rule.type !== 'string') return null;
  const p = isObj(rule.parameters) ? rule.parameters : {};
  const out: Rule = { type: rule.type };
  if (rule.type === 'pull_request') {
    out.allowed_merge_methods = strs(p.allowed_merge_methods);
    out.dismiss_stale_reviews_on_push = bool(p.dismiss_stale_reviews_on_push);
    out.required_approving_review_count = num(p.required_approving_review_count);
  } else if (rule.type === 'required_status_checks') {
    const checks = Array.isArray(p.required_status_checks) ? p.required_status_checks : [];
    out.checks = checks.filter(isObj).map((c) => ({ context: str(c.context) ?? '', integration_id: num(c.integration_id) }));
    out.strict = bool(p.strict_required_status_checks_policy);
    out.do_not_enforce_on_create = bool(p.do_not_enforce_on_create);
  } else if (rule.type === 'file_path_restriction') {
    out.restricted_file_paths = strs(p.restricted_file_paths) ?? [];
  } else if (rule.type === 'max_file_size') {
    out.max_file_size = num(p.max_file_size);
  }
  return out;
}

export function projectRuleset(body: unknown): RulesetBody | null {
  if (!isObj(body) || !Array.isArray(body.rules)) return null;
  const ref = isObj(body.conditions) && isObj(body.conditions.ref_name) ? body.conditions.ref_name : null;
  let bypass: string[] | null = null;
  if (Array.isArray(body.bypass_actors)) {
    // A role, the organization admin or an app keeps its id; a person or a team is recorded by type alone.
    bypass = body.bypass_actors
      .filter(isObj)
      .map((a) => {
        const type = str(a.actor_type) ?? '?';
        const id = type === 'User' || type === 'Team' ? '-' : (num(a.actor_id) ?? 'any');
        return `${type}:${id}:${str(a.bypass_mode) ?? '?'}`;
      })
      .sort();
  }
  const rules: Rule[] = [];
  for (const r of body.rules) {
    const projected = projectRule(r);
    if (!projected) return null;
    rules.push(projected);
  }
  return {
    target: str(body.target),
    enforcement: str(body.enforcement),
    include: ref ? strs(ref.include) : null,
    exclude: ref ? strs(ref.exclude) : null,
    bypass,
    rules,
  };
}

interface Simple {
  path: string;
  /** A GraphQL query, POSTed to `path`. */
  query?: string;
  /** Statuses whose body is projected; any other status stores body null. */
  ok: number[];
  project: (body: unknown, status: number, known: Known | null) => Json;
}

/** The single-request reads. Rulesets and environments take a second round and live in takeSnapshot. */
export const SIMPLE_READS: Record<string, Simple> = {
  repo: {
    path: R,
    ok: [200],
    project: (b) => ({
      ...pick(b, REPO_FIELDS),
      dependabot_security_updates:
        isObj(b) && isObj(b.security_and_analysis) && isObj(b.security_and_analysis.dependabot_security_updates)
          ? str(b.security_and_analysis.dependabot_security_updates.status)
          : null,
    }),
  },
  merge: { path: GRAPHQL, query: MERGE_QUERY, ok: [200], project: projectMerge },
  // 204 means on and 404 off, but a key without Administration read also gets a 404: settings.ts trusts it only when
  // actions_permissions, which needs the same permission, read 200.
  vulnerability_alerts: { path: `${R}/vulnerability-alerts`, ok: [204, 404], project: (_b, s) => ({ enabled: s === 204 }) },
  immutable_releases: { path: `${R}/immutable-releases`, ok: [200], project: (b) => pick(b, ['enabled']) },
  actions_permissions: { path: `${R}/actions/permissions`, ok: [200], project: (b) => pick(b, ['enabled', 'allowed_actions', 'sha_pinning_required']) },
  // 409 when allowed_actions isn't "selected": settings.ts reads that as drift, not as missing.
  actions_selected: {
    path: `${R}/actions/permissions/selected-actions`,
    ok: [200],
    project: (b) => ({ ...pick(b, ['github_owned_allowed', 'verified_allowed']), patterns_allowed: isObj(b) ? strs(b.patterns_allowed) : null }),
  },
  actions_workflow: { path: `${R}/actions/permissions/workflow`, ok: [200], project: (b) => pick(b, ['default_workflow_permissions', 'can_approve_pull_request_reviews']) },
  actions_access: { path: `${R}/actions/permissions/access`, ok: [200], project: (b) => pick(b, ['access_level']) },
  actions_retention: { path: `${R}/actions/permissions/artifact-and-log-retention`, ok: [200], project: (b) => pick(b, ['days']) },
  pages: {
    path: `${R}/pages`,
    ok: [200, 404],
    project: (b, s): Json => (s === 404 ? { exists: false, public: null, build_type: null } : { exists: true, ...pick(b, ['public', 'build_type']) }),
  },
  collaborators_admin: {
    path: `${R}/collaborators?affiliation=all&permission=admin&per_page=${PAGE}`,
    ok: [200],
    project: (b) => ({ count: fullList(b)?.length ?? null }),
  },
  collaborators_outside: { path: `${R}/collaborators?affiliation=outside&per_page=${PAGE}`, ok: [200], project: (b) => ({ count: fullList(b)?.length ?? null }) },
  deploy_keys: { path: `${R}/keys?per_page=${PAGE}`, ok: [200], project: (b) => ({ count: fullList(b)?.length ?? null }) },
  hooks: { path: `${R}/hooks?per_page=${PAGE}`, ok: [200], project: hookCounts },
  org_hooks: { path: `/orgs/${OWNER}/hooks?per_page=${PAGE}`, ok: [200], project: hookCounts },
  secrets_repo: { path: `${R}/actions/secrets?per_page=${PAGE}`, ok: [200], project: (b, _s, k) => secretList(b, k) },
  secrets_org: { path: `${R}/actions/organization-secrets?per_page=${PAGE}`, ok: [200], project: (b, _s, k) => secretList(b, k) },
  dependabot_secrets: { path: `${R}/dependabot/secrets?per_page=${PAGE}`, ok: [200], project: (b, _s, k) => secretList(b, k) },
  org: {
    path: `/orgs/${OWNER}`,
    ok: [200],
    project: (b) =>
      pick(b, [
        'two_factor_requirement_enabled',
        'default_repository_permission',
        'members_can_create_public_repositories',
        'members_can_fork_private_repositories',
        'members_can_create_public_pages',
        'members_can_change_repo_visibility',
      ]),
  },
  budgets: {
    path: `/organizations/${OWNER}/settings/billing/budgets?per_page=${PAGE}`,
    ok: [200],
    project: (b) => {
      if (!isObj(b) || !Array.isArray(b.budgets) || b.has_next_page === true || b.budgets.length >= PAGE) return null;
      return b.budgets.map((x) =>
        isObj(x) ? { amount: num(x.budget_amount), stop: bool(x.prevent_further_usage), scope: str(x.budget_scope), type: str(x.budget_type), sku: str(x.budget_product_sku) } : null,
      );
    },
  },
};

async function read(fetcher: Fetcher, path: string, ok: number[], project: (b: unknown, s: number) => Json, query?: string): Promise<Read> {
  // The raw answer lives only inside this function: it is projected or dropped before anything is returned.
  let answer: Answer;
  try {
    answer = await fetcher(path, query);
  } catch {
    return { status: 0, body: null };
  }
  if (!ok.includes(answer.status)) return { status: answer.status, body: null };
  try {
    return { status: answer.status, body: project(answer.body, answer.status) };
  } catch {
    return { status: -1, body: null };
  }
}

/** Not an API read. An unset variable arrives as an empty string and reads false; not passed at all is unread. GitHub's
 * expressions compare strings ignoring case, so "True" switches claude-review on and reads true here too. */
export function claudeEnabledRead(v: string | undefined): Read {
  return v === undefined ? { status: 0, body: null } : { status: 200, body: { value: v.toLowerCase() === 'true' } };
}

export interface SnapshotOptions {
  /** The names workflows on main use; without it every secret and environment name is stored as unreferenced. */
  known?: Known | null;
  /** The CLAUDE_ENABLED variable as the job's vars context gave it; undefined when it wasn't passed. The lane's job has no
   * environment, so it reads the repository's value, as claude-review does. */
  claudeEnabled?: string | undefined;
  /** The job's own built-in token, for the reads it can make, so the key needs no permission for them. */
  builtin?: Fetcher | undefined;
}

/** Reads the job's built-in token makes when it is given (with `pages: read`), instead of the key. */
export const BUILTIN_READS = new Set(['pages']);

/** Every read, in order. A failed read is kept with its status, so settings.ts can tell missing from off. */
export async function takeSnapshot(fetcher: Fetcher, now: Date, options: SnapshotOptions = {}): Promise<Snapshot> {
  const known = options.known ?? null;
  const reads: Record<string, Read> = {};
  for (const [id, spec] of Object.entries(SIMPLE_READS)) {
    const by = BUILTIN_READS.has(id) && options.builtin ? options.builtin : fetcher;
    reads[id] = await read(by, spec.path, spec.ok, (b, s) => spec.project(b, s, known), spec.query);
  }
  reads.claude_enabled = claudeEnabledRead(options.claudeEnabled);

  // Rulesets: the list, then each one in full, including organization rulesets that apply here.
  const list = await read(fetcher, `${R}/rulesets?includes_parents=true&per_page=${PAGE}`, [200], (b) => {
    const l = fullList(b);
    return l ? l.map((x) => (isObj(x) ? num(x.id) : null)) : null;
  });
  if (list.status === 200 && Array.isArray(list.body) && list.body.every((id) => typeof id === 'number')) {
    const items: Json[] = [];
    for (const id of list.body as number[]) {
      const one = await read(fetcher, `${R}/rulesets/${id}`, [200], (b) => projectRuleset(b) as unknown as Json);
      items.push(one as unknown as Json);
    }
    reads.rulesets = { status: 200, body: items };
  } else reads.rulesets = { status: list.status === 200 ? -1 : list.status, body: null };

  // Environments: each one's branch policy and secret names.
  const envs = await read(fetcher, `${R}/environments?per_page=${PAGE}`, [200], (b) => {
    if (!isObj(b) || !Array.isArray(b.environments) || num(b.total_count) !== b.environments.length || b.environments.length >= PAGE) return null;
    return b.environments.map((e) => {
      if (!isObj(e) || typeof e.name !== 'string') return null;
      const p = e.deployment_branch_policy;
      const policy = isObj(p) ? { protected_branches: p.protected_branches === true, custom_branch_policies: p.custom_branch_policies === true } : null;
      return { name: e.name, policy };
    });
  });
  if (envs.status === 200 && Array.isArray(envs.body) && envs.body.every(isObj)) {
    const out: Json[] = [];
    for (const env of envs.body as unknown as EnvBody[]) {
      const base = `${R}/environments/${encodeURIComponent(env.name)}`;
      const name = known?.environments.includes(env.name) ? env.name : UNREFERENCED;
      const item: Record<string, Json> = { name, policy: env.policy as unknown as Json };
      if (env.policy?.custom_branch_policies) {
        item.branch_policies = (await read(fetcher, `${base}/deployment-branch-policies?per_page=${PAGE}`, [200], (b) => {
          if (!isObj(b) || !Array.isArray(b.branch_policies) || num(b.total_count) !== b.branch_policies.length) return null;
          return b.branch_policies.map((x) => (isObj(x) ? { name: str(x.name), type: str(x.type) ?? 'branch' } : null));
        })) as unknown as Json;
      }
      item.secrets = (await read(fetcher, `${base}/secrets?per_page=${PAGE}`, [200], (b) => secretList(b, known))) as unknown as Json;
      out.push(item);
    }
    reads.environments = { status: 200, body: out };
  } else reads.environments = { status: envs.status === 200 ? -1 : envs.status, body: null };

  return { taken_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'), reads };
}
