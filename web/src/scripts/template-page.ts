// SPDX-License-Identifier: Apache-2.0
// The template page (src/pages/template.astro): fetches one founder template the room serves under /templates/, shows its
// title, source and law date, renders its text as Markdown (raw HTML off, then sanitized) and links the file to download.
import { fileHref, splitTemplate, templatePath } from './template-page-model.ts';

const root = document.querySelector<HTMLElement>('[data-template]')!; // safe: template.astro renders it
const status = root.querySelector<HTMLElement>('[data-template-status]')!;

function fail(message: string): void {
  status.textContent = message;
}

async function show(): Promise<void> {
  const path = templatePath(new URLSearchParams(location.search).get('path'));
  if (!path) return fail('No such template. Open one from the company checklist.');
  const response = await fetch(fileHref(path), { credentials: 'same-origin' });
  if (!response.ok) return fail('This template could not be loaded.');
  const { meta, body } = splitTemplate(await response.text());
  const [{ renderUnderPageTitle }, { sanitizeInto }] = await Promise.all([import('./markdown.ts'), import('./safe-html.ts')]);
  if (meta.title) {
    root.querySelector<HTMLElement>('[data-template-title]')!.textContent = meta.title;
    document.title = `${meta.title} | ${document.title.split(' | ').slice(1).join(' | ') || document.title}`;
  }
  const facts = [meta.source ? `Source: ${meta.source}` : null, meta.date_checked ? `Law checked: ${meta.date_checked}` : null].filter(Boolean);
  root.querySelector<HTMLElement>('[data-template-facts]')!.textContent = facts.join(' · ');
  const download = root.querySelector<HTMLAnchorElement>('[data-template-download]')!;
  download.href = fileHref(path);
  download.download = path.slice(path.lastIndexOf('/') + 1);
  sanitizeInto(root.querySelector<HTMLElement>('[data-md]')!, renderUnderPageTitle(body));
  root.querySelector<HTMLElement>('[data-template-view]')!.hidden = false;
  status.hidden = true;
}

show().catch(() => fail('This template could not be loaded.'));
