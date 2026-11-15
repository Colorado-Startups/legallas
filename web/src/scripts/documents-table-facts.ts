// SPDX-License-Identifier: Apache-2.0
// One document's designations as the Documents table shows them and the CSV index exports them (D17): its reading
// title, the matter's date and type, and whether it is privileged. No DOM types here: worker/export.ts imports this
// file too, so the table and the index a member downloads cannot drift apart.
import type { DocFacts } from '../../worker/matter-types.ts';
import { docTitle } from './doc-titles.ts';
import { docTypeWords } from './doc-type.ts';

const PRIVILEGED_SEGMENT = /privileged/i;
const NOT_PRIVILEGED_SEGMENT = /\bnon[- ]?privileged|not[- ]privileged/i;

/** True when any folder of `folder` says PRIVILEGED (the same reading as `npm run matter`). */
export function privilegedFolder(folder: string): boolean {
  return folder.split('/').some((segment) => PRIVILEGED_SEGMENT.test(segment) && !NOT_PRIVILEGED_SEGMENT.test(segment));
}

/** The manifest's facts a designation reads (served or stored; both carry these fields). */
export type DesignationFacts = Pick<DocFacts, 'date' | 'type' | 'privileged'>;

/** A document's designations: its title from the file name, and the matter's date for it. */
export interface Designations {
  /** "Order compelling discovery, Court" from the file name (doc-titles.ts), as the doc page heads it. */
  title: string;
  /** The matter's partial ISO date, or ''. Never the sync time. */
  date: string;
  /** The matter's type in words, else `fallbackType` of the file name. */
  type: string;
  /** The matter calls it privileged, or its folder or file name says so (the path rule worker/privilege.ts hides by). */
  privileged: boolean;
}

/**
 * The designations of the file `name` listed in `folder`. `fallbackType` names the type when the matter has none: the
 * table passes the file's format label (files-format.ts typeLabel); the CSV leaves the cell blank, since D1 holds no
 * type and its File name column already shows the extension.
 */
export function designate(name: string, folder: string, facts: DesignationFacts | undefined, fallbackType: (name: string) => string): Designations {
  return {
    title: docTitle(name),
    date: facts?.date ?? '',
    type: facts?.type ? docTypeWords(facts.type) : fallbackType(name),
    privileged: Boolean(facts?.privileged) || privilegedFolder(folder) || privilegedFolder(name),
  };
}
