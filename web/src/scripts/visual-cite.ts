// SPDX-License-Identifier: Apache-2.0
// Cites inside a binder visual (card P8). A visual cannot reach the API, so a cite in it is a link
// `#<stored name>-cite=<prefix>-000412@3` that the bridge script posts to the room page; the viewer resolves the
// control number against /api/documents and opens the exhibit pane at that page. Control numbers are the
// room's permanent document numbers, so a page written today still opens the same exhibit after renames.
import type { FolderNode } from './files-api.ts';

/** One cite from a visual: the control number's sequence and an optional page. */
export interface VisualCite {
  seq: number;
  page: number | null;
}

const CITE = /^([A-Z]{2,6})-(\d{6})(?:@(\d{1,5}))?$/;

/**
 * Parses the text after `#<stored name>-cite=`. Null unless it is this room's prefix, a six-digit number of 1 or
 * more, and an optional page of 1 or more, so a visual can never name anything but a document number.
 */
export function parseVisualCite(ref: unknown, prefix: string): VisualCite | null {
  if (typeof ref !== 'string' || ref.length > 32) return null;
  const match = CITE.exec(ref.trim());
  if (!match || match[1] !== prefix) return null;
  const seq = Number(match[2]);
  const page = match[3] === undefined ? null : Number(match[3]);
  if (seq < 1 || page === 0) return null;
  return { seq, page };
}

/** Control sequence to document id, for every numbered document in the tree. */
export function controlIndex(root: FolderNode): Map<number, string> {
  const index = new Map<number, string>();
  const walk = (node: FolderNode): void => {
    for (const file of node.files) {
      if (typeof file.control_seq === 'number') index.set(file.control_seq, file.id);
    }
    if (node.guide && typeof node.guide.control_seq === 'number') index.set(node.guide.control_seq, node.guide.id);
    node.folders.forEach(walk);
  };
  walk(root);
  return index;
}
