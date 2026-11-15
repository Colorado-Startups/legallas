// SPDX-License-Identifier: Apache-2.0
// A whole chapter of the Delaware Code from Delaware Code Online: a chapter's page links its subchapters, or holds its
// sections when it has none. Each such page lists its own sections at the top, which is what proves none went missing.
// The legislative history printed after each section is dropped, since it's a note about the law and not the law.
import { htmlText, type Section } from './parse.ts';

/** The Delaware Code URL of one chapter of a title. */
export function delawareChapterUrl(title: number, chapter: string): string {
  return `https://delcode.delaware.gov/title${title}/c${chapter}/index.html`;
}

/** The chapter's subchapter pages, in the site's order. Empty when the chapter page holds the sections itself. */
export function delawareSubchapters(html: string, title: number, chapter: string): string[] {
  assertWholePage(html, `title ${title} chapter ${chapter}`);
  const urls = new Set<string>();
  for (const match of html.matchAll(/href="((?:\.\.\/)*title(\d+)\/c(\w+)\/(sc\w+)\/index\.html)(?:#[^"]*)?"/g)) {
    if (Number(match[2]) !== title || match[3] !== chapter) continue;
    urls.add(`https://delcode.delaware.gov/title${title}/c${chapter}/${match[4]}/index.html`);
  }
  if (urls.size > 0 && html.includes('<div class="Section">')) throw new Error(`the Delaware Code page for title ${title} chapter ${chapter} holds sections and links subchapters; check its layout`);
  return [...urls];
}

function assertWholePage(html: string, what: string): void {
  // Chapter pages end on their closing script and section pages on the closing html.
  if (!/<\/(?:html|script)>\s*$/i.test(html)) throw new Error(`the Delaware Code page for ${what} is cut short`);
}

// The forms a section's legislative history takes, as read across the chapters the pack holds: "70 Del. Laws, c. 186, § 1",
// "8 Del. C. 1953, § 101", "Code 1915, § 102", "repealed by 83 Del. Laws, c. 61, § 7, effective Aug. 1, 2021."
const HISTORY = /^(?:repealed by )?(?:\d+ Del\. Laws, c\. [\w-]+|\d+ Del\. C\. \d{4}|Code \d{4})(?:, §§? [\w(),\s-]+?)?(?:, effective [A-Z][a-z]+\.? \d{1,2}, \d{4})?\.?$/;
/** Paragraph classes the site uses for a section's text. Any other might be a note, so it isn't taken for law. */
const TEXT_CLASS = /^(?:subsection|indent-\d*)$/;

/** What's left in a section once its paragraphs are out may only be its history. Anything else would be lost law. */
function assertOnlyHistory(rest: string, number: string): void {
  for (const segment of htmlText(rest).split(';')) {
    const text = segment.trim();
    if (text && !HISTORY.test(text)) throw new Error(`§ ${number} has text outside its paragraphs: "${text.slice(0, 80)}"`);
  }
}

/**
 * A section's anchor as its number. One page anchors a section "§ 1156" and lists it encoded, and another anchors one
 * "17-1201." with the heading's full stop, so each comes back plain.
 */
function anchorNumber(anchor: string): string {
  return decodeURIComponent(anchor).replace(/^§\s*/, '').trim().replace(/\.$/, '');
}

/** One parsed Delaware Code page: its sections, and the numbers it lists that hold no text. */
export interface DelawarePage {
  sections: Section[];
  /** Numbers the page lists that hold no text: reserved or repealed. */
  empty: string[];
  /** The highest volume of the Delaware Laws its history lines cite, for how current the page is. */
  lawsVolume: number;
}

/** Every section of a page, or an error when any section its own list names is missing. */
export function delawareSections(html: string, what: string): DelawarePage {
  assertWholePage(html, what);
  const list = /<ul class="chaptersections">([\s\S]*?)<\/ul>/.exec(html);
  if (!list) throw new Error(`the Delaware Code page for ${what} doesn't list its sections; check its layout`);
  const listed = [...list[1]!.matchAll(/href="#([^"]+)"/g)].map((match) => anchorNumber(match[1]!));
  if (listed.length === 0) throw new Error(`the Delaware Code page for ${what} lists no sections, so nothing proves it whole; check its layout`);
  const start = html.indexOf('<div id="CodeBody">');
  if (start < 0) throw new Error(`the Delaware Code page for ${what} has no CodeBody; check its layout`);
  const [lead, ...pieces] = html.slice(start).split('<div class="Section">');
  const stray = htmlText((lead ?? '').split(/<footer\b/)[0]!);
  if (stray) throw new Error(`the Delaware Code page for ${what} has text before its first section: "${stray.slice(0, 80)}"`);
  const sections: Section[] = [];
  const empty: string[] = [];
  const found = new Set<string>();
  let lawsVolume = 0;
  for (const [i, piece] of pieces.entries()) {
    // The last section ends where the page's own footer begins.
    const body = i === pieces.length - 1 ? piece.split(/<footer\b/)[0]! : piece;
    const head = /<div class="SectionHead" id="([^"]+)">([\s\S]*?)<\/div>/.exec(body);
    if (!head) throw new Error(`a section on the Delaware Code page for ${what} has no heading; check its layout`);
    const number = anchorNumber(head[1]!);
    found.add(number);
    const printed = /^(?:§\s*)+([0-9A-Za-z-]+(?:,\s*[0-9A-Za-z-]+)*)/.exec(htmlText(head[2]!))?.[1];
    if (printed !== number) throw new Error(`a section on the Delaware Code page for ${what} is anchored ${number} and printed ${printed ?? 'with no number'}`);
    // "§§ 1910, 1911" and "§§ 1913-1916" head several sections at once, which the site does only for ones repealed or moved.
    if (/^§§/.test(htmlText(head[2]!))) {
      if (!/\[(?:Repealed|Transferred|Reserved)\]\.?$/.test(htmlText(head[2]!))) throw new Error(`§§ ${number} head several sections that still hold law; check its layout`);
      empty.push(number);
      continue;
    }
    const heading = htmlText(head[2]!).replace(/^(?:§\s*)+[0-9A-Za-z-]+(?:\s*[-–,]\s*[0-9A-Za-z-]+)*\.?\s*/, '').replace(/\.$/, '').trim();
    const after = body.slice(head.index + head[0].length);
    const lines: string[] = [];
    if (/<table\b/.test(after)) throw new Error(`§ ${number} holds a table, which these pages haven't used before; check its layout`);
    const rest = after.replace(/<p\b([^>]*)>[\s\S]*?<\/p>/g, (block, attributes: string) => {
      const name = /class="([^"]*)"/.exec(attributes)?.[1];
      if (name !== undefined && !TEXT_CLASS.test(name)) throw new Error(`§ ${number} has a paragraph of a kind these pages haven't used before: "${name}"`);
      const text = htmlText(block);
      if (text) lines.push(text);
      return ' ';
    });
    assertOnlyHistory(rest, number);
    for (const match of rest.matchAll(/(\d+)\s+Del\.\s+Laws/g)) lawsVolume = Math.max(lawsVolume, Number(match[1]));
    if (lines.length === 0) empty.push(number);
    else sections.push({ number, heading, lines });
  }
  const missing = listed.filter((number) => !found.has(number));
  if (missing.length > 0) throw new Error(`the Delaware Code page for ${what} lists ${missing.join(', ')} and doesn't hold them`);
  if (found.size === 0) throw new Error(`the Delaware Code page for ${what} has no sections; check its layout`);
  return { sections, empty, lawsVolume };
}
