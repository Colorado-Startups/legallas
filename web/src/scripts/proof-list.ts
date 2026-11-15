// SPDX-License-Identifier: Apache-2.0
// The proof checklist (track pages): one row per point to prove. Each row leads with the strongest-proof ring and
// its word, then the point, its authority when counsel has one, and the cite chips that open the exhibit pane.
// A gap row wears the paper haze (c-fog, data-state="gap") and reads "Not yet in the record". Loaded lazily by
// track.ts, since the ring drawing pulls in the chart helpers.
import { citeChip, el } from './track-dom.ts';
import { PROOF_WORDS, proofRows, type ProofPoint } from './proof-list-model.ts';
import { ringSvg } from './viz/ring.ts';

/** Options for the proof list, including a callback for a gap row that takes focus or the pointer. */
export interface ProofListOptions {
  /** A gap row took focus or the pointer (the guide reacts). */
  onGap?: (row: HTMLElement) => void;
}

/** Draws the checklist for `points` into `parent`; returns the list. */
export function renderProofList(parent: HTMLElement, points: readonly ProofPoint[], opts: ProofListOptions = {}): HTMLUListElement {
  const list = el('ul', { class: 'track-proof' }, parent);
  for (const row of proofRows(points)) {
    const item = el('li', {
      class: row.gap ? 'track-proof__row c-fog' : 'track-proof__row',
      'data-state': row.gap ? 'gap' : undefined,
      'data-strength': row.strength,
    }, list);
    const mark = el('span', { class: 'track-proof__mark' }, item);
    ringSvg(row.strength, 20, mark);
    el('span', { class: 'track-proof__word' }, mark, PROOF_WORDS[row.strength]);
    const body = el('div', { class: 'track-proof__body' }, item);
    el('p', { class: 'track-proof__text' }, body, row.text);
    if (row.authority) el('p', { class: 'track-proof__authority t-small' }, body, row.authority);
    const cites = el('div', { class: 'track-proof__cites' }, item);
    if (row.gap) {
      // The gap is reachable by keyboard, so focusing it can tell the guide; it holds no control of its own.
      item.tabIndex = 0;
      item.setAttribute('aria-label', `${row.text} ${PROOF_WORDS.gap}.`);
      const gapped = () => opts.onGap?.(item);
      item.addEventListener('focus', gapped);
      item.addEventListener('pointerenter', gapped);
    } else {
      const group = el('span', { class: 'track-cites', role: 'group', 'aria-label': `Proof for: ${row.text}` }, cites);
      for (const proof of row.cites) {
        const chip = citeChip(proof.cite, group, proof.note);
        chip.dataset.strength = proof.strength;
      }
    }
  }
  return list;
}
