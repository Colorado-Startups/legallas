// SPDX-License-Identifier: Apache-2.0
// Test helper: a throwaway git repository holding invented files, loaded as a corpus.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type Corpus, loadCorpus, trackedFiles } from './corpus.ts';

export const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

export interface Repo { dir: string; corpus: () => Corpus; config: string; done: () => void }

/** Writes `files` into a new repository (tracked, uncommitted) and a config folder for not-in-tree. */
export function repo(files: Record<string, string>, config: { notInTree?: unknown[] } = {}): Repo {
  const root = mkdtempSync(join(tmpdir(), 'qs-docs-test-'));
  const dir = join(root, 'repo');
  const cfg = join(root, 'config');
  mkdirSync(dir);
  mkdirSync(cfg);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  writeFileSync(join(cfg, 'not-in-tree.json'), JSON.stringify(config.notInTree ?? []));
  execFileSync('git', ['-C', dir, 'init', '-q'], { env: GIT_ENV });
  execFileSync('git', ['-C', dir, 'add', '-A'], { env: GIT_ENV });
  return {
    dir,
    config: cfg,
    corpus: () => loadCorpus(dir, trackedFiles(dir)),
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}
