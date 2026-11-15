// SPDX-License-Identifier: Apache-2.0
// What GitHub shows around the files: the licence it detects, the About box, main's Activity and the custom properties.
// Read with the lane's read-only $GH_TOKEN. A failed read throws, and the collector writes that metric as missing.

const API = 'https://api.github.com';
export const OWNER = 'Colorado-Startups';
export const NAME = 'legallas';

async function call(token: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(API + path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...init.headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status}`);
  return res.json();
}

export interface Repo { description: string | null; topics: string[]; homepage: string | null; license: { spdx_id: string | null } | null }

export const readRepo = (token: string) => call(token, `/repos/${OWNER}/${NAME}`) as Promise<Repo>;

/** The repository's custom property values. The metadata read every token has is enough. */
export const readProperties = (token: string) =>
  call(token, `/repos/${OWNER}/${NAME}/properties/values`) as Promise<{ property_name: string; value: unknown }[]>;

/** The About box's three fields, each set; the website also answers. Percent of three. */
export function aboutShare(repo: Pick<Repo, 'description' | 'topics' | 'homepage'>, websiteAlive: boolean): number {
  const set = [Boolean(repo.description?.trim()), repo.topics.length > 0, Boolean(repo.homepage?.trim()) && websiteAlive];
  return (100 * set.filter(Boolean).length) / set.length;
}

export async function alive(url: string | null): Promise<boolean> {
  if (!url || !/^https:\/\//.test(url)) return false;
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    await res.body?.cancel();
    return res.status < 400;
  } catch {
    return false;
  }
}

export interface MainCommit { oid: string; prs: { merged: boolean; base: string }[] }

/** main's newest first-parent commits, each with the pull requests GitHub ties to it. One GraphQL call. */
export async function readMain(token: string, count: number): Promise<MainCommit[]> {
  const query = `{repository(owner:"${OWNER}",name:"${NAME}"){defaultBranchRef{target{... on Commit{history(first:${count}){nodes{oid associatedPullRequests(first:5){nodes{merged baseRefName}}}}}}}}}`;
  const body = (await call(token, '/graphql', { method: 'POST', body: JSON.stringify({ query }) })) as {
    data?: { repository?: { defaultBranchRef?: { target?: { history?: { nodes: { oid: string; associatedPullRequests: { nodes: { merged: boolean; baseRefName: string }[] } }[] } } } } };
  };
  const nodes = body.data?.repository?.defaultBranchRef?.target?.history?.nodes;
  if (!nodes) throw new Error('graphql: no history');
  return nodes.map((n) => ({ oid: n.oid, prs: n.associatedPullRequests.nodes.map((p) => ({ merged: p.merged, base: p.baseRefName })) }));
}

/** The share of main's commits that came through a pull request merged into main. */
export function viaPrShare(commits: MainCommit[]): number {
  const through = commits.filter((c) => c.prs.some((p) => p.merged && p.base === 'main')).length;
  return commits.length === 0 ? 0 : (100 * through) / commits.length;
}
