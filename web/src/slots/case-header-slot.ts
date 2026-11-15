// SPDX-License-Identifier: Apache-2.0
// The Overview's case header slot: overview-news.ts asks the
// litigation pack's overview-news-case.ts to fill the header from the matter (caption, glossary, campaign map). The
// glob matches it when the pack is in the tree and is empty in a core-only room, where caseHeader is undefined and
// the header keeps its plain "Overview" heading. Nothing else is imported here, so overview-news.ts imports this file
// where it imported the header module and the scripts load in the same order.
import type { ServedMatter } from '../../worker/matter-types.ts';

/** What overview-news.ts calls on the pack's header module. */
export interface CaseHeader {
  renderCase(root: ParentNode, matter: ServedMatter): void;
  renderCaseMissing(root: ParentNode, sentence: string): void;
  reserveCaseHeight(header: HTMLElement): void;
  releaseCaseHeight(header: HTMLElement): void;
}

export const caseHeader: CaseHeader | undefined = Object.values(import.meta.glob<CaseHeader>('../scripts/overview-news-case.ts', { eager: true }))[0];
