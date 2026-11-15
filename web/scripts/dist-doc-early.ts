// SPDX-License-Identifier: Apache-2.0
// The /doc/ page asks for its document from <head> (#918): doc-early.ts, in Room.astro's head slot, runs before the page's
// scripts at the end of <body>, so on slow 4G the ask leaves seconds sooner. Built names are hashed, so this reads what
// each script does: the first one whose static graph names /api/doc/ (doc-open.ts) must be in <head>. dist-audit.ts runs it.
import { entryScripts, pageBudget, type ReadAsset } from './bundle-budget.ts';
import type { Finding } from './dist-csp.ts';

/** The route checked, and the URL its first script asks. */
export const DOC_ROUTE = '/doc/';
const ASK = '/api/doc/';

/** Script src URLs in document order. A modulepreload link loads a module but runs nothing, so it is left out. */
function scripts(html: string): string[] {
  return entryScripts(html.replace(/<link\b[^>]*>/gi, ''));
}

/** True when a module in the static graph of `url` names /api/doc/. */
function asks(url: string, read: ReadAsset): boolean {
  return pageBudget(`<script src="${url}"></script>`, read).modules.some((m) => read(m.path)?.includes(ASK));
}

/** A finding when no script on /doc/ asks /api/doc/, or the first that does is not in <head>. */
export function checkDocEarly(rel: string, route: string, html: string, read: ReadAsset): Finding[] {
  if (route !== DOC_ROUTE) return [];
  const page = html.replace(/<!--[\s\S]*?-->/g, '');
  const end = page.search(/<\/head\s*>/i);
  const inHead = end < 0 ? 0 : scripts(page.slice(0, end)).length;
  const all = scripts(page);
  const first = all.findIndex((url) => asks(url, read));
  if (first < 0) return [{ file: rel, problem: `no script asks ${ASK}` }];
  if (first >= inHead) {
    return [{ file: rel, problem: `the first script that asks ${ASK}, ${all[first]}, is not in <head>: doc-early.ts belongs in Room's head slot` }];
  }
  return [];
}
