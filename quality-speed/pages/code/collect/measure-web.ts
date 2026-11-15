// SPDX-License-Identifier: Apache-2.0
// Runs web/'s own checks on the current commit: the full test suite with `npm test`'s globs and runner flags, a JUnit
// report, then `npm run check`. Nothing here is installed beyond web/'s lockfile.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TestReport {
  tests: number;
  failures: number;
  /** Skipped or todo tests beyond their file's allowance in EXPECTED_LINUX_SKIPS. */
  unexpectedSkips: number;
  skips: number;
  /** Skipped tests per file (web/-relative), for the drill-down. */
  skipsByFile: Record<string, number>;
}

/**
 * Tests that skip on a Linux runner by design, per file, counted on 2026-11-02: settings only a room's own config
 * holds, a brand pack's animation rig, macOS tools (`textutil`, which office-mac runs; `cp -c`; `xattr`), a dev
 * Chrome, and the case-data guard only a contributor's clone holds. A skipped or todo test beyond its file's
 * allowance is a failure, so a new skip cannot take the place of one that starts running. These may only fall.
 */
export const EXPECTED_LINUX_SKIPS: Readonly<Record<string, number>> = {
  'mcp/config.test.ts': 5,
  'worker/config.test.ts': 2,
  'src/scripts/companion-contract.test.ts': 4,
  'scripts/office-index.test.ts': 2,
  'scripts/docx-side.test.ts': 1,
  'scripts/snapshot.test.ts': 1,
  'scripts/guard.test.ts': 1,
  'scripts/visual-render-chrome.test.ts': 1,
  'scripts/case-guard.test.ts': 1,
  // Windows OCR API: ci.yml's sync-windows job runs it on windows-latest (WINDOWS_RUN_FILES).
  'scripts/extract-windows-api.test.ts': 2,
};

/** Allowed files that skip on Linux because only Windows can run them; ci.yml's sync-windows job must run each. */
export const WINDOWS_RUN_FILES: readonly string[] = ['scripts/snapshot.test.ts', 'scripts/extract-windows-api.test.ts'];

/**
 * The test globs from web/package.json's `test` script, so this run and CI run the same files. The script is `node --test`
 * or web/scripts/run-tests.ts, which shares processes between files; this run gives each file its own, as `node --test` does.
 */
export function testGlobs(packageJson: string): string[] {
  const script = (JSON.parse(packageJson) as { scripts?: Record<string, string> }).scripts?.test ?? '';
  if (!/^node (?:--test|scripts\/run-tests\.ts)\b/.test(script)) throw new Error('web/package.json test script is not `node --test ...` or `node scripts/run-tests.ts ...`');
  const globs = [...script.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '');
  if (globs.length === 0) throw new Error('web/package.json test script names no files');
  return globs;
}

/**
 * The runner's flags from the same script, such as `--test-concurrency=3`, so this run uses the runner's CPUs as CI's
 * does. Without it Node runs one file at a time on a 2-CPU runner. Reporters are left out: this run writes its own.
 */
export function testFlags(packageJson: string): string[] {
  const script = (JSON.parse(packageJson) as { scripts?: Record<string, string> }).scripts?.test ?? '';
  return (script.match(/(?<=\s)--test-[\w-]+(?:=\S+)?/g) ?? []).filter((flag) => !flag.startsWith('--test-reporter'));
}

/** Counts tests, failures and skips in Node's JUnit report. `webDir` turns absolute file paths into web/ paths. */
export function readJunit(xml: string, webDir: string, expectedSkips: Readonly<Record<string, number>> = EXPECTED_LINUX_SKIPS): TestReport {
  const report: TestReport = { tests: 0, failures: 0, unexpectedSkips: 0, skips: 0, skipsByFile: {} };
  // Attribute values are quoted and may hold a bare `>` (Node escapes quotes, not `>`), so attributes are matched
  // one by one rather than up to the first `>`.
  const cases = xml.matchAll(/<testcase((?:\s+[\w:-]+="[^"]*")*)\s*(\/>|>([\s\S]*?)<\/testcase>)/g);
  for (const m of cases) {
    report.tests++;
    const body = m[3] ?? '';
    if (/<failure\b|<error\b/.test(body)) report.failures++;
    if (/<skipped\b/.test(body)) {
      const file = /\bfile="([^"]*)"/.exec(m[1] ?? '')?.[1] ?? '';
      const rel = file.startsWith(webDir) ? file.slice(webDir.length).replace(/^\//, '') : file;
      report.skips++;
      report.skipsByFile[rel] = (report.skipsByFile[rel] ?? 0) + 1;
    }
  }
  for (const [file, count] of Object.entries(report.skipsByFile)) report.unexpectedSkips += Math.max(0, count - (expectedSkips[file] ?? 0));
  return report;
}

export interface WebRun {
  report: TestReport;
  exitCode: number;
  seconds: number;
}

/** Runs the suite. A crash before any report is written throws: missing, not passing. */
export function runWebTests(repo: string, outDir: string): WebRun {
  const web = join(repo, 'web');
  const packageJson = readFileSync(join(web, 'package.json'), 'utf8');
  const globs = testGlobs(packageJson);
  const junitPath = join(outDir, 'web-junit.xml');
  const started = Date.now();
  const run = spawnSync(
    process.execPath,
    [
      '--test',
      ...testFlags(packageJson),
      '--test-reporter=junit',
      `--test-reporter-destination=${junitPath}`,
      ...globs,
    ],
    // A compile cache new to this run, as CI's is: each test file's process, and each process a test starts, reuses
    // the TypeScript and package code the processes before it compiled.
    { cwd: web, stdio: 'ignore', timeout: 20 * 60_000, env: { ...process.env, NODE_COMPILE_CACHE: join(outDir, 'node-compile-cache') } },
  );
  if (run.error) throw run.error;
  const report = readJunit(readFileSync(junitPath, 'utf8'), web);
  return { report, exitCode: run.status ?? 1, seconds: (Date.now() - started) / 1000 };
}

/** `npm run check` (types, Astro, every tsconfig): true when it passes. */
export function runWebCheck(repo: string): boolean {
  const run = spawnSync('npm', ['run', 'check'], { cwd: join(repo, 'web'), stdio: 'ignore', timeout: 15 * 60_000 });
  if (run.error) throw run.error;
  return run.status === 0;
}
