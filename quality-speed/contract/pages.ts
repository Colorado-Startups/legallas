// SPDX-License-Identifier: Apache-2.0
// What is particular to this repository's site.

/** The only repository a source link may point at. */
export const REPO = 'legallas';

/**
 * The site's sections, by the group and in the order the home page shows them. Adding a page is one line here.
 * The owner's four groups, 9 Nov: the product a customer uses; Claude building it; the GitHub repository and local
 * folder, in GitHub's tab order; law, templates included.
 */
export const PAGE_GROUPS = {
  product: ['data-room', 'ai-connectors', 'sync', 'build', 'launch-readiness', 'mac-app', 'compliance', 'reliability'],
  claude: ['claude-code', 'claude-documentation', 'claude-settings', 'agents', 'projects'],
  repo: ['code', 'repo-documentation', 'issues', 'pull-requests', 'actions', 'testing', 'ci-overview', 'security', 'insights', 'settings', 'github-app'],
  law: [
    'templates',
    'colorado-regulatory-agencies',
    'sec',
    'colorado-business-law',
    'delaware-business-law',
    'colorado-tax-law',
    'federal-tax-law',
    'delaware-tax-law',
    'employment-law',
    'intellectual-property-law',
    'court-rules',
  ],
} as const;
export const PAGES = [...PAGE_GROUPS.product, ...PAGE_GROUPS.claude, ...PAGE_GROUPS.repo, ...PAGE_GROUPS.law] as const;

export type PageSlug = (typeof PAGES)[number];

/**
 * The pages this public repository's workflow may measure and publish. Fail closed: a page not listed here runs no lane
 * in quality-speed.yml, and nothing of it reaches a `records-*` artifact, the history or the site. A new page stays out
 * until someone adds it here, having checked that it shows no account's token use or spend, no secret's name or date,
 * and no login.
 *
 * | Left out | Why |
 * |---|---|
 * | `agents`, `claude-code`, `claude-documentation`, `claude-settings` | Private pages (the owner, 2026-11-17) |
 * | `actions`, `ci-overview` | Their page code shows dollars from constants and committed baselines (the organization's included
 * amount, a push's cost). Each joins once its page shows none; its measurements and detail are already handled below |
 *
 * A public page can still hold a private part: a lane (PRIVATE_LANES), a measurement (PRIVATE_METRICS), or its lanes'
 * detail (PRIVATE_DETAIL).
 */
export const PUBLIC_PAGES: readonly PageSlug[] = PAGES.filter((page) =>
  (
    [
      ...PAGE_GROUPS.product,
      'projects',
      'code',
      'pull-requests',
      'repo-documentation',
      'issues',
      'testing',
      'security',
      'insights',
      'settings',
      'github-app',
      ...PAGE_GROUPS.law,
    ] as readonly string[]
  ).includes(page),
);
/** Lanes of a public page that stay private all the same, as `<page>/<lane>`: the Security page's secret names and dates. */
export const PRIVATE_LANES: readonly string[] = ['security/keys'];
/**
 * Measurements of a public page that stay private, as `<page>/<metric>`: figures from an owner's account. Each always
 * reads `missing` in this repository, never a value.
 */
export const PRIVATE_METRICS: readonly string[] = ['actions/allowance_forecast_usd', 'actions/usd_per_merge', 'pull-requests/review_tokens_p50'];
/**
 * Public pages whose lanes' detail (drill-downs, readings, the lane's memory in facts/) holds an owner-account figure:
 * dollars a job or a month, or review tokens. Only their records go out; each run starts from no memory. Take a page off
 * once its detail holds none.
 */
export const PRIVATE_DETAIL: readonly PageSlug[] = ['actions', 'ci-overview', 'pull-requests'];
export const isPublicPage = (page: string): page is PageSlug => (PUBLIC_PAGES as readonly string[]).includes(page);
export const isPublicMetric = (page: string, metric: string): boolean => isPublicPage(page) && !PRIVATE_METRICS.includes(`${page}/${metric}`);
/** A page's records as this repository may publish them: a private measurement keeps its id and reads `missing`. */
export function publicRecords<R extends { id: string; page: string; stage: unknown }>(records: readonly R[]): R[] {
  return records.map((r) =>
    isPublicMetric(r.page, r.id) ? r : ({ id: r.id, page: r.page, value: null, status: 'missing', stage: r.stage, measured_at: null, source_url: null, sample_size: null } as unknown as R),
  );
}
export const isPublicLane = (page: string, lane: string): boolean => isPublicPage(page) && !PRIVATE_LANES.includes(`${page}/${lane}`);

/**
 * A renamed page's old slug, and its new one. history.jsonl only grows, so its old lines keep the old slug and are read
 * under the new one: the trend runs on across the rename.
 */
export const RENAMED: Readonly<Record<string, PageSlug>> = { documentation: 'repo-documentation' };

/** How many times a page counts in the home score. A page not listed counts once. */
export const HOME_WEIGHTS: Partial<Record<PageSlug, number>> = {};
