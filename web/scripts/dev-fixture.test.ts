// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { caseGuardPattern } from './case-guard.ts';
import { configuredControlPrefix } from './config.ts';
import { citedLines, documentPages, pagesNeeded, pathById } from './dev-fixture-text.ts';
import {
  assertScratchFolder, catalogCsv, defaultDevRoot, fixtureFiles, loadFixtureInputs, MARKER, parseFixtureArgs, REPO_ROOT, writeFixture,
} from './dev-fixture.ts';
import { LINES_PER_PAGE, pdfBytes, pdfString, pngBytes, wrapLine, xlsxBytes } from './dev-pdf.ts';
import { CATALOG_REL, parseCatalog } from './matter/catalog.ts';

async function pdfText(bytes: Buffer): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join('\n'));
  }
  await task.destroy();
  return pages;
}

test('pdfBytes writes a valid xref: every offset lands on its object and startxref on the table', () => {
  const pdf = pdfBytes([['One'], ['Two (2)'], ['Three']]).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4\n'));
  const xref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)?.[1]);
  assert.equal(pdf.slice(xref, xref + 4), 'xref');
  const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.equal(offsets.length, 3 + 2 * 3);
  offsets.forEach((offset, i) => assert.ok(pdf.startsWith(`${i + 1} 0 obj\n`, offset), `object ${i + 1}`));
  assert.match(pdf, /\/Count 3 /);
  assert.throws(() => pdfBytes([]), /at least one page/);
});

test('pdf.js opens the PDF and reads each page text layer, escapes included', async () => {
  const pages = await pdfText(pdfBytes([['Doe v. Harbor Labs (draft) \\ final', 'Second line'], ['Page two phrase']]));
  assert.equal(pages.length, 2);
  assert.match(pages[0], /Doe v\. Harbor Labs \(draft\) \\ final/);
  assert.match(pages[0], /Second line/);
  assert.match(pages[1], /Page two phrase/);
});

test('pdfString keeps printable ASCII and escapes the PDF delimiters', () => {
  assert.equal(pdfString('a(b)c\\d'), 'a\\(b\\)c\\\\d');
  assert.equal(pdfString('café\tdone'), 'cafe done');
});

test('wrapLine wraps on words, splits overlong words, and keeps an empty line', () => {
  assert.deepEqual(wrapLine('one two three four', 9), ['one two', 'three', 'four']);
  assert.deepEqual(wrapLine('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(wrapLine(''), ['']);
  assert.ok(LINES_PER_PAGE > 30);
});

test('pngBytes writes a PNG signature, an IHDR of the right size and valid chunk CRCs', () => {
  const png = pngBytes(4, 2, ['000000', 'FFFFFF']);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.toString('latin1', 12, 16), 'IHDR');
  assert.equal(png.readUInt32BE(16), 4);
  assert.equal(png.readUInt32BE(20), 2);
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    const body = png.subarray(at + 4, at + 8 + length);
    assert.equal(png.readUInt32BE(at + 8 + length), crc32(body) >>> 0);
    at += 12 + length;
  }
});

test('xlsxBytes is a stored zip with the five workbook parts and matching CRCs', () => {
  const zip = xlsxBytes([['a', 'b & <c>']]);
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  assert.equal(zip.readUInt16LE(end + 10), 5);
  const names: string[] = [];
  for (let at = 0; zip.readUInt32LE(at) === 0x04034b50;) {
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    names.push(zip.toString('utf8', at + 30, at + 30 + nameLength));
    const data = zip.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
    assert.equal(zip.readUInt32LE(at + 14), crc32(data) >>> 0);
    at += 30 + nameLength + size;
  }
  assert.deepEqual(names, ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml']);
  assert.match(zip.toString('utf8'), /b &#38; &#60;c&#62;/);
});

test('every cited page carries the citing entry, and documents are as long as their last cite', async () => {
  const inputs = await loadFixtureInputs();
  const ids = pathById(inputs.docIds);
  const cited = citedLines(inputs.matter, ids);
  const event = inputs.matter.events.find((e) => e.cites.some((c) => (c.page ?? 1) > 1)) ?? inputs.matter.events[0];
  const cite = event.cites[0];
  const docPath = ids.get(cite.doc) ?? '';
  assert.ok(cited.get(docPath)?.get(cite.page ?? 1)?.includes(/[.!?]$/.test(event.title) ? event.title : `${event.title}.`));
  const pages = documentPages(docPath, cited.get(docPath), null);
  assert.equal(pages.length, pagesNeeded(cited.get(docPath)));
  assert.ok(pages[(cite.page ?? 1) - 1].some((line) => line.startsWith(event.title)));
  // Violation steps and track proof notes land on their cited pages too.
  const step = inputs.matter.violations.flatMap((v) => v.steps).find((s) => s.moves.length > 0)!;
  assert.ok(cited.get(ids.get(step.cites[0].doc) ?? '')?.get(step.cites[0].page ?? 1)?.includes(`${step.label}.`), step.id);
  const gap = inputs.matter.tracks.flatMap((t) => t.points.flatMap((p) => p.proof)).find((p) => p.strength === 'gap')!;
  assert.ok(cited.get(ids.get(gap.cite.doc) ?? '')?.get(gap.cite.page ?? 1)?.includes(gap.note!), 'a gap note');
  assert.equal(pagesNeeded(undefined), 2);
  assert.equal(pagesNeeded(new Map([[88, ['x']]])), 88);
});

test('fixtureFiles covers every doc-ids path and the extra kinds, deterministically', async () => {
  const inputs = await loadFixtureInputs();
  const files = fixtureFiles(inputs);
  const rels = files.map((f) => f.rel);
  for (const docPath of Object.keys(inputs.docIds)) assert.ok(rels.includes(docPath), docPath);
  for (const rel of ['CLAUDE.md', CATALOG_REL]) assert.ok(rels.includes(rel), rel);
  for (const ext of ['.pdf', '.xlsx', '.md', '.csv', '.png', '.xml']) assert.ok(rels.some((r) => r.endsWith(ext)), ext);
  assert.ok(rels.some((r) => r.split('/')[0].includes('PRIVILEGED')));
  assert.ok(files.length >= 40 && files.length <= 60);
  assert.ok(rels.every((r) => /^(?:\d\d-[A-Za-z-]+\/)?[\w.-]+$/.test(r)), 'plain ASCII paths');
  const again = fixtureFiles(inputs);
  assert.ok(files.every((f, i) => f.bytes.equals(again[i].bytes)), 'same bytes every run');
  const all = Buffer.concat(files.map((f) => f.bytes)).toString('latin1');
  // The room's own control prefix (its gitignored config) and matter words (its case-data guard), where the checkout
  // has them, never appear in the fictional fixture. assert.ok, so a failure never prints the words.
  const prefix = configuredControlPrefix();
  assert.ok(!prefix || !new RegExp(`\\b${prefix}-[0-9]`).test(all), 'the fixture carries the room\'s own control prefix');
  const guard = caseGuardPattern();
  assert.ok(!guard || !guard.test(all), 'the fixture names the room\'s matter (see its case-data guard)');
});

test('the catalog parses with the matter build and marks work product privileged', async () => {
  const inputs = await loadFixtureInputs();
  const files = fixtureFiles(inputs);
  const csv = files.find((f) => f.rel === CATALOG_REL)?.bytes.toString('utf8') ?? '';
  assert.equal(csv, catalogCsv(inputs, files));
  const catalog = parseCatalog(csv, '/fixture');
  assert.equal(catalog.rows, Object.keys(inputs.matter.docs).length);
  assert.equal(catalog.docs.get('10-Lawyer-Analysis/Damages-Model__WP__20130319.xlsx')?.privileged, true);
  assert.equal(catalog.docs.get('04-Letters/Email__20110518__Richard-Roe__Vesting-terms.pdf')?.privileged, false);
});

test('writeFixture writes once, then leaves unchanged files alone and prunes what the plan dropped', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'f9-fixture-'));
  const out = path.join(base, 'source');
  try {
    const files = [{ rel: 'a/one.md', bytes: Buffer.from('one') }, { rel: 'two.md', bytes: Buffer.from('two') }];
    assert.deepEqual(await writeFixture(out, files), { written: 2, unchanged: 0, removed: 0 });
    assert.deepEqual(await writeFixture(out, files), { written: 0, unchanged: 2, removed: 0 });
    assert.deepEqual(await writeFixture(out, files.slice(1)), { written: 0, unchanged: 1, removed: 1 });
    assert.equal(await readFile(path.join(out, MARKER), 'utf8').then(() => true), true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('assertScratchFolder refuses the repo, relative paths and folders it did not make', async () => {
  await assert.rejects(assertScratchFolder(path.join(REPO_ROOT, 'tmp-fixture')), /inside the repository/);
  await assert.rejects(assertScratchFolder('relative/dir'), /absolute/);
  const base = await mkdtemp(path.join(tmpdir(), 'f9-guard-'));
  try {
    await writeFile(path.join(base, 'someone-elses.txt'), 'x');
    await assert.rejects(assertScratchFolder(base), /not empty/);
    await mkdir(path.join(base, 'checkout', '.git'), { recursive: true });
    await assert.rejects(assertScratchFolder(path.join(base, 'checkout', 'sub')), /git checkout/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('the default fixture folder is per worktree, under the temp dir; --out overrides it', () => {
  assert.notEqual(defaultDevRoot('/a/web', '/tmp'), defaultDevRoot('/b/web', '/tmp'));
  assert.match(defaultDevRoot('/a/web', '/tmp'), /^\/tmp\/legallas-dev\/[0-9a-f]{10}$/);
  assert.deepEqual(parseFixtureArgs([], '/x'), { out: '/x' });
  assert.deepEqual(parseFixtureArgs(['--out', '/y/z']), { out: '/y/z' });
  assert.throws(() => parseFixtureArgs(['--remote']), /usage/);
});
