// SPDX-License-Identifier: Apache-2.0
// The shape of the baseline company checklist (docs/checklist/baseline.toml). scripts/checklist/baseline.ts reads the
// file into this shape, and worker/checklist-baseline.ts is the generated copy the room serves.

export interface ChecklistSource {
  title: string;
  url: string;
}

/**
 * How the room works out a date for an item, from the company's own facts.
 * - `after`: days or months after the date on a matched document of one of the `from` items. `pick` says which date counts
 *   when there are several: one date for `each`, one for the first of each kind of document, or only the `latest`.
 * - `yearly`: this month and day every year, starting the calendar year after the company forms.
 * - `report-window`: from `months_before` to `months_after` the formation month, from the calendar year after the company
 *   forms, for the entity types listed. A Delaware company's report month comes from its Colorado authority.
 */
export type ChecklistDue =
  | { kind: 'after'; from: string[]; days?: number; months?: number; pick: 'each' | 'first-of-each' | 'latest'; what: string }
  | { kind: 'yearly'; month: number; day: number }
  | { kind: 'report-window'; months_before: number; months_after: number; entity_types: string[] };

/** A file in the repository's templates/founders/ folder, which the room serves under /templates/. All but `path` come from the file. */
export interface ChecklistTemplate {
  title: string;
  path: string;
  source: string;
  /** From the file's own footer. Null only for a file that isn't a template to sign, which has no footer. */
  version: string | null;
  law_checked: string;
  /** The entity types it's written for, in the checklist's own words. */
  entity_types: string[];
}

/** One document or agreement on the list. Field meanings are in the file's [fields] table. */
export interface ChecklistItem {
  /** `<category>.<slug>`: stable and never reused, so a match keeps pointing at the same thing. */
  id: string;
  title: string;
  category: string;
  relationship: string;
  stage: string;
  repeats?: string;
  deadline?: string;
  due?: ChecklistDue;
  note?: string;
  /** What a match's date means for this item, when a rule counts from it or it's a filing. */
  date_label?: string;
  templates?: ChecklistTemplate[];
  applies_when?: string;
  entity_types: string[];
  why: string;
  provided_by: string[];
  /** Room roles that need it besides the owner; empty means owner only. */
  room_roles: string[];
  evidence: string;
  title_by_entity?: Record<string, string>;
  sources: ChecklistSource[];
}

export interface ChecklistVocabulary {
  categories: string[];
  relationships: string[];
  stages: string[];
  entity_types: string[];
  providers: string[];
  room_roles: string[];
}

/** The display name of each vocabulary word, by the vocabulary's name. */
export type ChecklistLabels = Record<keyof ChecklistVocabulary, Record<string, string>>;

export interface ChecklistFolder {
  number: number;
  title: string;
  items: string[];
}

export interface ChecklistBaseline {
  title: string;
  /** The product notice (docs/legal/product-notices.md, A2), shown with every list and report. */
  notice: string;
  /** Docs/legal/product-notices.md, A5: above a list of templates, and on each template's card. */
  template_notice: string;
  template_card_notice: string;
  template_licence_notice: string;
  /** What this list is: who has reviewed it and what reading it isn't. */
  status: string;
  drafted: string;
  scope: string;
  vocabulary: ChecklistVocabulary;
  labels: ChecklistLabels;
  items: ChecklistItem[];
  /** The folders an investor room opens with. */
  folders: ChecklistFolder[];
}
