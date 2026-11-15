// SPDX-License-Identifier: Apache-2.0
// Checks every page folder against the format: each folder is a known page, each manifest.json, metrics.json and
// ideal.json passes, metrics.json never comes without a manifest, and a signed-off manifest never without an ideal.json.
// A page with no folder or no list yet is allowed and scores 0, so a new page is one line in pages.ts.
//
//   node quality-speed/contract/check-pages.ts
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, type PageSlug } from './pages.ts';
import { validateIdeal, validateManifest, validateRecords } from './validate.ts';

const isPage = (name: string): name is PageSlug => (PAGES as readonly string[]).includes(name);

/** Walks by hand, because a recursive read follows symlinks out of the folder. */
function hasSymlink(dir: string): boolean {
  return readdirSync(dir, { withFileTypes: true }).some((e) => e.isSymbolicLink() || (e.isDirectory() && hasSymlink(path.join(dir, e.name))));
}

function parse(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Every problem under a pages folder, as lines that hold paths and rules only. */
export function checkPages(pagesDir: string): string[] {
  if (lstatSync(pagesDir, { throwIfNoEntry: false })?.isSymbolicLink()) return ['pages: a symlink is not allowed'];
  const errors: string[] = [];
  const entries = existsSync(pagesDir) ? readdirSync(pagesDir, { withFileTypes: true }) : [];
  // A symlink would let a page's list live outside the folder the goal check and review look at.
  if (existsSync(pagesDir) && hasSymlink(pagesDir)) errors.push('pages: a symlink is not allowed');
  if (entries.some((e) => !e.isDirectory() && !e.isSymbolicLink() && e.name !== '.DS_Store')) errors.push('pages: only folders belong here');
  for (const folder of entries.filter((e) => e.isDirectory()).map((e) => e.name)) {
    if (!isPage(folder)) {
      errors.push('pages: a folder is not in the closed list of pages');
      continue;
    }
    const idealFile = path.join(pagesDir, folder, 'ideal.json');
    if (existsSync(idealFile)) {
      const ideal = parse(idealFile);
      if (ideal === undefined) errors.push(`pages/${folder}/ideal.json: not valid JSON`);
      else errors.push(...validateIdeal(ideal).errors.map((e) => `pages/${folder}/ideal.json: ${e}`));
    }
    const manifestFile = path.join(pagesDir, folder, 'manifest.json');
    const metricsFile = path.join(pagesDir, folder, 'metrics.json');
    if (!existsSync(manifestFile)) {
      if (existsSync(metricsFile)) errors.push(`pages/${folder}: metrics.json needs a manifest.json`);
      continue;
    }
    const parsed = parse(manifestFile);
    if (parsed === undefined) {
      errors.push(`pages/${folder}/manifest.json: not valid JSON`);
      continue;
    }
    // A list that scores says what it works toward.
    const signedOff = (parsed as { signoff_comment?: unknown } | null)?.signoff_comment !== undefined;
    if (signedOff && !existsSync(idealFile)) errors.push(`pages/${folder}: a signed-off manifest.json needs an ideal.json`);
    const manifest = validateManifest(parsed, folder);
    errors.push(...manifest.errors.map((e) => `pages/${folder}/manifest.json: ${e}`));
    if (!manifest.value || !existsSync(metricsFile)) continue;
    const records = validateRecords(parse(metricsFile), manifest.value);
    errors.push(...records.errors.map((e) => `pages/${folder}/metrics.json: ${e}`));
  }
  return errors;
}

if (import.meta.main) {
  const errors = checkPages(fileURLToPath(new URL('../pages', import.meta.url)));
  for (const error of errors) console.error(error);
  if (errors.length) process.exit(1);
  console.log('Every page folder passes.');
}
