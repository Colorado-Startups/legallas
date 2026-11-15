// SPDX-License-Identifier: Apache-2.0
//   node --test quality-speed/pages/compliance/collect.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { isDetail } from '../../core/detail.ts';
import { AREAS, attestations, covered, days, detail, isPath, type Lookup, readPolicies, readPolicy, records, references, resolves, tableRows } from './collect.ts';

const tree: Record<string, string> = {
  'web/worker/auth.ts': 'export function backendGate() {}\nconst viewActivity = 1;',
  'SECURITY.md': '# Security',
  'web/migrations': 'dir',
};
const lookup: Lookup = (p) => tree[p] ?? null;
const run = { now: new Date('2026-11-06T08:00:00Z'), sourceUrl: 'https://github.com/Colorado-Startups/legallas/actions/runs/1' };
const policy = (body: string) => `# Access\n\nPart of the policies. Version 1.0, 2026-11-05.\n\n${body}\n`;

test('the seven areas a firm asks about are all listed, each with its own policy file', () => {
  assert.deepEqual(
    AREAS.map((a) => a.file),
    ['ai-governance.md', 'access.md', 'encryption.md', 'data-and-network.md', 'bcp-dr.md', 'incident-response.md', 'vulnerability-management.md'],
  );
});

test('a path is a repository path, never a command, a URL, a branch pattern or a way out of the tree', () => {
  for (const yes of ['web/worker/auth.ts', 'web/migrations/', 'SECURITY.md', '.github/dependabot.yml', 'quality-speed/pages/security/scan.sh']) assert.ok(isPath(yes), yes);
  for (const no of ['../SECURITY.md', '/etc/passwd', '@cf/', 'claude/*', 'npm run sync', '.dev.vars', 'workers.dev', 'vars.CS_APP_CLIENT_ID', 'https://example.com/a', 'ci-ok', 'backendGate']) {
    assert.ok(!isPath(no), no);
  }
});

test('references: each path once, and a symbol with its file either way round', () => {
  const refs = references('`web/worker/auth.ts` and `web/worker/auth.ts` (`backendGate`); `viewActivity` in `web/worker/auth.ts`; run `npm test`');
  assert.deepEqual(refs, [{ path: 'web/worker/auth.ts' }, { path: 'web/worker/auth.ts', symbol: 'backendGate' }, { path: 'web/worker/auth.ts', symbol: 'viewActivity' }]);
});

test('a reference resolves only when its path is in the tree and a named symbol is in that file as a whole word', () => {
  assert.ok(resolves({ path: 'web/worker/auth.ts' }, lookup));
  assert.ok(resolves({ path: 'web/migrations/' }, lookup), 'a folder');
  assert.ok(!resolves({ path: 'web/worker/gone.ts' }, lookup));
  assert.ok(resolves({ path: 'web/worker/auth.ts', symbol: 'backendGate' }, lookup));
  assert.ok(!resolves({ path: 'web/worker/auth.ts', symbol: 'backend' }, lookup), 'part of a word is not the symbol');
  assert.ok(!resolves({ path: 'web/worker/auth.ts', symbol: 'renamedGate' }, lookup));
  assert.ok(!resolves({ path: 'web/migrations', symbol: 'x' }, lookup), 'a folder holds no symbol');
});

test('tableRows reads only the named section, without its header', () => {
  const text = '## Gaps\n\n| Gap | Takes |\n|---|---|\n| One | a |\n| Two | b |\n\n## Review\n\n| A | B |\n|---|---|\n| x | y |\n';
  assert.deepEqual(tableRows(text, 'Gaps'), [['One', 'a'], ['Two', 'b']]);
  assert.deepEqual(tableRows(text, 'Nothing'), []);
});

test('an area is covered only by a dated policy citing at least one piece of evidence in the tree', () => {
  assert.ok(covered(readPolicy('access', policy('`web/worker/auth.ts`, `web/worker/gone.ts`'), lookup, 0)));
  assert.ok(!covered(readPolicy('access', policy('`web/worker/gone.ts`'), lookup, 0)), 'only dead citations');
  assert.ok(!covered(readPolicy('access', policy('No citations.'), lookup, 0)), 'no evidence');
  assert.ok(!covered(readPolicy('access', '# Access\n\n`web/worker/auth.ts`\n', lookup, 0)), 'undated');
  assert.ok(!covered(readPolicy('access', null, lookup, null)), 'absent');
  assert.equal(readPolicy('access', policy('## Gaps\n\n| Gap | Takes |\n|---|---|\n| A | b |'), lookup, 0).gaps, 1);
});

test('an attestation reads held only when the README says so, and never by default', () => {
  const readme = (soc2: string) => `## Attestations\n\n| Attestation | State |\n|---|---|\n| SOC 2 Type I or Type II | ${soc2} |\n| ISO/IEC 27001 | None held |\n| ISO/IEC 42001 | None held |\n| Third-party penetration test | None done |\n`;
  assert.deepEqual(attestations(readme('None held')), { soc2: 0, iso27001: 0, iso42001: 0, pentest: 0 });
  assert.deepEqual(attestations(readme('Type II report, 2027-05-01')), { soc2: 1, iso27001: 0, iso42001: 0, pentest: 0 });
  assert.deepEqual(attestations(null), { soc2: 0, iso27001: 0, iso42001: 0, pentest: 0 });
  assert.deepEqual(attestations('# Security policies\n'), { soc2: 0, iso27001: 0, iso42001: 0, pentest: 0 }, 'no table');
});

test('records: shares, counts and the oldest review, with missing for whatever was not read', () => {
  const read = AREAS.map(({ id }, i) => readPolicy(id, i < 6 ? policy('`web/worker/auth.ts` `web/worker/gone.ts`') : null, lookup, i < 6 ? 10 * i : null));
  const byId = Object.fromEntries(records(read, '2026-10-07T08:00:00Z', run).map((r) => [r.id, r]));
  assert.equal(byId.policy_areas_covered?.value, 85.71);
  assert.equal(byId.policy_areas_covered?.sample_size, 7);
  assert.deepEqual([byId.evidence_refs_dead?.value, byId.evidence_refs_dead?.sample_size], [6, 12]);
  assert.deepEqual([byId.policy_review_age_days?.value, byId.policy_review_age_days?.sample_size], [50, 6]);
  assert.equal(byId.restore_drill_age_days?.value, 30);
  assert.ok(Object.values(byId).every((r) => r.status === 'ok' && r.source_url === run.sourceUrl && r.page === 'compliance'));

  const none = Object.fromEntries(records(null, null, run).map((r) => [r.id, r.status]));
  assert.deepEqual(none, { policy_areas_covered: 'missing', evidence_refs_dead: 'missing', policy_review_age_days: 'missing', restore_drill_age_days: 'missing' });

  const empty = Object.fromEntries(records(AREAS.map(({ id }) => readPolicy(id, null, lookup, null)), null, run).map((r) => [r.id, r]));
  assert.equal(empty.policy_areas_covered?.value, 0, 'no policies is a measured 0');
  assert.equal(empty.evidence_refs_dead?.sample_size, 0, 'no citations: too few samples to score');
  assert.equal(empty.policy_review_age_days?.status, 'missing');
});

test('days are tenths, from an ISO time', () => {
  assert.equal(days('2026-11-05T08:00:00Z', run.now), 1);
  assert.equal(days('2026-11-06T05:36:00Z', run.now), 0.1);
});

test('the detail keeps to its format: short ids, 0 or 1 checks, numeric readings', () => {
  const read = AREAS.map(({ id }) => readPolicy(id, policy('`web/worker/auth.ts`'), lookup, 3));
  const d = detail(read, attestations(null));
  assert.ok(isDetail(d));
  assert.equal(Object.keys(d.checks).length, 11);
  assert.deepEqual(d.readings.dead_vulns, { value: 0, limit: 0, n: 1 });
});

test('ages come from git on a full history, and a shallow checkout reads nothing', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compliance-'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: root, env: { ...process.env, GIT_COMMITTER_DATE: '2026-10-27T08:00:00Z' } });
  try {
    git('init', '-q');
    mkdirSync(path.join(root, 'docs/security'), { recursive: true });
    mkdirSync(path.join(root, 'web'));
    writeFileSync(path.join(root, 'web/a.ts'), 'export const a = 1;\n');
    writeFileSync(path.join(root, 'docs/security/access.md'), policy('`web/a.ts` (`a`)'));
    git('add', '.');
    git('commit', '-q', '-m', 'one');
    const read = readPolicies(run.now, root);
    const access = read?.find((p) => p.id === 'access');
    assert.deepEqual(access, { id: 'access', present: true, dated: true, refs: 2, dead: 0, gaps: 0, age: 10 });
    assert.equal(read?.filter((p) => p.present).length, 1);
    writeFileSync(path.join(root, '.git/shallow'), `${execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })}`);
    assert.equal(readPolicies(run.now, root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
