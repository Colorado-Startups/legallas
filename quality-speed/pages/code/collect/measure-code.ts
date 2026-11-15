// SPDX-License-Identifier: Apache-2.0
// The static measurements: unit lengths, type escapes, duplication and dead code, each over the
// files classify.ts assigns it. Pure over a RepoView, so the scope rules are tested without touching the disk.
import type * as TS from 'typescript';
import { type Classification, type FileClass, CODE_FILE, isTypeDeclaration } from './classify.ts';
import { unusedDeclarations, unusedExports, type DeadFinding } from './dead.ts';
import { duplication, type DupResult } from './dup.ts';
import { swiftShape } from './shape-swift.ts';
import { tsShape, type FunctionShape } from './shape-ts.ts';
import type { RepoView } from './classify.ts';

export const FUNCTION_LIMIT = 60;
export const FILE_LIMIT = 400;

/** What a file is, for every code file this page reads: web/ files by classify.ts, Swift by folder. */
export function classOf(file: string, c: Classification): FileClass | undefined {
  if (file.endsWith('.swift')) {
    if (file.startsWith('Tests/')) return 'test';
    if (file.startsWith('Sources/') || file.startsWith('LegallasApp/')) return 'production';
    return undefined;
  }
  return c.classes.get(file);
}

export interface Shapes {
  files: { file: string; cls: FileClass; codeLines: number; codeLineNumbers: number[] }[];
  longFunctions: (FunctionShape & { file: string })[];
  longFiles: { file: string; codeLines: number }[];
  functions: number;
  escapes: { file: string; kind: string; count: number }[];
  productionCodeLines: number;
}

/** Shapes of every TS, JS and Swift file this page reads (tests and helpers included; orphans too). */
export function measureShapes(ts: typeof TS, view: RepoView, c: Classification): Shapes {
  const out: Shapes = { files: [], longFunctions: [], longFiles: [], functions: 0, escapes: [], productionCodeLines: 0 };
  for (const file of view.files) {
    const isWeb = file.startsWith('web/') && CODE_FILE.test(file) && !isTypeDeclaration(file);
    if (!isWeb && !file.endsWith('.swift')) continue;
    const cls = classOf(file, c);
    if (!cls) continue;
    const text = view.read(file);
    const shape = file.endsWith('.swift') ? swiftShape(text) : tsShape(ts, file, text);
    out.files.push({ file, cls, codeLines: shape.codeLines, codeLineNumbers: shape.codeLineNumbers });
    out.functions += shape.functions.length;
    for (const fn of shape.functions) if (fn.codeLines > FUNCTION_LIMIT) out.longFunctions.push({ ...fn, file });
    if (shape.codeLines > FILE_LIMIT) out.longFiles.push({ file, codeLines: shape.codeLines });
    if (cls !== 'production') continue;
    out.productionCodeLines += shape.codeLines;
    const kinds: [string, number][] =
      'escapes' in shape
        ? Object.entries(shape.escapes)
        : [['unmarkedForces', shape.unmarkedForces]];
    for (const [kind, count] of kinds) if (count > 0) out.escapes.push({ file, kind, count });
  }
  out.longFunctions.sort((a, b) => b.codeLines - a.codeLines);
  out.longFiles.sort((a, b) => b.codeLines - a.codeLines);
  return out;
}

/** Duplication over production files (SonarQube measures main code, not tests). */
export function measureDuplication(view: RepoView, shapes: Shapes): DupResult {
  const inputs = shapes.files
    .filter((f) => f.cls === 'production')
    .map((f) => {
      const lines = view.read(f.file).split('\n');
      return { file: f.file, lines: f.codeLineNumbers.map((n) => ({ line: n, text: lines[n - 1] ?? '' })) };
    });
  return duplication(inputs);
}

/** The tsconfig projects under web/ that `npm run check` type-checks. */
export function tsProjects(view: RepoView): string[] {
  return view.files.filter((f) => /^web\/(.*\/)?tsconfig\.json$/.test(f)).sort();
}

/** Unused declarations, unused exports and orphan files in web/. */
export function measureDeadCode(ts: typeof TS, root: string, view: RepoView, c: Classification): DeadFinding[] {
  const projects = tsProjects(view);
  // With no project the compiler checks nothing, and an empty list would read as 0, at goal: missing instead.
  if (projects.length === 0) throw new Error('no web/ tsconfig.json');
  const findings = unusedDeclarations(ts, root, projects, 'web/');
  const tracked = new Set(view.files);
  const code = view.files.filter((f) => f.startsWith('web/') && CODE_FILE.test(f) && !isTypeDeclaration(f));
  const astro = view.files.filter((f) => f.startsWith('web/') && f.endsWith('.astro'));
  const entries = new Set(c.entries.map((e) => e.file));
  findings.push(...unusedExports(ts, code, astro, entries, view.read, (p) => tracked.has(p), view.files));
  for (const [file, cls] of c.classes) if (cls === 'orphan') findings.push({ file, line: 1, kind: 'orphan-file', name: file });
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
