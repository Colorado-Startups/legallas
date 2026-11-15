// SPDX-License-Identifier: Apache-2.0
// Ask over the keyword fallback (worker/fts.ts through retrieval.ts retrieve()): ASK_VISUALS decides whether its
// visual rows reach Ask, and Ask's cite pipeline reads a keyword passage's marker. The fallback on its own is in
// fts.test.ts. Fictional DOE text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askVisuals } from './ask.ts';
import { citedRefs, markersToCites } from './citations.ts';
import { ftsSearch } from './fts.ts';
import { answering, ids, REPAIR, room, roomWithEdgeCases, SEAM, spent } from './fts-fixtures.ts';
import { keywordFallbackFor, RETRIEVAL, retrieve, type Retrieved } from './retrieval.ts';

test('Ask with ASK_VISUALS "0" gets no visual rows from the keyword fallback, end to end through retrieve() (7c)', async () => {
  const t = roomWithEdgeCases();
  // The options quick Ask's route passes (routes/ask.ts): includeVisuals and its fallback both follow ASK_VISUALS.
  const ask = async (flag: string | undefined) => {
    const includeVisuals = askVisuals({ ASK_VISUALS: flag });
    return ids((await retrieve(spent, t.db, 'copper gutter escalation', 'counsel', RETRIEVAL, { includeVisuals, keywordFallback: keywordFallbackFor(includeVisuals) })).chunks).sort();
  };
  for (const flag of [undefined, '0']) assert.deepEqual(await ask(flag), ['doc-gutter', 'doc-minutes', 'doc-priv', 'doc-priv-name'], `ASK_VISUALS ${flag}`);
  assert.deepEqual(await ask('1'), ['doc-gutter', 'doc-minutes', 'doc-priv', 'doc-priv-name', 'doc-visual'], 'only "1" lets the visual in');
  assert.equal(keywordFallbackFor(false), ftsSearch, 'without visuals, the fallback is ftsSearch itself, called with no options');
  const owner = await retrieve(spent, t.db, 'copper gutter escalation', 'owner', RETRIEVAL, { includeVisuals: false, keywordFallback: ftsSearch });
  assert.deepEqual(ids(owner.chunks).sort(), ['doc-gutter', 'doc-minutes', 'doc-priv', 'doc-priv-name'], 'the owner sees privileged pages, still no visual');
});

test("retrieve(): the keyword fallback gives AI Search's chunk shape and citable set, and Ask's cite pipeline reads its marker", async () => {
  const t = room();
  const semantic = await retrieve(answering('doc-gutter', 2, REPAIR), t.db, 'copper gutter', 'counsel');
  const keyword: Retrieved = await retrieve(spent, t.db, 'copper gutter', 'counsel', { k: 1, candidates: 1 }, { keywordFallback: SEAM });
  assert.equal(keyword.viaKeyword, true);
  assert.equal(semantic.viaKeyword, undefined);
  assert.deepEqual(keyword.chunks, semantic.chunks, 'a short page comes back whole, behind the same marker');
  assert.deepEqual(keyword.citable, semantic.citable);
  assert.deepEqual(citedRefs(markersToCites(keyword.chunks[0]!.text)), [{ id: 'doc-gutter', page: 2 }]);
});
