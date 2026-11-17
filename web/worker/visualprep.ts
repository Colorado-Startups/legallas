// SPDX-License-Identifier: Apache-2.0
// Turns a published HTML page (a claude.ai artifact or any self-contained page) into a room visual. Two callers:
// `npm run visuals` (scripts/visuals.ts) for the owner's binder, and approving a visual an AI saved
// (worker/proposal-visual.ts).
//
// In the room a visual runs in <iframe sandbox="allow-scripts"> under a CSP with no network, so:
// Each link prefix and the bridge's message carry the room's stored name (worker/stored-name.ts), here "<name>":
//   - links to other visuals become "#<name>=<slug>" and a small bridge script asks the room page to
//     navigate (postMessage; the room accepts only slugs that are in the binder),
//   - links to the web become "#<name>-out=<url>" and the room shows them as an explicit "leaves the
//     room" link instead of letting the frame navigate away,
//   - cites written as "#<name>-cite=<prefix>-000412@3" are left as they are; the bridge posts them and the
//     room opens that document in the exhibit pane (src/scripts/visual-cite.ts). Given a ResolveCite, a link to a
//     room document (its /doc/ page, as a connected AI's results link it) becomes such a cite too,
//   - remote stylesheets (Google Fonts and the like) are removed: they could never load, and every
//     font stack in the exhibits falls back to Georgia, system-ui and Menlo.
// Script and style bodies are never rewritten, so chart code is left exactly as written.
import { STORED_NAME } from './stored-name.ts';

/** One published page: the artifact id from its claude.ai URL and the file path inside it. */
export interface PageRef {
  artifact: string;
  path: string;
}

/** Maps a page to the visual slug it was exported as, or null when it is not in the binder. */
export type ResolvePage = (page: PageRef) => string | null;

/** Maps a link to a room document to its cite ("<prefix>-000412@3"), or null when it is not one. */
export type ResolveCite = (href: string) => string | null;

export interface PreparedVisual {
  html: string;
  /** Links that point nowhere in the binder, and remote resources that will not load in the room. */
  warnings: string[];
}

/** Marks the bridge inside a page, so a new export replaces it and never adds a second. */
const bridgeMarker = (name: string) => `${name}-bridge`;

/**
 * Kept small and dependency-free: it runs inside every visual. Messages carry slugs, URLs, cites and keys only. Its text
 * is part of each stored page, and an export replaces any other, so a change here rewrites every visual: the offsets are
 * plain numbers, as the prefixes' lengths always were in stored pages.
 */
export function bridgeScript(name: string = STORED_NAME): string {
  const visual = `#${name}=`;
  const out = `#${name}-out=`;
  const cite = `#${name}-cite=`;
  return (
    `<script>/* ${bridgeMarker(name)} */(function(){var p=window.parent;if(!p||p===window)return;` +
    `function send(m){m.${name}=1;p.postMessage(m,'*')}` +
    `document.addEventListener('click',function(e){var t=e.target,a=t&&t.closest?t.closest('a[href^="#${name}"]'):null;` +
    "if(!a)return;e.preventDefault();var h=a.getAttribute('href')||'';" +
    `if(h.indexOf('${visual}')===0)send({type:'nav',slug:h.slice(${visual.length})});` +
    `else if(h.indexOf('${out}')===0)send({type:'out',url:decodeURIComponent(h.slice(${out.length}))});` +
    `else if(h.indexOf('${cite}')===0)send({type:'cite',ref:decodeURIComponent(h.slice(${cite.length}))})});` +
    "document.addEventListener('keydown',function(e){if(e.altKey||e.ctrlKey||e.metaKey)return;" +
    "if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;var n=e.target&&e.target.tagName;" +
    "if(n==='INPUT'||n==='SELECT'||n==='TEXTAREA')return;send({type:'key',key:e.key})})})();</script>"
  );
}

export const BRIDGE_MARKER = bridgeMarker(STORED_NAME);
export const BRIDGE_SCRIPT = bridgeScript();

const oldBridge = (name: string) => new RegExp(`<script>/\\* ${bridgeMarker(name)} \\*/[\\s\\S]*?</script>`, 'g');
const ARTIFACT_URL = /^https:\/\/claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9_-]+)\/?([^?#]*)/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// An end tag as a browser reads it: the name, then ">", "/" or whitespace and anything up to ">" ("</script foo>").
const PROTECTED = /(<script\b[^>]*>[\s\S]*?<\/script(?:[\s/][^>]*)?>|<style\b[^>]*>[\s\S]*?<\/style(?:[\s/][^>]*)?>)/gi;
const HREF = /(\s(?:xlink:)?href\s*=\s*)("([^"]*)"|'([^']*)')/gi;
const REMOTE_LINK_TAG = /<link\b[^>]*\bhref\s*=\s*["']\s*(?:https?:)?\/\/[^"']*["'][^>]*>\s*/gi;
const REMOTE_RESOURCE = /\b(?:src|srcset|poster)\s*=\s*["']\s*(?:https?:)?\/\/|url\(\s*["']?\s*(?:https?:)?\/\//i;
const TARGET_BLANK = /\s+target\s*=\s*(?:"_blank"|'_blank')/gi;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decodes the character references an href attribute can hold. */
export function decodeAttribute(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1]?.toLowerCase() === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/** Resolves a relative link against the current page's folder. Null if it climbs out of the artifact. */
export function joinRelative(fromPath: string, href: string): string | null {
  const parts = fromPath.split('/').slice(0, -1);
  for (const segment of href.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.length ? parts.join('/') : null;
}

/** The rewritten href for one link, plus a warning when the target is not in the binder. */
export function rewriteHref(raw: string, page: PageRef, resolve: ResolvePage, name: string = STORED_NAME, cite?: ResolveCite): { href: string; warning?: string } {
  const href = decodeAttribute(raw).trim();
  if (href === '' || href.startsWith('#')) return { href: raw };

  const cited = cite?.(href);
  if (cited) return { href: `#${name}-cite=${cited}` };

  const artifact = ARTIFACT_URL.exec(href);
  if (artifact) {
    const target = { artifact: artifact[1]!, path: decodeURIComponent(artifact[2] || '') || 'index.html' };
    const slug = resolve(target);
    return slug ? { href: `#${name}=${slug}` } : { href: `#${name}-missing`, warning: `no visual for ${href}` };
  }

  if (SCHEME.test(href)) {
    if (/^https?:/i.test(href)) return { href: `#${name}-out=${encodeURIComponent(href)}` };
    return { href: `#${name}-missing`, warning: `dropped a ${href.split(':')[0]}: link` };
  }

  const relative = joinRelative(page.path, href.replace(/[?#].*$/, ''));
  const slug = relative ? resolve({ artifact: page.artifact, path: relative }) : null;
  return slug ? { href: `#${name}=${slug}` } : { href: `#${name}-missing`, warning: `no visual for ${href} in ${page.artifact}` };
}

/** Rewrites one stretch of markup that holds no script or style bodies. */
function rewriteMarkup(markup: string, page: PageRef, resolve: ResolvePage, warnings: string[], name: string, cite?: ResolveCite): string {
  return markup
    .replace(REMOTE_LINK_TAG, '')
    .replace(TARGET_BLANK, '')
    .replace(HREF, (_whole, lead: string, _quoted: string, double?: string, single?: string) => {
      const { href, warning } = rewriteHref(double ?? single ?? '', page, resolve, name, cite);
      if (warning) warnings.push(warning);
      return `${lead}"${href.replace(/"/g, '&quot;')}"`;
    });
}

/** Prepares one page for the room. Running it again on its own output changes nothing. */
export function prepareVisual(html: string, page: PageRef, resolve: ResolvePage, name: string = STORED_NAME, cite?: ResolveCite): PreparedVisual {
  const warnings: string[] = [];
  const pieces = html.split(PROTECTED);
  for (let i = 0; i < pieces.length; i += 2) pieces[i] = rewriteMarkup(pieces[i]!, page, resolve, warnings, name, cite);
  let out = pieces.join('');

  for (let i = 0; i < pieces.length; i += 2) {
    if (REMOTE_RESOURCE.test(pieces[i]!)) warnings.push('loads a remote resource that the room will block');
  }
  for (let i = 1; i < pieces.length; i += 2) {
    if (/^<style/i.test(pieces[i]!) && REMOTE_RESOURCE.test(pieces[i]!)) warnings.push('a stylesheet loads a remote resource that the room will block');
  }

  // A page exported before a bridge change carries the older script: swap it for the current one.
  const bridge = bridgeScript(name);
  out = out.replace(oldBridge(name), (whole) => (whole === bridge ? whole : bridge));
  if (!out.includes(bridgeMarker(name))) {
    const close = out.search(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i);
    out = close >= 0 ? `${out.slice(0, close)}${bridge}\n${out.slice(close)}` : `${out}\n${bridge}\n`;
  }
  return { html: out, warnings: [...new Set(warnings)] };
}
