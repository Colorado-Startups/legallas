// SPDX-License-Identifier: Apache-2.0
// office= and sync= in .github/scripts/changed-paths.sh list the files office-mac and sync-windows test. A change to one
// runs that job, and a pull request skips the job only while its earlier pass saw every one of them unchanged
// (.github/scripts/inputs_passed.py). So each list must hold every file its job's tests load, read from ci.yml's
// `node --test` line and followed to the end, and nothing those tests never reach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const WEB = path.join(REPO, 'web');
const MODULE = /\.(?:[mc]?ts|[mc]?js|json)$/;
// A room composed from a product commit is a plain folder with no git metadata, and these lists gate the product's CI.
const notACheckout = !existsSync(path.join(REPO, '.git')) && 'not a git checkout: a composed room runs no product CI';

// Node erases these statements before it runs a file, so it never loads what they name. `import type from './a.ts'` and
// `import type, { b } from './a.ts'` import a default named `type`, so they stay.
const TYPE_ONLY = [
  /\bimport\s+type\s+(?:\{[^}]*\}|\*\s+as\s+[\w$]+|[\w$]+)\s+from\s*(['"])[^'"\n]+\1/g,
  /\bexport\s+type\s+(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)\s*from\s*(['"])[^'"\n]+\1/g,
];
// Any one-line quoted path, so `loadModule('worker/x.ts')` and a child process's script count as well as imports.
const QUOTED = /(['"`])((?:(?!\1)[^\\\n$])+)\1/g;
// Module specifiers alone, so a stray quote earlier on a line can't hide one from QUOTED. Not the word in `['from', 'to']`.
const SPECIFIER = /(?<![\w$.'"`])(?:from|import)\s*\(?\s*(['"])([^'"\n]+)\1/g;
const PACKAGE = /^(?:@\w[\w.-]*\/)?\w[\w.-]*(?:\/[\w./-]+)?$/;

const isFile = (file: string): boolean => existsSync(file) && statSync(file).isFile();
const repoPath = (file: string): string => path.relative(REPO, file).split(path.sep).join('/');

/** What a file's text loads: files under the repository, and npm packages by name. */
function references(text: string, fromDir: string): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  for (const [literal, isSpecifier] of [
    ...[...text.matchAll(QUOTED)].map((match) => [match[2]!, false] as const),
    ...[...text.matchAll(SPECIFIER)].map((match) => [match[2]!, true] as const),
  ]) {
    if (isSpecifier && PACKAGE.test(literal)) {
      packages.add(literal);
      continue;
    }
    if (!MODULE.test(literal) || /\s/.test(literal)) continue;
    // Next to the file, or under web/: loadModule and the scripts a test runs name their files from there.
    const file = [path.resolve(fromDir, literal), path.resolve(WEB, literal)].find(isFile);
    if (file) files.add(file);
    else assert.ok(!(isSpecifier && literal.startsWith('.')), `${literal} in ${repoPath(fromDir)} names no file`);
  }
  return { files: [...files], packages: [...packages] };
}

/** Every file the entries load, and every file they reach, `import type` included. */
function closure(entries: readonly string[], eraseTypes: boolean): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const todo = [...entries];
  while (todo.length > 0) {
    const file = todo.pop()!;
    if (files.has(repoPath(file))) continue;
    files.add(repoPath(file));
    let text = readFileSync(file, 'utf8');
    if (eraseTypes) for (const statement of TYPE_ONLY) text = text.replace(statement, '');
    const found = references(text, path.dirname(file));
    todo.push(...found.files);
    for (const name of found.packages) packages.add(name);
  }
  return { files, packages };
}

const workflow = (): string => readFileSync(path.join(REPO, '.github/workflows/ci.yml'), 'utf8');

/** One job's lines in ci.yml, after its `<job>:` line. */
const jobBlock = (job: string): string => new RegExp(`^  ${job}:\\n((?:(?:    .*)?\\n)+)`, 'm').exec(workflow())?.[1] ?? '';

/** The test files a job in ci.yml runs, from its one `node --test` line, as paths under web/. */
function jobTests(job: string): string[] {
  const block = jobBlock(job);
  const lines = [...block.matchAll(/^\s+run: node --test (.+)$/gm)];
  assert.equal(lines.length, 1, `${job} in ci.yml should run its tests with one \`node --test\` line`);
  assert.match(block, /^\s+working-directory: web$/m, `${job} runs its tests from web/`);
  return lines[0]![1]!.trim().split(/\s+/).map((file) => path.join(WEB, file));
}

/** Tracked files the list in changed-paths.sh matches, the way the script matches them. */
function listed(name: string): string[] {
  const script = readFileSync(path.join(REPO, '.github/scripts/changed-paths.sh'), 'utf8');
  const list = new RegExp(`^${name}='([^']+)'$`, 'm').exec(script)?.[1];
  assert.ok(list, `changed-paths.sh sets ${name}`);
  const pattern = new RegExp(`^(${list})$`);
  return execFileSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter((file) => file && pattern.test(file))
    .sort();
}

/** Files a job reads that no import names. */
function readsToo(files: Set<string>, packages: Set<string>): string[] {
  const extra: string[] = [];
  // npm ci installs the packages from these two.
  if (packages.size > 0) extra.push('web/package.json', 'web/package-lock.json');
  // sqlite-d1.ts applies every file in web/migrations/ to a fresh database.
  if (files.has('web/worker/sqlite-d1.ts')) {
    const migrations = execFileSync('git', ['-C', REPO, 'ls-files', '-z', 'web/migrations'], { encoding: 'utf8' });
    extra.push(...migrations.split('\0').filter((file) => /^web\/migrations\/[^/]+\.sql$/.test(file)));
  }
  return extra;
}

for (const [job, list] of [['office-mac', 'office_files'], ['sync-windows', 'sync_files']] as const) {
  test(`${list} in changed-paths.sh lists what ${job}'s tests load`, { skip: notACheckout }, () => {
    const entries = jobTests(job);
    const loaded = closure(entries, true);
    const reached = closure(entries, false);
    const need = new Set([...loaded.files, ...readsToo(loaded.files, loaded.packages)]);
    const may = new Set([...reached.files, ...readsToo(reached.files, reached.packages)]);
    const have = listed(list);
    const missing = [...need].filter((file) => !have.includes(file)).sort();
    // Files reached only through `import type` may stay listed: a narrower list would look like a looser gate.
    const stale = have.filter((file) => !may.has(file));
    assert.deepEqual(missing, [], `add to ${list}: ${job} loads these`);
    assert.deepEqual(stale, [], `remove from ${list}: ${job}'s tests never reach these`);
    // inputs_passed.py keys a symlink by its target's name, not the target's contents, so it never skips on one (#434).
    const links = have.filter((file) => lstatSync(path.join(REPO, file)).isSymbolicLink());
    assert.deepEqual(links, [], `${list}: ${job}'s inputs must be files, not symlinks`);
  });
}

// A pull request's own workflows can save caches and write logs, outputs and job names, then be deleted, so a skip
// read from any of those can be planted. inputs_passed.py reads only GitHub's run records and git.
test('office-mac and sync-windows skip only on inputs_passed.py, which runs before any cache restore', () => {
  const checks = jobBlock('checks');
  assert.match(checks, /^ {6}office_passed: \$\{\{ steps\.passed\.outputs\.office \}\}$/m, 'office_passed comes from inputs_passed.py');
  assert.match(checks, /^ {6}sync_passed: \$\{\{ steps\.passed\.outputs\.sync \}\}$/m, 'sync_passed comes from inputs_passed.py');
  const steps = checks.split(/^ {6}- /m).slice(1);
  const check = steps.findIndex((step) => /^\s+id: passed$/m.test(step));
  assert.ok(check >= 0 && /^\s+run: python3 \.github\/scripts\/inputs_passed\.py$/m.test(steps[check]!), 'the passed step runs inputs_passed.py');
  const cache = steps.findIndex((step) => /uses: actions\/cache\//.test(step));
  assert.ok(cache === -1 || check < cache, 'inputs_passed.py reads the checkout before any cache is restored into it');
  assert.doesNotMatch(workflow(), /inputs-passed-/, 'no cache marker a run could plant');
  for (const [job, output] of [['office-mac', 'office_passed'], ['sync-windows', 'sync_passed']] as const) {
    assert.match(jobBlock(job), new RegExp(`needs\\.checks\\.outputs\\.${output} != 'true'`), `${job} skips on ${output}`);
  }
});

test('a type-only import is not followed, and every other quoted path is', () => {
  const text = [
    "import type { A } from './checkindex.ts';",
    "import type {\n  B,\n} from './diff.ts';",
    "export type * from './guard.ts';",
    "import type from './office.ts';",
    "import { type C } from './ooxml.ts';",
    "const x = await loadModule('worker/stored-name.ts');",
    "import { getDocument } from 'pdfjs-dist';",
    "const headers = ['from', 'date'];",
  ].join('\n');
  let erased = text;
  for (const statement of TYPE_ONLY) erased = erased.replace(statement, '');
  const found = references(erased, path.join(WEB, 'scripts'));
  assert.deepEqual(found.files.map(repoPath).sort(), ['web/scripts/office.ts', 'web/scripts/ooxml.ts', 'web/worker/stored-name.ts']);
  assert.deepEqual(found.packages, ['pdfjs-dist']);
  assert.throws(() => references("import { gone } from './no-such-file.ts';", WEB), /names no file/);
});
