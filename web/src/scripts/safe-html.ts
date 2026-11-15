// SPDX-License-Identifier: Apache-2.0
// The last step before rendered Markdown reaches the page: parse it in an inert <template> and keep only
// the tags and attributes Markdown produces. markdown-it already escapes raw HTML and skips images;
// this is a second lock, so a parser bug cannot become script, a frame or a remote image.

const TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'A', 'EM', 'STRONG', 'CODE', 'PRE', 'BLOCKQUOTE',
  'HR', 'BR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'S', 'DEL',
]);

const ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  A: new Set(['href', 'target', 'rel']),
  OL: new Set(['start']),
  TH: new Set(['class']),
  TD: new Set(['class']),
  CODE: new Set(['class']),
};

// Web and mail links, in-page anchors, and relative paths. Anything with another scheme loses its href.
const SAFE_HREF = /^(?:https?:|mailto:|#|\/|\.|[^:]*$)/i;
// Browsers read //host and /\host (and \\host) as links to another site; they lose their href.
const HOST_RELATIVE = /^\s*[\\/][\\/]/;
const LEAVES_ROOM = /^https?:/i;
// A browser drops leading controls and spaces, and tabs and newlines anywhere, before it reads a link.
const URL_IGNORES = /^[\u0000-\u0020]+|[\t\n\r]/g;

/** What to do with a link: keep it, keep it and mark it as leaving the room, or drop it. */
export function hrefVerdict(raw: string): 'keep' | 'leaves' | 'drop' {
  const href = raw.replace(URL_IGNORES, '');
  if (!SAFE_HREF.test(href) || HOST_RELATIVE.test(href)) return 'drop';
  return LEAVES_ROOM.test(href) ? 'leaves' : 'keep';
}

function clean(parent: ParentNode): void {
  for (const child of Array.from(parent.children)) {
    if (!TAGS.has(child.tagName)) {
      child.replaceWith(document.createTextNode(child.textContent ?? ''));
      continue;
    }
    const allowed = ATTRIBUTES[child.tagName];
    for (const attribute of Array.from(child.attributes)) {
      if (!allowed?.has(attribute.name)) child.removeAttribute(attribute.name);
    }
    if (child.tagName === 'A') {
      const verdict = hrefVerdict(child.getAttribute('href') ?? '');
      if (verdict === 'drop') child.removeAttribute('href');
      else if (verdict === 'leaves') {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer nofollow');
      }
    }
    clean(child);
  }
}

/** Replaces `target`'s children with the allowlisted content of `html`. */
export function sanitizeInto(target: Element, html: string): void {
  const template = document.createElement('template');
  template.innerHTML = html;
  clean(template.content);
  target.replaceChildren(template.content);
}
