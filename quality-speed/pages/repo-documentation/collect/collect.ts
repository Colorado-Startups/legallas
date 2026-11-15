// SPDX-License-Identifier: Apache-2.0
// The repo documentation page's collector: the repository's front door. Writes one record per metric of the lane it
// runs, in the contract's metrics.json shape.
//
//   node quality-speed/pages/repo-documentation/collect/collect.ts daily --out metrics.json [--details details.json]
//
// core/collect.ts runs it that way for each lane in lanes.json: daily for the files and GitHub's reads, weekly for
// external links. --details writes the per-file table for a local look; it never reaches the site.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MetricRecord } from '../../../contract/format.ts';
import { laneRecord } from '../../../core/lane/collect.ts';
import { type Corpus, loadCorpus } from './corpus.ts';
import { checkWithHosts, deadReading } from './external.ts';
import { readingMinutes, tokensOf, visualShare } from './front.ts';
import { aboutShare, alive, readMain, readProperties, readRepo, viaPrShare } from './github.ts';
import { INPUTS } from './inputs.ts';
import { brokenLinks, externalLinks } from './links.ts';
import { deadNames, loadContext } from './names.ts';

export const PAGE = 'repo-documentation';
const HERE = dirname(fileURLToPath(import.meta.url));
export const CONFIG_DIR = resolve(HERE, '..');
/** The files a visitor meets first: the README, then the community files GitHub links beside it. */
export const FRONT_DOOR = [INPUTS.readme, ...INPUTS.community];

export interface RunInfo { commit: string; at: string; sourceUrl: string }

export function runInfo(root: string, env = process.env): RunInfo {
  const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const repo = 'https://github.com/Colorado-Startups/legallas';
  const sourceUrl = env.GITHUB_RUN_ID && /^\d+$/.test(env.GITHUB_RUN_ID) ? `${repo}/actions/runs/${env.GITHUB_RUN_ID}` : `${repo}/commit/${commit}`;
  return { commit, at, sourceUrl };
}

export function ok(run: RunInfo, id: string, value: number, sample: number): MetricRecord {
  return { id, page: PAGE, value, status: 'ok', stage: 'lab', measured_at: run.at, source_url: run.sourceUrl, sample_size: sample };
}

export function missing(id: string): MetricRecord {
  return { id, page: PAGE, value: null, status: 'missing', stage: 'lab', measured_at: null, source_url: null, sample_size: null };
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

/** Each front-door file: present, its visual share, and the dead names and broken links in it. */
export function frontFiles(c: Corpus, notInTree: string) {
  const names = deadNames(c, loadContext(c, notInTree));
  const links = brokenLinks(c);
  return FRONT_DOOR.map((path) => {
    const doc = c.docs.get(path);
    return {
      path,
      present: Boolean(doc),
      visual: doc ? round(visualShare(doc)) : 0,
      dead_names: names.filter((n) => n.path === path).length,
      broken_links: links.filter((l) => l.path === path).length,
      internal_links: doc ? doc.links.filter((l) => !/^[a-z][a-z0-9+.-]*:/i.test(l.target)).length : 0,
    };
  });
}

/** One GitHub read as a record, or missing when there is no token or the read fails. */
async function fromGitHub(id: string, token: string | undefined, read: (token: string) => Promise<[number, number]>, run: RunInfo): Promise<MetricRecord> {
  if (!token) return missing(id);
  try {
    const [value, sample] = await read(token);
    return ok(run, id, round(value), sample);
  } catch (e) {
    console.error(`${id}: ${(e as Error).message}, so it reads missing`);
    return missing(id);
  }
}

export async function daily(root: string, run: RunInfo, token: string | undefined): Promise<{ records: MetricRecord[]; details: Record<string, unknown> }> {
  const c = loadCorpus(root);
  const files = frontFiles(c, join(CONFIG_DIR, 'not-in-tree.json'));
  const readme = c.docs.get(INPUTS.readme);
  const community = files.slice(1);
  const communityOk = community.filter((f) => f.present && f.visual >= INPUTS.community_visual_min && f.dead_names === 0 && f.broken_links === 0).length;
  const records: MetricRecord[] = [
    readme ? ok(run, 'readme_visual_share', round(visualShare(readme)), readme.lines.length) : missing('readme_visual_share'),
    ok(run, 'front_door_dead_names', files.reduce((n, f) => n + f.dead_names, 0), files.filter((f) => f.present).length),
    ok(run, 'front_door_broken_links', files.reduce((n, f) => n + f.broken_links, 0), files.reduce((n, f) => n + f.internal_links, 0)),
    ok(run, 'community_files_ok', round((100 * communityOk) / community.length), community.length),
    await fromGitHub('license_detected', token, async (t) => [(await readRepo(t)).license?.spdx_id === 'Apache-2.0' ? 1 : 0, 1], run),
    await fromGitHub('about_box_set', token, async (t) => {
      const repo = await readRepo(t);
      return [aboutShare(repo, await alive(repo.homepage)), 3];
    }, run),
    await fromGitHub('main_via_pr', token, async (t) => {
      const commits = await readMain(t, INPUTS.main_commits);
      return [viaPrShare(commits), commits.length];
    }, run),
    await fromGitHub('custom_properties_set', token, async (t) => {
      const set = (await readProperties(t)).filter((p) => p.value !== null && p.value !== '').length;
      return [set > 0 ? 1 : 0, Math.max(set, 1)];
    }, run),
    readme ? ok(run, 'readme_reading_minutes', round(readingMinutes(readme)), 1) : missing('readme_reading_minutes'),
    readme ? ok(run, 'readme_tokens', tokensOf(readme.lines.join('\n')), 1) : missing('readme_tokens'),
  ];
  return { records, details: { files } };
}

export async function weekly(root: string, run: RunInfo, contact: string): Promise<{ records: MetricRecord[]; details: Record<string, unknown> }> {
  const c = loadCorpus(root);
  const urls = externalLinks(c).filter((l) => FRONT_DOOR.includes(l.path)).map((l) => l.url);
  const results = await checkWithHosts(urls, contact);
  const reading = deadReading(results);
  const records = [reading ? ok(run, 'dead_external_links', reading.dead, reading.definite) : missing('dead_external_links')];
  return { records, details: { external: results.map((r) => ({ url: r.url, verdict: r.verdict })) } };
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = resolve(arg('root', resolve(HERE, '../../../..')));
  // core/collect.ts passes the lane as a plain word; --lane works too, for a local run.
  const lane = arg('lane', process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'daily');
  const run = runInfo(root);
  const out =
    lane === 'daily' ? await daily(root, run, process.env.GH_TOKEN) : lane === 'weekly' ? await weekly(root, run, process.env.LEGALLAS_LAW_CONTACT ?? '') : null;
  if (!out) {
    console.error('Unknown lane: use daily or weekly.');
    process.exit(2);
  }
  // The daily lane is the page's main one. Last, after every check, so it times the whole lane (core/lane/collect.ts).
  if (lane === 'daily') out.records.push(await laneRecord(PAGE));
  writeFileSync(arg('out', 'metrics.json'), `${JSON.stringify(out.records, null, 2)}\n`);
  if (process.argv.includes('--details')) writeFileSync(arg('details', 'details.json'), `${JSON.stringify(out.details, null, 2)}\n`);
  for (const r of out.records) console.log(`${r.id}: ${r.status} ${r.value ?? ''}`);
}
