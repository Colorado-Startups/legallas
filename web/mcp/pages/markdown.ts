// SPDX-License-Identifier: Apache-2.0
// The Markdown the security brief (connect/security-brief.md) uses, as HTML for /security: headings, paragraphs, "- "
// lists, pipe tables, fenced code, `code`, **bold** and bare https links. Nothing else is parsed: other syntax shows as
// its own text. Each line is escaped before any tag is added, and a link keeps only URL characters (no &, quote or
// angle bracket), so no source text can add markup, an attribute or a javascript: link.
import { escapeHtml } from './html.ts';

/** A heading's anchor: "Subprocessors and location" becomes "subprocessors-and-location". */
export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const URL_PATTERN = /https:\/\/[A-Za-z0-9\-._~/?#=%+:]+/g;
const CODE_MARK = '\u0000';

/** One line of inline Markdown as HTML: `code`, **bold** and https links; every other character escaped. */
export function inline(text: string): string {
  const codes: string[] = [];
  const held = text.replaceAll(CODE_MARK, '').replace(/`([^`]+)`/g, (_, code: string) => `${CODE_MARK}${codes.push(code) - 1}${CODE_MARK}`);
  return escapeHtml(held)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(URL_PATTERN, (url) => {
      const href = url.replace(/[.:]+$/, '');
      return `<a href="${href}">${href}</a>${url.slice(href.length)}`;
    })
    .replace(/\u0000(\d+)\u0000/g, (_, index: string) => `<code>${escapeHtml(codes[Number(index)])}</code>`);
}

const FENCE = /^```/;
const HEADING = /^(#{1,4})\s+(\S.*)$/;
const TABLE_ROW = /^\|/;
const LIST_ITEM = /^[-*] /;

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || TABLE_ROW.test(line) || LIST_ITEM.test(line);
}

/** A table row's cells, outer pipes dropped; `\|` stays a pipe inside a cell. */
function cells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function table(rows: string[][]): string {
  const [head = [], ...rest] = rows;
  const body = rest[0]?.every((cell) => /^:?-+:?$/.test(cell)) ? rest.slice(1) : rest;
  const labels = head.map((cell) => escapeHtml(cell.replace(/[`*]/g, '')));
  const th = head.map((cell) => `<th scope="col">${inline(cell)}</th>`).join('');
  const tr = body.map((row) => `<tr>${row.map((cell, i) => `<td data-label="${labels[i] ?? ''}">${inline(cell)}</td>`).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

/** Markdown as HTML. `#` and `##` become h2 (the page has its own h1), `###` h3 and `####` h4, each with its slug as id. */
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
    } else if (FENCE.test(line)) {
      const code: string[] = [];
      for (i++; i < lines.length && !FENCE.test(lines[i]); i++) code.push(lines[i]);
      i++;
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
    } else if (HEADING.test(line)) {
      const [, hashes, text] = HEADING.exec(line)!;
      const level = Math.max(2, hashes.length);
      out.push(`<h${level} id="${slug(text)}">${inline(text.trim())}</h${level}>`);
      i++;
    } else if (TABLE_ROW.test(line)) {
      const rows: string[][] = [];
      for (; i < lines.length && TABLE_ROW.test(lines[i]); i++) rows.push(cells(lines[i]));
      out.push(table(rows));
    } else if (LIST_ITEM.test(line)) {
      const items: string[] = [];
      for (; i < lines.length; i++) {
        if (LIST_ITEM.test(lines[i])) items.push(lines[i].slice(2).trim());
        else if (/^\s+\S/.test(lines[i])) items[items.length - 1] += ` ${lines[i].trim()}`;
        else break;
      }
      out.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
    } else {
      const words = [line.trim()];
      for (i++; i < lines.length && lines[i].trim() !== '' && !startsBlock(lines[i]); i++) words.push(lines[i].trim());
      out.push(`<p>${inline(words.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}
