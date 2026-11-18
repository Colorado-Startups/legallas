// SPDX-License-Identifier: Apache-2.0
// Card F6b (binder theme fixes): a small element tree and selector matcher for the contrast check.
//
// The contrast check needs the ground a text rule actually sits on: its own background, else the nearest
// ancestor that paints one, else the page. This reads the page's static markup (script and style bodies
// masked) into elements, and matches the simple selectors binder pages use: type, class, id, attribute,
// :root, :not() and :is()/:where() of compounds, joined by descendant or child combinators. Sibling
// combinators and other pseudo-classes match loosely (as if true); pseudo-elements match their element.

export interface Element {
  tag: string;
  id: string;
  classes: Set<string>;
  attrs: Map<string, string>;
  parent: Element | null;
  /** The style attribute, as the theme rewrote it. */
  style: string;
  /** The element's own text (not its children's), entities as written. */
  text: string;
}

const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"'][^\s>]*))?)*)\s*(\/?)>/g;
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** Every element of the markup in document order. Missing html and body elements are not invented. */
export function parseElements(markup: string): Element[] {
  const elements: Element[] = [];
  const open: Element[] = [];
  let at = 0;
  for (const match of markup.matchAll(TAG)) {
    const parent = open[open.length - 1];
    if (parent) parent.text += markup.slice(at, match.index);
    at = match.index + match[0].length;
    if (!match[2]) continue;
    const tag = match[2].toLowerCase();
    if (match[1]) {
      const at = open.map((e) => e.tag).lastIndexOf(tag);
      if (at >= 0) open.length = at;
      continue;
    }
    const attrs = new Map<string, string>();
    for (const a of (match[3] ?? '').matchAll(ATTRIBUTE)) attrs.set(a[1]!.toLowerCase(), a[2] ?? a[3] ?? a[4] ?? '');
    const element: Element = {
      tag, id: attrs.get('id') ?? '', classes: new Set((attrs.get('class') ?? '').split(/\s+/).filter(Boolean)),
      attrs, parent: open[open.length - 1] ?? null, style: attrs.get('style') ?? '', text: '',
    };
    elements.push(element);
    if (!VOID.has(tag) && !match[4]) open.push(element);
  }
  return elements;
}

/** Splits a selector list at its top-level commas. */
export function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (c === ',' && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out.filter(Boolean);
}

const PSEUDO_ELEMENT = /::?(?:before|after|first-line|first-letter|marker|placeholder|selection|backdrop|file-selector-button)\b|::[\w-]+/i;

/** True when a selector styles a pseudo-element rather than its element. */
export const hasPseudoElement = (selector: string) => PSEUDO_ELEMENT.test(selector);

type Test = (element: Element) => boolean;

export interface Compound {
  tag: string;
  id: string;
  classes: string[];
  others: Test[];
  specificity: number;
}

const SIMPLE = /^(?:\*|[a-zA-Z][\w-]*|#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?)/;

function attributeTest(body: string): Test {
  const m = /^\s*([\w:-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*(i)?)?\s*$/i.exec(body);
  if (!m) return () => true;
  const name = m[1]!.toLowerCase();
  const op = m[2];
  const fold = (v: string) => (m[6] ? v.toLowerCase() : v);
  const want = fold(m[3] ?? m[4] ?? m[5] ?? '');
  return (e) => {
    const raw = e.attrs.get(name);
    if (raw === undefined) return false;
    const v = fold(raw);
    if (!op) return true;
    if (op === '=') return v === want;
    if (op === '~=') return v.split(/\s+/).includes(want);
    if (op === '|=') return v === want || v.startsWith(`${want}-`);
    if (op === '^=') return v.startsWith(want);
    if (op === '$=') return v.endsWith(want);
    return v.includes(want);
  };
}

function pseudoTest(token: string): { test: Test; specificity: number } {
  const m = /^::?([\w-]+)(?:\(([\s\S]*)\))?$/.exec(token)!;
  const name = m[1]!.toLowerCase();
  if (token.startsWith('::') || PSEUDO_ELEMENT.test(token)) return { test: () => true, specificity: 1 };
  if (name === 'root') return { test: (e) => e.tag === 'html', specificity: 100 };
  if (name === 'not' || name === 'is' || name === 'where' || name === 'matches') {
    const inner = splitSelectors(m[2] ?? '').map(parseComplex);
    const any = (e: Element) => inner.some((c) => c !== null && c.matches(e));
    const weight = name === 'where' ? 0 : Math.max(0, ...inner.map((c) => c?.specificity ?? 0));
    return { test: name === 'not' ? (e) => !any(e) : any, specificity: weight };
  }
  return { test: () => true, specificity: 100 };
}

function parseCompound(text: string): Compound | null {
  const compound: Compound = { tag: '', id: '', classes: [], others: [], specificity: 0 };
  for (let rest = text; rest; ) {
    const token = SIMPLE.exec(rest)?.[0];
    if (!token) return null;
    rest = rest.slice(token.length);
    if (token === '*') continue;
    if (token.startsWith('#')) {
      compound.id = token.slice(1);
      compound.specificity += 10000;
    } else if (token.startsWith('.')) {
      compound.classes.push(token.slice(1));
      compound.specificity += 100;
    } else if (token.startsWith('[')) {
      compound.others.push(attributeTest(token.slice(1, -1)));
      compound.specificity += 100;
    } else if (token.startsWith(':')) {
      const pseudo = pseudoTest(token);
      compound.others.push(pseudo.test);
      compound.specificity += pseudo.specificity;
    } else {
      compound.tag = token.toLowerCase();
      compound.specificity += 1;
    }
  }
  return compound;
}

function compoundMatches(c: Compound, e: Element): boolean {
  if (c.tag && c.tag !== e.tag) return false;
  if (c.id && c.id !== e.id) return false;
  for (const name of c.classes) if (!e.classes.has(name)) return false;
  for (const test of c.others) if (!test(e)) return false;
  return true;
}

/** Splits a complex selector into compounds and combinators, outside brackets, parentheses and quotes. */
function tokens(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  const flush = () => {
    if (current) out.push(current);
    current = '';
  };
  for (const c of selector.trim()) {
    if (quote) quote = c === quote ? '' : quote;
    else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (depth === 0 && /[\s>+~]/.test(c)) {
      flush();
      if (c !== ' ' && !/\s/.test(c)) out.push(c);
      continue;
    }
    current += c;
  }
  flush();
  return out;
}

/** A parsed complex selector: does it match an element, and how specific it is (ids, classes, types). */
export interface Matcher {
  matches: (element: Element) => boolean;
  specificity: number;
  /** The rightmost compound, which every matching element must satisfy. */
  subject: Compound;
}

/** Elements by id, class and type, so a selector is only tried on elements its subject could match. */
export interface ElementIndex {
  all: Element[];
  byId: Map<string, Element[]>;
  byClass: Map<string, Element[]>;
  byTag: Map<string, Element[]>;
}

function add(map: Map<string, Element[]>, key: string, element: Element): void {
  const list = map.get(key);
  if (list) list.push(element);
  else map.set(key, [element]);
}

export function indexElements(all: Element[]): ElementIndex {
  const index: ElementIndex = { all, byId: new Map(), byClass: new Map(), byTag: new Map() };
  for (const element of all) {
    if (element.id) add(index.byId, element.id, element);
    for (const name of element.classes) add(index.byClass, name, element);
    add(index.byTag, element.tag, element);
  }
  return index;
}

/** The elements a selector matches, in document order. */
export function select(matcher: Matcher, index: ElementIndex): Element[] {
  const { id, classes, tag } = matcher.subject;
  const pool = id ? index.byId.get(id) : classes.length ? index.byClass.get(classes[0]!) : tag ? index.byTag.get(tag) : index.all;
  return (pool ?? []).filter(matcher.matches);
}

function matchFrom(compounds: Compound[], combinators: string[], i: number, element: Element | null): boolean {
  if (!element || !compoundMatches(compounds[i]!, element)) return false;
  if (i === 0) return true;
  const combinator = combinators[i - 1];
  if (combinator === '>') return matchFrom(compounds, combinators, i - 1, element.parent);
  if (combinator === '+' || combinator === '~') return true;
  for (let up = element.parent; up; up = up.parent) if (matchFrom(compounds, combinators, i - 1, up)) return true;
  return false;
}

/** Parses one complex selector, or returns null when it uses syntax this matcher does not know. */
export function parseComplex(selector: string): Matcher | null {
  const parts = tokens(selector);
  const compounds: Compound[] = [];
  const combinators: string[] = [];
  for (const part of parts) {
    if (/^[>+~]$/.test(part)) {
      combinators[compounds.length - 1] = part;
      continue;
    }
    const compound = parseCompound(part);
    if (!compound) return null;
    if (compounds.length) combinators[compounds.length - 1] ??= ' ';
    compounds.push(compound);
  }
  if (!compounds.length) return null;
  return {
    matches: (e) => matchFrom(compounds, combinators, compounds.length - 1, e),
    specificity: compounds.reduce((sum, c) => sum + c.specificity, 0),
    subject: compounds[compounds.length - 1]!,
  };
}
