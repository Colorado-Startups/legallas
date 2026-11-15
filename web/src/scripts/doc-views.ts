// SPDX-License-Identifier: Apache-2.0
// The non-PDF viewers on the document page. Every piece of file content goes in as text (textContent),
// except Markdown, which goes through markdown-it (raw HTML off) and then the allowlist in safe-html.ts.
// highlightText marks a cited passage in any of them (card F7); the exhibit pane and /doc/ share these views.
import { parseCsv } from './csv.ts';
import { fetchTextCapped, fileUrl, type DocMeta } from './files-api.ts';
import { locateQuote } from './files-format.ts';

/** Text-like files show their first 2 MB; the rest is a download. */
export const TEXT_CAP = 2 * 1024 * 1024;
/** CSV tables stop after this many data rows. */
export const CSV_ROWS = 1000;

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

function note(section: HTMLElement, text: string): void {
  const el = section.querySelector<HTMLElement>('[data-view-note]');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
}

const CUT_NOTE = 'Showing the first 2 MB of a long file; download it for the rest.';
const EMAIL_NOTE = 'Email set out as text; attachments are listed by name. Download gives the original message file.';
const EMAIL_CUT_NOTE = 'Email set out as text from the first 2 MB of the message file; download it for the rest.';

/** Fetches a Markdown document and draws it, sanitized, into the section. */
export async function showMarkdown(section: HTMLElement, doc: DocMeta): Promise<void> {
  const [{ renderUnderPageTitle }, { sanitizeInto }, { text, truncated }] = await Promise.all([
    import('./markdown.ts'),
    import('./safe-html.ts'),
    fetchTextCapped(doc.id, TEXT_CAP),
  ]);
  // The viewer's own title is the page h1, so the file's headings start at h2 (R83), sized as the file's title.
  const body = section.querySelector<HTMLElement>('[data-md]')!; // safe: both viewers render the slot
  body.classList.add('markdown-body--shifted');
  sanitizeInto(body, renderUnderPageTitle(text));
  if (truncated) note(section, CUT_NOTE);
}

/**
 * Plain text as it is, except an SEC Form D in XML and an email (.eml), shown as the text the index holds (formd.ts,
 * eml.ts), so a cite's pinpoint quote is found on screen. Any other XML, or a file that does not parse, is shown as
 * it is. An email is set out even from its first 2 MB: its text comes before its attachments.
 */
export async function showText(section: HTMLElement, doc: DocMeta): Promise<void> {
  const { text, truncated } = await fetchTextCapped(doc.id, TEXT_CAP);
  const formD = !truncated && /\.xml$/i.test(doc.name) ? (await import('./formd.ts')).renderFormD(text, doc.name) : null;
  const email = /\.eml$/i.test(doc.name) ? (await import('./eml.ts')).renderEml(text) : null;
  section.querySelector('[data-text]')!.textContent = formD ?? email ?? text; // safe: both viewers render the slot
  if (formD) note(section, 'SEC Form D set out as text from its EDGAR XML. Download gives the original XML file.');
  else if (email) note(section, truncated ? EMAIL_CUT_NOTE : EMAIL_NOTE);
  else if (truncated) note(section, CUT_NOTE);
}

function cell(tag: 'th' | 'td', text: string): HTMLElement {
  const el = document.createElement(tag);
  el.textContent = text;
  if (tag === 'th') el.scope = 'col';
  return el;
}

/** Fetches a CSV document and draws its rows into the section, dropping a partial last row when the file was cut. */
export async function showCsv(section: HTMLElement, doc: DocMeta): Promise<void> {
  const { text, truncated } = await fetchTextCapped(doc.id, TEXT_CAP);
  // A cut file ends mid-row; drop that partial line rather than show a broken last row.
  const whole = truncated ? text.slice(0, text.lastIndexOf('\n') + 1) : text;
  const { rows, more } = parseCsv(whole, CSV_ROWS + 1);
  const [header = [], ...data] = rows;
  const width = Math.max(header.length, ...data.map((row) => row.length));

  const table = section.querySelector<HTMLTableElement>('[data-csv]')!;
  const head = document.createElement('tr');
  for (let i = 0; i < width; i += 1) head.append(cell('th', header[i] ?? ''));
  table.createTHead().append(head);
  const body = table.createTBody();
  for (const row of data) {
    const tr = document.createElement('tr');
    for (let i = 0; i < width; i += 1) tr.append(cell('td', row[i] ?? ''));
    body.append(tr);
  }
  section.querySelector('[data-csv-caption]')!.textContent = `${doc.name}: ${data.length.toLocaleString('en-US')} rows shown`;
  if (more || truncated) note(section, `Showing the first ${data.length.toLocaleString('en-US')} rows; download the file for the rest.`);
}

/** A zoomable <img>. SVG is only ever shown this way: as an image, its scripts never run. */
export function showImage(section: HTMLElement, doc: DocMeta): Promise<void> {
  const img = section.querySelector<HTMLImageElement>('[data-image]')!;
  const label = section.querySelector<HTMLElement>('[data-image-zoom]')!;
  let zoom: number | 'fit' = 'fit';

  const apply = () => {
    const fit = zoom === 'fit';
    img.classList.toggle('is-fit', fit);
    // Sizing through the CSSOM, never a style attribute (the CSP refuses those).
    img.style.width = fit ? '' : `${Math.round(img.naturalWidth * (zoom as number))}px`;
    label.textContent = fit ? 'Fit' : `${Math.round((zoom as number) * 100)}%`;
  };
  const current = () => (zoom === 'fit' ? img.clientWidth / Math.max(1, img.naturalWidth) : zoom);
  const step = (factor: number) => {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current() * factor));
    apply();
  };

  section.querySelector('[data-image-in]')!.addEventListener('click', () => step(1.25));
  section.querySelector('[data-image-out]')!.addEventListener('click', () => step(1 / 1.25));
  section.querySelector('[data-image-fit]')!.addEventListener('click', () => {
    zoom = 'fit';
    apply();
  });
  section.querySelector('[data-image-actual]')!.addEventListener('click', () => {
    zoom = 1;
    apply();
  });
  img.addEventListener('click', () => {
    zoom = zoom === 'fit' ? 1 : 'fit';
    apply();
  });

  return new Promise((resolve, reject) => {
    img.addEventListener('load', () => {
      apply();
      resolve();
    }, { once: true });
    img.addEventListener('error', () => reject(new Error('image')), { once: true });
    img.alt = doc.name;
    img.src = fileUrl(doc.id);
  });
}

/** An owner-mirrored HTML visual, in the same script-only sandbox as the binder. */
export function showVisual(section: HTMLElement, doc: DocMeta): Promise<void> {
  const frame = section.querySelector<HTMLIFrameElement>('[data-visual]')!;
  frame.title = doc.name;
  frame.src = fileUrl(doc.id);
  return Promise.resolve();
}

/** A text node that only separates blocks (markup indentation), which a highlight skips. */
const isLayoutWhitespace = (node: Text) => node.data.includes('\n') && node.data.trim() === '';

/** Removes the marks a previous highlightText added, joining the text back together. */
export function clearHighlight(root: HTMLElement): void {
  for (const mark of root.querySelectorAll('mark[data-hit]')) {
    const parent = mark.parentNode;
    mark.replaceWith(...mark.childNodes);
    parent?.normalize();
  }
}

/**
 * Marks the first place `quote` appears in `root`'s text as mark.c-hit (one mark per text node it spans) and
 * scrolls it into view. Matching ignores case, curly quotes and runs of whitespace. Returns the first mark, or
 * null when the passage is not there (the view stays as it was).
 */
export function highlightText(root: HTMLElement, quote: string): HTMLElement | null {
  clearHighlight(root);
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
    starts.push(text.length);
    text += (node as Text).data;
  }
  const hit = locateQuote(text, quote);
  if (!hit) return null;

  let first: HTMLElement | null = null;
  nodes.forEach((node, i) => {
    const from = Math.max(hit.start - starts[i]!, 0);
    const to = Math.min(hit.end - starts[i]!, node.data.length);
    if (to <= from || isLayoutWhitespace(node)) return;
    const range = document.createRange();
    range.setStart(node, from);
    range.setEnd(node, to);
    const mark = document.createElement('mark');
    mark.className = 'c-hit';
    mark.dataset.hit = '';
    range.surroundContents(mark);
    first ??= mark;
  });
  (first as HTMLElement | null)?.scrollIntoView({ block: 'center' });
  return first;
}
