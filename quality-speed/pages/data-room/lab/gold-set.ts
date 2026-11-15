// SPDX-License-Identifier: Apache-2.0
// One room's question set (../gold/questions/<room>.json) in the shape the lab's journeys take. Only the path of each answer is
// read here, never the code behind the answers, and the wall runs the other way: that set's author doesn't read this lab's results.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { QuestionSet } from './journeys.ts';

interface GoldItem {
  id: string;
  kind: string;
  question: string;
  gold: { sources?: { doc: string; page: number | null }[] };
}

const isPdf = (doc: string) => doc.toLowerCase().endsWith('.pdf');

/** The kinds of document name the filter journey types: what comes before the first `__` in the fixture's filenames. */
const documentType = (doc: string) => path.posix.basename(doc).split('__')[0]!; // safe: split always returns a first item

/**
 * The answerable items, each right on any of its sources. The filter types the first PDF's document type, and the two documents
 * opened are the first PDF, at its cited page, and the deepest page cited.
 */
export function questionSetFrom(items: readonly GoldItem[]): QuestionSet {
  const answerable = items.filter((item) => item.kind === 'known' && (item.gold.sources?.length ?? 0) > 0);
  const questions = answerable.map((item) => {
    const sources = item.gold.sources ?? [];
    const pages = sources.flatMap((source) => (source.page !== null ? [{ path: source.doc, page: source.page }] : []));
    return { id: item.id, question: item.question, paths: [...new Set(sources.map((source) => source.doc))], ...(pages.length ? { pages } : {}) };
  });
  const pdfPages = answerable.flatMap((item) => item.gold.sources ?? []).flatMap((source) => (source.page !== null && isPdf(source.doc) ? [{ path: source.doc, page: source.page }] : []));
  const first = pdfPages[0];
  if (!first) throw new Error('This question set cites no PDF page to open');
  const deepest = pdfPages.reduce((best, entry) => (entry.page > best.page ? entry : best), first);
  return {
    filter: { id: 'filter', query: documentType(first.path), path: first.path },
    documents: [{ id: 'doc-open', path: first.path, page: first.page }, { id: 'doc-open-deep', path: deepest.path, page: deepest.page }],
    questions,
  };
}

export async function goldQuestions(room: string): Promise<QuestionSet> {
  const file = path.resolve(import.meta.dirname, '..', 'gold', 'questions', `${room}.json`);
  return questionSetFrom(JSON.parse(await readFile(file, 'utf8')) as GoldItem[]);
}
