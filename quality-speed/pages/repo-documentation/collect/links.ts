// SPDX-License-Identifier: Apache-2.0
// Broken internal links: a relative link whose file is not in the tree, or
// whose #anchor names no heading in the target. External links are counted
// separately (external.ts), on their own slower lane.

import { posix } from 'node:path';
import { type Corpus, exists } from './corpus.ts';

export interface Finding { path: string; line: number; target: string; reason: string }

export function isExternal(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target);
}

/** Resolve a link target from the doc at `from` to a repo path and a fragment. */
export function resolveLink(from: string, target: string): { path: string; frag: string } {
  const hash = target.indexOf('#');
  const rawPath = hash === -1 ? target : target.slice(0, hash);
  const frag = hash === -1 ? '' : decodeURIComponent(target.slice(hash + 1));
  const clean = decodeURIComponent(rawPath.split('?')[0] ?? '');
  if (clean === '') return { path: from, frag };
  const path = clean.startsWith('/') ? posix.normalize(clean.slice(1)) : posix.normalize(posix.join(posix.dirname(from), clean));
  return { path, frag };
}

const LINE_FRAG = /^L(\d+)(?:-L(\d+))?$/;

export function brokenLinks(c: Corpus): Finding[] {
  const out: Finding[] = [];
  for (const doc of c.docs.values()) {
    for (const link of doc.links) {
      if (isExternal(link.target)) continue;
      const { path, frag } = resolveLink(doc.path, link.target);
      if (path.startsWith('..')) {
        out.push({ path: doc.path, line: link.line, target: link.target, reason: 'outside the repository' });
        continue;
      }
      if (!exists(c, path)) {
        out.push({ path: doc.path, line: link.line, target: link.target, reason: 'no such file' });
        continue;
      }
      if (!frag) continue;
      const target = c.docs.get(path);
      if (target) {
        if (!target.anchors.has(frag)) out.push({ path: doc.path, line: link.line, target: link.target, reason: 'no such heading' });
        continue;
      }
      const lineFrag = LINE_FRAG.exec(frag);
      if (lineFrag && c.fileSet.has(path)) {
        const count = c.read(path).split('\n').length;
        const last = Number(lineFrag[2] ?? lineFrag[1]);
        if (last > count) out.push({ path: doc.path, line: link.line, target: link.target, reason: 'past the end of the file' });
        continue;
      }
      if (c.fileSet.has(path) && path.endsWith('.md')) {
        out.push({ path: doc.path, line: link.line, target: link.target, reason: 'no such heading' });
      }
    }
  }
  return out;
}

/** Every http(s) URL a doc gives: Markdown links, reference definitions, autolinks and bare URLs in prose. */
export function externalLinks(c: Corpus): { path: string; line: number; url: string }[] {
  const out: { path: string; line: number; url: string }[] = [];
  for (const doc of c.docs.values()) {
    for (const link of doc.links) {
      if (/^https?:\/\//i.test(link.target)) out.push({ path: doc.path, line: link.line, url: link.target });
    }
    for (const p of doc.prose) {
      // Links are already counted; what is left is autolinks (<https://...>) and bare URLs.
      const rest = p.text.replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ');
      for (const m of rest.matchAll(/https?:\/\/[^\s<>()`"']+[^\s<>()`"'.,;:!?]/g)) out.push({ path: doc.path, line: p.line, url: m[0] });
    }
  }
  return out;
}
