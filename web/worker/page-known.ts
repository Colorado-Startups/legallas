// SPDX-License-Identifier: Apache-2.0
// Whether a document's page numbers mean anything. Only a PDF, an image, a rendered visual and the slides and sheets
// of Keynote and Numbers are indexed page by page. Every other format is one block of text (office.ts, extract.ts,
// docs/design/iwork-reading.md): its index marker still says p:1, which only addresses the text, and nobody is shown it,
// because a page nobody knows is a wrong answer someone could rely on (#142, #225). Pure, so the browser, the Worker and
// the MCP server all use this one rule.
import { kindOf } from './doc-kinds.ts';

const PAGED_KINDS = new Set(['pdf', 'image', 'visual']);

export function pageIsKnown(name: string): boolean {
  return PAGED_KINDS.has(kindOf(name).kind) || /\.(?:key|numbers)$/i.test(name);
}
