// SPDX-License-Identifier: Apache-2.0
// The shape of a TypeScript or JavaScript file, read with the TypeScript compiler web/ already installs (no new
// package): which lines hold code, how many code lines each function spans, and every place the type system is
// switched off. The compiler is passed in, so this module loads without it and its tests can run without an install.
import type * as TS from 'typescript';
import type { FileShape, FunctionShape } from './shape-swift.ts';

export type { FileShape, FunctionShape };

/** Where a file opts out of type checking. Each kind is one finding per occurrence. */
export interface TypeEscapes {
  /** An explicit `any` type annotation or assertion (`: any`, `as any`, `<any>`, `any[]`). */
  explicitAny: number;
  /** `@ts-ignore`, `@ts-nocheck` and `@ts-expect-error` comments. */
  suppressions: number;
  /** A double assertion through `unknown` or `any` (`x as unknown as T`), which turns checking off for one value. */
  doubleAssertions: number;
  /** A non-null assertion (`x!`): TypeScript's counterpart of a Swift force unwrap. */
  nonNullAssertions: number;
}

export interface TsFileShape extends FileShape {
  escapes: TypeEscapes;
}

const SUPPRESSION = /@ts-(ignore|nocheck|expect-error)\b/g;

function lineOf(sf: TS.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

/**
 * Walks the parsed tree's leaf tokens (the parser already told regex, template and division apart, which a bare
 * scanner cannot): marks every line a token spans as code, and returns the text of every comment, each once.
 */
function scanTokens(ts: typeof TS, sf: TS.SourceFile): { lines: Set<number>; comments: string[] } {
  const lines = new Set<number>();
  const comments: string[] = [];
  const seen = new Set<number>();
  const walk = (node: TS.Node) => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(sf);
    if (children.length > 0) {
      for (const child of children) walk(child);
      return;
    }
    for (const range of ts.getLeadingCommentRanges(sf.text, node.getFullStart()) ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      comments.push(sf.text.slice(range.pos, range.end));
    }
    if (node.kind === ts.SyntaxKind.EndOfFileToken) return;
    const start = lineOf(sf, node.getStart(sf));
    const end = lineOf(sf, node.getEnd());
    for (let l = start; l <= end; l++) lines.add(l);
  };
  walk(sf);
  return { lines, comments };
}

function functionName(ts: typeof TS, node: TS.Node): string {
  const named = node as TS.Node & { name?: TS.Node };
  if (named.name && ts.isIdentifier(named.name)) return named.name.text;
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (parent && ts.isCallExpression(parent)) {
    // test('name', () => ...) and similar: the callee's name tells more than nothing.
    const callee = parent.expression;
    if (ts.isIdentifier(callee)) return `${callee.text}(callback)`;
    if (ts.isPropertyAccessExpression(callee)) return `${callee.name.text}(callback)`;
  }
  return '(anonymous)';
}

/** Reads one file's shape. `fileName` decides TS, TSX, JS or MJS parsing by its extension. */
export function tsShape(ts: typeof TS, fileName: string, text: string): TsFileShape {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const { lines, comments } = scanTokens(ts, sf);
  const functions: FunctionShape[] = [];
  const escapes: TypeEscapes = { explicitAny: 0, suppressions: 0, doubleAssertions: 0, nonNullAssertions: 0 };

  const count = (from: number, to: number) => {
    let c = 0;
    for (let l = from; l <= to; l++) if (lines.has(l)) c++;
    return c;
  };

  const visit = (node: TS.Node) => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      const body = (node as TS.FunctionLikeDeclaration).body;
      if (body) {
        const start = lineOf(sf, node.getStart(sf));
        const end = lineOf(sf, node.getEnd());
        functions.push({ name: functionName(ts, node), line: start, codeLines: count(start, end) });
      }
    }
    if (node.kind === ts.SyntaxKind.AnyKeyword) escapes.explicitAny++;
    if (ts.isNonNullExpression(node)) escapes.nonNullAssertions++;
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      const inner = node.expression;
      if (
        (ts.isAsExpression(inner) || ts.isTypeAssertionExpression(inner)) &&
        (inner.type.kind === ts.SyntaxKind.UnknownKeyword || inner.type.kind === ts.SyntaxKind.AnyKeyword)
      ) {
        escapes.doubleAssertions++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Suppression comments live in trivia, so they are counted from the comment text, never from strings.
  for (const comment of comments) escapes.suppressions += (comment.match(SUPPRESSION) ?? []).length;

  const codeLineNumbers = [...lines].sort((a, b) => a - b);
  return { codeLines: lines.size, codeLineNumbers, functions, escapes };
}
