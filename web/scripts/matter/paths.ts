// SPDX-License-Identifier: Apache-2.0
// Card F4. Where the matter build reads and writes, and the guard that keeps its output out of every git
// checkout and out of the mirrored case folder. Everything it writes is mode 600 in a mode 700 folder.
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** The repository this script runs from (web/scripts/matter/ is three levels down). */
export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/** The folders that the matter tool uses. */
export interface MatterPaths {
  fragments: string;
  build: string;
  matter: string;
  sha: string;
  info: string;
  report: string;
}

/** Builds the matter tool's folder paths under the cache directory. */
export function matterPaths(cacheDir: string): MatterPaths {
  const root = path.join(cacheDir, 'matter');
  const build = path.join(root, 'build');
  return {
    fragments: path.join(root, 'fragments'),
    build,
    matter: path.join(build, 'matter.json'),
    sha: path.join(build, 'matter.json.sha256'),
    info: path.join(build, 'build-info.json'),
    report: path.join(build, 'report.html'),
  };
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** The deepest existing ancestor of a path, resolved through symlinks. */
async function realAncestor(target: string): Promise<string> {
  let current = path.resolve(target);
  for (;;) {
    try {
      return path.join(await realpath(current), path.relative(current, path.resolve(target)));
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      current = parent;
    }
  }
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(() => true, () => false);
}

/**
 * Refuses an output folder inside the repository, inside any git checkout (a folder with .git above it), or
 * inside the mirrored case folder. Symlinks are resolved first.
 */
export async function assertSafeOutput(dir: string, sourceRoot: string, repoRoot = REPO_ROOT): Promise<void> {
  const real = await realAncestor(dir);
  const roots = await Promise.all([repoRoot, sourceRoot].map(realAncestor));
  if (isInside(real, roots[0])) throw new Error('Refusing to write matter output inside the repository');
  if (isInside(real, roots[1])) throw new Error('Refusing to write matter output inside the case folder');
  for (let current = real; ; current = path.dirname(current)) {
    if (await exists(path.join(current, '.git'))) throw new Error('Refusing to write matter output inside a git checkout');
    if (path.dirname(current) === current) break;
  }
}

/** Writes a file at mode 600 through a temporary name, so a reader never sees half a file. */
export async function writePrivate(file: string, data: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(file), 0o700);
  const temp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await writeFile(temp, data, { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

/** The hex SHA-256 of text or bytes. */
export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** The built manifest's bytes and their sha256. */
export async function readBuilt(paths: MatterPaths): Promise<{ text: string; sha: string }> {
  let text: string;
  try {
    text = await readFile(paths.matter, 'utf8');
  } catch {
    throw new Error('No built manifest yet: run `npm run matter -- build` first');
  }
  return { text, sha: sha256(text) };
}
