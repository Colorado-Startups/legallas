// SPDX-License-Identifier: Apache-2.0
// Scans GitHub text for the case patterns in this clone's .git/info/case-patterns.txt, which never leave the clone (#250).
// Prints labels and counts, never the matched words.
//
//   node scripts/case-text-scan.ts draft <file>...      before posting a PR description, issue or comment: exit 1 on a match
//   node scripts/case-text-scan.ts repo <owner/name>    every issue and PR title, body, comment, review and review comment, and
//                                                       each revision in their edit histories (the make-public gate)
//
// Fails, never passes, when the patterns are missing or empty, when a draft file is empty, when the repo read found no issues
// or no pull requests, when an edit history didn't come back, or when a list was too long to read whole.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface Text { label: string; body: string }
interface Node { id: string; body: string; lastEditedAt?: string | null }
interface List<T> { totalCount: number; nodes: T[] }
export interface Item extends Node { number: number; title: string; comments: List<Node>; reviews?: List<Node> }
export interface Edited { id: string; userContentEdits: List<{ diff: string | null }> }

export function patternsFile(): string {
  if (process.env.CASE_PATTERNS) return process.env.CASE_PATTERNS;
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
  return path.join(common, 'info', 'case-patterns.txt');
}

/** An issue's or pull request's texts, and the ids GitHub marks as edited. Throws when a list came back cut short. */
export function flatten(item: Item): { texts: Text[]; edited: Map<string, string> } {
  const texts: Text[] = [];
  const edited = new Map<string, string>();
  const add = (label: string, node: Node) => {
    texts.push({ label, body: node.body ?? '' });
    if (node.lastEditedAt) edited.set(node.id, label);
  };
  const whole = (list: List<unknown>, what: string) => {
    if (list.totalCount > list.nodes.length) throw new Error(`#${item.number}: ${what} has ${list.totalCount}, read ${list.nodes.length}`);
  };
  add(`#${item.number}`, item);
  texts.push({ label: `#${item.number} title`, body: item.title ?? '' });
  whole(item.comments, 'comments');
  for (const c of item.comments.nodes) add(`#${item.number} comment ${c.id}`, c);
  if (item.reviews) {
    whole(item.reviews, 'reviews');
    for (const r of item.reviews.nodes) add(`#${item.number} review ${r.id}`, r);
  }
  return { texts, edited };
}

/** Every revision of the edited texts. Throws when a history came back cut short. */
export function revisions(nodes: readonly Edited[], labels: ReadonlyMap<string, string>): Text[] {
  return nodes.flatMap((n) => {
    const label = labels.get(n.id) ?? n.id;
    if (n.userContentEdits.totalCount > n.userContentEdits.nodes.length) throw new Error(`${label}: edit history cut short`);
    return n.userContentEdits.nodes.map((e, i) => ({ label: `${label} revision ${i + 1}`, body: e.diff ?? '' }));
  });
}

/** A draft's texts. An empty file fails: a wrong path or an empty heredoc must never scan clean. */
export function draftTexts(files: readonly string[]): Text[] {
  if (files.length === 0) throw new Error('nothing was read');
  return files.map((f) => {
    const body = readFileSync(f, 'utf8');
    if (!body.trim()) throw new Error(`nothing was read: ${f} is empty`);
    return { label: f, body };
  });
}

/** How many of each kind the repo read. A kind with none fails: an empty read never passes as clean. */
export function checkRead(counts: Readonly<Record<'issues' | 'pullRequests', number>>): void {
  const none = Object.entries(counts).filter(([, n]) => n === 0).map(([kind]) => kind);
  if (none.length) throw new Error(`nothing was read: ${none.join(', ')}`);
}

/** The edited nodes GitHub returned for these ids: one each and none null, or some edit history went unread. */
export function editedNodes(nodes: readonly (Edited | null)[], ids: readonly string[]): Edited[] {
  const read = nodes.filter((n): n is Edited => n !== null);
  if (nodes.length !== ids.length || read.length !== ids.length) throw new Error(`edit histories: read ${read.length} of ${ids.length}`);
  return read;
}

/** Labels of the texts that match any pattern. One grep over files, so no text reaches the output. */
export function matches(texts: readonly Text[], patterns: string): string[] {
  const lines = readFileSync(patterns, 'utf8').split('\n').filter((l) => l.trim());
  if (lines.length === 0) throw new Error('the patterns file is empty');
  if (texts.length === 0) throw new Error('nothing was read');
  const dir = mkdtempSync(path.join(tmpdir(), 'case-text-'));
  try {
    const files = texts.map((t, i) => {
      const file = path.join(dir, `${i}.txt`);
      writeFileSync(file, t.body);
      return file;
    });
    const grep = spawnSync('grep', ['-liE', '-f', patterns, '--', ...files], { encoding: 'utf8' });
    if (grep.status !== 0 && grep.status !== 1) throw new Error(`grep failed (${grep.status})`);
    return grep.stdout.split('\n').filter(Boolean).map((f) => texts[Number(path.basename(f, '.txt'))]!.label);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// About 50 GraphQL points a page of 50 (GitHub counts each connection's first:), so a whole repository costs a few hundred.
const LIST = (kind: 'issues' | 'pullRequests') => `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) { ${kind}(first: 50, after: $after) { pageInfo { hasNextPage endCursor }
    nodes { id number title body lastEditedAt comments(first: 100) { totalCount nodes { id body lastEditedAt } }
      ${kind === 'pullRequests' ? 'reviews(first: 100) { totalCount nodes { id body lastEditedAt } }' : ''} } } } }`;
const EDITS = `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Comment { id userContentEdits(first: 100) { totalCount nodes { diff } } } } }`;

const gh = (args: string[]) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));

function repoTexts(repo: string): { texts: Text[]; counts: Record<'issues' | 'pullRequests', number> } {
  const [owner, name] = repo.split('/');
  const texts: Text[] = [];
  const edited = new Map<string, string>();
  const counts = { issues: 0, pullRequests: 0 };
  for (const kind of ['issues', 'pullRequests'] as const) {
    let after: string | null = null;
    do {
      const args = ['api', 'graphql', '-f', `query=${LIST(kind)}`, '-F', `owner=${owner}`, '-F', `name=${name}`];
      if (after) args.push('-F', `after=${after}`);
      const page = gh(args).data.repository[kind];
      for (const item of page.nodes as Item[]) {
        counts[kind]++;
        const one = flatten(item);
        texts.push(...one.texts);
        for (const [id, label] of one.edited) edited.set(id, label);
      }
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);
  }
  // Review comments by REST, one list for the repository: an edit leaves updated_at after created_at.
  const pages = gh(['api', '--paginate', '--slurp', `repos/${repo}/pulls/comments?per_page=100`]) as { node_id: string; body: string; pull_request_url: string; created_at: string; updated_at: string }[][];
  for (const c of pages.flat()) {
    const label = `#${c.pull_request_url.split('/').pop()} review comment ${c.node_id}`;
    texts.push({ label, body: c.body ?? '' });
    if (c.updated_at !== c.created_at) edited.set(c.node_id, label);
  }
  checkRead(counts);
  const ids = [...edited.keys()];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const args = ['api', 'graphql', '-f', `query=${EDITS}`, ...batch.flatMap((id) => ['-f', `ids[]=${id}`])];
    texts.push(...revisions(editedNodes(gh(args).data.nodes, batch), edited));
  }
  console.log(`Read ${counts.issues} issues, ${counts.pullRequests} pull requests and ${ids.length} edit histories.`);
  return { texts, counts };
}

if (import.meta.main) {
  const [mode, ...rest] = process.argv.slice(2);
  const texts = mode === 'draft' ? draftTexts(rest)
    : mode === 'repo' && rest[0] ? repoTexts(rest[0]).texts : null;
  if (!texts) {
    console.error('usage: case-text-scan.ts draft <file>... | repo <owner/name>');
    process.exit(2);
  }
  const hits = matches(texts, patternsFile());
  for (const label of hits) console.log(`match: ${label}`);
  console.log(`Read ${texts.length} texts; ${hits.length} match a case pattern.`);
  process.exit(hits.length ? 1 : 0);
}
