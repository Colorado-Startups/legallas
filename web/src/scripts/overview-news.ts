// SPDX-License-Identifier: Apache-2.0
// Card P1a: the Overview's case header, "Since your last visit" and Key documents. Loads the matter, the document
// list, the open-comments feed and counsel uploads in parallel; each part fails on its own with one sentence, and a
// throw anywhere on the way ends on the page's error line (settle, page-load.ts). The last visit is the room's
// (POST /api/seen, D17), so it follows the member from browser to browser; this browser's copy stands in when the
// room cannot answer (overview-news-seen.ts). The comments feed waits for it, since it asks only for what is new.
import { initExhibitLinks } from './exhibit-pane.ts';
import { guideSend } from './guide-bus.ts';
import { getJson, type FolderNode, type Loaded } from './files-api.ts';
import { meCan } from './room-me.ts';
import { pageMatter, formatPartialDate, type ServedMatter } from './doc-facts.ts';
import { settle, type LoadState } from './page-load.ts';
import { caseHeader as caseView } from '../slots/case-header-slot.ts';
import { sayInstead } from './overview-news-dom.ts';
import {
  factsMap, renderDiscussions, renderKeyDocs, renderNewDocs, renderUploads, wireCounts, type FactsById,
} from './overview-news-feed.ts';
import {
  applyKey, flattenTree, keyDocuments, localDay, newDocuments, newsCutoff, newUploads, openThreads,
  FIRST_VISIT_DAYS, type CounselUpload, type FeedComment, type NewsDoc, type Visit,
} from './overview-news-model.ts';
import { localVisit, roomVisit } from './overview-news-seen.ts';

const FEED_LIMIT = 200;
const NO_FEED: Loaded<{ comments: FeedComment[] }> = { ok: true, value: { comments: [] } };

/** Open discussions with activity after the cutoff; a member who cannot read comments gets an empty feed. */
async function loadFeed(cutoff: string): Promise<Loaded<{ comments: FeedComment[] }>> {
  if (!(await meCan('readComments'))) return NO_FEED;
  return getJson<{ comments: FeedComment[] }>(`/api/comments?open=1&limit=${FEED_LIMIT}&since=${encodeURIComponent(cutoff)}`);
}

async function loadMatter(): Promise<ServedMatter | null | 'error'> {
  try {
    return await pageMatter();
  } catch {
    return 'error';
  }
}

function column(root: ParentNode, name: string): Element | null {
  return root.querySelector(`[data-ov-column="${name}"]`);
}

function failColumn(target: Element | null, sentence: string): void {
  const list = target?.querySelector('[data-ov-list]');
  if (list) sayInstead(list, sentence);
}

function renderSince(root: ParentNode, visit: Visit): void {
  const since = root.querySelector('[data-ov-since]');
  if (!since) return;
  since.textContent = visit.since
    ? formatPartialDate(localDay(visit.since))
    : `Last ${FIRST_VISIT_DAYS} days`;
}

const DOCS_FAILED = 'The document list did not load; reload the page.';

/** Key documents: they need no visit, so they draw as soon as the list arrives. Null `docs` is a failed list. */
function renderKeys(root: ParentNode, docs: NewsDoc[] | null, facts: FactsById): void {
  const keySection = root.querySelector('[data-ov-key]');
  if (!keySection) return;
  if (!docs) return failColumn(keySection, DOCS_FAILED);
  renderKeyDocs(keySection, keyDocuments(docs), facts);
  // The pane announces Key changes; the cards follow without a reload.
  document.addEventListener('legallas:key', (event) => {
    if (applyKey(docs, (event as CustomEvent<unknown>).detail)) renderKeyDocs(keySection, keyDocuments(docs), facts);
  });
}

interface SinceParts {
  docs: NewsDoc[] | null;
  uploads: Loaded<{ uploads: CounselUpload[] }>;
  feed: Loaded<{ comments: FeedComment[] }>;
  cutoff: string;
  facts: FactsById;
}

/** "Since your last visit": new documents, open discussions and counsel uploads after the visit's cutoff. */
function renderSinceColumns(root: ParentNode, { docs, uploads, feed, cutoff, facts }: SinceParts): void {
  const docsColumn = column(root, 'docs');
  if (!docs) failColumn(docsColumn, DOCS_FAILED);
  else if (docsColumn) renderNewDocs(docsColumn, newDocuments(docs, cutoff), facts);

  const talk = column(root, 'discussions');
  if (feed.ok && talk) renderDiscussions(talk, openThreads(feed.value.comments));
  else failColumn(talk, 'Discussions did not load; reload the page.');

  const counsel = column(root, 'counsel');
  const seqById = new Map((docs ?? []).map((doc) => [doc.id, doc.control_seq]));
  if (uploads.ok && counsel) renderUploads(counsel, newUploads(uploads.value.uploads, cutoff), seqById, facts);
  else failColumn(counsel, 'Counsel uploads did not load; reload the page.');
}

function renderCaseHeader(caseHeader: HTMLElement, matter: ServedMatter | null | 'error'): void {
  if (!caseView) {
    // No litigation pack (slots/case-header-slot.ts): the plain "Overview" heading is the whole header.
    if (matter === 'error') guideSend({ type: 'error' });
    caseHeader.setAttribute('aria-busy', 'false');
    return;
  }
  if (matter === 'error') {
    caseView.renderCaseMissing(caseHeader, 'The case summary did not load; reload the page.');
    guideSend({ type: 'error' });
  } else if (matter === null) caseView.renderCaseMissing(caseHeader, 'The case summary has not been published yet.');
  else caseView.renderCase(caseHeader, matter);
  caseView.releaseCaseHeight(caseHeader);
}

/**
 * Where the page's load ended. A part whose fetch failed already says so in its own sentence, so the page is still
 * ready; 'error' is a throw on the way (a header or list that fails while drawing), and then the caption and the
 * error line stand alone (overview-news.css hides the frame).
 */
function showState(state: LoadState): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-ov-loading]')) el.hidden = true;
  const failed = document.querySelector<HTMLElement>('[data-ov-failed]');
  if (failed) failed.hidden = state !== 'error';
  if (state !== 'error') return;
  for (const el of document.querySelectorAll<HTMLElement>('[data-ov-court], [data-ov-case-note], [data-ov-glossary], [data-ov-map]')) {
    el.hidden = true;
  }
  // Not releaseCaseHeight: an error's height is not the one to reserve on the next visit.
  for (const el of document.querySelectorAll('[data-overview-caption], [data-overview-news]')) el.setAttribute('aria-busy', 'false');
}

async function load(root: HTMLElement): Promise<'ready'> {
  const caseHeader = document.querySelector<HTMLElement>('[data-overview-caption]');
  if (caseHeader) caseView?.reserveCaseHeight(caseHeader);
  const now = new Date();
  // The browser's copy draws the heading at once; the room's answer replaces it (usually with the same day).
  const local = localVisit(now);
  renderSince(root, local);
  wireCounts(root);
  initExhibitLinks();

  const visiting = roomVisit(local).then((visit) => {
    renderSince(root, visit);
    return visit;
  });
  // Only "Since your last visit" waits for the room's visit (at most SEEN_TIMEOUT_MS); the feed asks only for what is
  // new, so it starts once the cutoff is known. The case header and Key documents draw without it.
  const feeding = visiting.then((visit) => loadFeed(newsCutoff(visit, now)));
  const [matter, tree, uploads] = await Promise.all([
    loadMatter(),
    getJson<{ root: FolderNode }>('/api/documents'),
    getJson<{ uploads: CounselUpload[] }>('/api/uploads'),
  ]);
  if (caseHeader) renderCaseHeader(caseHeader, matter);
  const facts = factsMap(matter && matter !== 'error' ? matter.docs : undefined);
  const docs = tree.ok ? flattenTree(tree.value.root) : null;
  renderKeys(root, docs, facts);

  // The discussions column is hidden for a member who cannot read comments (data-needs), and their feed is empty.
  const [visit, feed] = await Promise.all([visiting, feeding]);
  renderSinceColumns(root, { docs, uploads, feed, cutoff: newsCutoff(visit, now), facts });
  root.setAttribute('aria-busy', 'false');
  return 'ready';
}

const root = document.querySelector<HTMLElement>('[data-overview-news]');
// Every step can fail (a fetch, the data, a part while it draws); none leaves the page on Loading.
if (root) void settle(showState, () => load(root), () => guideSend({ type: 'error' }));
