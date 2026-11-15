// SPDX-License-Identifier: Apache-2.0
// Card P4 (Claims & Proof). Money in the record: movements by payer and year on one scale and as a flow from
// payer to payee; promises (commitments and calls) in charts of their own, never added to movements; and a
// ledger in which every figure carries its cite. Entries with no kind (unless the label gives one confidently) or
// no payer or payee appear in the ledger only (R43). No damages models, no projections, no settlement figures.

import type { RoomMoney, ServedMatter } from './matter-api.ts';
import { formatPartialDate } from './matter-api.ts';
import { byDate, chartSeries, kindWord, splitRoomMoney, withKinds, yearBars, type PartyInfo } from './claims-money-model.ts';
import { citeChip, el } from './claims-dom.ts';
import { formatUsd } from './viz/core.ts';
import { renderBars } from './viz/bar.ts';
import { renderFlow, type FlowParty } from './viz/flow.ts';
import type { MoneySeries } from './viz/money.ts';

function partyLookup(matter: ServedMatter): (id: string) => PartyInfo {
  const known = new Map<string, PartyInfo>();
  for (const p of matter.people) known.set(p.id, { name: p.name, side: p.side });
  for (const o of matter.orgs) known.set(o.id, { name: o.name, side: o.side });
  return (id) => known.get(id) ?? { name: 'Not stated', side: null };
}

const CHARTS: Record<MoneySeries, { bars: string; barsNote: string; flow: string }> = {
  movements: {
    bars: 'Paid or transferred, by payer and year',
    barsNote: 'One scale; each payer is its own bar.',
    flow: 'Where the money came from and where it went',
  },
  promises: {
    bars: 'Committed or called, by party and year',
    barsNote: 'Commitments and capital calls, kept apart from money paid.',
    flow: 'Who committed or called money, and to whom',
  },
};

/** Draws the section into `host`. Returns false, drawing nothing, when the record holds no money facts. */
export function renderMoney(host: HTMLElement, matter: ServedMatter): boolean {
  if (matter.money.length === 0) return false;
  const party = partyLookup(matter);
  const { money, inferred } = withKinds(matter.money);
  const split = splitRoomMoney(money);
  const charts = el('div', { class: 'claims-money__charts' }, host);
  for (const series of ['movements', 'promises'] as const) {
    if (split[series].some((f) => chartSeries(f) === series)) seriesCharts(charts, series, split[series], party);
  }
  ledger(host, money, inferred, party);
  return true;
}

/** One series: its year bars and its flow. Entries without a payer or payee are listed in the flow's table only. */
function seriesCharts(host: HTMLElement, series: MoneySeries, facts: RoomMoney[], party: (id: string) => PartyInfo): void {
  const words = CHARTS[series];
  const bars = yearBars(facts, series, party);
  renderBars(el('div', { class: 'claims-money__chart' }, host), {
    categories: bars.years.map((y) => ({ id: y, label: y })),
    series: bars.payers.map((p) => ({ id: p.id, label: p.name, side: p.side, series })),
    values: bars.values,
  }, { title: words.bars, caption: words.barsNote, orientation: 'vertical', stacked: false, kind: 'usd', height: 200 });
  const flowParties: Record<string, FlowParty> = {};
  for (const f of facts) {
    for (const id of [f.from, f.to]) if (id) flowParties[id] = { name: party(id).name, side: party(id).side ?? 'none' };
  }
  renderFlow(el('div', { class: 'claims-money__chart' }, host), facts, {
    title: words.flow,
    caption: 'Band width is to scale. Exact figures and their cites are in the ledger below.',
    parties: flowParties,
    series,
  });
}

/** Every money fact in date order with its kind, parties, amount and cite chips. Never a total. */
function ledger(host: HTMLElement, money: readonly RoomMoney[], inferred: ReadonlySet<string>, party: (id: string) => PartyInfo): void {
  const section = el('div', { class: 'claims-ledger', 'data-claims-ledger': '' }, host);
  el('h3', { class: 't-label claims-ledger__title' }, section, 'Every figure, with its cite');
  const wrap = el('div', { class: 'c-table-wrap' }, section);
  const table = el('table', { class: 'c-table claims-ledger__table' }, wrap);
  el('caption', { class: 'u-vh' }, table, 'Money in the record, by date');
  const head = el('tr', {}, el('thead', {}, table));
  for (const [label, num] of [['Date', true], ['Entry', false], ['From → to', false], ['Kind', false], ['Amount', true], ['Cite', false]] as const) {
    el('th', { scope: 'col', class: num ? 'c-table__num' : undefined }, head, label);
  }
  const body = el('tbody', {}, table);
  for (const fact of [...money].sort(byDate)) {
    const charted = chartSeries(fact);
    const tr = el('tr', { 'data-series': charted ?? 'listed' }, body);
    const date = el('td', { class: 'c-table__num' }, tr);
    el('time', { datetime: fact.date, title: formatPartialDate(fact.date) || undefined }, date, fact.date);
    el('td', {}, tr, fact.label);
    el('td', {}, tr, `${fact.from ? party(fact.from).name : 'Not stated'} → ${fact.to ? party(fact.to).name : 'Not stated'}`);
    el('td', {}, tr, charted ? kindWord(fact, inferred) : `${kindWord(fact, inferred)}, not charted`);
    el('td', { class: 'c-table__num' }, tr, formatUsd(fact.amountCents));
    const cites = el('td', { class: 'claims-ledger__cites' }, tr);
    for (const cite of fact.cites) citeChip(cite, cites);
  }
}
