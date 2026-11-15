// SPDX-License-Identifier: Apache-2.0
// CourtListener's opinion HTML (`html_with_citations`, W4d 2026-10-05): the text of an opinion that neither CAP nor a
// stored PDF has. It is supplied into the raw cache, never downloaded: CourtListener's
// API needs a token and its opinion pages refuse automated clients (a law pack's `supplied` opinion, fetch.ts cacheOnly).
//
// The layout: a caption (<h1> parties, <center> cite, docket and dates), counsel and "Selected for Official
// Publication." as paragraphs, the author line ("FABLE, Judge."), then the opinion's paragraphs, headings (<h2>)
// and quotations, ending on the panel's line ("OTHER, C. J., and THIRD, J., concur."). Star pages are
// `<span class="star-pagination">*223</span>`, kept as [*223] markers like CAP's. Everything before the author line
// is head matter and dropped. A separate writing opens under its own heading ("THIRD, Judge, dissenting."), as in
// CAP files (opinions.ts headingOf). The parser refuses footnotes (not read yet), a missing author line, and a panel
// line that names a separate writing (a dissent, a special concurrence) the text does not hold.
import { decodeXml } from './docx.ts';
import { articleRole, headingOf, judgeName } from './opinions.ts';
import { htmlText, type Opinion } from './parse.ts';

const STAR = /<span class="star-pagination">\s*\*?(\d{1,5})\s*<\/span>/g;
// "FABLE, Judge.", "Justice OTHER", "THIRD, Chief Justice."
const AUTHOR = /^(?:(?:Mr\.\s+)?(?:Chief\s+)?(?:Justice|Judge)\s+[\p{Lu}][\p{Lu}'’. -]{1,40}|[\p{Lu}][\p{Lu}'’. -]{1,40},\s*(?:(?:Chief\s+)?(?:Justice|Judge)|C\.\s?J\.|J\.))\.?$/u;
// The lowercase words a panel line may hold: "OTHER, C. J., and THIRD, J., concur."
const PANEL_WORDS = new Set(['and', 'concur', 'concurs', 'dissent', 'dissents', 'specially', 'in', 'part', 'the', 'result', 'judgment']);

/** The closing panel line of an opinion: names in capitals and "concur" or "dissent", nothing else. */
export function isPanelLine(text: string): boolean {
  if (text.length > 160 || !/^[\p{Lu}]{2,}/u.test(text) || !/\b(?:concurs?|dissents?)\b[^.]*\.?$/.test(text)) return false;
  return (text.match(/\b[a-z]+\b/g) ?? []).every((word) => PANEL_WORDS.has(word));
}

/** The blocks of the page in order: paragraphs, headings and quotations, as plain text with [*n] star markers. */
function blocks(html: string): { tag: string; text: string }[] {
  const marked = html.replace(STAR, ' [*$1] ');
  return [...marked.matchAll(/<(p|h[1-6]|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => ({ tag: m[1]!, text: htmlText(m[2]!) }));
}

/** The caption's parties line (the <h1>), for the parties check. */
export function courtListenerParties(html: string): string {
  return [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => htmlText(m[1]!)).join(' ');
}

/** The citations the caption prints (`<span class="citation no-link">412 P.2d 220</span>`). */
export function courtListenerCites(html: string): string[] {
  return [...html.matchAll(/<span class="citation no-link">([\s\S]*?)<\/span>/g)].map((m) => decodeXml(m[1]!).trim());
}

/** The writings of a CourtListener opinion page: the court's first, each with its star page and author. */
export function courtListenerOpinions(html: string): Opinion[] {
  if (/footnote|<sup\b/i.test(html)) throw new Error('this CourtListener opinion has footnotes, which the build does not read yet');
  const all = blocks(html);
  const at = all.findIndex((b) => b.tag === 'p' && AUTHOR.test(b.text));
  if (at < 0) throw new Error('no author line in the CourtListener opinion');
  let page = [...all.slice(0, at + 1).map((b) => b.text).join(' ').matchAll(/\[\*(\d{1,5})\]/g)].at(-1)?.[1] ?? null;
  const author = all[at]!.text;
  let current: Opinion = { type: 'majority', author, lines: [], notes: [], startPage: page, ...articleRole('majority', author), judge: judgeName(author) };
  const opinions = [current];
  let panel = '';
  for (const { text } of all.slice(at + 1)) {
    if (!text) continue;
    const heading = current.lines.length > 0 ? headingOf(text) : null;
    if (heading) {
      current = { type: heading.opinion, author: text, lines: [], notes: [], startPage: /^\[\*(\d{1,5})\]/.exec(text)?.[1] ?? page, opinion: heading.opinion, judge: heading.judge, role: heading.role };
      opinions.push(current);
    } else if (isPanelLine(text)) {
      panel = `${panel} ${text}`.trim();
    } else {
      current.lines.push(text);
    }
    page = [...text.matchAll(/\[\*(\d{1,5})\]/g)].at(-1)?.[1] ?? page;
  }
  const separate = /\bdissents?\b|\bspecially\b|\bconcurs? in (?:part|the result|the judgment)\b/i.test(panel);
  if (separate && opinions.length === 1) throw new Error(`the panel line "${panel}" names a separate writing the text does not hold`);
  return opinions.filter((o) => o.lines.length > 0);
}
