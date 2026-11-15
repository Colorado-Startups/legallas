// SPDX-License-Identifier: Apache-2.0
// The Overview's campaign map: one objective card per track inside the case header, complaint first. Each card
// links to its track page and shows the parties it is against as the record names them, a proof meter and one small picture chosen from the data (overview-map-model.ts). Built with createElement and
// textContent only; sizes go through custom properties (CSP). The structure picture upgrades to S2's tree lazily.
import { guideLook } from './guide-bus.ts';
import type { ServedMatter } from './matter-api.ts';
import type { Party } from './overview-case-model.ts';
import { whenNear } from './overview-case-dom.ts';
import { capBar, meterLabel, objectiveCards, structureOrgs, type MiniPicture, type ObjectiveCard } from './overview-map-model.ts';
import { el } from './overview-news-dom.ts';
import { formatValue, shapeSvg } from './viz/core.ts';

/** Entities a structure picture names before "and N more". */
const ENTITIES_SHOWN = 4;

function partyChip(party: Pick<Party, 'name' | 'side'>): HTMLElement {
  const chip = el('span', 'c-chip ov-party', [party.name]);
  chip.prepend(shapeSvg(party.side, 12));
  return chip;
}

/** The pips draw the meter; the label says it in words, so the pips are hidden from assistive tech. */
function meter(card: ObjectiveCard): HTMLElement {
  const pips = el('span', 'c-meter__pips', card.meter.pips.map((strength) =>
    el('span', 'c-meter__pip', [], { 'data-strength': strength })), { 'aria-hidden': 'true' });
  return el('p', 'c-meter ov-meter', [pips, el('span', 'c-meter__label', [meterLabel(card.meter)])], { 'data-total': String(card.meter.total) });
}

function capsPicture(picture: Extract<MiniPicture, { kind: 'caps' }>): HTMLElement {
  return el('dl', 'ov-caps', picture.figures.flatMap((figure) => {
    const bar = capBar(figure);
    const track = el('span', 'ov-cap', [el('span', 'ov-cap__fill'), el('span', 'ov-cap__limit')], { 'aria-hidden': 'true' });
    track.style.setProperty('--ov-fill', `${(bar.fill * 100).toFixed(2)}%`);
    track.style.setProperty('--ov-limit', `${(bar.limit * 100).toFixed(2)}%`);
    const limit = figure.limit === null ? '' : ` of ${formatValue(figure.unit, figure.limit)}`;
    return [
      el('dt', 'ov-caps__label', [figure.label]),
      el('dd', 'ov-caps__value', [track, el('span', 'u-num', [`${formatValue(figure.unit, figure.value)}${limit}`])]),
    ];
  }));
}

const SVG = 'http://www.w3.org/2000/svg';

/** A down arrow in the line-icon style (DESIGN.md section 8). Decorative: the move's label beside it says it. */
function arrow(): SVGSVGElement {
  const icon = document.createElementNS(SVG, 'svg');
  for (const [name, value] of Object.entries({ viewBox: '0 0 16 20', class: 'ov-move__arrow', 'aria-hidden': 'true', focusable: 'false' })) {
    icon.setAttribute(name, value);
  }
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M8 2v15M3.5 12 8 17l4.5-5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  icon.append(path);
  return icon;
}

function movePicture(picture: Extract<MiniPicture, { kind: 'move' }>, parties: ReadonlyMap<string, Party>): HTMLElement {
  const org = (id: string) => partyChip(parties.get(id) ?? { name: id, side: 'nominal' });
  const moves = picture.step.moves.map((move) =>
    el('li', 'ov-move', [
      org(move.from),
      el('span', 'ov-move__how', [arrow(), ` ${move.label} `]),
      org(move.to),
    ]));
  return el('div', 'ov-moves', [
    el('p', 'ov-moves__step', [el('span', 'u-mono ov-moves__date', [picture.step.date]), ' ', picture.step.label]),
    el('ul', 'ov-moves__list', moves),
  ]);
}

/**
 * Swaps the entity list for S2's structure tree (viz/tree.ts) once the card nears the viewport, drawn as a
 * thumbnail (overview-map.css scales it to a fixed height; its Table twin reads the names): the entities with
 * their owners above them, the entities highlighted. Choosing a tile opens that entity in Entities & People. If
 * the module fails to load, the list stays.
 */
function upgradeToTree(figure: HTMLElement, matter: ServedMatter, entities: readonly string[]): void {
  const orgs = structureOrgs(matter.orgs, entities);
  if (!orgs.length) return;
  queueMicrotask(() => whenNear(figure, figure, async () => {
    try {
      const [{ renderTree }] = await Promise.all([import('./viz/tree.ts'), import('./viz/charts.css')]);
      figure.replaceChildren();
      renderTree(figure, orgs, {
        title: PICTURE_LABEL.structure,
        caption: '',
        highlight: new Set(entities),
        onSelect: (id) => {
          if (id) window.location.assign(`/people/?p=${encodeURIComponent(id)}`);
        },
      });
    } catch {
      // The entity list drawn first stays in place.
    }
  }));
}

/** The entities a structure picture highlights, as hex tiles with their names. */
function structurePicture(picture: Extract<MiniPicture, { kind: 'structure' }>, parties: ReadonlyMap<string, Party>): HTMLElement {
  const named = picture.entities.map((id) => parties.get(id)).filter((p): p is Party => p !== undefined);
  if (!named.length) return el('p', 'ov-mini__none', ['No entities are named yet.']);
  const rest = named.length - ENTITIES_SHOWN;
  return el('ul', 'ov-entities', [
    ...named.slice(0, ENTITIES_SHOWN).map((party) => {
      const item = el('li', 'ov-entities__item', [party.name]);
      item.prepend(shapeSvg(party.side, 14));
      return item;
    }),
    rest > 0 ? el('li', 'ov-entities__more', [`and ${rest} more`]) : null,
  ]);
}

const PICTURE_LABEL: Record<MiniPicture['kind'], string> = {
  structure: 'Entities involved',
  caps: 'Figures against their limits',
  move: 'Moved under another entity',
};

function picture(card: ObjectiveCard, matter: ServedMatter, parties: ReadonlyMap<string, Party>): HTMLElement {
  const p = card.picture;
  const body = p.kind === 'caps' ? capsPicture(p) : p.kind === 'move' ? movePicture(p, parties) : structurePicture(p, parties);
  const figure = el('figure', 'ov-mini', [el('figcaption', 't-label ov-mini__label', [PICTURE_LABEL[p.kind]]), body], { 'data-picture': p.kind });
  if (p.kind === 'structure') upgradeToTree(figure, matter, p.entities);
  return figure;
}

function objective(card: ObjectiveCard, matter: ServedMatter, parties: ReadonlyMap<string, Party>): HTMLElement {
  const against = card.against.length
    ? el('div', 'ov-against', [
      el('p', 'ov-against__label', [card.kind === 'complaint' ? 'Against' : 'Against, per the record']),
      el('ul', 'ov-against__list', card.against.map((party) => el('li', '', [partyChip(party)]))),
    ])
    : null;
  const article = el('article', 'c-objective ov-objective', [
    el('h3', 'c-objective__title', [el('a', 'ov-objective__link', [card.title], { href: card.href })]),
    el('p', 'c-objective__summary', [card.forum]),
    el('div', 'c-objective__meta ov-objective__meta', [against, meter(card)]),
    picture(card, matter, parties),
  ], { 'data-kind': card.kind });
  const look = () => guideLook(article);
  article.addEventListener('pointerenter', look);
  article.addEventListener('focusin', look);
  return article;
}

/** Fills the header's map. A matter with no tracks yet says so in one sentence. */
export function renderMap(host: HTMLElement, matter: ServedMatter, parties: ReadonlyMap<string, Party>): void {
  const cards = objectiveCards(matter);
  if (!cards.length) {
    host.replaceChildren(el('p', 'ov-map__none', ['The tracks have not been drafted yet.']));
  } else {
    host.replaceChildren(
      el('h2', 'u-vh', ['Tracks']),
      el('ol', 'ov-map__list', cards.map((card) => el('li', 'ov-map__item', [objective(card, matter, parties)]))),
    );
  }
  host.hidden = false;
}
