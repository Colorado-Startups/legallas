// SPDX-License-Identifier: Apache-2.0
// A small RFC 4180 CSV reader for the table viewer: quoted fields, doubled quotes, commas and newlines
// inside quotes, CRLF or LF. It stops after `maxRows` rows so a huge sheet never builds a huge table.

/** Parsed CSV rows, and whether the text had more rows than were returned. */
export interface ParsedCsv {
  rows: string[][];
  /** True when the text had more rows than were returned. */
  more: boolean;
}

/** Parses CSV text into at most the given number of rows. */
export function parseCsv(text: string, maxRows: number): ParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endRow = (): boolean => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
    return rows.length >= maxRows;
  };

  for (; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      if (endRow()) return { rows, more: /\S/.test(text.slice(i + 1)) };
    } else field += ch;
  }
  if (field !== '' || row.length > 0) endRow();
  return { rows, more: false };
}
