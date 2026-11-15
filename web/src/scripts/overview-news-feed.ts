// SPDX-License-Identifier: Apache-2.0
// Card P1a: draws "Since your last visit" (new documents, open discussions, counsel uploads) and the Key documents
// cards into the static frame in index.astro. Data selection lives in overview-news-model.ts.
import { markedHref } from './documents-table-data.ts';
import { plural, typeLabel } from './files-format.ts';
import { controlPrefix, formatCite, formatPartialDate, type ServedDocFacts } from './doc-facts.ts';
import { controlText, docLink, el, keyBadge, sayInstead } from './overview-news-dom.ts';
import { docTitle } from './doc-titles.ts';
import { docTypeWords } from './doc-type.ts';
import { localDay, pagesText, type CounselUpload, type FeedComment, type NewsDoc } from './overview-news-model.ts';
import { MARK_LABEL } from './mark-words.ts';

/** Rows shown per column before the "All ..." link takes over. */
const SHOWN = { docs: 4, discussions: 3, uploads: 3, key: 6 } as const;

/** Key cards a phone shows (the rest wait behind the "All ..." link). */
const KEY_NARROW = 3;

/** Document facts from the matter, by lowercased id (the server lowercases ids when it joins). */
export type FactsById = ReadonlyMap<string, ServedDocFacts>;

/** Indexes the served document facts by lowercase document id. */
export function factsMap(docs: Record<string, ServedDocFacts> | undefined): FactsById {
  return new Map(Object.entries(docs ?? {}).map(([id, facts]) => [id.toLowerCase(), facts]));
}

const factsFor = (facts: FactsById, id: string) => facts.get(id.toLowerCase());

/** Joins the non-empty parts of a metadata line with spaces between spans. */
function metaLine(className: string, parts: (Node | string | null)[]): HTMLElement {
  const kept = parts.filter((part): part is Node | string => Boolean(part));
  const line = el('p', className);
  kept.forEach((part, i) => line.append(...(i ? [' ', part] : [part])));
  return line;
}

function setCount(column: Element, count: number): void {
  const badge = column.querySelector('[data-ov-count]');
  if (badge) badge.textContent = String(count);
  const tab = column.ownerDocument.querySelector(`[data-ov-tab="${column.getAttribute('data-ov-column')}"] [data-ov-count]`);
  if (tab) tab.textContent = String(count);
}

function moreLink(column: Element, total: number, shown: number, label: string, href: string): void {
  const more = column.querySelector<HTMLAnchorElement>('[data-ov-more]');
  if (!more) return;
  more.hidden = total <= shown;
  more.textContent = label;
  more.href = href;
}

/** Draws the new documents into the column, with their facts. */
export function renderNewDocs(column: Element, docs: readonly NewsDoc[], facts: FactsById): void {
  const list = column.querySelector('[data-ov-list]')!; // safe: index.astro renders the list in every column
  setCount(column, docs.length);
  // Documents marks the same visit's new and changed files (?mark=new, D17), counsel uploads included, so no count here.
  moreLink(column, docs.length, SHOWN.docs, 'All new in Documents', markedHref('new'));
  if (!docs.length) return sayInstead(list, 'No new documents.');
  list.replaceChildren(
    ...docs.slice(0, SHOWN.docs).map((doc) => {
      const date = formatPartialDate(factsFor(facts, doc.id)?.date ?? null);
      return el('li', 'ov-item ov-item--dot', [
        docLink(doc.id, null, 'ov-item__title', [docTitle(doc.name)]),
        metaLine('ov-item__meta', [controlText(doc.control_seq), date, pagesText(doc.pages)]),
      ]);
    }),
  );
}

/** "DOE-000231 at 88" for a thread anchored to a page, else the control number alone. */
function threadPlace(thread: FeedComment): HTMLElement | null {
  const text = formatCite(controlPrefix(), { control: thread.control_seq, page: thread.page ?? null });
  return text ? el('span', 'u-mono ov-control', [text]) : null;
}

/** "Morgan Chen, Sept. 28, 2026, 2 replies": who opened the thread, when, and how far it has gone. */
function byLine(thread: FeedComment): string {
  const replies = thread.reply_count ? plural(thread.reply_count, 'reply', 'replies') : '';
  return [thread.author_name, formatPartialDate(localDay(thread.created_at)), replies].filter(Boolean).join(', ');
}

/** Draws the discussion threads into the column, with a link to all of them in Documents. */
export function renderDiscussions(column: Element, threads: readonly FeedComment[]): void {
  const list = column.querySelector('[data-ov-list]')!; // safe: index.astro renders the list in every column
  setCount(column, threads.length);
  moreLink(column, threads.length, SHOWN.discussions, `All ${plural(threads.length, 'discussion')} in Documents`, markedHref('discussion'));
  if (!threads.length) return sayInstead(list, 'No open discussions.');
  list.replaceChildren(
    ...threads.slice(0, SHOWN.discussions).map((thread) =>
      el('li', 'ov-item', [
        metaLine('ov-item__meta', [threadPlace(thread), docTitle(thread.document_name)]),
        docLink(thread.document_id, thread.page ?? null, 'ov-item__quote', [`\u201C${thread.excerpt}\u201D`]),
        el('p', 'ov-item__by', [byLine(thread)]),
      ]),
    ),
  );
}

/** Draws the counsel uploads into the column. */
export function renderUploads(
  column: Element,
  uploads: readonly CounselUpload[],
  seqById: ReadonlyMap<string, number | null>,
  facts: FactsById,
): void {
  const list = column.querySelector('[data-ov-list]')!; // safe: index.astro renders the list in every column
  setCount(column, uploads.length);
  if (!uploads.length) return sayInstead(list, 'No uploads from counsel.');
  list.replaceChildren(
    ...uploads.slice(0, SHOWN.uploads).map((upload) => {
      const privileged = factsFor(facts, upload.id)?.privileged === true;
      const chip = privileged
        ? el('span', 'c-chip c-chip--privileged', [MARK_LABEL])
        : el('span', 'c-chip c-chip--counsel', ['From counsel']);
      const by = upload.uploader_name ?? upload.uploaded_by ?? '';
      return el('li', 'ov-item', [
        docLink(upload.id, null, 'ov-item__title', [docTitle(upload.name)]),
        metaLine('ov-item__meta', [controlText(seqById.get(upload.id) ?? null), chip]),
        by ? el('p', 'ov-item__by', [`${by}, ${formatPartialDate(localDay(upload.uploaded_at))}`]) : null,
      ].filter((child): child is HTMLElement => Boolean(child)));
    }),
  );
}

/** Draws the documents marked Key into the section, with their count. */
export function renderKeyDocs(section: Element, docs: readonly NewsDoc[], facts: FactsById): void {
  const list = section.querySelector('[data-ov-list]')!; // safe: index.astro renders the Key list
  const count = section.querySelector('[data-ov-key-count]');
  if (count) count.textContent = docs.length ? `${docs.length} marked Key` : '';
  moreLink(section, docs.length, KEY_NARROW, `All ${plural(docs.length, 'Key document')}`, markedHref('key'));
  // Wide screens show six cards, so the link only shows there once there are more than six.
  section.querySelector('[data-ov-more]')?.setAttribute('data-state', docs.length > SHOWN.key ? 'always' : 'narrow');
  if (!docs.length) return sayInstead(list, 'No documents are marked Key yet.');
  list.replaceChildren(
    ...docs.slice(0, SHOWN.key).map((doc) => {
      const f = factsFor(facts, doc.id);
      const details = [f?.type ? docTypeWords(f.type) : typeLabel(doc.name), formatPartialDate(f?.date ?? null), pagesText(doc.pages)];
      return el('li', 'ov-key', [
        docLink(doc.id, null, 'ov-key__link', [
          el('span', 'ov-key__head', [keyBadge(), controlText(doc.control_seq) ?? el('span', 'u-vh', ['Key'])]),
          el('span', 'ov-key__title', [docTitle(doc.name)]),
          el('span', 'ov-key__meta', [details.filter(Boolean).join(', ')]),
        ]),
      ]);
    }),
  );
}

/**
 * "Since your last visit" is one row of three counts; each count is a disclosure button that opens its list
 * below the row. One list is open at a time, and choosing the open one again closes it.
 */
export function wireCounts(root: ParentNode): void {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-ov-tab]')];
  const panel = (button: HTMLButtonElement) => root.querySelector<HTMLElement>(`[data-ov-column="${button.dataset.ovTab}"]`);
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') !== 'true';
      for (const other of buttons) {
        const on = open && other === button;
        other.setAttribute('aria-expanded', String(on));
        const list = panel(other);
        if (list) list.hidden = !on;
      }
    });
  }
}
