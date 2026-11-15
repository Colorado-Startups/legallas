// SPDX-License-Identifier: Apache-2.0
// Mutants: one small break each, made from the syntax tree of the named functions only. The operators are a subset of
// Stryker's (https://stryker-mutator.io/docs/mutation-testing-elements/supported-mutators/): equality, logical and
// arithmetic operators, boolean literals, negation, if conditions and emptied function bodies. TypeScript comes from
// web/'s install, so this needs no install of its own.
import { createRequire } from 'node:module';
import path from 'node:path';
import type * as TS from 'typescript';

const ts = createRequire(path.resolve(import.meta.dirname, '../../../web/package.json'))('typescript') as typeof TS;

export interface Mutant {
  file: string;
  line: number;
  start: number;
  end: number;
  text: string;
}

const FLIP: Readonly<Record<string, string>> = {
  '===': '!==', '!==': '===', '==': '!=', '!=': '==', '<': '<=', '<=': '<', '>': '>=', '>=': '>',
  '&&': '||', '||': '&&', '??': '&&', '+': '-', '-': '+', '*': '/', '/': '*',
};

function nameOf(node: TS.Node): string | null {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) return node.name.getText();
  if (ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
    return node.name.getText();
  }
  return null;
}

const isText = (node: TS.Node) => ts.isStringLiteral(node) || ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node);
const isConsole = (node: TS.Node) => ts.isCallExpression(node) && node.expression.getText().startsWith('console.');

/** Every mutant inside the functions `names` of `source`, in source order. */
export function mutantsOf(file: string, source: string, names: readonly string[]): Mutant[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: Mutant[] = [];
  const add = (start: number, end: number, text: string) =>
    out.push({ file, line: tree.getLineAndCharacterOfPosition(start).line + 1, start, end, text });
  const visit = (node: TS.Node, inside: boolean): void => {
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || isConsole(node)) return;
    const name = nameOf(node);
    const on = inside || (name !== null && names.includes(name));
    if (on) {
      if (ts.isBinaryExpression(node)) {
        const op = node.operatorToken.getText();
        const flip = FLIP[op];
        if (flip && !(op === '+' && (isText(node.left) || isText(node.right)))) add(node.operatorToken.getStart(), node.operatorToken.getEnd(), flip);
      } else if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
        add(node.getStart(), node.getEnd(), node.operand.getText());
      } else if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
        add(node.getStart(), node.getEnd(), node.kind === ts.SyntaxKind.TrueKeyword ? 'false' : 'true');
      } else if (ts.isIfStatement(node)) {
        add(node.expression.getStart(), node.expression.getEnd(), 'true');
        add(node.expression.getStart(), node.expression.getEnd(), 'false');
      } else if (ts.isBlock(node) && ts.isFunctionLike(node.parent) && node.statements.length > 0) {
        add(node.getStart(), node.getEnd(), '{}');
      }
    }
    ts.forEachChild(node, (child) => visit(child, on));
  };
  visit(tree, false);
  return out;
}

/** `source` with `mutant` applied, or null when the result would not parse. */
export function applyMutant(source: string, mutant: Mutant): string | null {
  const text = source.slice(0, mutant.start) + mutant.text + source.slice(mutant.end);
  const { diagnostics } = ts.transpileModule(text, { reportDiagnostics: true, fileName: mutant.file });
  return diagnostics?.length ? null : text;
}
