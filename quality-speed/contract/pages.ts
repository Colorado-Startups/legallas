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
 * A renamed page's old slug, and its new one. history.jsonl only grows, so its old lines keep the old slug and are read
 * under the new one: the trend runs on across the rename.
 */
export const RENAMED: Readonly<Record<string, PageSlug>> = { documentation: 'repo-documentation' };

/** How many times a page counts in the home score. A page not listed counts once. */
export const HOME_WEIGHTS: Partial<Record<PageSlug, number>> = {};
