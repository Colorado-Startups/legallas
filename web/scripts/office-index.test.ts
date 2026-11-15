// SPDX-License-Identifier: Apache-2.0
// Office documents and email in the index: the readers (office.ts, ooxml.ts, src/scripts/eml.ts), their render
// versions, and the rule that office files under a privileged path segment stay download-only. Every fixture is
// made here from fictional text (textutil for Word, RTF and OpenDocument; zip for PowerPoint and Excel parts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { checkIndex, failureCode } from './checkindex.ts';
import { diffSync } from './diff.ts';
import {
  directTextPages, EMAIL_RENDER_VERSION, indexSource, isPrivilegedOffice, IWORK_RENDER_VERSION, OFFICE_RENDER_VERSION, RENDER_VERSION, renderVersion,
} from './extract.ts';
import { indexWork, type IndexJob } from './indexjob.ts';
import { buildParts } from './indexparts.ts';
import type { SnapshotFile } from './snapshot.ts';

const run = promisify(execFile);
/** textutil ships with macOS only; the tests that make Word, RTF and OpenDocument fixtures with it skip elsewhere (Linux CI). */
const TEXTUTIL = existsSync('/usr/bin/textutil');
const TEXT = 'Doe v. Harbor Labs\n\nDraft reminder letter about the unpaid spring invoices.\n\nSigned, Jane Doe';

async function inTemp(work: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-office-'));
  try {
    await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Writes `parts` (archive path -> XML) under a folder and zips it as `out`, links stored as links. */
async function zipParts(dir: string, out: string, parts: Record<string, string>): Promise<string> {
  const root = path.join(dir, `${path.basename(out)}.parts`);
  for (const [name, xml] of Object.entries(parts)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), xml);
  }
  await run('/usr/bin/zip', ['-q', '-X', '-r', '-y', path.join(dir, out), '.'], { cwd: root });
  return path.join(dir, out);
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = (items: [string, string, string][]) =>
  `<Relationships>${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
const para = (text: string) => `<a:p><a:pPr/><a:r><a:t>${text}</a:t></a:r></a:p>`;

test('Word, RTF and OpenDocument text are read by textutil as one page', { skip: !TEXTUTIL && 'textutil is macOS only' }, async () => {
  await inTemp(async (dir) => {
    await writeFile(path.join(dir, 'source.txt'), TEXT);
    for (const format of ['docx', 'doc', 'rtf', 'odt']) {
      const file = path.join(dir, `000123.${format}`);
      await run('/usr/bin/textutil', ['-convert', format, '-output', file, path.join(dir, 'source.txt')]);
      assert.deepEqual(await directTextPages(file, `Draft Reminder.${format.toUpperCase()}`), [{ n: 1, text: TEXT, ocr: false, rendered: true }], format);
    }
  });
});

test('a file that is not what its extension says fails with a short code and no file name', async () => {
  await inTemp(async (dir) => {
    const file = path.join(dir, '000124.doc');
    await writeFile(file, '<html><body><p>Not Word <img src="https://example.test/x.png"></p></body></html>');
    const error = await directTextPages(file, 'Secret Name.doc').then(() => assert.fail('expected a failure'), (caught: unknown) => caught);
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'office text failed: unreadable');
    assert.equal(failureCode(error), 'unreadable');
    const zip = path.join(dir, '000125.pptx');
    await writeFile(zip, 'not a zip');
    await assert.rejects(directTextPages(zip, 'Deck.pptx'), /^Error: office text failed: unreadable$/);
  });
});

const SLIDE_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

test('PowerPoint: slides in presentation order with their speaker notes; unlisted slides and links are not read', async () => {
  await inTemp(async (dir) => {
    await writeFile(path.join(dir, 'outside.xml'), `<p:sld ${SLIDE_NS}>${para('OUTSIDE THE ARCHIVE')}</p:sld>`);
    const file = await zipParts(dir, '000126.pptx', {
      'ppt/presentation.xml': `<p:presentation ${SLIDE_NS}><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
      'ppt/_rels/presentation.xml.rels': rels([['rId2', 'slide', 'slides/slide1.xml'], ['rId3', 'slide', '/ppt/slides/slide2.xml'], ['rId4', 'slideMaster', 'slideMasters/slideMaster1.xml']]),
      'ppt/slides/slide1.xml': `<p:sld ${SLIDE_NS}>${para('Closing slide')}<a:p/><a:p><a:pPr/></a:p></p:sld>`,
      'ppt/slides/slide2.xml': `<p:sld ${SLIDE_NS}>${para('Harbor Street Grill &amp; Copperline Cafe')}<a:p><a:r><a:t>First line</a:t></a:r><a:br/><a:r><a:t>second line</a:t></a:r></a:p><a:tbl><a:tr><a:tc><a:txBody>${para('Cell A')}</a:txBody></a:tc></a:tr></a:tbl></p:sld>`,
      'ppt/slides/_rels/slide2.xml.rels': rels([['rId1', 'notesSlide', '../notesSlides/notesSlide1.xml']]),
      'ppt/notesSlides/notesSlide1.xml': `<p:notes ${SLIDE_NS}><a:p><a:fld id="{1}" type="slidenum"><a:t>2</a:t></a:fld></a:p>${para('Speaker note about the fictional cooler repair.')}</p:notes>`,
      'ppt/slides/slide3.xml': `<p:sld ${SLIDE_NS}>${para('Orphan slide nobody can see')}</p:sld>`,
    });
    const [page] = await directTextPages(file, 'Menu-Plan.pptx');
    assert.equal(page?.text, 'Slide 1\nHarbor Street Grill & Copperline Cafe\nFirst line\nsecond line\nCell A\nNotes:\nSpeaker note about the fictional cooler repair.\n\nSlide 2\nClosing slide');
    // An archive whose only slide is a stored link to a file outside it.
    const linkDir = path.join(dir, 'linkparts', 'ppt', 'slides');
    await mkdir(linkDir, { recursive: true });
    await symlink(path.join(dir, 'outside.xml'), path.join(linkDir, 'slide1.xml'));
    const linked = path.join(dir, '000127.pptx');
    await run('/usr/bin/zip', ['-q', '-X', '-y', '-r', linked, 'ppt'], { cwd: path.join(dir, 'linkparts') });
    assert.deepEqual(await directTextPages(linked, 'Linked.pptx'), [{ n: 1, text: 'Slide 1', ocr: false, rendered: true }], 'the link is never followed');
  });
});

test('Excel: sheets in workbook order, shared and inline strings, dates, percents, booleans and gaps between cells', async () => {
  await inTemp(async (dir) => {
    const file = await zipParts(dir, '000128.xlsx', {
      'xl/workbook.xml': '<workbook><workbookPr date1904="false"/><sheets><sheet name="Invoices &amp; Deliveries" sheetId="2" r:id="rId2"/><sheet name="Notes" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': rels([['rId1', 'worksheet', 'worksheets/sheet1.xml'], ['rId2', 'worksheet', 'worksheets/sheet2.xml'], ['rId3', 'styles', 'styles.xml']]),
      'xl/sharedStrings.xml': '<sst><si><t>Restaurant</t></si><si><r><t>Harbor </t></r><r><rPr><b/></rPr><t xml:space="preserve">Street Grill</t></r><rPh sb="0" eb="1"><t>PHONETIC</t></rPh></si><si><t>Invoice total</t></si></sst>',
      'xl/styles.xml': '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;USD&quot; #,##0.00"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="10"/></cellXfs></styleSheet>',
      'xl/worksheets/sheet2.xml': [
        '<worksheet><sheetData>',
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>2</v></c></row>',
        '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" s="1"><v>41099</v></c><c r="C2" s="2"><v>18420.55</v></c><c r="D2" t="b"><v>1</v></c><c r="E2" s="3"><v>3.7037037037037035E-2</v></c><c r="F2"><v>70.666666666666671</v></c></row>',
        '<row r="3"/><row r="4"><c r="A4" s="2"/></row>',
        '<row r="5"><c r="A5" t="inlineStr"><is><t>Inline &lt;note&gt;</t></is></c><c r="B5" t="str"><f>A1</f><v>Restaurant</v></c><c r="C5" s="1"><v>41135.5</v></c></row>',
        '</sheetData></worksheet>',
      ].join(''),
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Prepared for Doe v. Roe</t></is></c></row></sheetData></worksheet>',
    });
    const [page] = await directTextPages(file, 'Ledger.xlsx');
    assert.equal(
      page?.text,
      [
        'Sheet 1: Invoices & Deliveries',
        'Restaurant |  | Invoice total',
        'Harbor Street Grill | 2012-07-09 | 18420.55 | TRUE | 3.7% | 70.6666666667',
        'Inline <note> | Restaurant | 2012-08-14 12:00',
        '',
        'Sheet 2: Notes',
        'Prepared for Doe v. Roe',
      ].join('\n'),
    );
  });
});

test('a long office document is one page whose index markers recur every ~150 words, all at p. 1', () => {
  const words = Array.from({ length: 1000 }, (_, i) => `word${i}`).join(' ');
  const parts = buildParts('doc-office', [{ n: 1, text: words }]);
  const markers = parts.map((part) => part.body).join('').match(/\[\[doc:doc-office p:\d+\]\]/g) ?? [];
  assert.equal(markers.length, 7);
  assert.deepEqual(new Set(markers), new Set(['[[doc:doc-office p:1]]']));
});

test('office files and email carry their own render versions; PDFs, Markdown and download-only files none', () => {
  assert.equal(renderVersion('a/Draft.docx'), OFFICE_RENDER_VERSION);
  assert.equal(renderVersion('a/Deck.PPTX'), OFFICE_RENDER_VERSION);
  assert.equal(renderVersion('a/message.eml'), EMAIL_RENDER_VERSION);
  assert.equal(renderVersion('a/Filing.xml'), RENDER_VERSION);
  for (const name of ['a/deck.key', 'a/doc.pages', 'a/Model.NUMBERS']) assert.equal(renderVersion(name), IWORK_RENDER_VERSION, name);
  for (const name of ['a/scan.pdf', 'a/notes.md', 'a/bundle.zip']) assert.equal(renderVersion(name), null, name);
  for (const name of ['x.docx', 'x.doc', 'x.rtf', 'x.odt', 'x.pptx', 'x.xlsx', 'x.key', 'x.pages', 'x.numbers']) assert.equal(indexSource('file', name), 'direct', name);
  for (const name of ['x.zip', 'x.xls', 'x.ppt', 'x.mp4']) assert.equal(indexSource('file', name), null, name);
});

test('an office file under any path segment containing "privileged" stays download-only; other files there do not', () => {
  assert.equal(isPrivilegedOffice('Case/07-Lawyer-Notes-PRIVILEGED/memo.docx'), true);
  assert.equal(isPrivilegedOffice('Case/04-Letters/with-Counsel-privileged/deck.pptx'), true);
  assert.equal(isPrivilegedOffice('Case/Privileged Memo.xlsx'), true, 'the file name is a segment too');
  for (const name of ['Case/07-Lawyer-Notes-PRIVILEGED/memo.pages', 'Case/07-Lawyer-Notes-PRIVILEGED/ledger.numbers', 'Case/Privileged Deck.key']) {
    assert.equal(isPrivilegedOffice(name), true, name);
  }
  assert.equal(isPrivilegedOffice('Case/07-Lawyer-Notes-PRIVILEGED/letter.pdf'), false);
  assert.equal(isPrivilegedOffice('Case/07-Lawyer-Notes-PRIVILEGED/notes.md'), false);
  assert.equal(isPrivilegedOffice('Case/drafts/complaint.docx'), false);

  const sha = (c: string) => c.repeat(64);
  const file = (rel: string, c: string): SnapshotFile => ({ rel, abs: `/src/${rel}`, size: 1000, mtimeMs: 0, dev: 1, ino: 1, snapshot: `/snap/${c}${path.extname(rel)}`, sha256: sha(c) });
  const files = [
    file('Case/07-Lawyer-Notes-PRIVILEGED/memo.docx', 'a'),
    file('Case/07-Lawyer-Notes-PRIVILEGED/letter.pdf', 'b'),
    file('Case/07-Lawyer-Notes-PRIVILEGED/thread.eml', 'c'),
    file('Case/drafts/complaint.docx', 'd'),
    file('Case/Privileged Memo.xlsx', 'e'),
    file('Case/deck/menu-plan.pptx', 'f'),
    file('Case/archive/bundle.zip', '1'),
    file('Case/archive/deck.key', '2'),
    file('Case/archive/doc.pages', '3'),
    file('Case/07-Lawyer-Notes-PRIVILEGED/memo.pages', '4'),
    file('Case/07-Lawyer-Notes-PRIVILEGED/ledger.numbers', '5'),
    file('Case/Privileged Deck.key', '6'),
  ];
  const { jobs } = indexWork(diffSync(files, []), {});
  assert.deepEqual(jobs.map((job) => job.name).sort(), ['complaint.docx', 'deck.key', 'doc.pages', 'letter.pdf', 'menu-plan.pptx', 'thread.eml']);
});

test('an email indexed as raw MIME is indexed again once; an indexed office file moved under a privileged segment loses its parts', () => {
  const sha = 'c'.repeat(64);
  const eml: SnapshotFile = { rel: 'Case/mail/thread.eml', abs: '/src/thread.eml', size: 500, mtimeMs: 0, dev: 1, ino: 1, snapshot: '/snap/1.eml', sha256: sha };
  const row = { id: 'doc-eml', path: eml.rel, sha256: sha, size: 500, kind: 'text', pages: null, r2_key: 'k1', source: 'mirror' };
  const before = indexWork(diffSync([eml], [row]), { 'doc-eml': { sha256: sha, parts: 1 } });
  assert.deepEqual(before.jobs.map((job) => [job.id, job.refresh]), [['doc-eml', true]]);
  assert.deepEqual(indexWork(diffSync([eml], [row]), { 'doc-eml': { sha256: sha, parts: 1, render: EMAIL_RENDER_VERSION } }).jobs, []);

  const docx: SnapshotFile = { ...eml, rel: 'Case/07-Lawyer-Notes-PRIVILEGED/memo.docx', snapshot: '/snap/2.docx', sha256: 'd'.repeat(64) };
  const moved = { ...row, id: 'doc-memo', path: 'Case/drafts/memo.docx', sha256: docx.sha256, kind: 'file' };
  const work = indexWork(diffSync([docx], [moved]), { 'doc-memo': { sha256: docx.sha256, parts: 2, render: OFFICE_RENDER_VERSION } });
  assert.deepEqual(work.jobs, []);
  assert.deepEqual(work.drops, [{ id: 'doc-memo', parts: 2 }]);
});

test('the index check counts emails and office documents read as text', { skip: !TEXTUTIL && 'textutil is macOS only' }, async () => {
  await inTemp(async (dir) => {
    await writeFile(path.join(dir, 'source.txt'), TEXT);
    await run('/usr/bin/textutil', ['-convert', 'docx', '-output', path.join(dir, '1.docx'), path.join(dir, 'source.txt')]);
    await writeFile(path.join(dir, '2.eml'), 'From: Jane Doe <jane.doe@example.test>\nSubject: Hello\n\nA fictional note.');
    const job = (id: string, file: string, name: string, kind: IndexJob['kind']): IndexJob => ({ id, kind, sha256: id.padEnd(64, '0'), file: path.join(dir, file), name, staleParts: 0 });
    const check = await checkIndex([job('a', '1.docx', 'Draft.docx', 'file'), job('b', '2.eml', 'note.eml', 'text')], {
      extractPdf: () => Promise.reject(new Error('no PDFs here')),
      readText: directTextPages,
    });
    assert.deepEqual([check.textDocs, check.officeDocs, check.emailDocs, check.renderedDocs], [2, 1, 1, 0]);
  });
});
