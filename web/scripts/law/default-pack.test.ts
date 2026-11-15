// SPDX-License-Identifier: Apache-2.0
// The default law pack: every unit whole or a loud failure, and each site's rules followed. Invented text and a fake
// network: nothing here reaches a real site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isLawId, isOfficialLink } from '../../worker/law-cite.ts';
import { assertCitable, assertClean, assertWhole, createDefaultPack, sourceUrls, titled } from './default-pack.ts';
import { DEFAULT_PACK_UNITS, NEXT_PACK_UNITS, type PackUnit, withNextUnits } from './default-pack-units.ts';
import { cfrAnnualSection } from './cfr-annual.ts';

/** Every unit the definition holds: the defaults and the ones behind LEGALLAS_LAW_NEXT. */
const ALL_UNITS = [...DEFAULT_PACK_UNITS, ...NEXT_PACK_UNITS];
import { assertAllowed, RawCache } from './fetch.ts';
import { seedUnit } from './seed.ts';
import { allowedHosts, type LawPack } from './pack.ts';
import type { BuildOptions } from './build.ts';

const ACT_URL = 'https://www.govinfo.gov/content/pkg/COMPS-9001/uslm/COMPS-9001.xml';
const CFR_URL = 'https://www.govinfo.gov/bulkdata/ECFR/title-17/ECFR-title17.xml';
const ACT = `<statuteCompilation><meta><dc:title>FICTIONAL ACT</dc:title><currentThroughPublicLaw>119–99</currentThroughPublicLaw></meta><main>
<section identifier="/us/s1"><heading>first </heading><num>Sec. 1. </num><editorialNote role="uscRef">[99a] </editorialNote><content>First words.</content></section>
<section identifier="/us/s2"><heading>second </heading><num>Sec. 2. </num><editorialNote role="uscRef">[99b] </editorialNote><content>Second words.</content></section>
</main></statuteCompilation>`;
const CFR = `<DLPSTEXTCLASS><AMDDATE>Oct. 19, 2099 (fm)</AMDDATE><DIV5 N="900" TYPE="PART"><DIV8 N="§ 900.1" TYPE="SECTION"><HEAD>§ 900.1   Scope.</HEAD><P>Words.</P></DIV8><DIV8 N="§ 900.2" TYPE="SECTION"><HEAD>§ 900.2   Reach.</HEAD><P>More words.</P></DIV8></DIV5>
<DIV5 N="901" TYPE="PART"><DIV8 N="§ 901.1" TYPE="SECTION"><HEAD>§ 901.1   Other.</HEAD><P>Other words.</P></DIV8></DIV5></DLPSTEXTCLASS>`;

const ACT_UNIT: PackUnit = {
  id: 'us-fiction',
  title: 'Fictional Act',
  citation: '15 U.S.C. 99a',
  level: 'federal',
  layer: 'securities',
  paths: ['startup-forms'],
  link: 'https://www.govinfo.gov/content/pkg/COMPS-9001/pdf/COMPS-9001.pdf',
  source: { kind: 'compilation', pkg: 'COMPS-9001', act: 'Fictional Act', uscTitle: 15 },
  track: 'both',
  kind: 'statute',
  whole: { minSections: 2, sections: ['99a', '99b'] },
};
const RULES_UNIT: PackUnit = {
  ...ACT_UNIT,
  id: 'us-fiction-rules',
  title: 'Fictional rules',
  citation: '17 CFR Part 900',
  link: 'https://www.ecfr.gov/current/title-17/chapter-II/part-900',
  source: { kind: 'ecfr-parts', title: 17, parts: [900], rule: 'Fictional Rule' },
  kind: 'regulation',
  whole: { minSections: 2, sections: ['900.1', '900.2'] },
};
const OTHER_RULES_UNIT: PackUnit = { ...RULES_UNIT, id: 'us-fiction-other', title: 'Other rules', citation: '17 CFR Part 901', source: { kind: 'ecfr-parts', title: 17, parts: [901], rule: 'Other Rule' }, whole: { minSections: 1, sections: ['901.1'] } };
const { whole: _whole, ...ACT_WITHOUT_CHECK } = ACT_UNIT;
const CITED_UNIT: PackUnit = { ...ACT_WITHOUT_CHECK, id: 'us-fiction-cited', title: 'A cited act', citation: '99 U.S.C. 1', link: 'https://uscode.house.gov/us/usc/t99/s1/', source: { kind: 'cited' } };

interface Net {
  bodies: Record<string, string>;
  calls: string[];
}

function fakeNet(bodies: Record<string, string> = { [ACT_URL]: ACT, [CFR_URL]: CFR }): Net & { fetcher: typeof fetch } {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const body = bodies[url];
    return body === undefined ? new Response('not here', { status: 404 }) : new Response(body);
  }) as typeof fetch;
  return { bodies, calls, fetcher };
}

async function withPack(units: readonly PackUnit[], net: ReturnType<typeof fakeNet>, run: (pack: LawPack, cache: RawCache, options: BuildOptions) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'law-default-'));
  try {
    const pack = createDefaultPack(units);
    await run(pack, new RawCache(dir, net.fetcher, () => '2099-02-03', allowedHosts([pack]), 0), { packs: [pack] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const DE_CHAPTER = 'https://delcode.delaware.gov/title99/c018/index.html';
const DE_SC1 = 'https://delcode.delaware.gov/title99/c018/sc01/index.html';
const DE_SC2 = 'https://delcode.delaware.gov/title99/c018/sc02/index.html';
const DE_PAGE = (id: string) =>
  `<html><ul class="chaptersections"><li><a href="#${id}">§ ${id}</a></li></ul><div id="CodeBody"><div class="Section"><div class="SectionHead" id="${id}">§ ${id}. Fictional heading.</div><p class="subsection">(a) Invented words.</p>84 Del. Laws, c. 1;</div></div><footer>Help</footer></html>`;
const DE_INDEX = `<html><a href="../../title99/c018/sc01/index.html">I</a><a href="../../title99/c018/sc02/index.html">II</a><script>x</script>`;
const DE_UNIT: PackUnit = {
  ...ACT_UNIT,
  id: 'de-fiction',
  title: 'Fictional Delaware Act',
  citation: '99 Del. C. ch. 18',
  level: 'Delaware',
  link: DE_CHAPTER,
  source: { kind: 'delaware', title: 99, chapter: '018' },
  whole: { minSections: 2, sections: ['18-101', '18-201'] },
};

test('a Delaware chapter builds from every subchapter, each section linked to its own place', async () => {
  await withPack([DE_UNIT], fakeNet({ [DE_CHAPTER]: DE_INDEX, [DE_SC1]: DE_PAGE('18-101'), [DE_SC2]: DE_PAGE('18-201') }), async (pack, cache, options) => {
    const units = await pack.build(cache, options);
    assert.deepEqual(units.map((unit) => unit.cite), ['99 Del. C. § 18-101', '99 Del. C. § 18-201']);
    assert.equal(units[0]?.id, 'del-99-18-101');
    assert.equal(units[1]?.url, `${DE_SC2}#18-201`);
    assert.equal(units[0]?.title, 'Fictional heading (Fictional Delaware Act)');
    assert.match((await pack.report?.(cache))!.join('\n'), /built: 2 sections, amendments through volume 84 of the Delaware Laws/);
  });
});

test('a Delaware chapter missing a subchapter page fails whole', async () => {
  await withPack([DE_UNIT], fakeNet({ [DE_CHAPTER]: DE_INDEX, [DE_SC1]: DE_PAGE('18-101') }), async (pack, cache, options) => {
    await assert.rejects(pack.build(cache, options), /de-fiction: .*sc02\/index\.html answered "not found"/);
  });
});

const TITLE_URL = 'https://olls.info/crs/crs2026-title-99.docx';
const CRS_UNIT: PackUnit = {
  ...ACT_UNIT,
  id: 'co-fiction',
  title: 'Fictional Colorado Act',
  citation: 'C.R.S. 99-80-101',
  level: 'Colorado',
  link: 'https://olls.info/crs/crs2026-title-99.pdf',
  source: { kind: 'crs', title: 99, articles: ['80'] },
  whole: { minSections: 1, sections: ['99-80-101'] },
};

/** A minimal .docx: a zip holding one stored document.xml, enough for readDocx. */
function docx(paragraphs: readonly string[]): Buffer {
  const name = Buffer.from('word/document.xml');
  const data = Buffer.from(paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join(''));
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

test('a Colorado unit takes the newest edition that exists, and says it is unofficial with no annotations', async () => {
  const body = docx(['ARTICLE 80', '99-80-101. Short title. Fictional words.', 'Source: L. 90.', 'ANNOTATION', 'A case note.']);
  const fetcher = (async (input: string | URL | Request) => (String(input) === TITLE_URL ? new Response(body) : new Response('Page not found', { status: 200 }))) as typeof fetch;
  await withPack([CRS_UNIT], { bodies: {}, calls: [], fetcher }, async (pack, cache, options) => {
    const [unit] = await pack.build(cache, options);
    assert.equal(unit?.cite, 'C.R.S. § 99-80-101');
    assert.equal(unit?.title, 'Short title (Fictional Colorado Act)');
    assert.equal(unit?.url, 'https://olls.info/crs/crs2026-title-99.pdf');
    assert.match(unit?.source ?? '', /C\.R\.S\. 2026, uncertified and not the official statutes; case annotations left out/);
    assert.deepEqual(unit?.lines, ['Fictional words.']);
    assert.match((await pack.report?.(cache))!.join('\n'), /source https:\/\/olls\.info\/crs\/crs2026-title-99\.docx; fetched 2099-02-03/);
  });
});

test('a Colorado unit with no edition to download fails loudly', async () => {
  const fetcher = (async () => new Response('Page not found', { status: 200 })) as unknown as typeof fetch;
  await withPack([CRS_UNIT], { bodies: {}, calls: [], fetcher }, async (pack, cache, options) => {
    await assert.rejects(pack.build(cache, options), /no C\.R\.S\. edition of title 99 could be downloaded/);
  });
});

test('a Colorado unit taking whole parts keeps those parts of the article and no others', async () => {
  const body = docx(['ARTICLE 80', '99-80-101. Short title. Words of part 1.', '99-80-301. Charges. Words of part 3.', '99-80-302.5. Relief. More of part 3.', '99-80-901. Other. Words of part 9.']);
  const fetcher = (async (input: string | URL | Request) => (String(input) === TITLE_URL ? new Response(body) : new Response('Page not found', { status: 200 }))) as typeof fetch;
  const unit: PackUnit = { ...CRS_UNIT, source: { kind: 'crs', title: 99, articles: ['80'], parts: [3] }, whole: { minSections: 2, sections: ['99-80-301', '99-80-302.5'] } };
  await withPack([unit], { bodies: {}, calls: [], fetcher }, async (pack, cache, options) => {
    assert.deepEqual((await pack.build(cache, options)).map((built) => built.cite), ['C.R.S. § 99-80-301', 'C.R.S. § 99-80-302.5']);
  });
});

test('a Delaware unit naming a subchapter builds that subchapter alone, and one the chapter lacks fails', async () => {
  const net = fakeNet({ [DE_CHAPTER]: DE_INDEX, [DE_SC2]: DE_PAGE('18-201') });
  const unit: PackUnit = { ...DE_UNIT, source: { kind: 'delaware', title: 99, chapter: '018', subchapter: '02' }, whole: { minSections: 1, sections: ['18-201'] } };
  await withPack([unit], net, async (pack, cache, options) => {
    assert.deepEqual((await pack.build(cache, options)).map((built) => built.cite), ['99 Del. C. § 18-201']);
    assert.ok(!net.calls.includes(DE_SC1));
  });
  await withPack([{ ...unit, source: { ...unit.source, subchapter: '03' } as PackUnit['source'] }], net, async (pack, cache, options) => {
    await assert.rejects(pack.build(cache, options), /chapter 018 lists no subchapter 03/);
  });
});

const USC_PAGE = (section: string, credit = true) =>
  `<html><head><title>99 U.S.C. § ${section}</title></head><body><div id="notice-banner">The United States Code Online is current through Public Law 119-99 (October 22, 2099).</div><h3 class="section-head">§${section}. Fictional heading</h3><div class="statutory-body-container"><p class="statutory-body" id="a">(a)&nbsp;<em class="level-heading"> Widgets</em></p><p class="statutory-body-1em">Invented words.</p></div>${credit ? '<p class="source-credit" id="sourcecredit">(Added Pub. L. 1-1, Jan. 1, 2099.)</p>' : ''}<h4 class="note-head">Editorial Notes</h4><p>A note, not law.</p></body></html>`;
const USC_UNIT: PackUnit = {
  ...ACT_UNIT,
  id: 'us-fiction-code',
  title: 'Fictional code sections',
  citation: '99 U.S.C. 1, 7A',
  layer: 'other',
  link: 'https://uscode.house.gov/us/usc/t99/s1/',
  source: { kind: 'uscode', title: 99, sections: ['1', '7A'], name: 'Fictional Act' },
  whole: { minSections: 2, sections: ['1', '7A'] },
};

test('U.S. Code sections come from their own current pages, each named by its act, with no notes', async () => {
  const net = fakeNet({ 'https://uscode.house.gov/us/usc/t99/s1/': USC_PAGE('1'), 'https://uscode.house.gov/us/usc/t99/s7A/': USC_PAGE('7A') });
  await withPack([USC_UNIT], net, async (pack, cache, options) => {
    const units = await pack.build(cache, options);
    assert.deepEqual(units.map((unit) => unit.id), ['usc-99-1', 'usc-99-7a']);
    assert.equal(units[1]?.cite, '99 U.S.C. § 7A');
    assert.equal(units[1]?.title, 'Fictional heading (Fictional Act)');
    assert.equal(units[1]?.url, 'https://uscode.house.gov/us/usc/t99/s7A/');
    assert.deepEqual(units[1]?.lines, ['(a) Widgets', 'Invented words.']);
    assert.match(units[1]?.source ?? '', /Law Revision Counsel .*current through Public Law 119-99 \(October 22, 2099\)/);
  });
});

test('a U.S. Code page with no source credit may be cut short, so the unit fails', async () => {
  const net = fakeNet({ 'https://uscode.house.gov/us/usc/t99/s1/': USC_PAGE('1'), 'https://uscode.house.gov/us/usc/t99/s7A/': USC_PAGE('7A', false) });
  await withPack([USC_UNIT], net, async (pack, cache, options) => {
    await assert.rejects(pack.build(cache, options), /99 U\.S\.C\. 7A: the page has no source credit/);
  });
});

const REG_LINK = 'https://www.govinfo.gov/link/cfr/99/9?sectionnum=12-3&year=mostrecent&link-type=xml';
const REG_FILE = 'https://www.govinfo.gov/content/pkg/CFR-2099-title99-vol2/xml/CFR-2099-title99-vol2-sec9-12-3.xml';
// The annual edition's pretty-printed shape: a space past a multiple of four is the text's own.
const REG_GRANULE = [
  '<?xml version="1.0"?>',
  '<CFRGRANULE>',
  '    <FDSYS>',
  '        <CFRTITLE>99</CFRTITLE>',
  '        <DATE>2099-04-01</DATE>',
  '    </FDSYS>',
  '    <SECTION>',
  '        <SECTNO>§ 9.12-3</SECTNO>',
  '        <SUBJECT>Widget elections.</SUBJECT>',
  '        <P>',
  '            (a) ',
  '            <E T="03">Widgets</E>',
  '            \u2014(1) ',
  '            <E T="03">In general.</E>',
  '             An election is due within 2',
  '            <FR>1/2</FR>',
  '             months after the ',
  '            <PRTPAGE P="12"/>',
  '            transfer.',
  '        </P>',
  '        <GPOTABLE COLS="2">',
  '            <BOXHD>',
  '                <CHED H="1">Widget</CHED>',
  '                <CHED H="1">Due</CHED>',
  '            </BOXHD>',
  '            <ROW>',
  '                <ENT I="01">Cog</ENT>',
  '                <ENT/>',
  '            </ROW>',
  '        </GPOTABLE>',
  '        <EXAMPLE>',
  '            <HD SOURCE="HED">Example.</HD>',
  '            <P>Harbor Labs makes the election for Doe on day 30.</P>',
  '        </EXAMPLE>',
  '        <CITA>[T.D. 9999, 99 FR 1, Jan. 1, 2099]</CITA>',
  '    </SECTION>',
  '</CFRGRANULE>',
  '',
].join('\n');

test('C.F.R. sections come from the annual edition by section, read whole, each linked to its edition\'s PDF', async () => {
  const net = fakeNet({ [REG_FILE]: REG_GRANULE });
  // The link service answers with a redirect to the edition's file.
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) !== REG_LINK) return net.fetcher(input, init);
    net.calls.push(REG_LINK);
    return new Response(null, { status: 302, headers: { location: REG_FILE } });
  }) as typeof fetch;
  const unit: PackUnit = { ...ACT_UNIT, id: 'us-fiction-regs', citation: '99 CFR 9.12-3', layer: 'other', link: REG_LINK.replace('xml', 'pdf'), source: { kind: 'cfr-sections', title: 99, sections: ['9.12-3'], name: 'Fictional Reg.' }, kind: 'regulation', whole: { minSections: 1, sections: ['9.12-3'] } };
  assert.deepEqual(sourceUrls(unit), [REG_LINK]);
  await withPack([unit], { ...net, fetcher }, async (pack, cache, options) => {
    const [reg] = await pack.build(cache, options);
    assert.equal(reg?.id, 'cfr-99-9-12-3');
    assert.equal(reg?.title, 'Widget elections (Fictional Reg. § 9.12-3)');
    assert.equal(reg?.url, 'https://www.govinfo.gov/content/pkg/CFR-2099-title99-vol2/pdf/CFR-2099-title99-vol2-sec9-12-3.pdf');
    assert.deepEqual(reg?.lines, ['(a) Widgets\u2014(1) In general. An election is due within 2 1/2 months after the transfer.', 'Widget | Due', 'Cog | ', 'Example.', 'Harbor Labs makes the election for Doe on day 30.']);
    assert.match(reg?.source ?? '', /annual edition revised as of 2099-04-01, .*the edition's PDF is the official text, and later amendments are not in it$/);
    assert.ok(net.calls.includes(REG_LINK) && net.calls.includes(REG_FILE));
  });
  assert.throws(() => cfrAnnualSection(REG_GRANULE.replace('<E T="03">Widgets</E>', 'Widgets<SU>1</SU>'), 99, '9.12-3'), /uses <SU>/);
  assert.throws(() => cfrAnnualSection(REG_GRANULE.replace('<ENT I="01">Cog</ENT>', '<ENT I="01">Cog</ENT> Harbor Labs only'), 99, '9.12-3'), /table row outside any cell: "Harbor Labs only"/);
  assert.throws(() => cfrAnnualSection(REG_GRANULE, 99, '9.12-4'), /holds § 9\.12-3/);
  assert.throws(() => cfrAnnualSection(REG_GRANULE.slice(0, -20), 99, '9.12-3'), /cut short/);
});

test('a whole unit builds with its citation, source, reading link and date', async () => {
  await withPack([ACT_UNIT, RULES_UNIT], fakeNet(), async (pack, cache, options) => {
    const units = await pack.build(cache, options);
    assert.deepEqual(units.map((unit) => unit.cite), ['15 U.S.C. § 99a', '15 U.S.C. § 99b', '17 C.F.R. § 900.1', '17 C.F.R. § 900.2']);
    const [act] = units;
    assert.equal(act?.id, 'usc-15-99a');
    assert.equal(act?.title, 'First (Fictional Act § 1)');
    assert.equal(act?.retrieved, '2099-02-03');
    assert.match(act?.source ?? '', /not the official text, as amended through P\.L\. 119-99/);
    assert.equal(units[2]?.url, 'https://www.ecfr.gov/current/title-17/section-900.1');
    assert.equal(units[2]?.title, 'Scope (Fictional Rule 1)');
    assert.match(units[2]?.source ?? '', /amended through Oct\. 19, 2099/);
  });
});

test('the report lists every unit with its source and when it was fetched, stored or not', async () => {
  await withPack([ACT_UNIT, CITED_UNIT], fakeNet(), async (pack, cache, options) => {
    const before = (await pack.report?.(cache))!.join('\n');
    assert.match(before, /2 units, 1 stored whole and 1 cited only/);
    assert.match(before, /us-fiction: Fictional Act \(15 U\.S\.C\. 99a\)/);
    assert.match(before, /source https:\/\/www\.govinfo\.gov\/content\/pkg\/COMPS-9001\/uslm\/COMPS-9001\.xml; not fetched yet/);
    assert.match(before, /us-fiction-cited: A cited act \(99 U\.S\.C\. 1\)\n\s+cited only, not stored; https:\/\/uscode\.house\.gov\/us\/usc\/t99\/s1\//);
    await pack.build(cache, options);
    const after = (await pack.report?.(cache))!.join('\n');
    assert.match(after, /COMPS-9001\.xml; fetched 2099-02-03/);
    assert.match(after, /built: 2 sections, as amended through P\.L\. 119-99/);
  });
});

test('listing the pack downloads nothing', async () => {
  const net = fakeNet();
  await withPack([ACT_UNIT, RULES_UNIT, CITED_UNIT], net, async (pack, cache) => {
    await pack.report?.(cache);
    assert.deepEqual(net.calls, []);
  });
});

test('an act missing a section it must hold fails, and no part of it is built', async () => {
  const net = fakeNet({ [ACT_URL]: ACT.replace(/<section identifier="\/us\/s2">[\s\S]*?<\/section>/, '') });
  await withPack([ACT_UNIT], net, async (pack, cache, options) => {
    await assert.rejects(pack.build(cache, options), /us-fiction \(Fictional Act\) came back without 99b; refusing a partial act/);
  });
});

test('an act with too few sections fails even when the named ones are there', () => {
  assert.throws(() => assertWhole(ACT_UNIT, { minSections: 3, sections: ['99a'] }, ['99a', '99b']), /came back with 2 sections and a whole one has at least 3; refusing a partial act/);
  assert.doesNotThrow(() => assertWhole(ACT_UNIT, { minSections: 2, sections: ['99a'] }, ['99a', '99b']));
});

test('a file cut short fails the unit', async () => {
  await withPack([ACT_UNIT], fakeNet({ [ACT_URL]: ACT.slice(0, -40) }), async (pack, cache, options) => {
    await assert.rejects(pack.build(cache, options), /us-fiction: the compilation is cut short/);
  });
});

test('every failing unit is named at once and nothing comes back, even when others built', async () => {
  const net = fakeNet({ [CFR_URL]: CFR });
  await withPack([ACT_UNIT, RULES_UNIT, { ...OTHER_RULES_UNIT, source: { kind: 'ecfr-parts', title: 17, parts: [902], rule: 'Other' } }], net, async (pack, cache, options) => {
    await assert.rejects(pack.build(cache, options), (error: Error) => {
      assert.match(error.message, /^2 law pack units failed, so nothing was built:/);
      assert.match(error.message, /us-fiction: .*answered "not found"/);
      assert.match(error.message, /us-fiction-other: eCFR part 902 is not in the title file/);
      assert.doesNotMatch(error.message, /us-fiction-rules/);
      return true;
    });
  });
});

test('a server error fails the unit rather than passing for an empty act', async () => {
  const fetcher = (async (input: string | URL | Request) => (String(input).endsWith('robots.txt') ? new Response('', { status: 404 }) : new Response('busy', { status: 503 }))) as typeof fetch;
  await withPack([ACT_UNIT], { bodies: {}, calls: [], fetcher }, async (pack, cache, options) => {
    await assert.rejects(pack.build(cache, options), /us-fiction: fetch www\.govinfo\.gov failed: HTTP 503/);
  });
});

test('a path the site\'s robots file disallows is never fetched', async () => {
  const net = fakeNet({ [ACT_URL]: ACT, 'https://www.govinfo.gov/robots.txt': 'User-agent: *\nDisallow: /content/\n' });
  await withPack([ACT_UNIT], net, async (pack, cache, options) => {
    await assert.rejects(pack.build(cache, options), /www\.govinfo\.gov's robots file disallows \/content\/pkg\/COMPS-9001\/uslm\/COMPS-9001\.xml/);
    assert.deepEqual(net.calls, ['https://www.govinfo.gov/robots.txt']);
  });
});

test('the title file is downloaded once however many units read it, and a rebuild is offline', async () => {
  const net = fakeNet();
  await withPack([RULES_UNIT, OTHER_RULES_UNIT], net, async (pack, cache, options) => {
    await pack.build(cache, options);
    assert.deepEqual(net.calls, ['https://www.govinfo.gov/robots.txt', CFR_URL]);
    net.calls.length = 0;
    await createDefaultPack([RULES_UNIT, OTHER_RULES_UNIT]).build(cache, options);
    assert.deepEqual(net.calls, []);
  });
});

test('--only builds the named units alone, and a name not in the pack is refused', async () => {
  const net = fakeNet();
  await withPack([ACT_UNIT, RULES_UNIT], net, async (pack, cache, options) => {
    const units = await pack.build(cache, { ...options, only: new Set(['us-fiction']) });
    assert.deepEqual(units.map((unit) => unit.cite), ['15 U.S.C. § 99a', '15 U.S.C. § 99b']);
    assert.ok(!net.calls.includes(CFR_URL));
    await assert.rejects(pack.build(cache, { ...options, only: new Set(['us-nothing']) }), /no such unit in the default law pack: us-nothing/);
  });
});

test('a unit the Worker\'s catalog would quietly drop stops the build instead', () => {
  const good = { id: 'usc-15-99a', cite: '15 U.S.C. § 99a', title: 'First', url: 'https://www.govinfo.gov/a.pdf', source: 'A source' };
  assert.doesNotThrow(() => assertCitable(good));
  assert.throws(() => assertCitable({ ...good, url: 'https://example.com/a' }), /isn't on the library's list of official hosts/);
  assert.throws(() => assertCitable({ ...good, id: 'Bad Id' }), /can't cite/);
  assert.throws(() => assertCitable({ ...good, title: 'x'.repeat(401) }), /over the catalog's 400 characters/);
});

test('a heading too long for the catalog is cut in the title and kept whole in the text', () => {
  assert.deepEqual(titled('Scope', 'Rule 1', ['Words.']), { title: 'Scope (Rule 1)', lines: ['Words.'] });
  const long = `Form X ${'for registering a widget '.repeat(30)}`.trim();
  const { title, lines } = titled(long, 'Rule 1', ['Words.']);
  assert.ok(title.length <= 400 && title.endsWith('... (Rule 1)'));
  assert.deepEqual(lines, [long, 'Words.']);
});

test('the shipped definition: stable ids, whole checks on every stored unit, official links and allowed hosts', () => {
  const ids = ALL_UNITS.map((unit) => unit.id);
  assert.equal(new Set(ids).size, ids.length);
  const pack = createDefaultPack();
  const hosts = allowedHosts([pack]);
  for (const unit of ALL_UNITS) {
    assert.ok(isLawId(unit.id) || /^[a-z0-9-]+$/.test(unit.id), unit.id);
    assert.ok(unit.link.startsWith('https://'), unit.id);
    if (unit.source.kind === 'cited') {
      assert.equal(unit.whole, undefined, unit.id);
      continue;
    }
    // Not built until its reader has been checked on a real copy.
    if (unit.source.kind === 'person' && !unit.source.parser) continue;
    assert.ok(unit.whole && unit.whole.sections.length > 0, `${unit.id} has no whole check`);
    assert.ok(isOfficialLink(unit.link), `${unit.id} links to ${unit.link}`);
    for (const url of sourceUrls(unit)) assert.equal(assertAllowed(url, hosts).protocol, 'https:');
  }
});

test('every unit in the plan is in the pack: 99, 72 stored whole and 27 cited only', () => {
  const plan = planUnits();
  assert.deepEqual([...plan.keys()].filter((id) => !plan.get(id)!.next && !DEFAULT_PACK_UNITS.some((unit) => unit.id === id)), []);
  assert.equal(DEFAULT_PACK_UNITS.length, 99);
  assert.equal(DEFAULT_PACK_UNITS.filter((unit) => unit.source.kind === 'cited').length, 27);
});

test('a room built with the defaults holds the 14 units opened on 2026-11-02, and the cited de-income-tax is retired', () => {
  const ids = new Set(DEFAULT_PACK_UNITS.map((unit) => unit.id));
  const opened = [
    'co-anti-discrimination', 'co-tax-code', 'co-business-property-tax', 'co-unemployment-employer', 'de-corporate-income-tax', 'de-unclaimed-property', 'us-tax-code',
    'us-copyright-basics', 'us-patent-basics', 'us-trademark-basics', 'us-civil-rules', 'us-evidence-rules', 'de-chancery-court-rules', 'co-civil-procedure',
  ];
  assert.deepEqual(opened.filter((id) => !ids.has(id)), []);
  assert.ok(!ids.has('de-income-tax'));
  assert.ok(!planUnits().has('de-income-tax'));
});

test('each Colorado tax need has a plan row, and the rows name the 2026 acts that changed title 39', () => {
  const toml = readFileSync(new URL('../../../docs/design/law-pack-plan.toml', import.meta.url), 'utf8');
  const needs = JSON.parse(readFileSync(new URL('../../../quality-speed/pages/colorado-tax-law/needs.json', import.meta.url), 'utf8')) as { needs: { id: string }[] };
  const rows = new Set([...toml.matchAll(/^need = "colorado-tax-law\.(.+)"$/gm)].map((match) => match[1]));
  assert.deepEqual(needs.needs.map((need) => need.id).filter((id) => !rows.has(id)), []);
  for (const act of ['HB 26-1223', 'SB 26-116', 'HB 26-1295']) assert.ok(toml.includes(act), act);
});

test('the units behind the flag are exactly the plan\'s flag = "next" ones, and a room without the flag builds none of them', () => {
  const plan = planUnits();
  assert.deepEqual(NEXT_PACK_UNITS.map((unit) => unit.id), [...plan.keys()].filter((id) => plan.get(id)!.next));
  assert.ok(NEXT_PACK_UNITS.every((unit) => !DEFAULT_PACK_UNITS.includes(unit)));
  assert.deepEqual(withNextUnits().map((unit) => unit.id).sort(), ALL_UNITS.map((unit) => unit.id).sort());
});

const PERSON_UNIT: PackUnit = {
  ...ACT_UNIT,
  id: 'co-fiction-rules',
  title: 'Fictional state rules',
  citation: '3 CCR 704-1',
  level: 'Colorado',
  link: 'https://www.coloradosos.gov/CCR/DisplayRule.do?id=1',
  source: { kind: 'person', address: 'https://www.coloradosos.gov/CCR/Fiction.pdf', steps: 'A person downloads it.', parser: 'colorado-rules' },
  whole: { minSections: 1, sections: ['51-1.1'] },
};

const CDI_URL = 'https://www.sec.gov/rules-regulations/staff-guidance/corporation-finance-interpretations/securities-act-rules';
const CDI_PAGE = `<html><h2>Last Update: October 15, 2099</h2><h2>QUESTIONS AND ANSWERS OF GENERAL APPLICABILITY</h2><h3 class="rule-title">Section 110. Rule 134 — Widget Notices</h3><h4><a id="110-01"></a>Question 110.01</h4><p>Words.</p><h2>INTERPRETIVE RESPONSES REGARDING PARTICULAR SITUATIONS</h2><h3>Section 510. Rule 134 — Widget Notices</h3><p>510.01 More words.</p><div class="date-modified"></div></html>`;
const CDI_UNIT: PackUnit = {
  ...ACT_UNIT,
  id: 'us-fiction-staff',
  title: 'Fictional staff views',
  citation: 'CFI',
  link: CDI_URL,
  source: { kind: 'sec-interpretations' },
  track: 'regulator',
  kind: 'guidance',
  whole: { minSections: 2, sections: ['110.01', '510.01'] },
};

async function withContact(env: NodeJS.ProcessEnv, net: ReturnType<typeof fakeNet>, run: (pack: LawPack, cache: RawCache, options: BuildOptions) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'law-sec-'));
  try {
    const pack = createDefaultPack([CDI_UNIT, ACT_UNIT], env);
    await run(pack, new RawCache(dir, net.fetcher, () => '2099-02-03', allowedHosts([pack]), 0), { packs: [pack] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('the SEC contact is required: without it a run stops before any download', async () => {
  const net = fakeNet({ [CDI_URL]: CDI_PAGE, [ACT_URL]: ACT });
  await withContact({}, net, async (pack, cache, options) => {
    await assert.rejects(pack.build(cache, options), /LEGALLAS_LAW_CONTACT must name a company and an email/);
    assert.deepEqual(net.calls, []);
    // Listing needs no contact, and a run that leaves out the SEC units doesn't either.
    assert.ok((await pack.report?.(cache))?.length);
    const units = await pack.build(cache, { ...options, only: new Set(['us-fiction']) });
    assert.equal(units.length, 2);
  });
});

test('only sec.gov hears the contact, and interpretations are labelled staff views', async () => {
  const agents = new Map<string, string>();
  const bodies: Record<string, string> = { [CDI_URL]: CDI_PAGE, [ACT_URL]: ACT };
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    agents.set(new URL(url).hostname, new Headers(init?.headers).get('User-Agent') ?? '');
    return bodies[url] === undefined ? new Response('', { status: 404 }) : new Response(bodies[url]);
  }) as typeof fetch;
  await withContact({ LEGALLAS_LAW_CONTACT: 'Example Company legal@example.com' }, { bodies, calls: [], fetcher }, async (pack, cache, options) => {
    const units = await pack.build(cache, options);
    const staff = units.filter((unit) => unit.kind === 'guidance');
    assert.deepEqual(staff.map((unit) => unit.cite), ['SEC CFI, Securities Act Rules, Question 110.01', 'SEC CFI, Securities Act Rules, Interpretive Response 510.01']);
    assert.equal(staff[0]?.title, 'Rule 134 — Widget Notices (SEC staff view, not a rule)');
    assert.equal(staff[0]?.url, `${CDI_URL}#110-01`);
    assert.equal(staff[0]?.track, 'regulator');
    assert.match(staff[0]?.source ?? '', /staff views, not rules; page last updated October 15, 2099/);
    assert.equal(agents.get('www.sec.gov'), 'Example Company legal@example.com');
    assert.ok(!agents.get('www.govinfo.gov')?.includes('example.com'), 'told another site the contact');
  });
});

test('an entity no parser decoded stops the build, and a rule that names a tag doesn\'t', () => {
  assert.doesNotThrow(() => assertClean({ cite: 'x', lines: ['A price under $5 < $10 & more; AT&T is fine.', 'Mark changes with the <R> and </R> tags.'] }));
  assert.throws(() => assertClean({ cite: 'x', lines: ['Words&rsquo;s entity.'] }), /x still holds an undecoded entity/);
  assert.throws(() => assertClean({ cite: 'x', lines: ['A numeric &#8217; one.'] }), /still holds an undecoded entity/);
});

test('a unit a person must download waits, loudly, and the site is never contacted', async () => {
  const net = fakeNet();
  await withPack([PERSON_UNIT, ACT_UNIT], net, async (pack, cache, options) => {
    const units = await pack.build(cache, options);
    assert.ok(units.every((unit) => !unit.cite.includes('CCR')));
    assert.ok(net.calls.every((url) => !url.includes('coloradosos')), 'contacted the barred site');
    const report = (await pack.report?.(cache))!.join('\n');
    assert.match(report, /WAITING for a person: co-fiction-rules\. The library has none of their text until then\./);
    assert.match(report, /WAITING: A person downloads it\./);
  });
});

test('--refresh never downloads a person\'s copy either', async () => {
  const net = fakeNet();
  await withPack([PERSON_UNIT], net, async (pack, cache, options) => {
    await pack.build(cache, { ...options, refresh: true });
    assert.ok(net.calls.every((url) => !url.includes('coloradosos')));
  });
});

test('seeding takes a PDF for a unit a person downloads, and nothing else', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'law-seed-'));
  try {
    const pack = createDefaultPack();
    const cache = new RawCache(dir, fakeNet().fetcher, () => '2099-02-03', allowedHosts([pack]));
    const pdf = Buffer.from('%PDF-1.7 fictional');
    const unchecked: PackUnit = { ...PERSON_UNIT, id: 'de-fiction-rules', source: { ...PERSON_UNIT.source, parser: null } as PackUnit['source'] };
    const units = [...DEFAULT_PACK_UNITS, PERSON_UNIT, unchecked];
    await assert.rejects(seedUnit('us-ica', pdf, cache, '2099-02-03', units), /not a default law pack unit a person downloads/);
    await assert.rejects(seedUnit('co-securities-rules', pdf, cache, '2099-02-03'), /not a default law pack unit a person downloads/, 'cited only since 2026-11-07');
    await assert.rejects(seedUnit('co-fiction-rules', Buffer.from('<html>a saved page</html>'), cache, '2099-02-03', units), /isn't a PDF/);
    await assert.rejects(seedUnit('de-fiction-rules', pdf, cache, '2099-02-03', units), /no copy of it has been checked/);
    assert.match(await seedUnit('co-fiction-rules', pdf, cache, '2099-02-03', units), /Seeded co-fiction-rules \(downloaded 2099-02-03\)/);
    assert.ok(PERSON_UNIT.source.kind === 'person' && (await cache.peek(PERSON_UNIT.source.address))?.retrieved === '2099-02-03');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Each unit's `ship` status in the plan. */
function planShip(): Map<string, string> {
  const toml = readFileSync(new URL('../../../docs/design/law-pack-plan.toml', import.meta.url), 'utf8');
  return new Map(toml.split(/^\[\[unit\]\]$/m).slice(1).map((block) => [/^id = "(.*)"$/m.exec(block)?.[1] ?? '', /^ship = "(.*)"$/m.exec(block)?.[1] ?? '']));
}

test('the ship status holds: a unit that can\'t ship is downloaded by the install, or waits for its person, and is never bundled', () => {
  const ship = planShip();
  const allowed: Record<string, readonly PackUnit['source']['kind'][]> = {
    'after-statement': ['crs'],
    'after-counsel': ['delaware', 'person'],
    'after-permission': ['person'],
    'cite-only': ['cited'],
    bundle: ['compilation', 'ecfr-parts', 'sec-interpretations', 'form-adv', 'form-d', 'uscode', 'cfr-sections', 'uscourts-rules'],
  };
  for (const unit of ALL_UNITS) {
    const status = ship.get(unit.id) ?? '';
    assert.ok(allowed[status]?.includes(unit.source.kind), `${unit.id} is ${status} and its source is ${unit.source.kind}`);
  }
});

test('no law text sits in the builder\'s folder: only code, and no code file large enough to hide an act', () => {
  const folder = new URL('./', import.meta.url);
  for (const name of readdirSync(folder)) {
    assert.ok(/\.(?:ts|json)$/.test(name), `${name} isn't code`);
    assert.ok(statSync(new URL(name, folder)).size < 100_000, `${name} is large enough to hold law text`);
  }
});

test('no stored unit reads the eCFR path that site\'s robots file disallows', () => {
  for (const url of ALL_UNITS.flatMap(sourceUrls)) assert.ok(!url.includes('/api/versioner/v1/full/'), url);
});

test('the Exchange Act and its rules, the two largest, upload after every other stored unit', () => {
  for (const units of [DEFAULT_PACK_UNITS, withNextUnits()]) {
    const stored = units.filter((unit) => unit.source.kind !== 'cited').map((unit) => unit.id);
    assert.deepEqual(stored.slice(-2), ['us-exchange-act', 'us-sec-part-240']);
  }
});

/** The [[unit]] tables of the plan: just the plain fields this test compares. */
function planUnits(): Map<string, { title: string; citation: string; take: string; paths: string[]; next: boolean }> {
  const toml = readFileSync(new URL('../../../docs/design/law-pack-plan.toml', import.meta.url), 'utf8');
  const units = new Map<string, { title: string; citation: string; take: string; paths: string[]; next: boolean }>();
  for (const block of toml.split(/^\[\[unit\]\]$/m).slice(1)) {
    const field = (name: string) => new RegExp(`^${name} = "(.*)"$`, 'm').exec(block)?.[1] ?? '';
    const paths = /^paths = \[(.*)\]$/m.exec(block)?.[1] ?? '';
    units.set(field('id'), { title: field('title'), citation: field('citation'), take: field('take'), paths: [...paths.matchAll(/"([^"]+)"/g)].map((match) => match[1]!), next: field('flag') === 'next' });
  }
  return units;
}

test('each unit says what the plan says about it', () => {
  const plan = planUnits();
  for (const unit of ALL_UNITS) {
    const planned = plan.get(unit.id);
    assert.ok(planned, `${unit.id} isn't in the plan`);
    assert.deepEqual(
      { title: unit.title, citation: unit.citation, paths: [...unit.paths], take: unit.source.kind === 'cited' ? 'cite-only' : 'whole' },
      { title: planned.title, citation: planned.citation, paths: planned.paths, take: planned.take },
      unit.id,
    );
  }
});

test('the court rule units link where their sites now live, (#337)', () => {
  const link = (id: string) => ALL_UNITS.find((unit) => unit.id === id)?.link;
  assert.equal(link('co-civil-rules'), 'https://www.coloradojudicial.gov/');
  assert.equal(link('us-preservation'), 'https://uscode.house.gov/us/usc/t18/s1512/');
  assert.ok(isOfficialLink(link('co-civil-rules')!), 'the bare host was not an official link; www. is');
  for (const id of ['d-colo-local-rules', 'd-del-local-rules']) assert.ok(isOfficialLink(link(id)!), id);
});
