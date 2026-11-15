// SPDX-License-Identifier: Apache-2.0
// Draws Ask's public-records cards (records-card-model.ts) with el() and textContent only. Links are the model's
// checked ones: a source's own https page, opened in a new tab, or the room's own approval page.
import { el } from './dom-el.ts';
import type { RecordsCard, SourceCard } from './records-card-model.ts';

const outside = (href: string, label: string) => el('a', { href, rel: 'noopener noreferrer', target: '_blank' }, label);

function sourceNodes(source: SourceCard): HTMLElement {
  const findings = source.findings.map((f) =>
    el(
      'li',
      {},
      f.href ? outside(f.href, f.title) : f.title,
      f.date ? `, dated ${f.date}` : '',
      f.details.length ? `. ${f.details.join('. ')}.` : '',
      ` Checked ${f.checked}.`,
    ),
  );
  return el(
    'section',
    { class: 'rec-source' },
    el('h4', { class: 'rec-source__name t-small' }, `${source.name} (${source.operator})`),
    source.checked ? el('p', { class: 't-caption' }, `Checked ${source.checked.slice(0, 16).replace('T', ' ')} UTC.`) : null,
    el('p', { class: 't-small' }, source.note),
    findings.length ? el('ul', { class: 'rec-findings t-small' }, ...findings) : null,
    source.href && source.findings.length === 0 ? el('p', { class: 't-small' }, 'Search page: ', outside(source.href, source.name)) : null,
    source.lookFor && source.findings.length === 0 ? el('p', { class: 't-small' }, `What to look for: ${source.lookFor}`) : null,
    el('p', { class: 't-caption' }, `What it covers: ${source.coverage}`),
  );
}

/** One card as DOM. */
export function recordsCardNode(card: RecordsCard): HTMLElement {
  const root = el('aside', { class: 'rec-card', 'aria-label': card.title }, el('h3', { class: 'rec-card__title t-small' }, card.title));
  if (card.kind === 'approval') {
    root.append(el('p', { class: 't-small' }, `Checking this name sends it to: ${card.sendsTo.join('; ')}. Nothing has been sent yet.`));
    if (card.approveHref) root.append(el('p', {}, el('a', { class: 'c-button c-button--primary', href: card.approveHref }, 'Review and approve')));
    root.append(el('p', { class: 't-caption' }, 'After you approve, ask again to run the check.'), el('p', { class: 't-caption' }, card.notice));
    return root;
  }
  if (card.kind === 'declined') {
    root.append(el('p', { class: 't-small' }, card.message), el('p', { class: 't-caption' }, card.notice));
    return root;
  }
  root.append(el('p', { class: 't-caption' }, `Checked ${card.checked.slice(0, 16).replace('T', ' ')} UTC.`));
  for (const group of card.groups) root.append(el('h4', { class: 'rec-group t-label' }, group.heading), ...group.sources.map(sourceNodes));
  if (card.notApplicable.length) root.append(el('h4', { class: 'rec-group t-label' }, 'Not applicable'), el('ul', { class: 't-small' }, ...card.notApplicable.map((line) => el('li', {}, line))));
  root.append(el('div', { class: 'rec-notices' }, ...card.notices.map((notice) => el('p', { class: 't-caption' }, notice))));
  return root;
}
