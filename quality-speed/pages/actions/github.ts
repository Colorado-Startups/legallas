// SPDX-License-Identifier: Apache-2.0
// The GitHub reads this page makes. Any read that fails throws, so a metric built on it is missing and never a good
// number. An empty answer is a real answer only for the lists that can honestly be empty, and the billing report is not
// read at all: it answers an empty list for this organization, with no error, whatever has been spent.
import { cachedJobs, encodeLedger, type Ledger } from './ledger.ts';
import { Unreadable, type Job, type PullRequest, type Run } from './measure.ts';
import { ranStep, type Rule, type TokenJob } from './moved.ts';

const API = 'https://api.github.com';
const PAGE_SIZE = 100;
/** GitHub stops at this many results for a search by date, without saying so in the status. */
const SEARCH_LIMIT = 1000;
/** Under the 15,000 an hour GitHub gives a job's token on an Enterprise Cloud repository, shared with the other pages. The ledger keeps a pass well under it (#240). */
const MAX_READS = 12_000;
/** Left for the pull requests and the proven checks once job reads stop, so they still read while a cold ledger fills over several passes. */
const RESERVE = 2_000;
/** GitHub allows 900 reads a minute, so a few at a time stays under it. */
const AT_ONCE = 4;
const TRIES = 3;
const MS = 1000;

type Query = Record<string, string | number>;

export class Github {
  reads = 0;
  private readonly token: string;
  private readonly repo: string;

  constructor(token: string, repo: string) {
    this.token = token;
    this.repo = repo;
  }

  private async get<T>(path: string, query: Query = {}): Promise<T> {
    const search = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
    const url = `${API}/repos/${this.repo}${path}${search.size ? `?${search}` : ''}`;
    for (let attempt = 1; ; attempt += 1) {
      this.reads += 1;
      if (this.reads > MAX_READS) throw new Unreadable('this pass would read more than it may');
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'legallas-quality-speed' },
        signal: AbortSignal.timeout(30 * MS),
      }).catch(() => null);
      if (response?.ok) return (await response.json()) as T;
      const retryable = !response || response.status >= 500 || response.status === 429 || (response.status === 403 && response.headers.has('retry-after'));
      if (!retryable || attempt >= TRIES) throw new Unreadable(`a read failed with ${response?.status ?? 'no answer'}`);
      const wait = Number(response?.headers.get('retry-after') ?? attempt * 5);
      await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 60) * MS));
    }
  }

  /** Runs created in a span. A span past the search limit is split in two, and any run short of the count throws. */
  private async runsIn(from: number, to: number): Promise<Omit<Run, 'jobs'>[]> {
    const created = `${new Date(from).toISOString().slice(0, 19)}Z..${new Date(to).toISOString().slice(0, 19)}Z`;
    const first = await this.get<{ total_count: number; workflow_runs: Omit<Run, 'jobs'>[] }>('/actions/runs', { created, per_page: PAGE_SIZE, exclude_pull_requests: 'true' });
    if (first.total_count >= SEARCH_LIMIT) {
      if (to - from < 2 * MS) throw new Unreadable('more runs in a second than a search can return');
      const middle = from + Math.floor((to - from) / 2 / MS) * MS;
      return [...(await this.runsIn(from, middle)), ...(await this.runsIn(middle + MS, to))];
    }
    const runs = [...first.workflow_runs];
    for (let page = 2; runs.length < first.total_count; page += 1) {
      const next = await this.get<{ workflow_runs: Omit<Run, 'jobs'>[] }>('/actions/runs', { created, per_page: PAGE_SIZE, page, exclude_pull_requests: 'true' });
      if (!next.workflow_runs.length) throw new Unreadable('the runs did not all arrive');
      runs.push(...next.workflow_runs);
    }
    return runs;
  }

  private async jobsOf(run: Omit<Run, 'jobs'>): Promise<Job[]> {
    const jobs: Job[] = [];
    for (let page = 1; ; page += 1) {
      const data = await this.get<{ total_count: number; jobs: Job[] }>(`/actions/runs/${run.id}/jobs`, { filter: 'all', per_page: PAGE_SIZE, page });
      jobs.push(...data.jobs);
      // A rerun of failed jobs lists the ones it copied, with the same times, and those only ran and billed once.
      if (jobs.length >= data.total_count) return [...new Map(jobs.map((job) => [`${job.name} ${job.started_at} ${job.completed_at}`, job])).values()];
      if (!data.jobs.length) throw new Unreadable('the jobs of a run did not all arrive');
    }
  }

  /**
   * Runs since a time, with their jobs. A skipped run has none that cost anything, and a running one isn't finished, so
   * neither is read or kept. A finished run's jobs come from the ledger when its attempt and last update match, and are
   * read otherwise. The new ledger keeps every finished run this pass has jobs for, and drops runs no longer listed. A run
   * left unread, by the read budget or a failed read, makes the pass incomplete: none of its runs may be measured, but the
   * ledger keeps what was read, so the next pass carries on.
   */
  async runsSince(since: Date, now: Date, ledger: Ledger): Promise<{ runs: Run[]; complete: boolean; ledger: Ledger; cached: number; read: number }> {
    const listed = [...new Map((await this.runsIn(since.getTime(), now.getTime())).map((run) => [run.id, run])).values()];
    const finished = (run: Omit<Run, 'jobs'>) => run.status === 'completed' && run.conclusion !== 'skipped';
    // In listing order, whichever way the jobs arrived, so a measure that takes the first match takes the same one.
    const runs: (Run | null)[] = listed.map((run) => {
      const jobs = finished(run) ? cachedJobs(ledger, run) : [];
      return jobs && { ...run, jobs };
    });
    const unread = runs.flatMap((run, i) => (run ? [] : [i]));
    const cached = runs.filter((run, i) => run && finished(listed[i] as Omit<Run, 'jobs'>)).length;
    let complete = true;
    let read = 0;
    let next = 0;
    const worker = async () => {
      while (complete && next < unread.length) {
        if (this.reads >= MAX_READS - RESERVE) {
          complete = false;
          return;
        }
        const i = unread[next] as number;
        next += 1;
        const run = listed[i] as Omit<Run, 'jobs'>;
        try {
          runs[i] = { ...run, jobs: await this.jobsOf(run) };
          read += 1;
        } catch (error) {
          if (!(error instanceof Unreadable)) throw error;
          complete = false;
        }
      }
    };
    await Promise.all(Array.from({ length: AT_ONCE }, worker));
    const out = runs.filter((run) => run !== null);
    return { runs: out, complete, ledger: encodeLedger(out.filter(finished)), cached, read };
  }

  /** Pull requests touched since a time, each with its files. */
  async pullsSince(since: Date): Promise<PullRequest[]> {
    interface Raw {
      number: number;
      head: { ref: string; sha: string };
      created_at: string;
      updated_at: string;
      closed_at: string | null;
      merged_at: string | null;
      merge_commit_sha: string | null;
      user?: { type?: string } | null;
    }
    const raws: Raw[] = [];
    for (let page = 1; ; page += 1) {
      const data = await this.get<Raw[]>('/pulls', { state: 'all', sort: 'updated', direction: 'desc', per_page: PAGE_SIZE, page });
      const inWindow = data.filter((pull) => Date.parse(pull.updated_at) >= since.getTime());
      raws.push(...inWindow);
      if (inWindow.length < data.length || data.length < PAGE_SIZE) break;
    }
    const pulls: PullRequest[] = [];
    let next = 0;
    const worker = async () => {
      while (next < raws.length) {
        const raw = raws[next] as Raw;
        next += 1;
        pulls.push({
          number: raw.number,
          head_ref: raw.head.ref,
          head_sha: raw.head.sha,
          created_at: raw.created_at,
          closed_at: raw.closed_at,
          merged_at: raw.merged_at,
          merge_commit_sha: raw.merged_at ? raw.merge_commit_sha : null,
          files: await this.filesOf(raw.number),
          user_type: raw.user?.type,
        });
      }
    };
    await Promise.all(Array.from({ length: AT_ONCE }, worker));
    return pulls;
  }

  private async filesOf(number: number): Promise<string[]> {
    const files: string[] = [];
    for (let page = 1; ; page += 1) {
      const data = await this.get<{ filename: string; previous_filename?: string }[]>(`/pulls/${number}/files`, { per_page: PAGE_SIZE, page });
      files.push(...data.flatMap((file) => (file.previous_filename ? [file.filename, file.previous_filename] : [file.filename])));
      if (data.length < PAGE_SIZE) return files;
    }
  }

  /** Whether a workflow has really run and passed since a time. A skipped run is not proof. */
  async provenSince(workflow: string, since: Date): Promise<boolean> {
    const created = `>=${since.toISOString().slice(0, 10)}`;
    const data = await this.get<{ total_count: number; workflow_runs: { conclusion: string | null }[] }>(`/actions/workflows/${workflow}/runs`, { status: 'success', created, per_page: 1 });
    return data.workflow_runs.some((run) => run.conclusion === 'success');
  }

  /** Main's branch rules, as the rulesets give them. */
  async rulesOnMain(): Promise<Rule[]> {
    return this.get<Rule[]>('/rules/branches/main', { per_page: PAGE_SIZE });
  }

  /** Every attempt of every job that ran a token step, in these workflows' runs created since a time (the GitHub App page's read). */
  async tokenJobs(workflows: readonly { file: string; steps: string[] }[], since: Date): Promise<TokenJob[]> {
    const created = `>=${since.toISOString().slice(0, 10)}`;
    const jobs: TokenJob[] = [];
    for (const { file, steps } of workflows) {
      const listed = await this.get<{ workflow_runs: { id: number }[] }>(`/actions/workflows/${file}/runs`, { status: 'completed', created, per_page: PAGE_SIZE });
      for (const { id } of listed.workflow_runs) {
        const run = await this.get<{ jobs: TokenJob[] }>(`/actions/runs/${id}/jobs`, { filter: 'all', per_page: PAGE_SIZE });
        jobs.push(...run.jobs.filter((job) => ranStep(job, steps)));
      }
    }
    return jobs;
  }
}
