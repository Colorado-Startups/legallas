// SPDX-License-Identifier: Apache-2.0
// Scoring for scripts/retrieval-recall.ts. Pure: the passages one retrieval plan handed the model for a question,
// the documents and pages the eval item expects, ranks and counts out. No text leaves this module.

/** An eval set v2 item, as far as retrieval recall reads it. */
export interface RecallItem {
  id: string;
  category: string;
  question: string;
  /** Expected documents by control number ("DOE-000412") and their 1-based pages. */
  docs: { control: string; pages: number[] }[];
}

/** One passage as retrieve() returns it: its document and its text with [[doc:<id> p:<n>]] markers. */
export interface Passage {
  docId: string;
  text: string;
}

export interface ItemRecall {
  id: string;
  category: string;
  /** 1-based rank of the first passage from an expected document; null when none reached the model. */
  docRank: number | null;
  /** 1-based rank of the first passage carrying a marker for an expected page of an expected document. */
  pageRank: number | null;
  /** Share of the expected documents with at least one passage. */
  docsCovered: number;
  passages: number;
  documents: number;
  /** Most passages from one document. */
  maxPerDocument: number;
  chars: number;
  /** Passages with no page marker for their own document. */
  unpaged: number;
}

const MARKER = /\[\[doc:([A-Za-z0-9_-]{1,64}) p:([0-9]{1,6})\]\]/g;

/** The pages a passage names for its own document, from its markers. */
export function passagePages(passage: Passage): Set<number> {
  const pages = new Set<number>();
  for (const match of passage.text.matchAll(MARKER)) if (match[1] === passage.docId) pages.add(Number(match[2]));
  return pages;
}

/** The control sequence of "DOE-000412" (412), or null for anything else. */
export function controlSeq(control: string): number | null {
  const match = /^[A-Z]{2,8}-0*([1-9][0-9]{0,8})$/.exec(control.trim());
  return match ? Number(match[1]) : null;
}

/** Ranks and counts for one item, given each document id's control sequence. */
export function scoreItem(item: RecallItem, passages: readonly Passage[], seqOf: ReadonlyMap<string, number | null>): ItemRecall {
  const wanted = new Map<number, Set<number>>();
  for (const doc of item.docs) {
    const seq = controlSeq(doc.control);
    if (seq !== null) wanted.set(seq, new Set([...(wanted.get(seq) ?? []), ...doc.pages]));
  }
  let docRank: number | null = null;
  let pageRank: number | null = null;
  const covered = new Set<number>();
  const perDoc = new Map<string, number>();
  let chars = 0;
  let unpaged = 0;
  passages.forEach((passage, index) => {
    perDoc.set(passage.docId, (perDoc.get(passage.docId) ?? 0) + 1);
    chars += passage.text.length;
    const pages = passagePages(passage);
    if (pages.size === 0) unpaged += 1;
    const seq = seqOf.get(passage.docId) ?? null;
    const expected = seq === null ? undefined : wanted.get(seq);
    if (!expected || seq === null) return;
    covered.add(seq);
    docRank ??= index + 1;
    if (pageRank === null && [...pages].some((page) => expected.has(page))) pageRank = index + 1;
  });
  return {
    id: item.id,
    category: item.category,
    docRank,
    pageRank,
    docsCovered: wanted.size === 0 ? 0 : covered.size / wanted.size,
    passages: passages.length,
    documents: perDoc.size,
    maxPerDocument: Math.max(0, ...perDoc.values()),
    chars,
    unpaged,
  };
}

export interface RecallSummary {
  n: number;
  /** Share of items whose expected document (or page) ranked within 5, within 10, and anywhere in the passages. */
  doc5: number;
  doc10: number;
  doc: number;
  page5: number;
  page10: number;
  page: number;
  /** Mean share of an item's expected documents that reached the model. */
  covered: number;
  passages: number;
  maxPerDocument: number;
  charsP50: number;
  charsP95: number;
  unpaged: number;
}

function nearestRank(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

/** Recall and size figures over a set of items (a category, or every item). */
export function summarize(rows: readonly ItemRecall[]): RecallSummary {
  const n = rows.length;
  const share = (pick: (row: ItemRecall) => boolean) => (n === 0 ? 0 : rows.filter(pick).length / n);
  const mean = (pick: (row: ItemRecall) => number) => (n === 0 ? 0 : rows.reduce((sum, row) => sum + pick(row), 0) / n);
  const within = (rank: number | null, k: number) => rank !== null && rank <= k;
  return {
    n,
    doc5: share((r) => within(r.docRank, 5)),
    doc10: share((r) => within(r.docRank, 10)),
    doc: share((r) => r.docRank !== null),
    page5: share((r) => within(r.pageRank, 5)),
    page10: share((r) => within(r.pageRank, 10)),
    page: share((r) => r.pageRank !== null),
    covered: mean((r) => r.docsCovered),
    passages: mean((r) => r.passages),
    maxPerDocument: mean((r) => r.maxPerDocument),
    charsP50: nearestRank(rows.map((r) => r.chars), 50),
    charsP95: nearestRank(rows.map((r) => r.chars), 95),
    unpaged: mean((r) => (r.passages === 0 ? 0 : r.unpaged / r.passages)),
  };
}

/** Categories whose expected documents answer the question (the others list near misses for abstention items). */
export const ANSWERABLE = new Set(['facts', 'locate', 'allegation', 'elements', 'law', 'injection']);
