// SPDX-License-Identifier: Apache-2.0
// legallas_case_overview's shared shapes (owner: session 2a): free text from the manifest wrapped as case data, and
// cites as structured fields (control, doc, page, link), so the sections, the track briefs and the summary read the
// same to a model.
import type { ProofItem, ServedCite } from '../../worker/matter-types.ts';
import { caseData, docLink, formatControl } from '../format.ts';
import { untrustedReason } from '../untrusted.ts';

/** One free text field at most, before its case-data wrapper. */
export const MAX_TEXT_CHARS = 2000;
/** The marker appended to text that was cut. */
export const CUT = ' [cut]';

/** Free text from the manifest, labelled as case data, judged whole before a long one is cut (mcp/untrusted.ts). */
export function prose(value: string | null | undefined): string | null {
  return value ? caseData(value.length > MAX_TEXT_CHARS ? value.slice(0, MAX_TEXT_CHARS) + CUT : value, untrustedReason(value)) : null;
}

/** Renders a cite as structured fields. */
export type Render = (cite: ServedCite) => Record<string, unknown>;

/** A cite as structured fields: the room's control number, the document id, the page and the room link to it. */
export function citeRenderer(prefix: string | undefined): Render {
  return (cite) => ({
    control: formatControl(prefix, cite.control),
    doc: cite.doc,
    page: cite.page,
    link: docLink(cite.doc, cite.page),
    ...(cite.note ? { note: caseData(cite.note) } : {}),
  });
}

/** Builds the entry for a proof item: its strength, its note and its cite. */
export function proofEntry(p: ProofItem<ServedCite>, cite: Render) {
  return { strength: p.strength, note: prose(p.note), cite: cite(p.cite) };
}
