// SPDX-License-Identifier: Apache-2.0
// A room with no matter (worker/room-shape.ts) serves the same built pages as a case room, shaped as they leave: the
// Worker removes every data-case-only part. HTMLRewriter only runs in the Workers runtime, so this check shapes the
// built HTML the same way in plain Node and fails the build when a page a founder can open still says a case-room word
// (issue #218). dist-audit.ts runs it on every page, so `npm run build` and CI catch a new line with no mark. It reads the
// built HTML only: words a page's script writes later are for that script's own tests.
import type { Finding } from './dist-csp.ts';
import { CASE_PAGE } from '../worker/case-pages.ts';

/** Words that belong to a case room only. Matched in the text a person reads and in the attributes a reader announces. */
export const CASE_ROOM_WORDS = /\bcounsel\s+room\b/i;

/** Attributes whose words a person sees or hears: a tooltip, a label, an image's text, a field's text or hint, a summary. */
const READ_ATTRS = new Set([
  'title', 'aria-label', 'aria-description', 'aria-roledescription', 'aria-valuetext', 'aria-placeholder', 'alt',
  'placeholder', 'value', 'label', 'content',
]);
/** Elements with no closing tag. */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
/** Elements whose content is not page text: a script or a style is code, read up to its own closing tag. */
const RAW = new Set(['script', 'style']);
/** Elements a phrase runs through, as in `Legallas <b>counsel</b> room`. Any other tag ends a run of text. */
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr']);

const TAG = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const ATTR = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function attributes(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of source.matchAll(ATTR)) found.set(m[1]!.toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
  return found;
}

function decode(text: string): string {
  return text
    .replace(/&(?:nbsp|ensp|emsp|thinsp|ThinSpace|NewLine|Tab);/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * The words of `html` as a room with no matter serves it: every data-case-only element and its content gone, scripts
 * and styles left out, and the readable attributes kept. One string per run of text (a phrase runs on through inline
 * tags and comments) or attribute, so a finding can say which. Built pages are well formed; a stray closing tag closes
 * back to its own opening tag, as a browser would. Only the built HTML: words a script writes later are not here.
 */
export function companyText(html: string): string[] {
  const out: string[] = [];
  const open: { name: string; removed: boolean }[] = [];
  const removed = () => open.some((e) => e.removed);
  let run = '';
  const flush = () => {
    const words = decode(run).replace(/\s+/g, ' ').trim();
    if (words) out.push(words);
    run = '';
  };
  let at = 0;
  TAG.lastIndex = 0;
  for (let m = TAG.exec(html); m; m = TAG.exec(html)) {
    const [whole, closing, rawName, attrs, selfClosing] = m;
    if (!removed()) run += html.slice(at, m.index);
    at = m.index + whole.length;
    if (!rawName) continue; // a comment, a doctype or CDATA: a phrase runs through it
    const name = rawName.toLowerCase();
    if (!INLINE.has(name)) flush();
    if (closing) {
      const i = open.map((e) => e.name).lastIndexOf(name);
      if (i >= 0) open.length = i;
      continue;
    }
    const found = attributes(attrs ?? '');
    const caseOnly = found.has('data-case-only');
    if (!caseOnly && !removed()) {
      for (const [attr, value] of found) {
        const words = decode(value).replace(/\s+/g, ' ').trim();
        if (READ_ATTRS.has(attr) && words) out.push(words);
      }
    }
    if (RAW.has(name)) {
      // Code runs to its own closing tag, whatever it holds (`a<b`, `"</p>"`): skip there without reading tags.
      const end = html.toLowerCase().indexOf(`</${name}`, at);
      at = end < 0 ? html.length : end;
      TAG.lastIndex = at;
      continue;
    }
    if (VOID.has(name) || selfClosing) continue;
    open.push({ name, removed: caseOnly });
  }
  if (!removed()) run += html.slice(at);
  flush();
  return out;
}

/** Problems with one built page as a room with no matter serves it. A case page redirects there, so it is skipped. */
export function checkCompanyPage(rel: string, route: string, html: string): Finding[] {
  if (CASE_PAGE.test(route)) return [];
  return companyText(html)
    .filter((words) => CASE_ROOM_WORDS.test(words))
    .map((words) => ({
      file: rel,
      problem: `a room with no matter shows "${words.slice(0, 120)}"; mark the part data-case-only or name the room neutrally`,
    }));
}
