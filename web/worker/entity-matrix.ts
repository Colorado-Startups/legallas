// SPDX-License-Identifier: Apache-2.0
// The entity-choice matrix: a Colorado LLC, a Colorado C corporation and a Delaware C corporation, factor by factor, for
// a founder choosing how to form (src/pages/entity/, GET /api/entity-matrix). Each cell is a short answer and the
// statutes it rests on, spelled as law-cite.ts normalizeCitation spells them. resolveMatrix() dates each statute from the
// law library's catalog: its official link and the day its text was fetched, or null when the library doesn't hold it.
// The entity_matrix kit's reference (connect/skill/legallas/references/entity-matrix.md) lists the same statutes per
// factor; entity-matrix.test.ts keeps the two equal. Research support: no cell recommends a form.
import { unitIdFor, unitOf, type LawChunk } from './law-cite.ts';

export const ENTITY_FORMS = [
  { id: 'co-llc', name: 'Colorado LLC' },
  { id: 'co-corp', name: 'Colorado C corp' },
  { id: 'de-corp', name: 'Delaware C corp' },
] as const;

export type EntityForm = (typeof ENTITY_FORMS)[number]['id'];

export interface MatrixCell {
  text: string;
  cites: readonly string[];
}

export interface MatrixFactor {
  id: string;
  factor: string;
  cells: Readonly<Record<EntityForm, MatrixCell>>;
}

const cell = (text: string, ...cites: string[]): MatrixCell => ({ text, cites });
const corp = (text: string, ...cites: string[]) => ({ 'co-corp': cell(text, ...cites), 'de-corp': cell(text, ...cites) });

// Statutes as the law library cites them.
const CRS = (section: string) => `C.R.S. § ${section}`;
const DGCL = (section: string) => `8 Del. C. § ${section}`;
const IRC = (section: string) => `26 U.S.C. § ${section}`;

export const ENTITY_MATRIX: readonly MatrixFactor[] = [
  {
    id: 'yearly-filings',
    factor: 'Yearly state filings',
    cells: {
      'co-llc': cell('Periodic report to Colorado each year.', CRS('7-90-501')),
      'co-corp': cell('Periodic report to Colorado each year.', CRS('7-90-501')),
      'de-corp': cell("Delaware franchise tax each year, plus Colorado's periodic report once authorized here.", DGCL('503'), CRS('7-90-801'), CRS('7-90-501')),
    },
  },
  {
    id: 'income-tax',
    factor: 'Income tax',
    cells: {
      'co-llc': cell('As a partnership, the members pay income tax, not the LLC.', IRC('701')),
      'co-corp': cell('The corporation pays federal and Colorado income tax.', IRC('11'), CRS('39-22-301')),
      'de-corp': cell("The same, plus Delaware's tax on a corporation doing business in Delaware.", IRC('11'), CRS('39-22-301'), '30 Del. C. § 1902'),
    },
  },
  {
    id: 'qsbs',
    factor: 'Qualified small business stock',
    cells: {
      'co-llc': cell("No: only a C corporation's stock qualifies.", IRC('1202')),
      ...corp('Yes, if the size and active business tests are met.', IRC('1202')),
    },
  },
  {
    id: 'iso',
    factor: 'Incentive stock options',
    cells: {
      'co-llc': cell("No: the options must be on a corporation's stock.", IRC('422')),
      ...corp('Yes, under a plan the holders approve.', IRC('422')),
    },
  },
  {
    id: 'consent',
    factor: 'Owners acting without a meeting',
    cells: {
      'co-llc': cell('A majority of members decides, or of managers if it has them.', CRS('7-80-401')),
      'co-corp': cell('Unanimous written consent, or less if the articles allow.', CRS('7-107-104')),
      'de-corp': cell('Written consent of the votes a meeting would need, unless the charter bars it.', DGCL('228')),
    },
  },
  {
    id: 'cumulative-voting',
    factor: 'Cumulative voting',
    cells: {
      'co-llc': cell('Members decide by majority; the LLC Act has no cumulative voting rule.', CRS('7-80-401')),
      'co-corp': cell('On for directors unless the articles turn it off.', CRS('7-102-102')),
      'de-corp': cell('Only if the charter provides it.', DGCL('214')),
    },
  },
  {
    id: 'removal',
    factor: 'Removing a director or manager',
    cells: {
      'co-llc': cell('A majority of members removes a manager.', CRS('7-80-402')),
      'co-corp': cell('Holders remove with or without cause, unless the articles require cause.', CRS('7-108-108')),
      'de-corp': cell('A majority of shares removes, with or without cause; staggered boards and cumulative voting limit it.', DGCL('141')),
    },
  },
  {
    id: 'charter',
    factor: 'Amending the charter',
    cells: {
      'co-llc': cell('Every member must consent to amend the articles or operating agreement.', CRS('7-80-401')),
      'co-corp': cell('The board or 10% of holders proposes; shareholders approve.', CRS('7-110-103')),
      'de-corp': cell('The board resolves; stockholders approve.', DGCL('242')),
    },
  },
  {
    id: 'remedies',
    factor: "A smaller holder's remedies",
    cells: {
      'co-llc': cell("Court dissolution when the business can't reasonably go on under the operating agreement.", CRS('7-80-810')),
      'co-corp': cell('Court dissolution for deadlock or oppression, or a buyout at fair value instead.', CRS('7-114-301'), CRS('7-114-305')),
      'de-corp': cell('A court custodian on deadlock.', DGCL('226')),
    },
  },
  {
    id: 'liability',
    factor: 'Limits on money liability',
    cells: {
      'co-llc': cell("Managers' duty of care is only to avoid gross negligence, recklessness, intentional misconduct or knowing violation of law.", CRS('7-80-404')),
      'co-corp': cell("The articles may limit directors' money liability, with exceptions.", CRS('7-102-102')),
      'de-corp': cell("The charter may limit directors' and officers' money liability, with exceptions.", DGCL('102')),
    },
  },
  {
    id: 'converting',
    factor: 'Converting later',
    cells: {
      'co-llc': cell('Converts to a corporation by plan; tax-free if the members keep control.', CRS('7-90-201'), IRC('351')),
      'co-corp': cell('Converts to a Delaware corporation by plan; changing only its state is a tax reorganization.', CRS('7-90-201'), DGCL('265'), IRC('368')),
      'de-corp': cell('Converts to another form under Delaware law.', DGCL('266')),
    },
  },
  {
    id: 'working-in-colorado',
    factor: 'Working in Colorado',
    cells: {
      'co-llc': cell('Formed here: no foreign authority needed.', CRS('7-90-801')),
      'co-corp': cell('Formed here: no foreign authority needed.', CRS('7-90-801')),
      'de-corp': cell("Needs Colorado authority; without it, it can't sue here to collect its debts and owes a penalty.", CRS('7-90-801'), CRS('7-90-802')),
    },
  },
];

/** Every statute the matrix cites, once each, in the order they first appear. */
export function matrixCites(matrix: readonly MatrixFactor[] = ENTITY_MATRIX): string[] {
  const out = new Set<string>();
  for (const factor of matrix) for (const form of ENTITY_FORMS) for (const cite of factor.cells[form.id].cites) out.add(cite);
  return [...out];
}

/** The law library behind the matrix: off (LAW_LIBRARY isn't "1"), empty (on, but its bucket has no catalog) or on. */
export type MatrixLaw = 'on' | 'off' | 'empty';

/** What a cell shows for one statute: the library's entry, or null when the library doesn't hold it. */
export interface ResolvedCite {
  cite: string;
  law: Pick<LawChunk, 'title' | 'url' | 'retrieved' | 'source'> | null;
}

export interface ResolvedMatrix {
  law: MatrixLaw;
  forms: { id: EntityForm; name: string }[];
  factors: { id: string; factor: string; cells: Record<EntityForm, { text: string; cites: ResolvedCite[] }> }[];
  /** Distinct statutes with a dated row in the library, of `total`. */
  cited: number;
  total: number;
}

/** The part number of a catalog id (`<unit>~<n>`), 0 for a unit indexed whole. */
const partOf = (id: string) => Number(/~([0-9]+)$/.exec(id)?.[1] ?? 0);

/** Each unit's first part, which carries the unit's own citation, title, link and date. */
function firstParts(catalog: ReadonlyMap<string, LawChunk>): Map<string, LawChunk> {
  const units = new Map<string, LawChunk>();
  for (const entry of catalog.values()) {
    const unit = unitOf(entry.id);
    const held = units.get(unit);
    if (!held || partOf(entry.id) < partOf(held.id)) units.set(unit, entry);
  }
  return units;
}

/** The matrix with each statute dated from `catalog` (null: the library is off or empty, so nothing is dated). */
export function resolveMatrix(catalog: ReadonlyMap<string, LawChunk> | null, law: MatrixLaw, matrix: readonly MatrixFactor[] = ENTITY_MATRIX): ResolvedMatrix {
  const units = catalog ? firstParts(catalog) : new Map<string, LawChunk>();
  const resolve = (cite: string): ResolvedCite => {
    const entry = units.get(unitIdFor(cite) ?? '');
    return { cite, law: entry ? { title: entry.title, url: entry.url, retrieved: entry.retrieved, source: entry.source } : null };
  };
  const all = matrixCites(matrix);
  return {
    law,
    forms: ENTITY_FORMS.map(({ id, name }) => ({ id, name })),
    factors: matrix.map(({ id, factor, cells }) => ({
      id,
      factor,
      cells: Object.fromEntries(ENTITY_FORMS.map((form) => [form.id, { text: cells[form.id].text, cites: cells[form.id].cites.map(resolve) }])) as Record<EntityForm, { text: string; cites: ResolvedCite[] }>,
    })),
    cited: all.filter((cite) => resolve(cite).law !== null).length,
    total: all.length,
  };
}
