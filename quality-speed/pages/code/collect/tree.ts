// SPDX-License-Identifier: Apache-2.0
// Every tracked file and folder scored on Q, S and C, for the page's tree. Pure: docs.ts reads the files, page.ts draws
// the folders. This site's own folder and workflow stay out (BRIEF.md, Never).
import { lineScore } from '../../../core/score.ts';

/** One file: repository path, then its Q, S and C scores. */
export type FileRow = [path: string, q: number, s: number, c: number];
export interface Scores { q: number; s: number; c: number }

/** The site's own folder and workflow: never counted in Code. */
export const outsideCode = (path: string): boolean => path.startsWith('quality-speed/') || path === '.github/workflows/quality-speed.yml';

/** Each line: 100 at its goal, 0 at its floor. */
export const LINES = {
  /** Findings in the file (long function or file, type escape, dead code, broken link, dead name, long sentence, undocumented symbol). */
  q: { direction: 'lower', floor: 5, goal: 0 },
  /** Minutes to read it at 238 words a minute, reading_minutes_p90's line. */
  s: { direction: 'lower', floor: 10, goal: 1 },
  /** Tokens to read it, four characters each: about 200 lines at goal, 1,000 at the floor. */
  c: { direction: 'lower', floor: 10_000, goal: 2_000 },
} as const;
const WORDS_PER_MINUTE = 238;

/** The scores of one text file with `findings` against it. */
export function scoreFile(path: string, text: string, findings: number): FileRow {
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const tokens = Math.ceil(text.length / 4);
  const at = (line: keyof typeof LINES, v: number) => Math.floor(lineScore(LINES[line], v));
  return [path, at('q', findings), at('s', words / WORDS_PER_MINUTE), at('c', tokens)];
}

/** Each folder's scores: the mean of every file under it, rounded down. `''` is the root. */
export function folderScores(rows: readonly FileRow[]): Map<string, Scores> {
  const sums = new Map<string, { q: number; s: number; c: number; n: number }>();
  for (const [path, q, s, c] of rows) {
    const parts = path.split('/');
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      const v = sums.get(dir) ?? { q: 0, s: 0, c: 0, n: 0 };
      sums.set(dir, { q: v.q + q, s: v.s + s, c: v.c + c, n: v.n + 1 });
    }
  }
  return new Map([...sums].map(([dir, v]) => [dir, { q: Math.floor(v.q / v.n), s: Math.floor(v.s / v.n), c: Math.floor(v.c / v.n) }]));
}

/** Reads tree.json as untrusted: only rows of a safe path and three whole scores from 0 to 100 survive. */
export function readRows(raw: unknown): FileRow[] {
  const files = (raw as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return [];
  const score = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100;
  const safe = (p: unknown) => typeof p === 'string' && /^[\w.@+-]+(\/[\w.@+-]+)*$/.test(p) && !p.split('/').some((s) => /^\.\.?$/.test(s)) && !outsideCode(p);
  return files.filter((r): r is FileRow => Array.isArray(r) && r.length === 4 && safe(r[0]) && score(r[1]) && score(r[2]) && score(r[3]));
}
