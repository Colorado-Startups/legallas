// SPDX-License-Identifier: Apache-2.0
// The documentation corpus: which files count as docs, and a small Markdown
// reader (headings, anchors, links, code spans, fenced blocks, prose). No
// packages, so it runs under plain Node with type stripping.
//
// Scope: every tracked Markdown file except quality-speed/ (this site must not
// raise its own score), plus the full-line comments in .github config and
// scripts, which agents read as docs. The page scores only the front door's
// files; the rest loads so their links and names resolve against the tree.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { stripHtmlTags } from '../../../core/escape.ts';
import { INPUTS } from './inputs.ts';

export const EXCLUDED_PREFIXES = INPUTS.corpus_excluded;

export interface Tracked { files: string[]; links: Set<string> }

/**
 * Every tracked path, and which are symlinks (AGENTS.md points at CLAUDE.md): the index of the checkout at `root`,
 * or the tree of commit `sha` when given.
 */
export function trackedFiles(root: string, sha?: string): Tracked {
  const args = sha ? ['ls-tree', '-r', '-z', sha] : ['ls-files', '-s', '-z'];
  const out = execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const files: string[] = [];
  const links = new Set<string>();
  for (const rec of out.split('\0')) {
    if (!rec) continue;
    const path = rec.slice(rec.indexOf('\t') + 1);
    if (rec.startsWith('120000')) links.add(path);
    if (!rec.includes(' commit ')) files.push(path);
  }
  return { files: files.sort(), links };
}

export function isExcluded(path: string): boolean {
  return EXCLUDED_PREFIXES.some((p) => path.startsWith(p));
}

export function markdownDocs(files: string[]): string[] {
  return files.filter((f) => f.endsWith('.md') && !isExcluded(f));
}

const COMMENT_EXT = /\.(ya?ml|sh|py)$/;
export function commentFiles(files: string[]): string[] {
  return files.filter((f) => f.startsWith('.github/') && COMMENT_EXT.test(f));
}

export interface Heading { level: number; text: string; slug: string; line: number }
export interface Link { target: string; text: string; line: number; image: boolean }
export interface CodeSpan { code: string; line: number }
export interface Fence { lang: string; body: string; line: number }

export interface Doc {
  path: string;
  lines: string[];
  headings: Heading[];
  anchors: Set<string>;
  links: Link[];
  spans: CodeSpan[];
  fences: Fence[];
  /** Prose lines with code spans replaced by a single token, fences and tables removed. */
  prose: { text: string; line: number; kind: 'para' | 'list' | 'heading' }[];
}

/** GitHub's heading slug (github-slugger): lower case, drop punctuation, spaces to hyphens. */
export function slugBase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/** The text GitHub renders for a heading's Markdown source. */
export function headingText(src: string): string {
  return stripHtmlTags(src.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'))
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|\W)[*_](.+?)[*_](?=\W|$)/g, '$1$2')
    .replace(/\s+#+\s*$/, '')
    .trim();
}

const FENCE = /^(\s{0,3})(`{3,}|~{3,})\s*([\w+-]*)/;
const ATX = /^\s{0,3}(#{1,6})\s+(.*)$/;
const LINK = /(!?)\[((?:[^\[\]]|\[[^\]]*\])*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const REF_DEF = /^\s{0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/;
const HTML_ANCHOR = /<a\s+[^>]*(?:id|name)="([^"]+)"/gi;

export function parseMarkdown(path: string, source: string): Doc {
  const lines = source.split(/\r?\n/);
  const headings: Heading[] = [];
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  const links: Link[] = [];
  const spans: CodeSpan[] = [];
  const fences: Fence[] = [];
  const prose: Doc['prose'] = [];
  let fence: { marker: string; lang: string; start: number; body: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const lineNo = i + 1;
    const f = FENCE.exec(raw);
    if (fence) {
      const marker = f?.[2] ?? '';
      if (f && marker[0] === fence.marker[0] && marker.length >= fence.marker.length && raw.trim() === marker) {
        fences.push({ lang: fence.lang, body: fence.body.join('\n'), line: fence.start });
        fence = null;
      } else {
        fence.body.push(raw);
      }
      continue;
    }
    if (f) {
      fence = { marker: f[2] ?? '```', lang: (f[3] ?? '').toLowerCase(), start: lineNo, body: [] };
      continue;
    }
    for (const m of raw.matchAll(HTML_ANCHOR)) if (m[1]) anchors.add(m[1]);
    const ref = REF_DEF.exec(raw);
    if (ref) {
      links.push({ target: ref[2] ?? '', text: ref[1] ?? '', line: lineNo, image: false });
      continue;
    }
    // Code spans first, so links and prose ignore what sits inside them.
    let masked = '';
    let pos = 0;
    const tick = /(`+)([\s\S]*?[^`])\1(?!`)/g;
    let m: RegExpExecArray | null;
    while ((m = tick.exec(raw))) {
      masked += raw.slice(pos, m.index) + 'CODE';
      spans.push({ code: (m[2] ?? '').trim(), line: lineNo });
      pos = m.index + m[0].length;
    }
    masked += raw.slice(pos);
    for (const l of masked.matchAll(LINK)) {
      links.push({ target: l[3] ?? '', text: l[2] ?? '', line: lineNo, image: l[1] === '!' });
    }
    const h = ATX.exec(raw);
    if (h) {
      const text = headingText(h[2] ?? '');
      const base = slugBase(text);
      const n = counts.get(base) ?? 0;
      counts.set(base, n + 1);
      const slug = n === 0 ? base : `${base}-${n}`;
      headings.push({ level: (h[1] ?? '#').length, text, slug, line: lineNo });
      anchors.add(slug);
      prose.push({ text: headingText(masked.replace(ATX, '$2')), line: lineNo, kind: 'heading' });
      continue;
    }
    const t = masked.trim();
    if (!t || t.startsWith('|') || t.startsWith('<') || REF_DEF.test(t)) continue;
    const list = /^([-*+]|\d+[.)])\s+/.test(t);
    prose.push({ text: t.replace(/^([-*+]|\d+[.)]|>)\s+/, ''), line: lineNo, kind: list ? 'list' : 'para' });
  }
  return { path, lines, headings, anchors, links, spans, fences, prose };
}

export interface Comment { path: string; text: string; line: number }

/** Full-line comments in YAML, shell and Python files (shebangs and SHA pin notes skipped). */
export function parseComments(path: string, source: string): Comment[] {
  const out: Comment[] = [];
  source.split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trim();
    if (!t.startsWith('#') || t.startsWith('#!')) return;
    const text = t.replace(/^#+\s?/, '');
    if (text) out.push({ path, text, line: i + 1 });
  });
  return out;
}

export interface Corpus {
  /** Where the files are read from: a checkout, or a scratch copy of one commit's tree. */
  root: string;
  /** The git repository, for .gitignore lookups. */
  gitRoot: string;
  files: string[];
  fileSet: Set<string>;
  dirSet: Set<string>;
  basenames: Set<string>;
  docs: Map<string, Doc>;
  comments: Comment[];
  read(path: string): string;
}

export function loadCorpus(root: string, tracked: Tracked = trackedFiles(root), gitRoot = root): Corpus {
  const { files, links } = tracked;
  const fileSet = new Set(files);
  const dirSet = new Set<string>();
  const basenames = new Set<string>();
  for (const f of files) {
    basenames.add(posix.basename(f));
    let d = posix.dirname(f);
    while (d !== '.' && !dirSet.has(d)) {
      dirSet.add(d);
      d = posix.dirname(d);
    }
  }
  const read = (p: string) => readFileSync(posix.join(root, p), 'utf8');
  const docs = new Map<string, Doc>();
  for (const p of markdownDocs(files)) if (!links.has(p)) docs.set(p, parseMarkdown(p, read(p)));
  const comments: Comment[] = [];
  for (const p of commentFiles(files)) if (!links.has(p)) comments.push(...parseComments(p, read(p)));
  return { root, gitRoot, files, fileSet, dirSet, basenames, docs, comments, read };
}

/** True when `p` (repo-relative, no trailing slash) is a tracked file or a directory holding one. */
export function exists(c: Corpus, p: string): boolean {
  const n = posix.normalize(p).replace(/\/$/, '');
  if (n === '' || n === '.') return true;
  return c.fileSet.has(n) || c.dirSet.has(n);
}
