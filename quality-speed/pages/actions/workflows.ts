// SPDX-License-Identifier: Apache-2.0
// What the workflow files say, read as text because the site installs no packages. This site's own workflow is left out,
// so adding it can't lift a share. Only the shapes these files use are understood, and anything else reads as a failure.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { detailId, isSiteFile, type Reading } from './measure.ts';

export interface SourceFile {
  name: string;
  text: string;
}

/** Reads from a real room, so this site never runs it, and it stays off the list of workflows that must prove they run. */
export const NEVER_RUN_HERE: readonly string[] = ['replica-eval.yml'];

export function readWorkflows(root: string): SourceFile[] {
  const dir = path.join(root, '.github/workflows');
  return readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name) && !isSiteFile(`.github/workflows/${name}`))
    .sort()
    .map((name) => ({ name, text: readFileSync(path.join(dir, name), 'utf8') }));
}

export function readScripts(root: string): SourceFile[] {
  const dir = path.join(root, '.github/scripts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sh'))
    .sort()
    .map((name) => ({ name, text: readFileSync(path.join(dir, name), 'utf8') }));
}

/** A workflow's jobs, each with its lines. A job is a key two spaces in under a top-level `jobs:`. */
export function jobBlocks(text: string): Map<string, string[]> {
  const blocks = new Map<string, string[]>();
  let inJobs = false;
  let current: string[] | undefined;
  for (const line of text.split('\n')) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (/^\S/.test(line) && !line.startsWith('#')) {
      inJobs = false;
      current = undefined;
      continue;
    }
    const job = /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(line);
    if (job?.[1]) {
      current = [];
      blocks.set(job[1], current);
    } else {
      current?.push(line);
    }
  }
  return blocks;
}

/** The most a job's limit may be and still count. The default is six hours, which on a Mac is $22 from one hung job; today's longest is 30. */
const MAX_TIMEOUT_MINUTES = 60;

/** Each workflow's jobs in this checkout, as `<workflow>_<job>` ids: the only names the spend table may show. */
export function knownJobs(workflows: readonly SourceFile[]): Set<string> {
  const known = new Set<string>();
  for (const file of workflows) {
    const workflow = detailId(file.name.replace(/\.ya?ml$/, ''));
    for (const [job, lines] of jobBlocks(file.text)) {
      known.add(`${workflow}_${detailId(job)}`);
      const name = lines.map((line) => /^ {4}name:\s*(.+?)\s*$/.exec(line)?.[1]).find(Boolean);
      if (name && !name.includes('${{')) known.add(`${workflow}_${detailId(name)}`);
    }
  }
  return known;
}

/** Every job names its own limit, and a low one, so `timeout-minutes: 360` doesn't pass. */
export function jobsWithTimeout(files: readonly SourceFile[]): Reading | null {
  let jobs = 0;
  let limited = 0;
  for (const file of files) {
    for (const lines of jobBlocks(file.text).values()) {
      jobs += 1;
      const limit = lines.map((line) => /^ {4}timeout-minutes:\s*(\d+)/.exec(line)?.[1]).find(Boolean);
      if (limit && Number(limit) <= MAX_TIMEOUT_MINUTES) limited += 1;
    }
  }
  return jobs ? { value: (limited / jobs) * 100, samples: jobs } : null;
}

/** Pinned means a full commit SHA, a local action, or an image by digest. A tag can move under you. */
export function isPinned(reference: string): boolean {
  return reference.startsWith('./') || /^docker:\/\/.+@sha256:[0-9a-f]{64}$/.test(reference) || /@[0-9a-f]{40}$/.test(reference);
}

const USES = /^\s*(?:-\s+)?uses:\s*['"]?([^'"\s#]+)/;
const DOWNLOAD_THEN_RUN = [
  /\b(?:curl|wget)\b[^|#]*\|\s*(?:sudo\s+)?(?:(?:ba|z|da)?sh|python3?)\b/,
  /\b(?:ba|z)?sh\s+<\(\s*(?:curl|wget)\b/,
];

/** The two kinds of unpinned dependency OpenSSF Scorecard names that a text read can find: an action on a tag, and a download piped straight into a shell. */
export function unpinnedDependencies(workflows: readonly SourceFile[], scripts: readonly SourceFile[]): Reading {
  let value = 0;
  let samples = 0;
  for (const file of workflows) {
    for (const line of file.text.split('\n')) {
      const uses = USES.exec(line);
      if (!uses?.[1]) continue;
      samples += 1;
      if (!isPinned(uses[1])) value += 1;
    }
  }
  for (const file of [...workflows, ...scripts]) {
    for (const line of file.text.split('\n')) {
      if (/^\s*#/.test(line)) continue;
      if (DOWNLOAD_THEN_RUN.some((pattern) => pattern.test(line))) {
        value += 1;
        samples += 1;
      }
    }
  }
  return { value, samples };
}

/** The jobs a job waits for, from `needs: [a, b]`. */
export function jobNeeds(lines: readonly string[]): string[] {
  for (const line of lines) {
    const needs = /^ {4}needs:\s*\[([^\]]*)\]/.exec(line);
    if (needs) return (needs[1] ?? '').split(',').map((name) => name.trim()).filter(Boolean);
  }
  return [];
}

/** The text of the last `run: |` block in a job, without its indent, as GitHub would hand it to the shell. */
export function runBlock(lines: readonly string[]): string | null {
  let found: string | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const start = /^(\s*)(?:-\s+)?run:\s*\|[-+]?\s*$/.exec(lines[i] ?? '');
    if (!start) continue;
    const keyIndent = (lines[i] ?? '').indexOf('run:');
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j] ?? '';
      if (line.trim() && line.search(/\S/) <= keyIndent) break;
      body.push(line);
    }
    const indent = Math.min(...body.filter((line) => line.trim()).map((line) => line.search(/\S/)));
    found = body.map((line) => line.slice(indent)).join('\n');
  }
  return found;
}
