// SPDX-License-Identifier: Apache-2.0
// Invented history for the tests: numbers, times and wording are made up, and no record comes from the repository.
import { DAY_MS, HOUR_MS, type History, type PullFacts, type RawPull, type RawRun } from './delivery.ts';

/** A fixed "now" for every test: noon UTC on an invented day. */
export const NOW = Date.parse('2031-03-20T12:00:00Z');
export const iso = (t: number) => new Date(t).toISOString();
export const sha = (n: number) => n.toString(16).padStart(40, 'a');

export interface PullSpec {
  number: number;
  /** Days before NOW (fractions allowed). Null leaves it unmerged. */
  mergedDaysAgo: number | null;
  title?: string;
  body?: string | null;
  base?: string;
  head?: string;
  dependabot?: boolean;
  /** Hours from the first commit to the merge. */
  leadHours?: number;
  files?: string[];
}

export function pull(spec: PullSpec): RawPull {
  const merged = spec.mergedDaysAgo === null ? null : NOW - spec.mergedDaysAgo * DAY_MS;
  const created = (merged ?? NOW) - (spec.leadHours ?? 1) * HOUR_MS;
  return {
    number: spec.number,
    title: spec.title ?? `Invented change ${spec.number}`,
    body: spec.body ?? null,
    created_at: iso(created),
    merged_at: merged === null ? null : iso(merged),
    merge_commit_sha: merged === null ? null : sha(spec.number),
    base: { ref: spec.base ?? 'main' },
    head: { ref: spec.head ?? `claude/invented-${spec.number}` },
    user: spec.dependabot ? { type: 'Bot', login: 'dependabot[bot]' } : { type: 'User', login: 'invented-person' },
  };
}

export function run(id: number, forPull: number | string, createdDaysAgo: number, conclusion: string | null, status = 'completed'): RawRun {
  const created = NOW - createdDaysAgo * DAY_MS;
  return {
    id,
    path: '.github/workflows/ci.yml',
    event: 'push',
    head_branch: 'main',
    head_sha: typeof forPull === 'number' ? sha(forPull) : forPull,
    status,
    conclusion,
    created_at: iso(created),
    updated_at: iso(created + 10 * 60_000),
  };
}

/** A history from specs: facts for every merged pull request, a green CI run a minute after each merge by default. */
export function history(
  specs: PullSpec[],
  options: { issues?: number[]; bugIssues?: number[]; runs?: RawRun[]; greenRuns?: boolean } = {},
): History {
  const pulls = specs.map(pull);
  const facts = new Map<number, PullFacts>();
  for (const [i, p] of pulls.entries()) {
    if (p.merged_at === null) continue;
    facts.set(p.number, { firstCommitAt: p.created_at, files: specs[i]?.files ?? ['web/src/invented.ts'] });
  }
  const green =
    options.greenRuns === false
      ? []
      : specs
          .filter((s) => s.mergedDaysAgo !== null && (s.base ?? 'main') === 'main')
          .map((s, i) => run(10_000 + i, s.number, (s.mergedDaysAgo as number) - 1 / (24 * 60), 'success'));
  const bugs = options.bugIssues ?? [];
  return {
    pulls,
    facts,
    runs: [...green, ...(options.runs ?? [])],
    issues: new Set([...(options.issues ?? []), ...bugs]),
    bugIssues: new Set(bugs),
  };
}
