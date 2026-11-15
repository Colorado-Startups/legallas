// SPDX-License-Identifier: Apache-2.0
// The planted drill behind doc lag: a throwaway repository where a link
// breaks and is mended five hours later. Doc lag may read "no events" only
// while this finds that one episode and times it at five hours.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { docLag } from './lag.ts';

const HOURS = 5;

function git(dir: string, args: string[], at?: string): void {
  // No user or system git config: the throwaway repository signs nothing and reads no one's settings.
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'drill',
    GIT_AUTHOR_EMAIL: 'drill@example.test',
    GIT_COMMITTER_NAME: 'drill',
    GIT_COMMITTER_EMAIL: 'drill@example.test',
    ...(at ? { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : {}),
  };
  execFileSync('git', ['-C', dir, ...args], { env, stdio: 'ignore' });
}

export function runDrill(now = new Date()): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'qs-docs-drill-'));
  const config = join(dir, '.config');
  try {
    mkdirSync(config);
    writeFileSync(join(config, 'not-in-tree.json'), '[]\n');
    writeFileSync(join(config, 'questions.json'), '{"questions":[]}\n');
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    const t0 = new Date(now.getTime() - 24 * 3_600_000);
    const at = (h: number) => new Date(t0.getTime() + h * 3_600_000).toISOString();
    writeFileSync(join(repo, 'a.md'), '# A\n\nSee [b](b.md).\n');
    writeFileSync(join(repo, 'b.md'), '# B\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'start'], at(0));
    git(repo, ['rm', '-q', 'b.md']);
    git(repo, ['commit', '-q', '-m', 'break'], at(1));
    writeFileSync(join(repo, 'b.md'), '# B\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'mend'], at(1 + HOURS));
    const eps = docLag(repo, 'main', config, now.toISOString());
    return eps.length === 1 && eps[0]!.key === 'link a.md b.md' && eps[0]!.closed !== null && Math.abs(eps[0]!.hours - HOURS) < 1e-9;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
