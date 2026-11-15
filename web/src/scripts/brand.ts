// SPDX-License-Identifier: Apache-2.0
// The room's mark for the Astro pages (import.meta.glob is Vite's; plain Node cannot load this file): the brand pack's
// mark.ts (@brand, astro.config.mjs and scripts/config.ts brandAssetsDir), else the neutral mark (worker/mark.ts). The
// Worker's 403 page takes its mark from worker/extensions.ts instead, which the room's Worker entries set.
import { neutralMarkSvg, type MarkSvg } from '../../worker/mark.ts';

const marks = import.meta.glob<MarkSvg>('@brand/mark.ts', { eager: true, import: 'markSvg' });

/** The room's brand mark as SVG, or the neutral mark when the room has none. */
export const markSvg: MarkSvg = Object.values(marks)[0] ?? neutralMarkSvg;
