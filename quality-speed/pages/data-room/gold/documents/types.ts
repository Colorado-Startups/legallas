// SPDX-License-Identifier: Apache-2.0
// One invented document of the gold record. The text lives here so the question sets can be checked against it.

export interface GoldDoc {
  /** `NN-Folder/Type__YYYYMMDD__Party__Qualifier.ext`, the fixture's own filename shape. */
  path: string;
  date: string;
  type: string;
  /** Display names; the builder turns them into the manifest's people and organizations. */
  from: string[];
  to: string[];
  summary: string;
  /** The catalog marks it as work product, the way the fixture marks its lawyer analysis. */
  privileged?: boolean;
  /** Paragraphs per page. A .pptx page is a slide; a .docx has no fixed pages, so its pages only group paragraphs. */
  pages?: string[][];
  /** The sheet of an .xlsx. */
  rows?: string[][];
}

/** On every page, so nobody can mistake a sample for a real record. */
export const FICTIONAL = 'HARBOR LABS SAMPLE RECORD. Fictional: every name, date and number is invented.';
