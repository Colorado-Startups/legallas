// SPDX-License-Identifier: Apache-2.0
// Small schematic screens for a filmstrip, used when a frame has no screenshot yet. Decorative: the frame's label
// and timing say what happened. Shapes use a few tones from the theme, so they work in light and dark.

export type SketchKind =
  | 'signin' | 'search' | 'results' | 'document' | 'citation' | 'ask' | 'answer'
  | 'blocked' | 'log' | 'checklist' | 'folder';

const rows = (x: number, y: number, widths: number[], cls = 'a', gap = 9) =>
  widths.map((w, i) => `<rect class="sk-${cls}" x="${x}" y="${y + i * gap}" width="${w}" height="4" rx="1"/>`).join('');
const bar = '<rect class="sk-a" x="12" y="14" width="108" height="10" rx="2"/><rect class="sk-c" x="124" y="14" width="24" height="10" rx="2"/>';

const SHAPES: Record<SketchKind, string> = {
  signin: `<rect class="sk-p" x="48" y="18" width="64" height="66" rx="3"/><circle class="sk-b" cx="80" cy="33" r="7"/>${rows(58, 46, [44, 44], 'a', 10)}<rect class="sk-c" x="58" y="68" width="44" height="9" rx="2"/>`,
  search: `${bar}${rows(12, 38, [84, 62, 74], 'a', 11)}`,
  results: `${bar}<rect class="sk-t" x="10" y="32" width="140" height="17" rx="2"/>${rows(14, 36, [70], 'b')}${rows(14, 43, [104])}${rows(14, 56, [62], 'b')}${rows(14, 63, [96])}${rows(14, 76, [58], 'b')}${rows(14, 83, [88])}`,
  document: `<rect class="sk-p" x="36" y="10" width="88" height="84" rx="2"/>${rows(46, 20, [68, 60, 66, 52, 68, 62, 44, 64], 'a', 8)}`,
  citation: `<rect class="sk-p" x="30" y="10" width="88" height="84" rx="2"/>${rows(40, 20, [68, 60], 'a', 8)}<rect class="sk-t" x="37" y="36" width="74" height="22" rx="1"/>${rows(40, 40, [66, 60, 44], 'b', 6)}${rows(40, 64, [68, 62, 48], 'a', 8)}<circle class="sk-c" cx="126" cy="46" r="6"/>`,
  ask: `<rect class="sk-t" x="56" y="16" width="92" height="20" rx="4"/>${rows(64, 22, [70], 'b')}${rows(64, 28, [48], 'b')}<rect class="sk-a" x="12" y="78" width="112" height="12" rx="3"/><rect class="sk-c" x="130" y="78" width="18" height="12" rx="3"/>`,
  answer: `${rows(12, 12, [128, 112, 122], 'a', 8)}<rect class="sk-t" x="12" y="40" width="62" height="20" rx="3"/><rect class="sk-t" x="80" y="40" width="62" height="20" rx="3"/>${rows(18, 48, [46], 'b')}${rows(86, 48, [46], 'b')}<rect class="sk-c" x="12" y="68" width="42" height="9" rx="4"/><rect class="sk-p" x="60" y="68" width="34" height="9" rx="4"/>${rows(12, 86, [136], 'a')}`,
  blocked: `<rect class="sk-p" x="48" y="24" width="64" height="56" rx="3"/><rect class="sk-x" x="68" y="48" width="24" height="20" rx="2"/><path class="sk-xl" d="M73 48v-6a7 7 0 0 1 14 0v6"/>`,
  log: `${rows(12, 12, [136], 'b')}${[0, 1, 2, 3, 4].map((i) => `<circle class="sk-c" cx="16" cy="${28 + i * 14}" r="3"/>${rows(26, 26 + i * 14, [46 + (i % 2) * 10])}${rows(92, 26 + i * 14, [54])}`).join('')}`,
  checklist: [0, 1, 2, 3, 4].map((i) => `<rect class="${i < 3 ? 'sk-c' : 'sk-p'}" x="14" y="${12 + i * 16}" width="9" height="9" rx="2"/>${rows(30, 15 + i * 16, [90 - (i % 3) * 16])}`).join(''),
  folder: `<path class="sk-p" d="M12 22h34l7 8h95v58H12Z"/>${rows(24, 42, [104, 88, 96, 72], 'a', 10)}<circle class="sk-c" cx="134" cy="44" r="4"/>`,
};

/** One schematic screen, drawn at 8:5. */
export function sketch(kind: SketchKind): string {
  return `<svg class="qs-sketch" viewBox="0 0 160 100" aria-hidden="true">${SHAPES[kind]}</svg>`;
}
