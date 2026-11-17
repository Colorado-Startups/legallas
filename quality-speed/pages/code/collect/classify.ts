// SPDX-License-Identifier: Apache-2.0
// One rule, used by every metric on this page, for what each tracked web/ file is:
//   test        a *.test.ts file
//   production  reachable through imports from an entry point a runtime loads by name
//   helper      not production, but reachable from a test (fixtures, fakes, mocks used only by tests)
//   orphan      reachable from nothing: dead, and counted as such
// Entry points come from configuration, never a hand-kept list: the Workers' `main` in the example wrangler configs
// (and the pro slot beside each, CLAUDE.md's `entry-pro.ts`), every .ts path in package.json scripts, every
// `node <file>` in the workflows and the docs, astro.config.mjs, and every Astro page. A file another loads by a
// relative path (`new URL(..., import.meta.url)`, `join(import.meta.dirname, ...)`) is imported. Type declarations (.d.ts)
// hold no behaviour and are left out everywhere.
import type * as TS from 'typescript';
import { dirname, join, posix } from 'node:path';
import { astroImports, globTargets, moduleFacts } from './dead.ts';

export type FileClass = 'test' | 'production' | 'helper' | 'orphan';

export interface Classification {
  classes: Map<string, FileClass>;
  /** Entry points with the reason each counts, for the page to publish. */
  entries: { file: string; why: string }[];
  /** Import edges: file to the files it imports (TS, JS and .astro). */
  imports: Map<string, Set<string>>;
}

export interface RepoView {
  /** Every tracked file, repo-relative. */
  files: readonly string[];
  read: (path: string) => string;
}

export const CODE_FILE = /\.(ts|mjs|js)$/;
export const isTypeDeclaration = (f: string) => f.endsWith('.d.ts');
export const isWebTest = (f: string) => f.startsWith('web/') && f.endsWith('.test.ts');

const NODE_FILE = /\bnode\s+(?:--[\w-]+(?:[= ](?!-)[^\s'"`]+)?\s+)*['"]?([\w./-]+\.(?:ts|mjs|js))\b/g;
const IMPORT_FLAG = /--import[= ]['"]?([\w./-]+\.(?:ts|mjs|js))/g;

/** Resolves a path named in a script, workflow or doc to a tracked web/ file, trying web/ first. */
function webPath(path: string, tracked: Set<string>): string | undefined {
  const clean = posix.normalize(path.replace(/^\.\//, ''));
  for (const candidate of [`web/${clean}`, clean]) if (tracked.has(candidate) && candidate.startsWith('web/')) return candidate;
  return undefined;
}

/** Entry points derived from configuration. */
export function findEntries(view: RepoView): { file: string; why: string }[] {
  const tracked = new Set(view.files);
  const entries = new Map<string, string>();
  const add = (file: string | undefined, why: string) => {
    if (file && !entries.has(file)) entries.set(file, why);
  };

  for (const config of view.files.filter((f) => /^web\/wrangler(\.[\w-]+)?\.example\.jsonc$/.test(f))) {
    const main = /"main"\s*:\s*"([^"]+)"/.exec(view.read(config))?.[1];
    if (!main) continue;
    const file = webPath(main, tracked);
    add(file, `main in ${config}`);
    if (file) add(webPath(join(dirname(file).replace(/^web\//, ''), 'entry-pro.ts'), tracked), `pro slot beside ${file}`);
  }

  if (tracked.has('web/package.json')) {
    const scripts = (JSON.parse(view.read('web/package.json')) as { scripts?: Record<string, string> }).scripts ?? {};
    for (const [name, command] of Object.entries(scripts)) {
      for (const m of command.matchAll(NODE_FILE)) add(webPath(m[1] ?? '', tracked), `package.json script ${name}`);
      for (const m of command.matchAll(IMPORT_FLAG)) add(webPath(m[1] ?? '', tracked), `package.json script ${name} (preload)`);
    }
  }

  for (const file of view.files) {
    const isWorkflow = file.startsWith('.github/workflows/') && file.endsWith('.yml');
    const isDoc = file.endsWith('.md') && !file.startsWith('quality-speed/');
    if (!isWorkflow && !isDoc) continue;
    const text = view.read(file);
    for (const m of text.matchAll(NODE_FILE)) add(webPath(m[1] ?? '', tracked), `node command in ${file}`);
    for (const m of text.matchAll(IMPORT_FLAG)) add(webPath(m[1] ?? '', tracked), `preload in ${file}`);
  }

  add(tracked.has('web/astro.config.mjs') ? 'web/astro.config.mjs' : undefined, 'Astro config');
  for (const file of view.files) {
    if (!file.startsWith('web/') || !CODE_FILE.test(file) || isWebTest(file) || isTypeDeclaration(file)) continue;
    if (/\bimport\.meta\.main\b/.test(view.read(file))) add(file, 'runs as a command (import.meta.main)');
  }
  for (const file of view.files) {
    if (file.startsWith('web/src/pages/') && /\.(astro|ts|mjs)$/.test(file) && !isWebTest(file)) add(file, 'Astro page');
  }
  return [...entries].map(([file, why]) => ({ file, why })).sort((a, b) => a.file.localeCompare(b.file));
}

/** Repo paths a module loads relative to its own folder, from string literals only. */
export function relativeLoads(file: string, text: string): string[] {
  const here = posix.dirname(file);
  const out: string[] = [];
  for (const m of text.matchAll(/new URL\(\s*['"]([\w./-]+\.(?:ts|mjs|js))['"]\s*,\s*import\.meta\.url\s*\)/g)) {
    out.push(posix.join(here, m[1] ?? ''));
  }
  const dirNames = new Set(['import.meta.dirname', ...[...text.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*import\.meta\.dirname\b/g)].map((m) => m[1] ?? '')]);
  for (const m of text.matchAll(/\bjoin\(\s*([\w.]+)\s*,\s*((?:['"][\w.-]+['"]\s*,\s*)*['"][\w.-]+\.(?:ts|mjs|js)['"])\s*\)/g)) {
    if (!dirNames.has(m[1] ?? '')) continue;
    const parts = [...(m[2] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((p) => p[1] ?? '');
    out.push(posix.join(here, ...parts));
  }
  return out;
}

/** Script tags with a src attribute in an .astro file. */
function astroScriptSources(text: string): string[] {
  return [...text.matchAll(/<script[^>]*\bsrc=["'](\.[^"']+)["']/g)].map((m) => m[1] ?? '');
}

/** Classifies every tracked web/ code and .astro file. */
export function classify(ts: typeof TS, view: RepoView): Classification {
  const tracked = new Set(view.files);
  const exists = (p: string) => tracked.has(p);
  const nodes = view.files.filter((f) => f.startsWith('web/') && (CODE_FILE.test(f) || f.endsWith('.astro')) && !isTypeDeclaration(f));
  const imports = new Map<string, Set<string>>();
  for (const file of nodes) {
    const targets = new Set<string>();
    if (file.endsWith('.astro')) {
      const text = view.read(file);
      for (const { spec, glob } of astroImports(text)) {
        if (glob) for (const t of globTargets(file, spec, view.files)) targets.add(t);
        else {
          const t = resolve(file, spec, exists);
          if (t) targets.add(t);
        }
      }
      for (const src of astroScriptSources(text)) {
        const t = resolve(file, src, exists);
        if (t) targets.add(t);
      }
    } else {
      const text = view.read(file);
      for (const t of moduleFacts(ts, file, text, exists, view.files).imports.keys()) targets.add(t);
      // A file loaded by a path held in a string (`loadModule('worker/sqlite-d1.ts')`) is referenced too.
      for (const m of text.matchAll(/['"`]((?:scripts|worker|mcp|src|connect|integrations)\/[\w./-]+\.(?:ts|mjs))['"`]/g)) {
        if (tracked.has(`web/${m[1]}`)) targets.add(`web/${m[1]}`);
      }
      // A file loaded by a path relative to this one: new URL('../guest/viewer.js', import.meta.url), or
      // join(HERE, 'view', 'grid.ts') where HERE is import.meta.dirname.
      for (const t of relativeLoads(file, text)) if (tracked.has(t)) targets.add(t);
    }
    imports.set(file, targets);
  }

  const entries = findEntries(view);
  const reach = (starts: Iterable<string>) => {
    const seen = new Set<string>();
    const stack = [...starts];
    while (stack.length > 0) {
      const f = stack.pop() as string;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const t of imports.get(f) ?? []) stack.push(t);
    }
    return seen;
  };
  const production = reach(entries.map((e) => e.file));
  const fromTests = reach(nodes.filter(isWebTest));

  const classes = new Map<string, FileClass>();
  for (const file of nodes) {
    if (isWebTest(file)) classes.set(file, 'test');
    else if (production.has(file)) classes.set(file, 'production');
    else if (fromTests.has(file)) classes.set(file, 'helper');
    else classes.set(file, 'orphan');
  }
  return { classes, entries, imports };
}

const SUFFIXES = ['', '.ts', '.mjs', '.js', '.astro', '/index.ts', '/index.mjs'];

function resolve(fromFile: string, spec: string, exists: (p: string) => boolean): string | undefined {
  if (!spec.startsWith('.')) return undefined;
  const base = posix.normalize(posix.join(posix.dirname(fromFile), spec.replace(/\?.*$/, '')));
  for (const s of SUFFIXES) if (exists(base + s)) return base + s;
  if (base.endsWith('.js') && exists(base.replace(/\.js$/, '.ts'))) return base.replace(/\.js$/, '.ts');
  return undefined;
}

/**
 * Files that import `target` directly, and those that reach it through at most `depth - 1` other files, among
 * `from`. Unbounded depth (the default) reaches nearly every test from a shared module; mutation testing uses 2.
 */
export function importersOf(
  imports: Map<string, Set<string>>,
  target: string,
  from: (f: string) => boolean,
  depth = Number.POSITIVE_INFINITY,
): { direct: string[]; wider: string[] } {
  const reverse = new Map<string, Set<string>>();
  for (const [f, ts] of imports) for (const t of ts) {
    const set = reverse.get(t) ?? new Set<string>();
    set.add(f);
    reverse.set(t, set);
  }
  const direct = [...(reverse.get(target) ?? [])].filter(from).sort();
  const seen = new Set<string>([target]);
  let frontier = [target];
  for (let level = 0; level < depth && frontier.length > 0; level++) {
    const next: string[] = [];
    for (const f of frontier) {
      for (const importer of reverse.get(f) ?? []) {
        if (seen.has(importer)) continue;
        seen.add(importer);
        next.push(importer);
      }
    }
    frontier = next;
  }
  const wider = [...seen].filter((f) => f !== target && from(f) && !direct.includes(f)).sort();
  return { direct, wider };
}
