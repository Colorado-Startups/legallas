// SPDX-License-Identifier: Apache-2.0
// One stylesheet per page (#204). Astro links each component's CSS as its own file, so the Overview asked for 13
// stylesheets before its first paint. On a link with few connections (HTTP/1.1 allows six to a host) and a long round
// trip, that is two or three rounds of waiting, and the first paint waits on every one of them.
//
// integrations/page-css.mjs joins a page's stylesheets, in the order the page links them, into one file. Stylesheets
// cascade in document order, so the joined file applies exactly the rules, in exactly the order, the separate files did.
// The room sends every response with no-store (worker/headers.ts), so shared files never came from a cache anyway.
//
// Each joined file stays in the page as a link with a type that is not CSS, which the browser neither fetches nor applies
// (HTML: a stylesheet link of an unsupported type is not obtained). Vite's loader for a lazy chunk (a viewer opened
// later) skips a stylesheet already linked, and without that link it would add the same file again at the end of the
// head, after the page's own rules, and change which rule wins.
import { createHash } from 'node:crypto';

export type ReadAsset = (urlPath: string) => string | undefined;

/** The page's stylesheet links, joined into `href`, and the CSS to write there. */
export interface JoinedCss {
  html: string;
  href: string;
  css: string;
  joined: string[];
}

/** Marks a stylesheet link whose rules are in the page's joined file. */
export const JOINED_TYPE = 'text/x-legallas-joined';

const STYLESHEET = /<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

const ATTR = {
  rel: /\srel\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i,
  href: /\shref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i,
} as const;

function attr(tag: string, name: keyof typeof ATTR): string | undefined {
  const m = tag.match(ATTR[name]);
  return m ? m[1]!.replace(/^["']|["']$/g, '') : undefined;
}

/** A plain same-origin stylesheet link: no media query, title or other attribute that changes when it applies. */
function joinable(tag: string): string | undefined {
  if (attr(tag, 'rel')?.toLowerCase() !== 'stylesheet') return undefined;
  const href = attr(tag, 'href');
  if (!href || !href.startsWith('/_astro/') || !href.endsWith('.css')) return undefined;
  const others = tag.replace(/^<link\b|\/?>$/gi, '').replace(/\s(rel|href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').trim();
  return others === '' ? href : undefined;
}

/**
 * `html` with its head's stylesheets joined into one link where the first was, or null when it has fewer than two, a
 * file is missing, a file holds an at-rule that must come first in a stylesheet (@charset, @import, @namespace), or a
 * stylesheet that is not joined sits between two that are.
 */
export function joinPageCss(html: string, read: ReadAsset): JoinedCss | null {
  const head = html.search(/<\/head>/i);
  if (head < 0) return null;
  const comments = [...html.slice(0, head).matchAll(/<!--[\s\S]*?-->/g)].map((m) => [m.index, m.index + m[0].length]);
  const inComment = (at: number) => comments.some(([from, to]) => at >= from! && at < to!);
  const links: { tag: string; href: string; at: number }[] = [];
  let skipped = false;
  for (const m of html.slice(0, head).matchAll(STYLESHEET)) {
    if (inComment(m.index) || attr(m[0], 'rel')?.toLowerCase() !== 'stylesheet') continue;
    const href = joinable(m[0]);
    // A stylesheet left alone between two joined ones would end up before the later one: leave the page as built.
    if (!href) skipped = links.length > 0;
    else if (skipped) return null;
    else links.push({ tag: m[0], href, at: m.index });
  }
  if (links.length < 2) return null;
  const parts: string[] = [];
  for (const { href } of links) {
    const css = read(href);
    if (css === undefined || /@(charset|import|namespace)\b/i.test(css)) return null;
    parts.push(css);
  }
  const css = parts.join('\n');
  const href = `/_astro/page.${createHash('sha256').update(css).digest('base64url').slice(0, 10)}.css`;
  let out = '';
  let from = 0;
  links.forEach((link, i) => {
    out += html.slice(from, link.at);
    if (i === 0) out += `<link rel="stylesheet" href="${href}">`;
    out += `<link rel="stylesheet" href="${link.href}" type="${JOINED_TYPE}">`;
    from = link.at + link.tag.length;
  });
  out += html.slice(from);
  return { html: out, href, css, joined: links.map((link) => link.href) };
}
