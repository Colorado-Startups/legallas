// SPDX-License-Identifier: Apache-2.0
// What a rendered visual says, as blocks of text: headings, lines, list items, table rows, figures (an SVG chart's
// title and its text labels) and notes (image alt text, labels of elements with no text, canvas charts).
//
// The walker runs INSIDE the page: scripts/visual-render.ts evaluates pageExpression() over CDP once the page's own
// scripts have drawn their charts. pageExpression() is the source of the functions in PAGE_FUNCTIONS plus the three
// tag lists and the stored name, so those functions may use only each other, those and the page's globals: no other
// imports and no other module-level names. Node strips their erasable type annotations, so their source is plain
// JavaScript; visual-dom.test.ts runs it the same way over a small fake DOM.
import { STORED_NAME } from '../worker/stored-name.ts';

/** The parts of a DOM node the walker reads; Document, Element and Text fit. */
export interface DomNode {
  nodeType: number;
  localName?: string;
  nodeValue?: string | null;
  textContent?: string | null;
  childNodes: ArrayLike<DomNode>;
  getAttribute?(name: string): string | null;
}

export interface DomDocument {
  title?: string;
  body?: DomNode | null;
  documentElement?: DomNode | null;
}

export type VisualBlock =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'li'; depth: number; text: string }
  | { t: 'row'; head: boolean; cells: string[] }
  | { t: 'figure'; label: string; items: string[] }
  | { t: 'note'; text: string };

export interface WalkedVisual {
  title: string;
  blocks: VisualBlock[];
}

/** The walker's state: the blocks so far and the line of inline text being gathered. */
interface Walk {
  blocks: VisualBlock[];
  line: string;
}

/** Never read: code, metadata, form fields and embedded documents. */
const SKIP = ['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title', 'input', 'textarea', 'iframe', 'object'];
/** Elements that start and end a line. */
const BLOCK = [
  'address', 'article', 'aside', 'blockquote', 'caption', 'center', 'dd', 'details', 'dialog', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'header', 'hgroup', 'hr', 'html', 'body', 'legend', 'main',
  'nav', 'p', 'pre', 'section', 'summary', 'td', 'th', 'tr',
];
/** Elements read into blocks of their own. */
const STRUCTURE = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'ul', 'ol', 'li', 'svg', 'canvas', 'img', 'select'];

function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function nameOf(node: DomNode): string {
  return (node.localName ?? '').toLowerCase();
}

function attr(node: DomNode, name: string): string {
  return clean(node.getAttribute ? node.getAttribute(name) : null);
}

function kids(node: DomNode): DomNode[] {
  return Array.prototype.slice.call(node.childNodes) as DomNode[];
}

function flush(w: Walk): void {
  const text = clean(w.line);
  w.line = '';
  if (text) w.blocks.push({ t: 'p', text });
}

function hasBlock(node: DomNode): boolean {
  return kids(node).some((kid) => kid.nodeType === 1 && (BLOCK.includes(nameOf(kid)) || STRUCTURE.includes(nameOf(kid)) || hasBlock(kid)));
}

/** What a room link adds to its text: the control number of a cite, the slug of another visual, a web address. */
function linkNote(node: DomNode, text: string): string {
  const href = attr(node, 'href');
  let note = '';
  if (href.indexOf(`#${STORED_NAME}-cite=`) === 0) {
    const ref = decodeURIComponent(href.slice(`#${STORED_NAME}-cite=`.length));
    const at = ref.indexOf('@');
    const control = at < 0 ? ref : ref.slice(0, at);
    if (text.indexOf(control) < 0) note = `cite: ${at < 0 ? control : `${control} at ${ref.slice(at + 1)}`}`;
  } else if (href.indexOf(`#${STORED_NAME}=`) === 0) {
    note = `visual: ${href.slice(`#${STORED_NAME}=`.length)}`;
  } else if (href.indexOf(`#${STORED_NAME}-out=`) === 0) {
    note = `link: ${decodeURIComponent(href.slice(`#${STORED_NAME}-out=`.length))}`;
  }
  return note ? ` [${note}]` : '';
}

/** The text of a node read as one run, with link notes; charts, selects and canvases add nothing. */
function inline(node: DomNode): string {
  if (node.nodeType === 3) return node.nodeValue ?? '';
  if (node.nodeType !== 1) return '';
  const name = nameOf(node);
  if (SKIP.includes(name) || name === 'svg' || name === 'select' || name === 'canvas') return '';
  if (name === 'br') return ' ';
  if (name === 'img') return attr(node, 'alt') ? ` ${attr(node, 'alt')} ` : '';
  const text = kids(node).map(inline).join('');
  const spaced = BLOCK.includes(name) || STRUCTURE.includes(name) ? ` ${text} ` : text;
  return name === 'a' ? spaced + linkNote(node, clean(text)) : spaced;
}

/** An SVG as one figure: its label (aria-label or its own title) and every text label, mark title and aria-label inside. */
function figure(w: Walk, svg: DomNode): void {
  const items: string[] = [];
  let label = attr(svg, 'aria-label');
  const visit = (node: DomNode) => {
    for (const kid of kids(node)) {
      if (kid.nodeType !== 1) continue;
      const name = nameOf(kid);
      if (name === 'style' || name === 'script') continue;
      if (name === 'title' || name === 'desc') {
        if (node !== svg) items.push(clean(kid.textContent));
        else if (!label) label = clean(kid.textContent);
        continue;
      }
      if (name === 'text' || name === 'foreignobject') {
        items.push(clean(kid.textContent));
        continue;
      }
      if (attr(kid, 'aria-label')) items.push(attr(kid, 'aria-label'));
      visit(kid);
    }
  };
  visit(svg);
  const unique = items.filter((item, i) => item !== '' && item !== items[i - 1]);
  if (label || unique.length > 0) w.blocks.push({ t: 'figure', label, items: unique });
}

function table(w: Walk, node: DomNode): void {
  for (const kid of kids(node)) {
    if (kid.nodeType !== 1) continue;
    const name = nameOf(kid);
    if (name === 'caption' && clean(inline(kid))) w.blocks.push({ t: 'p', text: clean(inline(kid)) });
    else if (name === 'thead' || name === 'tbody' || name === 'tfoot') table(w, kid);
    else if (name === 'tr') {
      const cells = kids(kid).filter((cell) => cell.nodeType === 1 && (nameOf(cell) === 'td' || nameOf(cell) === 'th'));
      const texts = cells.map((cell) => clean(inline(cell)));
      if (texts.some((text) => text !== '')) w.blocks.push({ t: 'row', head: cells.every((cell) => nameOf(cell) === 'th'), cells: texts });
    }
  }
}

function list(w: Walk, node: DomNode, depth: number): void {
  for (const item of kids(node)) {
    if (item.nodeType !== 1 || nameOf(item) !== 'li') continue;
    const nested = kids(item).filter((kid) => kid.nodeType === 1 && (nameOf(kid) === 'ul' || nameOf(kid) === 'ol'));
    const text = clean(kids(item).filter((kid) => !nested.includes(kid)).map(inline).join(''));
    if (text) w.blocks.push({ t: 'li', depth, text });
    for (const sub of nested) list(w, sub, depth + 1);
  }
}

function walk(w: Walk, node: DomNode): void {
  for (const kid of kids(node)) {
    if (kid.nodeType === 3) w.line += kid.nodeValue ?? '';
    else if (kid.nodeType === 1) element(w, kid);
  }
}

/** One of the STRUCTURE elements, after the line before it was flushed. */
function structure(w: Walk, node: DomNode, name: string): void {
  const heading = /^h([1-6])$/.exec(name);
  if (heading) {
    const text = clean(inline(node));
    if (text) w.blocks.push({ t: 'h', level: Number(heading[1]), text });
  } else if (name === 'table') table(w, node);
  else if (name === 'ul' || name === 'ol') list(w, node, 0);
  else if (name === 'li') list(w, { nodeType: 1, childNodes: [node] }, 0);
  else if (name === 'svg') figure(w, node);
  else if (name === 'canvas') {
    const label = attr(node, 'aria-label');
    w.blocks.push({ t: 'note', text: label ? `Chart drawn on a canvas: ${label}` : 'Chart drawn on a canvas; its values are not in the page text' });
  } else if (name === 'img') {
    if (attr(node, 'alt')) w.blocks.push({ t: 'note', text: `Image: ${attr(node, 'alt')}` });
  } else if (name === 'select') {
    const options = kids(node).map((kid) => clean(kid.textContent)).filter((text) => text !== '');
    if (options.length > 0) w.blocks.push({ t: 'p', text: `Options: ${options.join('; ')}` });
  }
}

function element(w: Walk, node: DomNode): void {
  const name = nameOf(node);
  if (SKIP.includes(name)) return;
  if (STRUCTURE.includes(name)) {
    flush(w);
    structure(w, node, name);
  } else if (name === 'br') flush(w);
  else if (name === 'a' && !hasBlock(node)) w.line += inline(node);
  else if (name === 'a') {
    // A card made of a link around block content: its lines, then the link note on a line of its own.
    flush(w);
    walk(w, node);
    w.line += linkNote(node, clean(node.textContent));
    flush(w);
  } else if (attr(node, 'aria-label') && !clean(node.textContent)) {
    flush(w);
    w.blocks.push({ t: 'note', text: attr(node, 'aria-label') });
  } else if (BLOCK.includes(name)) {
    flush(w);
    walk(w, node);
    flush(w);
  } else walk(w, node);
}

/** Walks a rendered page into blocks. */
export function walkVisual(doc: DomDocument): WalkedVisual {
  const w: Walk = { blocks: [], line: '' };
  const root = doc.body ?? doc.documentElement;
  if (root) walk(w, root);
  flush(w);
  return { title: clean(doc.title), blocks: w.blocks };
}

/** Every function the page needs, walkVisual last. */
export const PAGE_FUNCTIONS = [clean, nameOf, attr, kids, flush, hasBlock, linkNote, inline, figure, table, list, walk, structure, element, walkVisual];

/** The expression Runtime.evaluate runs in the page: walkVisual(document), self-contained. */
export function pageExpression(storedName: string = STORED_NAME): string {
  const lists = `const SKIP = ${JSON.stringify(SKIP)};\nconst BLOCK = ${JSON.stringify(BLOCK)};\nconst STRUCTURE = ${JSON.stringify(STRUCTURE)};\nconst STORED_NAME = ${JSON.stringify(storedName)};`;
  return `(function () {\n${lists}\n${PAGE_FUNCTIONS.map(String).join('\n')}\nreturn walkVisual(document);\n})()`;
}

/** The most text kept for one visual; a longer page is cut and says so. */
export const VISUAL_TEXT_MAX_CHARS = 200_000;

function blockLine(block: VisualBlock): string {
  switch (block.t) {
    case 'h':
      return `${'#'.repeat(block.level)} ${block.text}`;
    case 'li':
      return `${'  '.repeat(block.depth)}- ${block.text}`;
    case 'row':
      return `| ${block.cells.map((cell) => cell.replace(/\|/g, '/')).join(' | ')} |`;
    case 'figure':
      return [block.label ? `Figure: ${block.label}` : 'Figure', ...(block.items.length > 0 ? [block.items.join('; ')] : [])].join('\n');
    case 'note':
      return `[${block.text}]`;
    default:
      return block.text;
  }
}

/**
 * The structured plain text kept for a visual: Markdown-style headings, lines, list items and table rows, each figure
 * as "Figure: <label>" over its labels, notes in brackets. The page title comes first unless the first heading says
 * the same. A block repeating the one before is dropped; text past VISUAL_TEXT_MAX_CHARS is cut with a note.
 */
export function formatVisualText(walked: WalkedVisual): string {
  const lines: string[] = [];
  const first = walked.blocks[0];
  if (walked.title && !(first?.t === 'h' && first.text === walked.title)) lines.push(`# ${walked.title}`);
  let previous = '';
  for (const block of walked.blocks) {
    const text = blockLine(block);
    if (text === previous) continue;
    previous = text;
    const spaced = block.t === 'h' || block.t === 'figure' || (block.t === 'row' && lines[lines.length - 1]?.startsWith('|') !== true);
    if (spaced && lines.length > 0) lines.push('');
    lines.push(text);
    if (block.t === 'figure') lines.push('');
  }
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length <= VISUAL_TEXT_MAX_CHARS) return text;
  const cut = text.slice(0, VISUAL_TEXT_MAX_CHARS).replace(/[\uD800-\uDBFF]$/, '');
  return `${cut}\n\n[The page continues; its text was cut at ${VISUAL_TEXT_MAX_CHARS.toLocaleString('en-US')} characters.]`;
}
