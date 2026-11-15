// SPDX-License-Identifier: Apache-2.0
// Card P5b (Documents, intake). Which date a document counts under on the month heatmap (the table, card P5a,
// filters by the same rule: the matter date, else updated_at), and the events the intake sends the table. Pure
// apart from docsTarget (documents-intake.test.ts).
import type { FolderNode, ListedDocument } from './files-api.ts';

/**
 * Fired on the table's slot, `[data-docs-table]`, bubbling to `document` (ruling R45). The table filters to
 * documents dated in `month` and, with `counsel: true`, to counsel uploads only. Anyone may fire it there; the
 * heatmap follows, so the table's own Clear also clears the heatmap's choice.
 */
export const DOCS_FILTER_EVENT = 'docs:filter';

/** Fired on the table's slot after an upload lands (bubbling to `document`), so the table can reload. */
export const DOCS_UPLOADED_EVENT = 'docs:uploaded';

/** The detail of a documents filter event: the month chosen and whether to show counsel uploads only. */
export interface DocsFilterDetail {
  /** "YYYY-MM", or null to clear the month filter. */
  month: string | null;
  /** true for counsel uploads only; false or absent for every document. */
  counsel?: boolean;
}

/** Where the intake sends its events: the table's slot, or `document` when the page has no table. */
export function docsTarget(): EventTarget {
  return document.querySelector('[data-docs-table]') ?? document;
}

/** The detail of a documents uploaded event: the id of the new document. */
export interface DocsUploadedDetail {
  id: string;
}

/** The part of a document's matter facts the heatmap reads (ServedDocFacts.date). */
export interface DatedFacts {
  date: string | null;
}

const PARTIAL = /^\d{4}(?:-(0[1-9]|1[0-2])(?:-\d{2})?)?$/;
const ISO_DAY = /^(\d{4}-\d{2}-\d{2})/;

/**
 * The document date: the matter's date when it has one (it may be "2013" or "2013-02" alone), otherwise the
 * day the room last saw the file (`updated_at`). null when neither is usable.
 */
export function documentDate(facts: DatedFacts | undefined, updatedAt: string | null | undefined): string | null {
  const date = facts?.date;
  if (typeof date === 'string' && PARTIAL.test(date)) return date;
  const day = typeof updatedAt === 'string' ? ISO_DAY.exec(updatedAt)?.[1] : undefined;
  return day && PARTIAL.test(day) ? day : null;
}

/** "YYYY-MM" for the heatmap and the table's month filter; null for a year-only or missing date. */
export function documentMonth(facts: DatedFacts | undefined, updatedAt: string | null | undefined): string | null {
  const date = documentDate(facts, updatedAt);
  return date && date.length >= 7 ? date.slice(0, 7) : null;
}

/** Every document in the tree, folder guides included (they are documents too), each once. */
export function flattenTree(root: FolderNode): ListedDocument[] {
  const out: ListedDocument[] = [];
  const seen = new Set<string>();
  const walk = (node: FolderNode) => {
    for (const doc of node.guide ? [node.guide, ...node.files] : node.files) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      out.push(doc);
    }
    node.folders.forEach(walk);
  };
  walk(root);
  return out;
}

/** The dates the heatmap counts, one per live document, in the tree's order. */
export function heatDates(docs: ListedDocument[], facts: Record<string, DatedFacts> | null): Array<string | null> {
  return docs.map((doc) => documentDate(facts?.[doc.id], doc.updated_at));
}
