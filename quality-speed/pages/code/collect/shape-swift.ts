// SPDX-License-Identifier: Apache-2.0
// The shape of a Swift file without a compiler (this lane runs on Linux, where the package's Apple frameworks do not
// build): which lines hold code, and how many code lines each function, initializer, subscript and computed
// property spans. A small lexer skips comments (nested block comments included) and string literals (multi-line,
// raw and interpolated), so braces inside them never count.

export interface FunctionShape {
  name: string;
  /** 1-based line of the declaration keyword. */
  line: number;
  /** Lines from the keyword to the closing brace that hold code: blank and comment-only lines do not count. */
  codeLines: number;
}

export interface FileShape {
  codeLines: number;
  /** The 1-based numbers of the lines that hold code, ascending. */
  codeLineNumbers: number[];
  functions: FunctionShape[];
}

export interface SwiftFileShape extends FileShape {
  /**
   * Force unwraps (`x!`), forced tries (`try!`) and forced casts (`as!`) with no `// safe:` comment on their line or
   * the line above. Each crashes the app when its assumption fails.
   */
  unmarkedForces: number;
}

interface Token {
  text: string;
  line: number;
  /** Offset of the token's first character. */
  pos: number;
}

/** Splits Swift source into code tokens (identifiers, keywords and punctuation) with their 1-based lines. */
export function lexSwift(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;

  const advance = (count: number) => {
    for (let k = 0; k < count && i < n; k++) {
      if (src.charAt(i) === '\n') line++;
      i++;
    }
  };

  // Lexes a string literal starting at i (after any leading #s), then any interpolations inside it as code.
  const lexString = (hashes: number) => {
    const multi = src.startsWith('"""', i);
    const open = multi ? 3 : 1;
    const close = (multi ? '"""' : '"') + '#'.repeat(hashes);
    const interp = '\\' + '#'.repeat(hashes) + '(';
    tokens.push({ text: 'STRING', line, pos: i });
    advance(open);
    while (i < n) {
      if (src.startsWith(close, i)) {
        advance(close.length);
        return;
      }
      if (hashes === 0 && src.charAt(i) === '\\' && src.charAt(i + 1) !== '(') {
        advance(2);
        continue;
      }
      if (src.startsWith(interp, i)) {
        advance(interp.length);
        lexCode(true);
        continue;
      }
      if (!multi && src.charAt(i) === '\n') return; // unterminated: stop at the line end
      advance(1);
    }
  };

  // Lexes code until end of input, or (inside an interpolation) until the parenthesis that closes it.
  const lexCode = (interpolation: boolean) => {
    let depth = 0;
    while (i < n) {
      const c = src.charAt(i);
      if (c === '\n' || c === ' ' || c === '\t' || c === '\r') {
        advance(1);
        continue;
      }
      if (src.startsWith('//', i)) {
        while (i < n && src.charAt(i) !== '\n') advance(1);
        continue;
      }
      if (src.startsWith('/*', i)) {
        let nest = 0;
        while (i < n) {
          if (src.startsWith('/*', i)) {
            nest++;
            advance(2);
          } else if (src.startsWith('*/', i)) {
            nest--;
            advance(2);
            if (nest === 0) break;
          } else advance(1);
        }
        continue;
      }
      if (c === '#') {
        let h = 0;
        while (src.charAt(i + h) === '#') h++;
        if (src.charAt(i + h) === '"') {
          advance(h);
          lexString(h);
          continue;
        }
      }
      if (c === '"') {
        lexString(0);
        continue;
      }
      if (/[A-Za-z_@#$]/.test(c)) {
        let j = i + 1;
        while (j < n && /[A-Za-z0-9_]/.test(src.charAt(j))) j++;
        tokens.push({ text: src.slice(i, j), line, pos: i });
        advance(j - i);
        continue;
      }
      if (interpolation) {
        if (c === '(') depth++;
        if (c === ')') {
          if (depth === 0) {
            advance(1);
            return;
          }
          depth--;
        }
      }
      tokens.push({ text: c, line, pos: i });
      advance(1);
    }
  };

  lexCode(false);
  return tokens;
}

const FUNCTION_KEYWORDS = new Set(['func', 'init', 'deinit', 'subscript']);
const STOP_KEYWORDS = new Set(['func', 'var', 'let', 'case', 'init', 'deinit', 'subscript', 'struct', 'class', 'enum', 'protocol', 'extension', 'typealias', 'associatedtype']);

/** Lines (1-based) whose comment text says `safe:`, the marker that excuses a force unwrap. */
function safeMarkedLines(src: string): Set<number> {
  const marked = new Set<number>();
  src.split('\n').forEach((text, index) => {
    if (/\/\/.*\bsafe:/.test(text)) marked.add(index + 1);
  });
  return marked;
}

/** The code-line count of a Swift file, each function-like body in it, and its unmarked force unwraps. */
export function swiftShape(src: string): SwiftFileShape {
  const tokens = lexSwift(src);
  const NONE: Token = { text: '', line: 0, pos: -1 };
  const tok = (k: number): Token => tokens[k] ?? NONE;
  const safe = safeMarkedLines(src);
  let unmarkedForces = 0;
  for (let k = 1; k < tokens.length; k++) {
    const t = tok(k);
    if (t.text !== '!') continue;
    const prev = tok(k - 1);
    // try! and as! force too: a failed try or cast crashes like a nil unwrap.
    const forcedTry = prev.text === 'try' || prev.text === 'as';
    // A postfix `!` touches the expression before it; `a != b` and `!flag` do not.
    const touching = prev.pos + prev.text.length === t.pos && /[A-Za-z0-9_)\]?]$/.test(prev.text);
    const next = src.charAt(t.pos + 1);
    if (!(forcedTry || touching) || next === '=') continue;
    if (safe.has(t.line) || safe.has(t.line - 1)) continue;
    unmarkedForces++;
  }
  const codeLineSet = new Set(tokens.map((t) => t.line));
  const functions: FunctionShape[] = [];

  const countCodeLines = (from: number, to: number) => {
    let count = 0;
    for (let l = from; l <= to; l++) if (codeLineSet.has(l)) count++;
    return count;
  };

  // Index of the brace that closes the one at `open`, or -1.
  const matchBrace = (open: number) => {
    let depth = 0;
    for (let k = open; k < tokens.length; k++) {
      if (tok(k).text === '{') depth++;
      else if (tok(k).text === '}') {
        depth--;
        if (depth === 0) return k;
      }
    }
    return -1;
  };

  for (let k = 0; k < tokens.length; k++) {
    const t = tok(k);
    const isFunction = FUNCTION_KEYWORDS.has(t.text);
    const isVar = t.text === 'var';
    if (!isFunction && !isVar) continue;
    // A keyword used as a member name (`.init(`, `x.subscript`) is not a declaration.
    if (tok(k - 1).text === '.') continue;

    let paren = 0;
    let open = -1;
    let sawEquals = false;
    let sawColon = false;
    for (let j = k + 1; j < tokens.length; j++) {
      const x = tok(j).text;
      if (x === '(' || x === '[') paren++;
      else if (x === ')' || x === ']') paren--;
      else if (paren === 0) {
        if (x === '{') {
          open = j;
          break;
        }
        if (x === '}' || (STOP_KEYWORDS.has(x) && j > k + 1)) break;
        if (isVar) {
          if (x === '=') sawEquals = true;
          if (x === ':') sawColon = true;
          // A stored property ends at its line: only a type annotation followed by a brace on the same
          // line is a computed property.
          if (tok(j).line !== t.line) break;
        }
      }
    }
    if (open < 0) continue;
    if (isVar && (sawEquals || !sawColon)) continue;
    const close = matchBrace(open);
    if (close < 0) continue;
    const nameToken = tok(k + 1).text;
    const name = t.text === 'func' || t.text === 'var' ? nameToken : t.text;
    functions.push({ name, line: t.line, codeLines: countCodeLines(t.line, tok(close).line) });
  }

  const codeLineNumbers = [...codeLineSet].sort((a, b) => a - b);
  return { codeLines: codeLineSet.size, codeLineNumbers, functions, unmarkedForces };
}
