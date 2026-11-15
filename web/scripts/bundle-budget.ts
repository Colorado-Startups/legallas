// SPDX-License-Identifier: Apache-2.0
// Eager script budget (R20): each page may load at most 60 KB of gzipped script before any user action.
// Eager means the page's <script src> and <link rel="modulepreload"> files plus everything they import
// statically, transitively. Dynamic import() chunks (PDF.js, the Rive runtime, the charts a page draws
// later) load on demand and are excluded, so a lazy chunk that becomes static counts against the page.
import { gzipSync } from 'node:zlib';
import path from 'node:path';

/** The R20 limit, in gzipped bytes. */
export const EAGER_BUDGET = 60 * 1024;

/** Reads a built file by its URL path (such as `/_astro/core.js`); undefined when it does not exist. */
export type ReadAsset = (urlPath: string) => string | undefined;

/** Eager script for one page: every module in its static closure and their gzipped total. */
export interface PageBudget {
  modules: { path: string; gzip: number }[];
  total: number;
  missing: string[];
}

const TAG = /<(script|link)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;

function attr(raw: string, name: string): string | undefined {
  const m = raw.match(new RegExp(`\\b${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i'));
  return m ? m[1].replace(/^["']|["']$/g, '') : undefined;
}

/** Same-origin script URLs a page loads up front, in document order. */
export function entryScripts(html: string): string[] {
  const out: string[] = [];
  for (const m of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(TAG)) {
    const tag = m[1].toLowerCase();
    const url = tag === 'script' ? attr(m[2], 'src') : attr(m[2], 'rel') === 'modulepreload' ? attr(m[2], 'href') : undefined;
    if (url && url.startsWith('/') && !url.startsWith('//')) out.push(url);
  }
  return out;
}

/**
 * Specifiers a built module imports statically: `import x from "y"`, `import "y"` and `export ... from "y"`.
 * `import("y")` never matches, because the optional clause cannot cross a parenthesis.
 */
export function staticImports(js: string): string[] {
  return [...js.matchAll(/\b(?:import|export)\s*(?:[^"'();]*?\bfrom\s*)?["']([^"']+)["']/g)].map((m) => m[1]);
}

function resolve(from: string, spec: string): string | undefined {
  if (spec.startsWith('/') && !spec.startsWith('//')) return spec;
  if (spec.startsWith('./') || spec.startsWith('../')) return path.posix.join(path.posix.dirname(from), spec);
  return undefined; // bare or remote specifiers never resolve in the browser build; dist-csp reports remote ones
}

/** Walks the static import graph from a page's entry scripts and sums the gzipped size of every module. */
export function pageBudget(html: string, read: ReadAsset): PageBudget {
  const seen = new Set<string>();
  const modules: PageBudget['modules'] = [];
  const missing: string[] = [];
  const queue = entryScripts(html);
  while (queue.length > 0) {
    const url = queue.shift() as string;
    if (seen.has(url)) continue;
    seen.add(url);
    const source = read(url);
    if (source === undefined) {
      missing.push(url);
      continue;
    }
    modules.push({ path: url, gzip: gzipSync(source).length });
    for (const spec of staticImports(source)) {
      const next = resolve(url, spec);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return { modules, total: modules.reduce((sum, m) => sum + m.gzip, 0), missing };
}
