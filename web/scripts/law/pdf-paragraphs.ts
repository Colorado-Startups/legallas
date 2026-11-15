// SPDX-License-Identifier: Apache-2.0
// A PDF's lines (pdf.ts pdfLines) as paragraphs: page numbers and a document's running heads gone, and a paragraph that a
// page break cut rejoined.

/** Options for joining PDF lines into paragraphs, including where the document's own text ends. */
export interface ParagraphOptions {
  /** Where the document's own text ends, if something else follows it. */
  end?: RegExp;
  /** A whole paragraph that belongs to no section: a chapter heading, say. */
  dropParagraph?: RegExp;
  /** A single line printed on page after page. */
  dropLine?: RegExp;
}

/** Joins a PDF's text lines into paragraphs. */
export function pdfParagraphs(lines: readonly string[], options: ParagraphOptions = {}): string[] {
  const out: string[] = [];
  let paragraph = '';
  let nextPage = 1;
  let afterPage = false;
  const flush = () => {
    if (!paragraph) return;
    if (!options.dropParagraph?.test(paragraph)) {
      const last = out.at(-1);
      if (afterPage && last && !/[.:;)\]]$/.test(last) && /^[a-z(]/.test(paragraph)) out[out.length - 1] = `${last} ${paragraph}`;
      else out.push(paragraph);
    }
    paragraph = '';
    afterPage = false;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (options.end?.test(line)) break;
    if (!line) {
      flush();
    } else if (!paragraph && line === String(nextPage)) {
      nextPage += 1;
      afterPage = true;
    } else if (!options.dropLine?.test(line)) {
      paragraph = paragraph ? `${paragraph} ${line}` : line;
    }
  }
  flush();
  return out;
}
