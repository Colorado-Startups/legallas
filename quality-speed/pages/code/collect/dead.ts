// SPDX-License-Identifier: Apache-2.0
// Dead code in web/, found with the TypeScript compiler web/ already installs: unused locals, imports, parameters,
// type parameters and private members (the compiler's own noUnused checks, turned on here without changing any
// tsconfig), plus exports nothing in the repository references. Each finding is code a reader has to understand
// and a change has to keep compiling, for no behaviour.
import type * as TS from 'typescript';
import { dirname, join, relative, resolve } from 'node:path';
import { pathGlobMatch } from '../../../core/glob.ts';

/** The compiler's "declared but never used" family of diagnostics. */
const UNUSED_CODES = new Set([6133, 6138, 6192, 6196, 6198, 6199, 6205]);

export interface DeadFinding {
  file: string;
  line: number;
  kind: 'unused' | 'unused-export' | 'orphan-file';
  name: string;
}

/**
 * Unused-declaration diagnostics for each tsconfig project, with noUnusedLocals and noUnusedParameters forced on.
 * Projects overlap (mcp includes worker files), so findings are keyed by file, line and code. `root` is the repo
 * root; returned paths are relative to it and limited to files under `within`.
 */
export function unusedDeclarations(ts: typeof TS, root: string, projects: string[], within: string): DeadFinding[] {
  const found = new Map<string, DeadFinding>();
  for (const project of projects) {
    const configPath = resolve(root, project);
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, { noUnusedLocals: true, noUnusedParameters: true }, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => {},
    });
    if (!parsed) throw new Error(`cannot read ${project}`);
    const program = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } });
    for (const sf of program.getSourceFiles()) {
      const rel = relative(root, sf.fileName);
      if (!rel.startsWith(within) || rel.includes('node_modules') || sf.isDeclarationFile) continue;
      for (const d of program.getSemanticDiagnostics(sf)) {
        if (!UNUSED_CODES.has(d.code) || d.start === undefined) continue;
        const line = sf.getLineAndCharacterOfPosition(d.start).line + 1;
        const name = sf.text.slice(d.start, d.start + (d.length ?? 0));
        const key = `${rel}:${line}:${d.code}:${name}`;
        if (!found.has(key)) found.set(key, { file: rel, line, kind: 'unused', name });
      }
    }
  }
  return [...found.values()];
}

interface ModuleFacts {
  /** Exported names and the line each is declared on; `default` for a default export. */
  exports: Map<string, number>;
  /** Names this file uses locally beyond their declarations. */
  localUses: Set<string>;
  /** Imports by resolved target file: the names taken, or '*' for all. */
  imports: Map<string, Set<string>>;
}

const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.mjs'];

/** Files a Vite `import.meta.glob` pattern matches, relative to the importing file. Aliases (`@brand/`) match nothing here. */
export function globTargets(fromFile: string, pattern: string, files: readonly string[]): string[] {
  if (!pattern.startsWith('.')) return [];
  const full = join(dirname(fromFile), pattern);
  return files.filter((f) => pathGlobMatch(full, f));
}

function resolveSpecifier(fromFile: string, spec: string, exists: (path: string) => boolean): string | undefined {
  if (!spec.startsWith('.')) return undefined;
  const base = join(dirname(fromFile), spec);
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix;
    if (exists(candidate)) return candidate;
  }
  // A .js specifier that points at a .ts source (moduleResolution Bundler allows both).
  if (/\.js$/.test(spec)) {
    const ts = base.replace(/\.js$/, '.ts');
    if (exists(ts)) return ts;
  }
  return undefined;
}

function addImport(facts: ModuleFacts, target: string | undefined, names: string[]) {
  if (!target) return;
  const set = facts.imports.get(target) ?? new Set<string>();
  for (const n of names) set.add(n);
  facts.imports.set(target, set);
}

/** Import, export and local-use facts for one TS/JS file. `file` is relative to the repo root. */
export function moduleFacts(
  ts: typeof TS,
  file: string,
  text: string,
  exists: (path: string) => boolean,
  files: readonly string[] = [],
): ModuleFacts {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const facts: ModuleFacts = { exports: new Map(), localUses: new Set(), imports: new Map() };
  const declarationNames = new Set<TS.Node>();
  const lineOf = (node: TS.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const isExported = (node: TS.Node) =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = (node: TS.Node) =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const target = resolveSpecifier(file, stmt.moduleSpecifier.text, exists);
      const clause = stmt.importClause;
      const names: string[] = [];
      if (!clause) names.push('*'); // side-effect import: the module runs, its exports are not judged by it
      else {
        if (clause.name) names.push('default');
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) names.push('*');
        if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) names.push((el.propertyName ?? el.name).text);
        }
      }
      addImport(facts, target, names);
      continue;
    }
    if (ts.isExportDeclaration(stmt)) {
      const target = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
        ? resolveSpecifier(file, stmt.moduleSpecifier.text, exists)
        : undefined;
      const clause = stmt.exportClause;
      if (!clause || ts.isNamespaceExport(clause)) {
        addImport(facts, target, ['*']);
        if (clause) facts.exports.set(clause.name.text, lineOf(stmt));
      } else {
        for (const el of clause.elements) {
          facts.exports.set(el.name.text, lineOf(el));
          if (target) addImport(facts, target, [(el.propertyName ?? el.name).text]);
          else facts.localUses.add((el.propertyName ?? el.name).text);
        }
      }
      continue;
    }
    if (ts.isExportAssignment(stmt)) {
      facts.exports.set('default', lineOf(stmt));
      continue;
    }
    if (!isExported(stmt)) continue;
    if (isDefault(stmt)) {
      facts.exports.set('default', lineOf(stmt));
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          facts.exports.set(decl.name.text, lineOf(decl));
          declarationNames.add(decl.name);
        }
      }
      continue;
    }
    const named = stmt as TS.Node & { name?: TS.Node };
    if (named.name && ts.isIdentifier(named.name)) {
      facts.exports.set(named.name.text, lineOf(stmt));
      declarationNames.add(named.name);
    }
  }

  const visit = (node: TS.Node) => {
    if (ts.isIdentifier(node) && !declarationNames.has(node)) facts.localUses.add(node.text);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      const spec = node.arguments[0];
      if (spec && ts.isStringLiteralLike(spec)) addImport(facts, resolveSpecifier(file, spec.text, exists), ['*']);
    }
    // import.meta.glob('pattern' | ['a', 'b'], ...): Vite loads every matching module.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'glob' &&
      ts.isMetaProperty(node.expression.expression) &&
      node.arguments.length > 0
    ) {
      const arg = node.arguments[0] as TS.Expression;
      const patterns = ts.isArrayLiteralExpression(arg) ? arg.elements : [arg];
      for (const p of patterns) {
        if (ts.isStringLiteralLike(p)) for (const target of globTargets(file, p.text, files)) addImport(facts, target, ['*']);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return facts;
}

/** Import specifiers in an .astro file's frontmatter and script tags, glob imports included (all names). */
export function astroImports(text: string): { spec: string; names: string[]; glob?: boolean }[] {
  const out: { spec: string; names: string[]; glob?: boolean }[] = [];
  // import.meta.glob<T>('pattern' | ['a', 'b'], ...); the type argument may itself hold `=>`.
  for (const m of text.matchAll(/import\.meta\.glob(?:<.*?>)?\(\s*(\[[^\]]*\]|'[^']+'|"[^"]+")/g)) {
    for (const p of (m[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)) out.push({ spec: p[1] ?? '', names: ['*'], glob: true });
  }
  const re = /import\s+(?:type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of text.matchAll(re)) {
    if (m[3] || m[4]) {
      out.push({ spec: m[3] ?? m[4] ?? '', names: ['*'] });
      continue;
    }
    const clause = m[1] ?? '';
    const names: string[] = [];
    const braces = clause.match(/\{([\s\S]*)\}/);
    if (braces) {
      for (const part of (braces[1] ?? '').split(',')) {
        const name = (part.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0] ?? '').trim();
        if (name) names.push(name);
      }
    }
    if (/\*\s+as\s+/.test(clause)) names.push('*');
    const head = clause.replace(/\{[\s\S]*\}/, '').replace(/\*\s+as\s+\w+/, '').replace(/,/g, '').trim();
    if (head) names.push('default');
    out.push({ spec: m[2] ?? '', names });
  }
  return out;
}

/**
 * Exports that no file imports and their own file never uses. `files` are repo-relative TS/JS paths; `astroFiles`
 * are .astro paths whose imports count as uses; `entries` are files a runtime loads by name (Worker mains, CLIs,
 * config), whose exports the platform consumes. Test files count as users: an export kept for a test is not dead.
 */
export function unusedExports(
  ts: typeof TS,
  files: string[],
  astroFiles: string[],
  entries: Set<string>,
  read: (path: string) => string,
  exists: (path: string) => boolean,
  allFiles: readonly string[],
): DeadFinding[] {
  const facts = new Map<string, ModuleFacts>();
  for (const f of files) facts.set(f, moduleFacts(ts, f, read(f), exists, allFiles));
  const used = new Map<string, Set<string>>();
  const markUsed = (target: string, names: Iterable<string>) => {
    const set = used.get(target) ?? new Set<string>();
    for (const n of names) set.add(n);
    used.set(target, set);
  };
  for (const f of facts.values()) for (const [target, names] of f.imports) markUsed(target, names);
  for (const a of astroFiles) {
    for (const { spec, names, glob } of astroImports(read(a))) {
      if (glob) {
        for (const target of globTargets(a, spec, allFiles)) markUsed(target, names);
        continue;
      }
      const target = resolveSpecifier(a, spec.replace(/\?.*$/, ''), exists);
      if (target) markUsed(target, names);
    }
  }
  const findings: DeadFinding[] = [];
  for (const [file, f] of facts) {
    if (entries.has(file) || /\.test\.ts$/.test(file)) continue;
    const names = used.get(file) ?? new Set<string>();
    if (names.has('*')) continue;
    for (const [name, line] of f.exports) {
      if (names.has(name) || f.localUses.has(name)) continue;
      findings.push({ file, line, kind: 'unused-export', name });
    }
  }
  return findings;
}
