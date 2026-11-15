// SPDX-License-Identifier: Apache-2.0
// What a lane keeps beside its records, in $DETAIL_DIR:
//
//   detail.json       Short ids and numbers only. Anything outside the shape here is dropped.
//   page/<name>.json  Copied beside the page's page.ts before the build, the only place page code can read in the fence.
//                     The page decides what reaches the site, and the guard checks what does. It can't replace a file
//                     that's already there, such as the reviewed manifest.
//   facts/            The lane's own memory, back in $PREV_DIR next run. Never published, but other lanes can read it,
//                     so it must hold no secret.
//
// Nothing else leaves a lane: the guard can read text, so nothing it can't read gets near the site.
//
// The folder lives with its lane in the state, and travels with the lane's records.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Short on purpose, so an id can't carry a title. */
const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const MAX_DETAIL_BYTES = 1024 * 1024;
/** Each day's state is kept for 90 days, so a lane's memory stays small. */
const MAX_FACTS_BYTES = 2 * 1024 * 1024;
const PAGE_FILE = /^[a-z0-9][a-z0-9._-]{0,63}\.json$/;

export interface Reading {
  value: number;
  limit: number | null;
  n: number;
}

export interface Detail {
  checks: Record<string, 0 | 1>;
  readings: Record<string, Reading>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasOnly = (v: Record<string, unknown>, ...keys: string[]) => Object.keys(v).every((key) => keys.includes(key));
const idsAre = (v: Record<string, unknown>, test: (entry: unknown) => boolean) => Object.entries(v).every(([id, entry]) => ID.test(id) && test(entry));

const isReading = (v: unknown): boolean =>
  isObject(v) && hasOnly(v, 'value', 'limit', 'n') && Number.isFinite(v.value) && (v.limit === null || Number.isFinite(v.limit)) && Number.isInteger(v.n) && (v.n as number) >= 0;

export function isDetail(v: unknown): v is Detail {
  return isObject(v) && hasOnly(v, 'checks', 'readings') && isObject(v.checks) && isObject(v.readings) &&
    idsAre(v.checks, (check) => check === 0 || check === 1) && idsAre(v.readings, isReading);
}

function readDetail(file: string): Detail | null {
  if (!existsSync(file) || statSync(file).size > MAX_DETAIL_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return isDetail(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Keeps a lane's memory for its next run, unless it has grown too big or holds anything but plain files and folders. */
export function carryFacts(from: string, to: string): void {
  const facts = path.join(from, 'facts');
  if (!existsSync(facts)) return;
  const entries = readdirSync(facts, { recursive: true, withFileTypes: true });
  if (entries.some((e) => !e.isFile() && !e.isDirectory())) return;
  const bytes = entries.filter((e) => e.isFile()).reduce((sum, e) => sum + statSync(path.join(e.parentPath, e.name)).size, 0);
  if (bytes <= MAX_FACTS_BYTES) cpSync(facts, path.join(to, 'facts'), { recursive: true });
}

/** A page file passes if its name is plain and it's a small, valid JSON file. */
function isPageFile(file: string): boolean {
  if (!PAGE_FILE.test(path.basename(file)) || !statSync(file).isFile() || statSync(file).size > MAX_DETAIL_BYTES) return false;
  try {
    JSON.parse(readFileSync(file, 'utf8'));
    return true;
  } catch {
    return false;
  }
}

/** Copies what passes from a lane's folder to the new state. */
export function carryDetail(from: string, to: string): void {
  carryFacts(from, to);
  const pageFiles = path.join(from, 'page');
  if (existsSync(pageFiles)) {
    for (const name of readdirSync(pageFiles).filter((n) => isPageFile(path.join(pageFiles, n)))) {
      mkdirSync(path.join(to, 'page'), { recursive: true });
      copyFileSync(path.join(pageFiles, name), path.join(to, 'page', name));
    }
  }
  const detail = readDetail(path.join(from, 'detail.json'));
  if (detail) {
    mkdirSync(to, { recursive: true });
    writeFileSync(path.join(to, 'detail.json'), JSON.stringify(detail));
  }
}

const laneDirs = (state: string, slug: string): string[] => {
  const dir = path.join(state, 'lanes', slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name)).sort();
};

/** Puts every lane's page files beside its page.ts, for page code to read in the fence. Never over a file already there. */
export function copyPageFiles(state: string, slugs: readonly string[], pagesDir: string): void {
  for (const slug of slugs) {
    for (const dir of laneDirs(state, slug)) {
      const pageFiles = path.join(dir, 'page');
      if (!existsSync(pageFiles)) continue;
      for (const name of readdirSync(pageFiles).filter((n) => isPageFile(path.join(pageFiles, n)))) {
        const target = path.join(pagesDir, slug, name);
        if (!existsSync(target)) copyFileSync(path.join(pageFiles, name), target);
      }
    }
  }
}

/** A page's detail across its lanes, or null when none has any. */
export function pageDetail(state: string, slug: string): Detail | null {
  const details = laneDirs(state, slug).map((dir) => readDetail(path.join(dir, 'detail.json'))).filter((d) => d !== null);
  if (!details.length) return null;
  return { checks: Object.assign({}, ...details.map((d) => d.checks)), readings: Object.assign({}, ...details.map((d) => d.readings)) };
}
