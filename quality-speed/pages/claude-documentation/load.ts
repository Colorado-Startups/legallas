// SPDX-License-Identifier: Apache-2.0
// What a session loads before its first edit, in two readings moved here unchanged, so no file counts twice:
//   start_tokens (from Documentation): the root CLAUDE.md, its `@` imports up to four hops, and its "Read too" files.
//   startup_tokens (from Claude settings): .claude/CLAUDE.md, rules with no `paths`, and each skill's and agent's listing.
// Both follow code.claude.com/docs/en/memory and /skills (read 2026-11-05).

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { stripHtmlComments } from '../../core/escape.ts';

export interface Loaded { path: string; tokens: number }

/** Four characters a token, the data room's rule (data-room/lab/journeys.ts), so tokens compare across pages. */
export const tokensOf = (text: string): number => Math.ceil(text.length / 4);

const IMPORT_HOPS = 4;
/** An `@path` import, outside code: Claude Code's memory import syntax. */
const IMPORT = /(?:^|\s)@([\w./-]+)/g;
const outsideCode = (text: string) => text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

/** The paths the entry's "Read too" row names. */
export function readToo(entry: string): string[] {
  const row = /^\|\s*Read too\s*\|(.*)\|\s*$/m.exec(entry)?.[1] ?? '';
  return [...row.matchAll(/`([^`]+\.md)`/g)].flatMap((m) => m[1] ?? []);
}

/** The start files: the root CLAUDE.md (AGENTS.md links to it), its imports and its Read too files, each once. */
export function startLoad(root: string): Loaded[] {
  const seen = new Map<string, Loaded>();
  const add = (file: string, hops: number) => {
    if (!existsSync(file)) return;
    const real = realpathSync(file);
    if (seen.has(real)) return;
    const text = readFileSync(real, 'utf8');
    seen.set(real, { path: path.relative(root, file), tokens: tokensOf(text) });
    if (hops >= IMPORT_HOPS) return;
    for (const m of outsideCode(text).matchAll(IMPORT)) add(path.join(path.dirname(file), m[1] ?? ''), hops + 1);
  };
  const first = path.join(root, 'CLAUDE.md');
  add(first, 0);
  if (existsSync(first)) for (const p of readToo(readFileSync(first, 'utf8'))) add(path.join(root, p), IMPORT_HOPS);
  return [...seen.values()];
}

/** A file's text as Claude Code loads it, block HTML comments stripped. Null on an `@` import outside code, which this count doesn't follow. */
export function loadedText(text: string): string | null {
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && /(^|\s)@[^\s`]/.test(line.replace(/`[^`]*`/g, ''))) return null;
  }
  return stripHtmlComments(text);
}

const frontmatter = (text: string) => /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';

/** The skill listing's share of a SKILL.md or agent file: its name, description and when_to_use, continuation lines included. */
export function listing(text: string): string {
  const kept: string[] = [];
  let keep = false;
  for (const line of frontmatter(text).split('\n')) {
    keep = /^(name|description|when_to_use):/.test(line) || (keep && /^\s/.test(line));
    if (keep) kept.push(line);
  }
  return kept.join('\n');
}

const mdIn = (dir: string, recursive: boolean) =>
  existsSync(dir) ? (readdirSync(dir, { recursive }) as string[]).filter((f) => f.endsWith('.md')).sort().map((f) => path.join(dir, f)) : [];

/**
 * What .claude/ adds to every session at launch, per file, and the total as UTF-8 bytes / 4 (Git Crafter's estimate), rounded up
 * once. Null on an import, or when .claude/ adds nothing.
 */
export function claudeLoad(root: string): { tokens: number; files: Loaded[] } | null {
  const files: { path: string; text: string }[] = [];
  const dir = path.join(root, '.claude');
  for (const file of [path.join(dir, 'CLAUDE.md'), ...mdIn(path.join(dir, 'rules'), true)]) {
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, 'utf8');
    // A rule with `paths` loads only with a matching file, not at launch.
    if (/^paths:/m.test(frontmatter(raw))) continue;
    const text = loadedText(raw);
    if (text === null) return null;
    files.push({ path: path.relative(root, file), text });
  }
  const skills = path.join(dir, 'skills');
  const named = existsSync(skills) ? readdirSync(skills).sort().map((d) => path.join(skills, d, 'SKILL.md')) : [];
  for (const file of [...named, ...mdIn(path.join(dir, 'agents'), false)]) {
    if (existsSync(file)) files.push({ path: path.relative(root, file), text: listing(readFileSync(file, 'utf8')) });
  }
  if (!files.length) return null;
  const bytes = files.map((f) => Buffer.byteLength(f.text, 'utf8'));
  return { tokens: Math.ceil(bytes.reduce((n, b) => n + b, 0) / 4), files: files.map((f, i) => ({ path: f.path, tokens: Math.ceil((bytes[i] ?? 0) / 4) })) };
}
