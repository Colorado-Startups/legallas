// SPDX-License-Identifier: Apache-2.0
// The target-ring glyph on its own (DESIGN.md section 3), so a page can draw proof rings without pulling in the
// matrix and its tiles. matrix.ts re-exports it.
import type { ProofStrength } from '../../../worker/matter-types.ts';
import { svg } from './core.ts';

/**
 * The target-ring glyph: bullseye, two rings, one ring or a dashed ring (DESIGN.md section 3), drawn with F1's
 * `c-proof__ring` and `c-proof__core` in currentColor. Inside a `c-proof` it takes that cell's color and size.
 */
export function ringSvg(strength: ProofStrength, size = 24, parent?: Element): SVGSVGElement {
  const root = svg('svg', { class: 'viz-ring', 'data-strength': strength, viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', focusable: 'false' }, parent);
  svg('circle', { class: 'c-proof__ring', cx: 12, cy: 12, r: 10 }, root);
  if (strength === 'direct' || strength === 'corroborating') svg('circle', { class: 'c-proof__ring', cx: 12, cy: 12, r: 6 }, root);
  if (strength === 'direct') svg('circle', { class: 'c-proof__core', cx: 12, cy: 12, r: 2.5 }, root);
  return root;
}
