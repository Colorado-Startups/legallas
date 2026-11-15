// SPDX-License-Identifier: Apache-2.0
// legallas_case_overview under the D6 response profiles, on the Doe v. Harbor Labs fixture and on a copy grown to the
// manifest's limits: compact pages stay within 25 entries and 9,000 characters, standard keeps its caps, cursors
// walk every section in both, and an entry too long for a page arrives whole, in parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPACT_LIMITS } from '../contract.ts';
import { encodeCursor as encodeParts, forProfile } from '../format.ts';
import {
  bigMatter, call, entriesOf, joinParts, LIST_SECTIONS, MATTER_JSON, overviewCtx, pages, type Value,
} from './overview-fixtures.ts';
import {
  COMPACT_PAGE_CHARS, COMPACT_PAGE_ENTRIES, decodePosition, encodeCursor, encodePosition, FITS, MAX_ENTRY_CHARS, PAGE_ENTRIES, splitEntry,
} from './overview-page.ts';
import { MAX_DEFINED_TERMS } from './overview-summary.ts';

const MATTERS = { doe: JSON.parse(MATTER_JSON), big: bigMatter() };

test('compact: every page of every section is at most 9,000 characters as sent, text and view together, and 25 entries', async () => {
  for (const [name, matter] of Object.entries(MATTERS)) {
    const ctx = overviewCtx({ matter, profile: 'compact' });
    for (const section of ['summary', ...LIST_SECTIONS]) {
      for (const { value, text, result } of await pages(ctx, section)) {
        assert.ok(text.length <= COMPACT_PAGE_CHARS, `${name} ${section}: ${text.length} characters`);
        const sent = forProfile('compact', result);
        assert.ok(sent.structuredContent, `${name} ${section}: a view`);
        assert.ok(JSON.stringify(sent).length <= COMPACT_LIMITS.maxChars, `${name} ${section}: ${JSON.stringify(sent).length} characters as sent`);
        assert.ok((value.entries ?? value.definedTerms).length <= COMPACT_PAGE_ENTRIES, `${name} ${section}`);
        assert.doesNotMatch(text, /"truncated"/, `${name} ${section}: nothing is cut`);
      }
    }
  }
});

test('cursor round-trip: every section walks to the same entries in both profiles, nothing repeated or cut', async () => {
  for (const [name, matter] of Object.entries(MATTERS)) {
    const { value: summary } = await call(overviewCtx({ matter }));
    for (const section of LIST_SECTIONS) {
      const standard = await entriesOf(overviewCtx({ matter, profile: 'standard' }), section);
      const compact = await entriesOf(overviewCtx({ matter, profile: 'compact' }), section);
      assert.deepEqual(compact, standard, `${name} ${section}`);
      assert.equal(standard.length, summary.counts[section], `${name} ${section}: every entry once`);
      assert.equal(new Set(standard.map((e) => e.id)).size, standard.length, `${name} ${section}: ids unique`);
      assert.doesNotMatch(JSON.stringify(standard), /"truncated"/);
    }
  }
});

test('standard (Claude, Harvey) keeps the caps it always had, and the fixture needs no parts there', async () => {
  const ctx = overviewCtx();
  assert.deepEqual([ctx.clientKind, ctx.profile], ['claude', 'standard']);
  for (const section of ['summary', ...LIST_SECTIONS]) {
    const walked = await pages(ctx, section);
    assert.ok(walked.every(({ value }) => (value.entries ?? []).every((e: Value) => !('part' in e))), `${section}: whole entries`);
  }
  const [first] = await pages(ctx, 'docs');
  assert.equal(first!.value.entries.length, PAGE_ENTRIES, 'a standard docs page still holds 40');
  const [compactFirst] = await pages(overviewCtx({ profile: 'compact' }), 'docs');
  assert.ok(compactFirst!.value.entries.length <= COMPACT_PAGE_ENTRIES);
});

test('anything but standard is sized compact, as unknown clients are (D6)', async () => {
  const ctx = overviewCtx({ matter: MATTERS.big });
  const odd = { ...ctx, clientKind: 'unknown', profile: 'other' } as unknown as typeof ctx;
  const { text } = await call(odd, { section: 'tracks' });
  assert.ok(text.length <= COMPACT_PAGE_CHARS);
  assert.deepEqual(await pages(odd, 'tracks'), await pages(overviewCtx({ matter: MATTERS.big, profile: 'compact' }), 'tracks'));
});

test('a track too long for one page comes in parts that share its id; joined, it has every item', async () => {
  const raw = MATTERS.big.tracks[0];
  for (const profile of ['standard', 'compact'] as const) {
    const items = (await pages(overviewCtx({ matter: MATTERS.big, profile }), 'tracks')).flatMap((p) => p.value.entries);
    const parts = items.filter((e) => e.id === raw.id);
    assert.ok(parts.length > 2, `${profile}: ${parts.length} parts`);
    assert.deepEqual(parts.map((p) => [p.part, p.parts]), parts.map((_, i) => [i + 1, parts.length]));
    assert.equal(parts[0].kind, 'complaint', 'part 1 has the scalar fields');
    assert.ok(parts.slice(1).every((p) => !('kind' in p)));
    if (profile === 'standard') assert.ok(parts.every((p) => JSON.stringify(p).length <= MAX_ENTRY_CHARS));
    const [whole] = joinParts(parts);
    assert.equal(whole.points.length, 60);
    assert.deepEqual(whole.points.map((p: Value) => p.id), raw.points.map((p: Value) => p.id), 'in manifest order');
    assert.deepEqual(
      [whole.brief.exhibits.length, whole.brief.hurdles.length, whole.brief.dates.length, whole.brief.cast.length],
      [20, 12, 20, raw.brief.cast.length],
    );
    assert.match(whole.brief.line, /^<case-record>\n/);
    assert.equal(whole.proofByViolation[0].points.length, 60);
  }
});

test('compact splits a long entry in any section, and a list item too long for a page continues across parts', async () => {
  const ctx = (profile: 'standard' | 'compact') => overviewCtx({ matter: MATTERS.big, profile });
  const onlyId = (items: Value[], id: string) => items.filter((e) => e.id === id);
  for (const [section, id] of [['claims', MATTERS.big.claims[0].id], ['people', 'per-low']] as const) {
    const compact = onlyId((await pages(ctx('compact'), section)).flatMap((p) => p.value.entries), id);
    const standard = onlyId((await pages(ctx('standard'), section)).flatMap((p) => p.value.entries), id);
    assert.ok(compact.length > 1, `${section}: compact sends it in parts`);
    assert.equal(standard.length, 1, `${section}: standard keeps it whole, as it always did`);
    assert.deepEqual(joinParts(compact), standard, `${section}: joined, nothing lost`);
  }
  const parts = onlyId((await pages(ctx('compact'), 'tracks')).flatMap((p) => p.value.entries), 'track-complaint');
  const fragments = parts.flatMap((p) => p.points ?? []).filter((point: Value) => point.id === 'pt-big-0');
  assert.ok(fragments.length > 1, 'the 20-proof point comes in fragments');
  assert.deepEqual(fragments.map((f: Value) => f.continues === true), fragments.map((_: Value, i: number) => i > 0));
  assert.ok(fragments.slice(1).every((f: Value) => !('text' in f)), 'only the first fragment has its fields');
  const [whole] = joinParts(parts);
  assert.equal(whole!.points[0].proof.length, 20);
  assert.deepEqual(whole!.points[0], (await entriesOf(ctx('standard'), 'tracks'))[0]!.points[0]);
});

test("a part cursor past its entry's parts, or for an entry never split, restarts the entry instead of skipping it", async () => {
  const standard = overviewCtx({ matter: MATTERS.big, profile: 'standard' });
  const claims = await call(standard, { section: 'claims', cursor: encodePosition('claims', { offset: 0, part: 3 }, 'standard') });
  assert.deepEqual(claims.value.entries, (await call(standard, { section: 'claims' })).value.entries);
  const compact = overviewCtx({ matter: MATTERS.big, profile: 'compact' });
  const tracks = await call(compact, { section: 'tracks', cursor: encodePosition('tracks', { offset: 0, part: 9999 }, 'compact') });
  assert.deepEqual([tracks.value.entries[0].id, tracks.value.entries[0].part], ['track-complaint', 1]);
  const summary = await call(compact, { section: 'summary', cursor: encodePosition('summary', { offset: 0, part: 2 }, 'compact') });
  assert.equal(summary.out.isError, undefined);
  assert.match(summary.value.caption, /^<case-record>\n/, 'the summary is never split: its first page');
});

test('a page can end inside an entry: its cursor resumes at the next part', async () => {
  const ctx = overviewCtx({ matter: MATTERS.big, profile: 'compact' });
  const first = (await call(ctx, { section: 'tracks' })).value;
  const last = first.entries.at(-1);
  assert.ok(last.part < last.parts, 'the first page stops inside the complaint track');
  assert.deepEqual(decodePosition(first.nextCursor, 'tracks', 'compact'), { offset: 0, part: last.part });
  const second = (await call(ctx, { section: 'tracks', cursor: first.nextCursor })).value;
  assert.equal(second.offset, 0);
  assert.deepEqual([second.entries[0].id, second.entries[0].part], [last.id, last.part + 1]);
});

test('a part cursor from the other profile restarts its entry; plain cursors read the same in both', async () => {
  const compact = overviewCtx({ matter: MATTERS.big, profile: 'compact' });
  const { nextCursor } = (await call(compact, { section: 'tracks' })).value;
  assert.deepEqual(decodePosition(nextCursor, 'tracks', 'standard'), { offset: 0, part: 0 });
  const { out, value } = await call(overviewCtx({ matter: MATTERS.big, profile: 'standard' }), { section: 'tracks', cursor: nextCursor });
  assert.equal(out.isError, undefined);
  assert.deepEqual([value.entries[0].id, value.entries[0].part], ['track-complaint', 1]);
  assert.equal(encodePosition('docs', { offset: 40, part: 0 }, 'compact'), encodeCursor('docs', 40));
  for (const profile of ['standard', 'compact'] as const) {
    assert.deepEqual(decodePosition(encodeCursor('docs', 40), 'docs', profile), { offset: 40, part: 0 });
    assert.deepEqual(decodePosition(encodePosition('docs', { offset: 3, part: 2 }, profile), 'docs', profile), { offset: 3, part: 2 });
    assert.equal(decodePosition(encodePosition('docs', { offset: 3, part: 2 }, profile), 'events', profile), null);
    assert.ok(encodePosition('violations', { offset: 999_999, part: 9999 }, profile).length <= 64, 'fits the input schema');
  }
  const bad = [
    '%%%', btoa('docs:1'), encodeParts(['docs']), encodeParts(['docs', -1]), encodeParts(['docs', 1.5]), encodeParts(['docs', 1, 2]),
    encodeParts(['docs', 1, 0, 'compact']), encodeParts(['docs', 1, 2, 'big']), encodeParts(['docs', 1, 2, 'compact', 3]), encodeParts([1, 'docs']),
  ];
  for (const cursor of bad) assert.equal(decodePosition(cursor, 'docs', 'compact'), null, cursor);
});

test('a foreign or broken cursor is bad_cursor in both profiles, before any audit', async () => {
  for (const profile of ['standard', 'compact'] as const) {
    let audits = 0;
    const ctx = { ...overviewCtx({ profile }), audit: async () => void audits++ };
    for (const [section, cursor] of [['docs', 'nope'], ['summary', encodeCursor('docs', 0)], ['tracks', encodeCursor('events', 0)]]) {
      const { out, text } = await call(ctx, { section, cursor });
      assert.equal(out.isError, true);
      assert.match(text, /^bad_cursor:/);
    }
    assert.equal(audits, 0, profile);
  }
});

test('the summary pages through every defined term in both profiles; the header comes once', async () => {
  const terms = MATTERS.big.meta.definedTerms.map((t: Value) => t.term);
  for (const profile of ['standard', 'compact'] as const) {
    const walked = await pages(overviewCtx({ matter: MATTERS.big, profile }), 'summary');
    const [head, ...rest] = walked.map((p) => p.value);
    if (profile === 'standard') assert.equal(head!.definedTerms.length, MAX_DEFINED_TERMS);
    assert.ok(rest.length > 0, `${profile}: more than one page`);
    assert.deepEqual(walked.flatMap((p) => p.value.definedTerms.map((t: Value) => t.term)), terms);
    assert.ok(walked.every((p) => p.value.definedTermsTotal === terms.length));
    assert.ok(rest.every((p) => !('caption' in p) && !('counts' in p)), 'later pages carry terms only');
    assert.equal(rest.at(-1)!.nextCursor, null);
    assert.match(head!.caption, /^<case-record>\n/);
  }
  const { value } = await call(overviewCtx({ profile: 'compact' }));
  assert.equal('nextCursor' in value, false, 'a summary whose terms all fit names no cursor');
});

test('splitEntry: a fitting entry comes back as it is; one list item too long is cut alone, its part flagged', () => {
  const fit = { ...FITS.standard, itemChars: 600 };
  const small = { id: 'x', list: [1, 2] };
  assert.equal(splitEntry(small, fit)[0], small);
  const entry = { id: 'e', title: 't', list: ['a'.repeat(100), 'b'.repeat(2000), 'c'.repeat(100)], box: { line: 'l', more: ['d'.repeat(300), 'e'.repeat(300)] } };
  const parts = splitEntry(entry, fit) as Value[];
  assert.ok(parts.every((p) => JSON.stringify(p).length <= 600));
  assert.deepEqual(parts.map((p) => p.truncated === true), parts.map((p) => JSON.stringify(p).includes('bbbb')));
  const joined = joinParts(parts)[0]!;
  assert.deepEqual(joined.list.map((s: string) => s[0]), ['a', 'b', 'c']);
  assert.deepEqual(joined.box, { line: 'l', more: entry.box.more });
  assert.deepEqual((splitEntry('z'.repeat(5000), fit)[0] as string).length, 2000 + ' [cut]'.length, 'no id: cut, as before');
  assert.equal(FITS.standard.entries, PAGE_ENTRIES);
});

test('splitEntry: a list item too long for a part alone is split one level down, its later fragments marked continues', () => {
  const fit = { ...FITS.standard, itemChars: 600 };
  const entry = { id: 'e', items: [{ id: 'i1', text: 't', proof: Array.from({ length: 10 }, (_, k) => String(k).repeat(100)) }, { id: 'i2', text: 'u', proof: [] }] };
  const parts = splitEntry(entry, fit) as Value[];
  assert.ok(parts.length > 2);
  assert.ok(parts.every((p) => JSON.stringify(p).length <= 600 && !('truncated' in p)), 'nothing is cut');
  const fragments = parts.flatMap((p) => p.items ?? []).filter((item: Value) => item.id === 'i1');
  assert.deepEqual(fragments.map((f: Value) => f.continues === true), fragments.map((_: Value, i: number) => i > 0));
  assert.deepEqual(joinParts(parts)[0], entry);
});
