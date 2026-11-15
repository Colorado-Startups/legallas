// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { factorCitations } from '../scripts/kit-checks.ts';
import { DEFAULT_PACK_UNITS, NEXT_PACK_UNITS, type PackUnit } from '../scripts/law/default-pack-units.ts';
import { ENTITY_FORMS, ENTITY_MATRIX, matrixCites, resolveMatrix } from './entity-matrix.ts';
import { normalizeCitation, unitIdFor } from './law-cite.ts';
import { ENTRY } from './law-fixtures.ts';

const read = (...path: string[]) => readFileSync(join(import.meta.dirname, ...path), 'utf8');

test('every cell cites at least one statute, spelled as the law library spells it', () => {
  for (const factor of ENTITY_MATRIX) {
    for (const form of ENTITY_FORMS) {
      const cell = factor.cells[form.id];
      assert.ok(cell.cites.length > 0, `${factor.id} / ${form.id} cites nothing`);
      assert.doesNotMatch(cell.text, /[\u2013\u2014]/, `${factor.id} / ${form.id} has a dash`);
      for (const cite of cell.cites) {
        assert.equal(normalizeCitation(cite), cite, `${cite} is not in the library's spelling`);
        assert.ok(unitIdFor(cite), `${cite} has no library id`);
      }
    }
  }
  assert.equal(new Set(ENTITY_MATRIX.map((factor) => factor.id)).size, ENTITY_MATRIX.length);
});

test("the entity_matrix kit's reference lists the page's factors and statutes", () => {
  const markdown = read('..', 'connect', 'skill', 'legallas', 'references', 'entity-matrix.md');
  assert.deepEqual(new Set(factorCitations(markdown)), new Set(matrixCites()));
  const table = markdown.slice(markdown.indexOf('## Factors'));
  for (const factor of ENTITY_MATRIX) {
    const row = table.split('\n').find((line) => line.startsWith(`| ${factor.factor} |`));
    assert.ok(row, `the reference has no "${factor.factor}" row`);
    const listed = row.split('|')[2]!.split(';').map((cite) => cite.trim());
    const cited = new Set(ENTITY_FORMS.flatMap((form) => factor.cells[form.id].cites));
    assert.deepEqual(new Set(listed), cited, `"${factor.factor}" lists other statutes than the page`);
  }
});

/** A Delaware section's chapter: the General Corporation Law (8 Del. C. ch. 1) runs §§ 101 to 398; elsewhere § 1902 is ch. 19. */
const delawareChapter = (title: number, section: number) => (title === 8 && section < 500 ? 1 : Math.floor(section / 100));

/** The pack unit that stores a statute: its C.R.S. article, Delaware chapter or U.S. Code section. */
function storedIn(cite: string, units: readonly PackUnit[]): PackUnit[] {
  const crs = /^C\.R\.S\. § ([0-9]+)-([0-9]+)-/.exec(cite);
  const del = /^([0-9]+) Del\. C\. § ([0-9]+)$/.exec(cite);
  const usc = /^([0-9]+) U\.S\.C\. § ([0-9A-Za-z]+)$/.exec(cite);
  return units.filter(({ source }) => {
    if (crs) return source.kind === 'crs' && source.title === Number(crs[1]) && source.articles.includes(crs[2]!) && !source.sections && !source.parts;
    if (del) return source.kind === 'delaware' && source.title === Number(del[1]) && Number(source.chapter) === delawareChapter(Number(del[1]), Number(del[2])) && !source.subchapter;
    if (usc) return source.kind === 'uscode' && source.title === Number(usc[1]) && source.sections.includes(usc[2]!);
    return false;
  });
}

test('every statute is stored whole by exactly one pack unit, and the fixture run builds exactly those units', () => {
  const units = [...DEFAULT_PACK_UNITS, ...NEXT_PACK_UNITS];
  const needed = new Set<string>();
  for (const cite of matrixCites()) {
    const found = storedIn(cite, units);
    assert.equal(found.length, 1, `${cite} is stored by ${found.map((unit) => unit.id).join(', ') || 'no unit'}`);
    needed.add(found[0]!.id);
  }
  const workflow = read('..', '..', '.github', 'workflows', 'fixture-room.yml');
  const only = /--only ([a-z0-9,-]+)/.exec(workflow)?.[1]?.split(',') ?? [];
  assert.deepEqual(new Set(only), needed);
});

test('the library off dates nothing; on, each statute takes its first part', () => {
  const off = resolveMatrix(null, 'off');
  assert.equal(off.law, 'off');
  assert.equal(off.total, matrixCites().length);
  assert.equal(off.cited, 0);
  assert.ok(off.factors.every((factor) => ENTITY_FORMS.every((form) => factor.cells[form.id].cites.every((cite) => cite.law === null))));

  const entries = [
    ENTRY('crs-7-90-501~2', 'civil', { retrieved: '2026-10-09' }),
    ENTRY('crs-7-90-501~1', 'civil', { retrieved: '2026-10-08', url: 'https://leg.colorado.gov/sites/default/files/images/olls/crs2025-title-07.pdf' }),
    ENTRY('usc-26-1202', 'both', { retrieved: '2026-10-07' }),
    ENTRY('crs-7-80-714', 'civil'),
  ];
  const on = resolveMatrix(new Map(entries.map((entry) => [entry.id, entry])), 'on');
  assert.equal(on.cited, 2);
  const filings = on.factors.find((factor) => factor.id === 'yearly-filings')!.cells['co-llc'].cites[0]!;
  assert.deepEqual([filings.cite, filings.law?.retrieved, filings.law?.url], ['C.R.S. § 7-90-501', '2026-10-08', entries[1]!.url]);
  const qsbs = on.factors.find((factor) => factor.id === 'qsbs')!.cells['de-corp'].cites[0]!;
  assert.equal(qsbs.law?.retrieved, '2026-10-07');
  assert.deepEqual(
    on.forms.map((form) => form.name),
    ['Colorado LLC', 'Colorado C corp', 'Delaware C corp'],
  );
});
