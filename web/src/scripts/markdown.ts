// SPDX-License-Identifier: Apache-2.0
// Markdown for documents and folder guides. Raw HTML is off (it is shown as text), bare URLs are not
// turned into links, an image becomes a plain "Image: ..." link (nothing is ever fetched to show it),
// and table alignment becomes a class, because the page CSP refuses style attributes.
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx]!;
  const src = md.utils.escapeHtml(String(token.attrGet('src') ?? ''));
  const alt = md.utils.escapeHtml(token.content || 'untitled');
  return `<a href="${src}" target="_blank" rel="noopener noreferrer">Image: ${alt}</a>`;
};

// markdown-it sets style="text-align:..." on aligned table cells; swap it for a class the CSS knows.
md.core.ruler.push('legallas_no_inline_style', (state) => {
  for (const token of state.tokens) {
    const style = token.attrGet('style');
    if (style === null) continue;
    token.attrs = (token.attrs ?? []).filter(([name]) => name !== 'style');
    const align = /text-align:\s*(left|center|right)/.exec(String(style))?.[1];
    if (align) token.attrJoin('class', `align-${align}`);
  }
});

// Absolute links open in a new tab with no referrer and no opener. Everything else stays as written.
const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  if (/^(https?:|mailto:)/i.test(String(token.attrGet('href') ?? ''))) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

// A viewer under a page h1 demotes the file's headings (h1 becomes h2 and so on, capped at h6), so the page
// keeps one h1 (R83). The shift travels in markdown-it's per-render env.
md.core.ruler.push('legallas_heading_shift', (state) => {
  const shift = Number((state.env as { headingShift?: number }).headingShift ?? 0);
  if (!shift) return;
  for (const token of state.tokens) {
    if (token.type !== 'heading_open' && token.type !== 'heading_close') continue;
    token.tag = `h${Math.min(6, Number(token.tag.slice(1)) + shift)}`;
  }
});

/**
 * HTML for `text`, with headings moved down `headingShift` levels. Callers still pass it through sanitizeInto()
 * before it reaches the page.
 */
export function renderMarkdown(text: string, headingShift = 0): string {
  return md.render(text, { headingShift });
}

/**
 * A file shown under the page's own h1 (the /doc/ viewer, the exhibit pane, a folder guide on Documents): its
 * headings start at h2, so the page keeps one h1 (R83, R89). Render through here, not with a bare shift.
 */
export function renderUnderPageTitle(text: string): string {
  return renderMarkdown(text, 1);
}
