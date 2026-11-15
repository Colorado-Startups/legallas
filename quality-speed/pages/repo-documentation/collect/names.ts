// SPDX-License-Identifier: Apache-2.0
// Dead names: things the docs tell a reader to open or run that are not in
// the tree. Paths, npm scripts, `node <file>` commands, environment and
// binding names, and MCP tool names, from Markdown docs and from the comments
// in .github config. A file the docs say is never committed (a room's own
// settings) is ignored by .gitignore; anything else outside the tree (another
// repository's file, a run's output, another tool's setting) is listed with
// its reason in not-in-tree.json, which the sign-off reviewed.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { type Corpus, exists, isExcluded } from './corpus.ts';

export interface DeadName { path: string; line: number; name: string; kind: string }

const EXT = /\.(ts|tsx|js|mjs|cjs|md|ya?ml|json|jsonc|toml|swift|sh|py|astro|css|sql|html|svg|txt)$/;
const TOP_DIRS = new Set(['web', 'docs', 'Sources', 'Tests', 'LegallasApp', 'templates', '.github', '.claude', 'quality-speed']);
const WEB_DIRS = new Set(['worker', 'mcp', 'src', 'scripts', 'connect', 'migrations', 'fixtures', 'public']);
const PLACEHOLDER = /[*?<>{}$…|]|\.\.\.|\s/;
const ENV = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const TOOL = /^legallas_[a-z_]+$/;
const BARE_FILE = /(?<![\w./-])([\w-]+(?:\.[\w-]+)*\.(?:sh|ts|py|md|ya?ml|jsonc?|toml|swift))(?![\w/-])/g;

export interface Context {
  scripts: Set<string>;
  /** Names listed in not-in-tree.json: paths, env names and tools that live outside this tree. */
  expectedAbsent: Set<string>;
  /** Text of every tracked non-Markdown file outside the excluded folders, for env and tool names. */
  codeText: string;
}

export function loadContext(c: Corpus, notInTreePath: string): Context {
  const scripts = new Set<string>();
  for (const pkg of ['web/package.json']) {
    if (c.fileSet.has(pkg)) for (const k of Object.keys(JSON.parse(c.read(pkg)).scripts ?? {})) scripts.add(k);
  }
  const listed = JSON.parse(readFileSync(notInTreePath, 'utf8')) as { name: string; reason: string }[];
  const expectedAbsent = new Set(listed.map((e) => e.name));
  const parts: string[] = [];
  for (const f of c.files) {
    if (f.endsWith('.md') || isExcluded(f) || !/\.(ts|tsx|js|mjs|swift|ya?ml|jsonc?|toml|sh|py|astro|sql)$/.test(f)) continue;
    parts.push(c.read(f));
  }
  return { scripts, expectedAbsent, codeText: parts.join('\n') };
}

/** Candidate repo paths a name written in `from` may mean, most specific first. */
function bases(from: string): string[] {
  const out = [posix.dirname(from)];
  let d = posix.dirname(from);
  while (d !== '.') {
    d = posix.dirname(d);
    out.push(d);
  }
  out.push('web', '.github');
  return [...new Set(out)];
}

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|gov|org|net|io|dev|ai|us|uk|app|co)$/;

export function looksLikePath(s: string): boolean {
  if (PLACEHOLDER.test(s) || s.startsWith('~') || s.startsWith('/') || s.startsWith('@') || /^[a-z]+:/i.test(s)) return false;
  if (!/^[\w.@/-]+$/.test(s)) return false;
  if (/^Colorado-Startups\//.test(s) || /^\.[a-z]+$/.test(s)) return false;
  const first = s.replace(/^\.\//, '').split('/')[0] ?? '';
  if (HOST.test(first)) return false;
  // A bare name ending .js is an npm package (punycode.js), not a file here.
  if (!s.includes('/') && s.endsWith('.js')) return false;
  if (EXT.test(s)) return true;
  if (s.includes('/') && (TOP_DIRS.has(first) || WEB_DIRS.has(first))) return true;
  return false;
}

/** Every repo path a name written in `from` may resolve to. */
export function candidates(from: string, name: string): string[] {
  const n = name.replace(/:\d+(?::\d+)?$/, '').replace(/^\.\//, '').replace(/\/$/, '');
  return bases(from).map((b) => posix.normalize(posix.join(b, n)));
}

export function pathAlive(c: Corpus, ctx: Context, from: string, name: string): boolean {
  const n = name.replace(/:\d+(?::\d+)?$/, '').replace(/^\.\//, '').replace(/\/$/, '');
  if (ctx.expectedAbsent.has(n)) return true;
  for (const p of candidates(from, n)) {
    if (exists(c, p) || ctx.expectedAbsent.has(p)) return true;
  }
  if (!n.includes('/')) return c.basenames.has(n);
  // A short path written from a sub-folder (components/terms.css from web/src/styles),
  // or a numbered prefix (migrations/0001 for migrations/0001_init.sql).
  return c.files.some((f) => f.endsWith(`/${n}`) || f.startsWith(`${n}_`) || f.includes(`/${n}_`));
}

/** Drop findings whose path git ignores: a room's settings and build output are never committed, by rule. */
export function dropIgnored(root: string, list: DeadName[]): DeadName[] {
  const paths = list.filter((d) => d.kind === 'path');
  if (paths.length === 0) return list;
  const asked = paths.flatMap((d) => candidates(d.path, d.name));
  // check-ignore exits 1 when nothing matches, 0 when something does; anything else is an error.
  const res = spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '--stdin', '-z'], { input: asked.join('\0') + '\0', encoding: 'utf8' });
  if (res.status !== 0 && res.status !== 1) throw new Error(`git check-ignore failed: ${res.stderr}`);
  return filterIgnored(list, new Set(res.stdout.split('\0').filter(Boolean)));
}

function filterIgnored(list: DeadName[], ignored: Set<string>): DeadName[] {
  return list.filter((d) => d.kind !== 'path' || !candidates(d.path, d.name).some((p) => ignored.has(p)));
}

/** Commands in a code span or a shell block: `npm run x`, `node file`, `node --test file`. */
export function commandNames(text: string): { kind: string; name: string }[] {
  const out: { kind: string; name: string }[] = [];
  for (const m of text.matchAll(/\bnpm run ([\w:.-]+)/g)) out.push({ kind: 'npm script', name: m[1] ?? '' });
  // Every script file a `node` command names: the one it runs and any it preloads.
  for (const m of text.matchAll(/\bnode\s+([^\n;&|`]*)/g)) {
    for (const tok of (m[1] ?? '').split(/\s+/)) {
      if (/^(?:\.\/)?[\w./-]+\.(?:ts|js|mjs)$/.test(tok) && !tok.startsWith('-')) out.push({ kind: 'path', name: tok });
    }
  }
  return out;
}

function checkSpan(c: Corpus, ctx: Context, from: string, line: number, code: string, out: DeadName[]): void {
  if (ENV.test(code)) {
    if (!ctx.codeText.includes(code) && !ctx.expectedAbsent.has(code)) out.push({ path: from, line, name: code, kind: 'name' });
    return;
  }
  if (TOOL.test(code)) {
    if (!ctx.codeText.includes(`'${code}'`)) out.push({ path: from, line, name: code, kind: 'MCP tool' });
    return;
  }
  if (looksLikePath(code)) {
    if (!pathAlive(c, ctx, from, code)) out.push({ path: from, line, name: code, kind: 'path' });
    return;
  }
  checkCommands(c, ctx, from, line, code, out);
}

function checkCommands(c: Corpus, ctx: Context, from: string, line: number, text: string, out: DeadName[]): void {
  for (const cmd of commandNames(text)) {
    if (cmd.kind === 'npm script' && !ctx.scripts.has(cmd.name)) out.push({ path: from, line, name: `npm run ${cmd.name}`, kind: 'npm script' });
    if (cmd.kind === 'path' && !pathAlive(c, ctx, from, cmd.name)) out.push({ path: from, line, name: cmd.name, kind: 'path' });
  }
}

export function deadNames(c: Corpus, ctx: Context): DeadName[] {
  return dropIgnored(c.gitRoot, findNames(c, ctx));
}

function findNames(c: Corpus, ctx: Context): DeadName[] {
  const out: DeadName[] = [];
  for (const doc of c.docs.values()) {
    for (const s of doc.spans) checkSpan(c, ctx, doc.path, s.line, s.code, out);
    for (const f of doc.fences) {
      if (!['', 'bash', 'sh', 'shell', 'console', 'zsh'].includes(f.lang)) continue;
      f.body.split('\n').forEach((l, i) => checkCommands(c, ctx, doc.path, f.line + 1 + i, l, out));
    }
  }
  for (const cm of c.comments) {
    const spans = [...cm.text.matchAll(/`([^`]+)`/g)].map((m) => (m[1] ?? '').trim());
    for (const s of spans) checkSpan(c, ctx, cm.path, cm.line, s, out);
    const prose = cm.text.replace(/`[^`]+`/g, ' ');
    for (const m of prose.matchAll(BARE_FILE)) {
      const name = m[1] ?? '';
      if (!pathAlive(c, ctx, cm.path, name)) out.push({ path: cm.path, line: cm.line, name, kind: 'path' });
    }
    checkCommands(c, ctx, cm.path, cm.line, prose, out);
  }
  return dedupe(out);
}

function dedupe(list: DeadName[]): DeadName[] {
  const seen = new Set<string>();
  return list.filter((d) => {
    const k = `${d.path}:${d.line}:${d.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
