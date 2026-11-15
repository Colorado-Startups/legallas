// SPDX-License-Identifier: Apache-2.0
// CSP checks on the built site (R15). Room pages are served with `script-src 'self'` and `style-src 'self'`
// and no 'unsafe-inline' (worker/headers.ts), so the browser would silently drop any inline style or script
// that reaches dist/. These checks catch it at build time instead. Each returns one line per problem.

/** One problem found in a built file. */
export interface Finding {
  file: string;
  problem: string;
}

const TAG = /<([a-zA-Z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
// Attributes that load a resource. An <a href> to another site is navigation, not an asset, so it is allowed.
const ASSET_ATTRS = new Set(['src', 'srcset', 'poster', 'data', 'action', 'formaction', 'background']);
const ASSET_HREF_TAGS = new Set(['link', 'use', 'image', 'feimage', 'script']);
// <script> types the browser never runs, so the CSP does not apply to them.
const DATA_SCRIPT = /^(application\/(ld\+)?json|importmap|text\/plain)$/i;
const REMOTE = /^\s*(https?:)?\/\//i;

function attributes(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of raw.matchAll(ATTR)) {
    const value = (m[2] ?? '').replace(/^["']|["']$/g, '');
    out.set(m[1].toLowerCase(), value);
  }
  return out;
}

/** Inline style, inline script, inline event handlers and remote assets in one HTML page. */
export function checkHtml(file: string, html: string): Finding[] {
  const found: Finding[] = [];
  const add = (problem: string) => found.push({ file, problem });
  // Comments can hold markup-looking text; they never render.
  const body = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of body.matchAll(TAG)) {
    const tag = m[1].toLowerCase();
    const attrs = attributes(m[2]);
    if (tag === 'style') add('inline <style> element');
    if (attrs.has('style')) add(`style= attribute on <${tag}>`);
    for (const name of attrs.keys()) {
      if (/^on[a-z]+$/.test(name)) add(`inline event handler ${name}= on <${tag}>`);
    }
    if (tag === 'script' && !attrs.has('src') && !DATA_SCRIPT.test(attrs.get('type') ?? '')) {
      add('inline <script> without src');
    }
    for (const [name, value] of attrs) {
      const asset = ASSET_ATTRS.has(name) || ((name === 'href' || name === 'xlink:href') && ASSET_HREF_TAGS.has(tag));
      if (!asset) continue;
      const urls = name === 'srcset' ? value.split(',').map((part) => part.trim().split(/\s+/)[0]) : [value];
      for (const url of urls) {
        if (REMOTE.test(url)) add(`remote asset ${name}="${url}" on <${tag}>`);
        if (/^\s*javascript:/i.test(url)) add(`javascript: URL in ${name}= on <${tag}>`);
      }
    }
  }
  return found;
}

/** Remote url() and @import references in one stylesheet. */
export function checkCss(file: string, css: string): Finding[] {
  const found: Finding[] = [];
  // `@import url(x)` matches both patterns, so each reference is reported once.
  const refs = new Set([
    ...[...css.matchAll(/url\(\s*["']?([^"')]+)/gi)].map((m) => m[1]),
    ...[...css.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)/gi)].map((m) => m[1]),
  ]);
  for (const ref of refs) {
    if (REMOTE.test(ref)) found.push({ file, problem: `remote stylesheet reference ${ref}` });
  }
  return found;
}

/** Remote module specifiers (static or dynamic import, or a worker script) in one built script. */
export function checkJs(file: string, js: string): Finding[] {
  const found: Finding[] = [];
  const specs = [
    ...js.matchAll(/\b(?:import|export)\s*(?:[^"'();]*?\bfrom\s*)?["']([^"']+)["']/g),
    ...js.matchAll(/\bimport\(\s*["'`]([^"'`]+)["'`]\s*\)/g),
    ...js.matchAll(/\bnew\s+(?:Shared)?Worker\(\s*["'`]([^"'`]+)["'`]/g),
  ];
  for (const m of specs) {
    if (REMOTE.test(m[1])) found.push({ file, problem: `remote module ${m[1]}` });
  }
  return found;
}
