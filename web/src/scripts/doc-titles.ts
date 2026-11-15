// SPDX-License-Identifier: Apache-2.0
// Card Q2 (R64). Readable titles from the case folder's file names, for Overview, Documents, the doc viewer and
// the exhibit pane. Files follow DocType_Abbr__YYYYMMDD__Party__Qualifier (scripts/matter/catalog.ts): the
// DocType is terse ("Order_Compel", "Response-to-MTD", "RFP") and the Abbr is the file's own short code. A
// title reads like a brief's exhibit list: "Order compelling discovery, Court". The type's words come from
// doc-type.ts, the one rule every page shares.

import { docTypeWords } from './doc-type.ts';

/** The room's document type rule, under the name the title code first used (see doc-type.ts). */
export const docTypeTitle = docTypeWords;

/** A segment that marks work product ("Claim_Chart__WP__20130812"). */
export const WORK_PRODUCT = /^(?:A?WP|AC-?WP)$/i;
const CONVENTION_DATE = /^\d{4}(?:\d{2}){0,2}(?:-\d{4}(?:\d{2}){0,2})?$/;
/** Matches a short file extension at the end of a file name. */
export const EXTENSION = /\.[A-Za-z0-9]{1,5}$/;

/**
 * A reading title from a file name. "Order-Compel__20130924__Court.pdf" reads "Order compelling discovery,
 * Court"; "Claim_Chart__WP__20130812.xlsx" reads "Claim chart (work product)". Dates are dropped; parties and
 * qualifiers keep their own capitals. A name outside the convention loses only its extension.
 */
export function docTitle(name: string): string {
  const stem = name.replace(EXTENSION, '');
  const segments = stem.split('__').filter(Boolean);
  if (segments.length < 2) return stem.replace(/[_-]+/g, ' ').trim() || name;
  const [type, ...rest] = segments as [string, ...string[]];
  const marked = rest.some((segment) => WORK_PRODUCT.test(segment));
  const parts = rest.filter((segment) => !WORK_PRODUCT.test(segment) && !CONVENTION_DATE.test(segment));
  const head = docTypeWords(marked ? `${type} (work product)` : type);
  return [head, ...parts.map((part) => part.replace(/[_-]+/g, ' ').trim())].filter(Boolean).join(', ');
}
