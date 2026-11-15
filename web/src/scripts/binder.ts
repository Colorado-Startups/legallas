// SPDX-License-Identifier: Apache-2.0
// The binder home (card P8): one tile per tab with its label, title, summary, its pages as direct links
// and how many this browser has read, so counsel can jump straight to any one page. Built from /api/visuals.
import {
  binderCount,
  el,
  icon,
  loadBinder,
  partLabel,
  readProgress,
  readSlugs,
  visualHref,
  type RoomSection,
  type RoomVisual,
} from './binder-data.ts';

const PAGES_ON_TILE = 5;
// One segment per page in the progress bar; long tabs are capped so the bar stays one line.
const PROGRESS_SEGMENTS = 24;

function progress(section: RoomSection, read: ReadonlySet<string>): HTMLElement {
  const { label } = readProgress(section, read);
  const bar = el('span', { class: 'binder-tile__bar', 'aria-hidden': 'true' });
  for (const slug of section.visuals.slice(0, PROGRESS_SEGMENTS)) {
    bar.append(el('i', read.has(slug) ? { 'data-read': '' } : {}));
  }
  return el('p', { class: 'binder-tile__progress' }, bar, el('span', {}, label));
}

function pageList(section: RoomSection, visuals: ReadonlyMap<string, RoomVisual>, read: ReadonlySet<string>): HTMLElement {
  const list = el('ol', { class: 'binder-tile__pages', 'aria-label': `Pages in ${section.label}` });
  for (const slug of section.visuals.slice(0, PAGES_ON_TILE)) {
    const visual = visuals.get(slug)!; // safe: resolveBinder lists only visuals it returns
    const isRead = read.has(slug);
    list.append(
      el(
        'li',
        {},
        el(
          'a',
          { href: visualHref(slug), 'data-read': isRead ? '' : undefined },
          el('span', { class: 'binder-tile__n' }, partLabel(section, visuals, slug)),
          el('span', { class: 'binder-tile__page' }, visual.title),
          isRead ? el('span', { class: 'u-vh' }, ', read') : null,
        ),
      ),
    );
  }
  const more = section.visuals.length - PAGES_ON_TILE;
  if (more > 0) {
    const next = section.visuals[PAGES_ON_TILE]!; // safe: more > 0
    list.append(el('li', { class: 'binder-tile__more' }, el('a', { href: visualHref(next) }, `${more} more`)));
  }
  return list;
}

function tile(section: RoomSection, visuals: ReadonlyMap<string, RoomVisual>, read: ReadonlySet<string>): HTMLElement {
  const first = section.visuals[0]!; // safe: resolveBinder drops empty sections
  const head = el(
    'a',
    { class: 'binder-tile__head', href: visualHref(first) },
    el('span', { class: 'binder-tile__label' }, icon(section.icon), el('span', {}, section.label)),
    el('span', { class: 'binder-tile__title' }, section.title),
  );
  return el(
    'li',
    { class: 'binder-tile', 'data-accent': section.accent },
    head,
    section.summary ? el('p', { class: 'binder-tile__summary' }, section.summary) : null,
    pageList(section, visuals, read),
    progress(section, read),
  );
}

async function renderBinder(root: HTMLElement): Promise<void> {
  const result = await loadBinder();
  const show = (selector: string) => root.querySelector<HTMLElement>(selector)?.removeAttribute('hidden');
  if (!result.ok) {
    show('[data-binder-error]');
    return;
  }
  const { binder } = result;
  if (binder.sections.length === 0) {
    show('[data-binder-empty]');
    return;
  }

  const bySlug = new Map(binder.visuals.map((v) => [v.slug, v]));
  const read = readSlugs();
  root.querySelector('[data-binder-count]')!.textContent = binderCount(binder);
  const grid = root.querySelector('[data-binder-tabs]')!;
  grid.replaceChildren(...binder.sections.map((section) => tile(section, bySlug, read)));
  show('[data-binder-tabs]');
}

const root = document.querySelector<HTMLElement>('[data-binder]');
if (root) void renderBinder(root);
