// SPDX-License-Identifier: Apache-2.0
// The sync's SSN guard: which documents it reads, how, what it reports and when --apply must stop. Synthetic
// files under the system temp directory only; numbers are joined at run time (area 078, group 05, serial 1120 is
// the SSA's voided sample; area 9xx is never issued as an SSN).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { diffSync, kindOf, type DocumentRow } from './diff.ts';
import { directTextPages, ExtractorUnavailable, type ExtractedPage } from './extract.ts';
import type { IndexJob } from './indexjob.ts';
import type { KnownMatcher } from './pii.ts';
import {
  formatPiiReport, loadCleared, officeParts, officeXml, piiFingerprintEntries, piiGate, piiRefusal, piiTargets, saveCleared, scanForPii, scanRead, unreadTargets, writePiiDetails, type PiiScan, type ScanDeps,
} from './pii-scan.ts';
import { formatReport } from './report.ts';
import { zipStore } from '../mcp/zip.ts';
import { planFingerprint } from './report.ts';
import type { SnapshotFile } from './snapshot.ts';
import { MAX_PART_BYTES } from './office-read.ts';
import { parseSyncArgs } from './sync.ts';

const VOIDED = ['078', '05', '1120'].join('-');
const ITIN_LIKE = ['90', '0123456'].join('-');
const sha = (c: string) => c.repeat(64);

function file(rel: string, c: string, snapshot = `/snap/${rel}`): SnapshotFile {
  return { rel, abs: `/src/${rel}`, size: 10, mtimeMs: 0, dev: 1, ino: 1, snapshot, sha256: sha(c) };
}

function row(id: string, rel: string, c: string): DocumentRow {
  return { id, path: rel, sha256: sha(c), size: 10, kind: kindOf(rel).kind, pages: null, r2_key: `key-${id}`, source: 'mirror' };
}

test('targets: adds, changes and renames, and unchanged documents only when re-indexed', () => {
  const plan = diffSync(
    [file('a/new.pdf', 'a'), file('a/changed.md', 'c'), file('b/moved.pdf', 'd'), file('a/same.pdf', 'e'), file('a/reindexed.xml', 'f')],
    [row('d-changed', 'a/changed.md', 'b'), row('d-moved', 'a/moved.pdf', 'd'), row('d-same', 'a/same.pdf', 'e'), row('d-xml', 'a/reindexed.xml', 'f')],
  );
  const job: IndexJob = { id: 'd-xml', kind: 'text', sha256: sha('f'), file: '/snap/a/reindexed.xml', name: 'reindexed.xml', staleParts: 1, refresh: true };
  const changedJob: IndexJob = { ...job, id: 'd-changed', kind: 'markdown', sha256: sha('c') };
  const targets = piiTargets(plan, [job, changedJob]);
  assert.deepEqual(targets.map((t) => t.rel), ['a/changed.md', 'a/new.pdf', 'a/reindexed.xml', 'b/moved.pdf']);
  assert.equal(targets.find((t) => t.rel === 'a/new.pdf')?.file, '/snap/a/new.pdf');
});

test('how each kind is read: as the index would, raw for visuals and SVG, not at all for archives and media', () => {
  assert.equal(scanRead('pdf', 'x.pdf'), 'extractor');
  assert.equal(scanRead('image', 'scan.png'), 'extractor');
  assert.equal(scanRead('image', 'chart.svg'), 'raw');
  assert.equal(scanRead('visual', 'tab.html'), 'raw');
  assert.equal(scanRead('markdown', 'notes.md'), 'direct');
  assert.equal(scanRead('text', 'data.json'), 'direct');
  assert.equal(scanRead('file', '07-Lawyer-Notes-PRIVILEGED/memo.docx'), 'direct', 'privileged office files are served, so they are scanned');
  for (const rel of ['deck.key', 'plan.pages', 'ledger.numbers', '07-Lawyer-Notes-PRIVILEGED/plan.pages']) assert.equal(scanRead(kindOf(rel).kind, rel), 'direct', rel);
  for (const rel of ['bundle.zip', 'call.m4a', 'old.xls', 'photo.heic']) assert.equal(scanRead(kindOf(rel).kind, rel), null, rel);
});

interface Fixture {
  dir: string;
  targets: ReturnType<typeof piiTargets>;
  deps: ScanDeps;
}

/** One document of each reading path, written to a scratch folder; PDFs come from a fake extractor. */
async function fixture(extract: (file: string) => Promise<ExtractedPage[]>, known: KnownMatcher | null = null): Promise<Fixture> {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-pii-scan-'));
  const bodies: Record<string, string> = {
    'a/clean.md': `# Notes\nVendor EIN ${['12', '3456789'].join('-')}; call 303-555-0123.`,
    'a/w9.md': `Taxpayer Identification Number (TIN)\nSocial security number\n${ITIN_LIKE}`,
    'a/Invoice__20121115__Tally-Payroll__Gutter-Parts.xml': `<invoiceBatch><x>${VOIDED}</x></invoiceBatch>`,
    'a/tab.html': `<p>${VOIDED}</p>`,
    'a/bundle.zip': 'PK',
  };
  const files = [];
  for (const [rel, body] of Object.entries(bodies)) {
    const snapshot = path.join(dir, rel.replace(/\//g, '_'));
    await writeFile(snapshot, body);
    files.push(file(rel, String(files.length), snapshot));
  }
  files.push(file('a/k1.pdf', 'p', path.join(dir, 'k1.pdf')), file('a/broken.pdf', 'q', path.join(dir, 'broken.pdf')));
  // As directTextPages: XML comes back rendered (here unchanged, but marked), Markdown as it is.
  const readText = async (snapshot: string, name: string): Promise<ExtractedPage[]> => [
    { n: 1, text: await readFile(snapshot, 'utf8'), ocr: false, ...(name.endsWith('.xml') ? { rendered: true } : {}) },
  ];
  return { dir, targets: piiTargets(diffSync(files, []), []), deps: { extractPdf: extract, readText, known } };
}

const extractor = async (snapshot: string): Promise<ExtractedPage[]> => {
  if (snapshot.endsWith('broken.pdf')) throw new Error('LegallasExtract failed: encrypted');
  return [{ n: 1, text: 'Schedule K-1', ocr: false }, { n: 2, text: `Partner's SSN or TIN ${VOIDED}`, ocr: true }];
};

test('the scan flags by document with page, rule and masked form; unreadable files are counted, not scanned', async () => {
  const { dir, targets, deps } = await fixture(extractor);
  try {
    const scan = await scanForPii(targets, deps);
    assert.equal(scan.scanned, 5);
    assert.deepEqual(scan.unscanned.map((u) => [u.path, u.reason]), [['a/broken.pdf', 'failed: encrypted'], ['a/bundle.zip', 'zip']]);
    assert.deepEqual(scan.flagged.map((doc) => doc.path), ['a/Invoice__20121115__Tally-Payroll__Gutter-Parts.xml', 'a/k1.pdf', 'a/tab.html', 'a/w9.md']);
    const k1 = scan.flagged.find((doc) => doc.path === 'a/k1.pdf');
    assert.deepEqual(k1?.hits, [{ page: 2, rule: 'labelled', masked: '***-**-1120' }, { page: 2, rule: 'ssn-form', masked: '***-**-1120' }]);
    const xml = scan.flagged.find((doc) => doc.path.endsWith('.xml'));
    assert.deepEqual(xml?.hits.map((hit) => [hit.page, hit.rule]), [[1, 'ssn-form'], [null, 'ssn-form']], 'rendered text and raw body');
    assert.deepEqual(scan.flagged.find((doc) => doc.path === 'a/w9.md')?.hits.map((hit) => hit.rule), ['labelled']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('without LegallasExtract the scan stops rather than pass PDFs unread', async () => {
  const { dir, targets, deps } = await fixture(async () => {
    throw new ExtractorUnavailable('extractor not built: swift failed');
  });
  try {
    await assert.rejects(scanForPii(targets, deps), (error: Error) => error instanceof ExtractorUnavailable && /SSN guard/.test(error.message));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function scanOf(...docs: [string, string, ('ssn-form' | 'labelled' | 'known-hash')[]][]): PiiScan {
  return {
    scanned: docs.length,
    flagged: docs.map(([rel, c, hitRules]) => ({ id: `id-${c}`, path: rel, sha256: sha(c), hits: hitRules.map((rule) => ({ page: 1, rule, masked: '***-**-1120' })) })),
    unscanned: [],
  };
}

test('the gate: open flags and known SSNs stop --apply; each document is acknowledged by its own sha256', () => {
  const scan = scanOf(['a/k1.pdf', 'a', ['ssn-form']], ['a/w9.md', 'b', ['labelled']], ['a/known.pdf', 'c', ['known-hash', 'ssn-form']]);
  const none = piiGate(scan, []);
  assert.deepEqual([none.open.length, none.acknowledged.length, none.known.length], [2, 0, 1]);
  assert.match(piiRefusal(none) ?? '', /1 hold a known SSN.*2 are flagged and not acknowledged.*Nothing was changed/);
  const both = piiGate(scan, [sha('a'), sha('b'), sha('c')]);
  assert.deepEqual([both.open.length, both.acknowledged.length, both.known.length], [0, 2, 1], 'a known SSN cannot be acknowledged');
  assert.match(piiRefusal(both) ?? '', /known SSN/);
  const clean = scanOf(['a/k1.pdf', 'a', ['ssn-form']]);
  assert.equal(piiRefusal(piiGate(clean, [sha('a')])), null);
  const stray = piiGate(clean, [sha('a'), sha('z')]);
  assert.deepEqual(stray.unused, [sha('z')]);
  assert.match(piiRefusal(stray) ?? '', /match no flagged document/);
  assert.equal(piiRefusal(piiGate(scanOf(), [])), null);
});

test('the fingerprint covers the flags and the acknowledgements, and is unchanged when nothing is flagged', () => {
  const plan = diffSync([file('a/k1.pdf', 'a')], []);
  const clean = planFingerprint(plan, piiFingerprintEntries(scanOf(), []));
  assert.equal(clean, planFingerprint(plan));
  const flagged = scanOf(['a/k1.pdf', 'a', ['ssn-form']]);
  const open = planFingerprint(plan, piiFingerprintEntries(flagged, []));
  const acknowledged = planFingerprint(plan, piiFingerprintEntries(flagged, [sha('a')]));
  assert.equal(new Set([clean, open, acknowledged]).size, 3);
  assert.equal(acknowledged, planFingerprint(plan, piiFingerprintEntries(flagged, [sha('a'), sha('a')])), 'repeating an acknowledgement changes nothing');
  const moreHits = scanOf(['a/k1.pdf', 'a', ['ssn-form', 'labelled']]);
  assert.notEqual(planFingerprint(plan, piiFingerprintEntries(moreHits, [sha('a')])), acknowledged, 'a new rule on the same file is a new plan');
});

test('the report and the details file carry masked forms only; --summary leaves paths to the file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-pii-out-'));
  try {
    const scan = { ...scanOf(['a/k1.pdf', 'a', ['ssn-form']], ['a/known.pdf', 'c', ['known-hash']]), unscanned: [{ path: 'a/b.zip', sha256: sha('z'), reason: 'zip' }] };
    const gate = piiGate(scan, [sha('a')]);
    const details = await writePiiDetails(dir, 'run-1', scan, gate, 'remote');
    assert.equal(details, path.join(dir, 'staging', 'pii-run-1.json'));
    assert.equal((await stat(details)).mode & 0o777, 0o600);
    const saved = JSON.parse(await readFile(details, 'utf8'));
    assert.deepEqual(saved.flagged.map((doc: { status: string }) => doc.status), ['acknowledged', 'known SSN']);
    assert.deepEqual(saved.unscanned, scan.unscanned);
    const full = formatPiiReport(scan, gate, details, false, { size: 1, hashed: 40 }).join('\n');
    assert.match(full, /2 documents scanned.*40 nine-digit sequences checked against 1 known hashes/);
    assert.match(full, /Not scanned \(no readable text\): zip 1/);
    assert.match(full, /acknowledged +a{64} {2}a\/k1\.pdf {2}\(ssn-form 1; p\. 1\)/);
    assert.match(full, /known SSN +c{64} {2}a\/known\.pdf/);
    assert.match(full, /--apply refuses until/);
    const summary = formatPiiReport(scan, gate, details, true, null).join('\n');
    assert.equal(summary.includes('a/k1.pdf'), false);
    assert.match(summary, /no known hashes configured/);
    assert.match(formatPiiReport(scanOf(), piiGate(scanOf(), []), null, false, null).join('\n'), /Nothing flagged\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sync takes --allow-pii <sha256>, once per document, in a dry run or an apply', () => {
  assert.deepEqual(parseSyncArgs([]).allowPii, []);
  assert.deepEqual(parseSyncArgs(['--allow-pii', sha('a'), '--allow-pii', sha('b')]).allowPii, [sha('a'), sha('b')]);
  assert.deepEqual(parseSyncArgs(['--apply', '--expect', 'abcdef012345', '--allow-pii', sha('a')]).allowPii, [sha('a')]);
  for (const bad of [['--allow-pii'], ['--allow-pii', 'all'], ['--allow-pii', sha('A')], ['--allow-pii', 'a'.repeat(63)]]) assert.throws(() => parseSyncArgs(bad), /usage/);
});

/** Invented: its digits simply count up. */
const PARTS = ['123', '45', '6789'] as const;
const INVENTED = PARTS.join('-');
const NINE = PARTS.join('');
const nothing: ScanDeps = { extractPdf: async () => [], readText: async () => [{ n: 1, text: 'Nothing here.', ocr: false }], known: null };
let madeTargets = 0;
const target = (rel: string, snapshot = '/snap/x') => ({ id: `doc-${(madeTargets += 1)}`, rel, sha256: sha('a'), file: snapshot, kind: kindOf(rel).kind });

async function inScratch(work: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-pii-guard-'));
  try {
    await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('the path is read too: a number in a file or folder name refuses the document, even one with no readable text', async () => {
  const named = [`Deals/W-9 ${INVENTED}.txt`, `${INVENTED}/notes.txt`, `Deals/${INVENTED}.zip`, `W-9-${INVENTED}.txt`, `2024-01-15-${INVENTED}.txt`, `Roe-${INVENTED}-2024.txt`, `W-9%20${INVENTED}.txt`, `W9_${PARTS.join('_')}.txt`, `ssn-${NINE}.txt`];
  const scan = await scanForPii([...named, 'Deals/clean.txt'].map((rel) => target(rel)), nothing);
  assert.deepEqual(scan.flagged.map((doc) => doc.path), [...named].sort());
  assert.ok(scan.flagged.every((doc) => doc.hits.every((hit) => hit.page === 0)));
  assert.deepEqual(scan.unscanned.map((skip) => skip.path), [`Deals/${INVENTED}.zip`]);
  assert.match(piiRefusal(piiGate(scan, [])) ?? '', /9 are flagged/);
});

test('a name is judged even when the file cannot be read', async () => {
  const failing: ScanDeps = { ...nothing, extractPdf: async () => Promise.reject(new Error('LegallasExtract failed: encrypted')) };
  const scan = await scanForPii([target(`W-9 ${INVENTED}.pdf`)], failing);
  assert.deepEqual(scan.flagged.map((doc) => doc.hits.map((hit) => hit.page)), [[0]]);
  assert.deepEqual(scan.unscanned.map((skip) => skip.reason), ['failed: encrypted']);
});

test('a failed read refuses until it is fixed or acknowledged, and is in the fingerprint', async () => {
  const failing: ScanDeps = { ...nothing, extractPdf: async () => Promise.reject(new Error('LegallasExtract failed: encrypted')) };
  const scan = await scanForPii([target('broken.pdf')], failing);
  assert.match(piiRefusal(piiGate(scan, [])) ?? '', /1 could not be read, so were not checked/);
  assert.equal(piiRefusal(piiGate(scan, [sha('a')])), null, 'acknowledged by its sha256, and that value counts as used');
  assert.match(formatPiiReport(scan, piiGate(scan, []), null, false, null).join('\n'), /unread +a{64} {2}broken\.pdf {2}\(failed: encrypted\)/);
  assert.notEqual(planFingerprint(diffSync([], []), piiFingerprintEntries(scan, [])), planFingerprint(diffSync([], [])));
  const zip = await scanForPii([target('bundle.zip')], nothing);
  assert.equal(piiRefusal(piiGate(zip, [])), null, 'a format with no readable text is counted, not refused');
});

test('every text encoding and width reads as its text, in the guard and for the index', async () => {
  await inScratch(async (dir) => {
    const text = `Jane Roe,${INVENTED}\n`;
    const utf32 = (littleEndian: boolean) => Buffer.concat([...text].map((c) => {
      const cell = Buffer.alloc(4);
      if (littleEndian) cell.writeUInt32LE(c.codePointAt(0) ?? 0);
      else cell.writeUInt32BE(c.codePointAt(0) ?? 0);
      return cell;
    }));
    const utf16le = Buffer.from(text, 'utf16le');
    const utf16be = Buffer.from(text, 'utf16le').swap16();
    const copies: [string, Buffer][] = [
      ['le.csv', Buffer.concat([Buffer.from([0xff, 0xfe]), utf16le])],
      ['be.csv', Buffer.concat([Buffer.from([0xfe, 0xff]), utf16be])],
      ['le-no-mark.csv', utf16le],
      ['be-no-mark.csv', utf16be],
      ['le32.csv', Buffer.concat([Buffer.from([0xff, 0xfe, 0, 0]), utf32(true)])],
      ['be32.csv', Buffer.concat([Buffer.from([0, 0, 0xfe, 0xff]), utf32(false)])],
      ['le32-no-mark.csv', utf32(true)],
      ['be32-no-mark.csv', utf32(false)],
      ['plain.csv', Buffer.from(text)],
    ];
    const targets = [];
    for (const [name, bytes] of copies) {
      const snapshot = path.join(dir, name);
      await writeFile(snapshot, bytes);
      assert.equal((await directTextPages(snapshot, name))[0]?.text, text, name);
      targets.push(target(name, snapshot));
    }
    const raw = path.join(dir, 'raw.svg');
    await writeFile(raw, Buffer.concat([Buffer.from([0xff, 0xfe]), utf16le]));
    const scan = await scanForPii([...targets, target('raw.svg', raw)], { ...nothing, readText: (file, name) => directTextPages(file, name) });
    assert.equal(scan.flagged.length, copies.length + 1);
  });
});

test('a file of no known type is read when its bytes read as text, and left when they do not', async () => {
  await inScratch(async (dir) => {
    const targets = [];
    for (const name of ['x.tsv', 'x.log', 'x.yml', 'no-extension']) {
      const snapshot = path.join(dir, name);
      await writeFile(snapshot, `Jane Roe\t${INVENTED}\n`);
      targets.push(target(name, snapshot));
    }
    const binary = path.join(dir, 'x.bin');
    await writeFile(binary, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x12, 0x34, 0x56]));
    const scan = await scanForPii([...targets, target('x.bin', binary)], nothing);
    assert.deepEqual(scan.flagged.map((doc) => doc.path), ['no-extension', 'x.log', 'x.tsv', 'x.yml']);
    assert.deepEqual(scan.unscanned.map((skip) => [skip.path, skip.reason]), [['x.bin', 'bin']]);
  });
});

test('Word headers, footers, footnotes, comments and the title are read, with a number split across runs', async () => {
  await inScratch(async (dir) => {
    const split = `<w:p><w:r><w:t>Holder ${PARTS[0]}-</w:t></w:r><w:r><w:rPr/><w:t>${PARTS[1]}-${PARTS[2]}</w:t></w:r></w:p>`;
    const parts = ['word/header3.xml', 'word/footer1.xml', 'word/footnotes.xml', 'word/comments.xml', 'docProps/core.xml', 'xl/comments1.xml'];
    const targets = [];
    for (const name of parts) {
      const snapshot = path.join(dir, `${name.replace(/\W/g, '-')}.docx`);
      await writeFile(snapshot, zipStore([{ name, data: new TextEncoder().encode(split) }, { name: 'word/document.xml', data: new TextEncoder().encode('<w:p/>') }]));
      targets.push(target(`${name.replace(/\W/g, '-')}.docx`, snapshot));
    }
    const clean = path.join(dir, 'clean.docx');
    await writeFile(clean, zipStore([{ name: 'word/comments.xml', data: new TextEncoder().encode('<w:p>Vendor &amp; terms</w:p>') }]));
    const notZip = path.join(dir, 'not-zip.docx');
    await writeFile(notZip, 'plain text');
    const scan = await scanForPii([...targets, target('clean.docx', clean), target('not-zip.docx', notZip)], nothing);
    assert.equal(scan.flagged.length, parts.length);
    assert.deepEqual(scan.unscanned.map((skip) => skip.path), ['not-zip.docx'], 'an Office file that is no archive fails closed');
  });
});

test('every XML part of an Office file is read, whatever it is called, and whatever only its XML holds', async () => {
  const plain = `<w:p><w:r><w:t>${INVENTED}</w:t></w:r></w:p>`;
  const deleted = `<w:p><w:del><w:r><w:delText>${INVENTED}</w:delText></w:r></w:del></w:p>`;
  const cases: [name: string, part: string, xml: string | Buffer][] = [
    ['tracked deletion.docx', 'word/document.xml', deleted],
    ['deletion split across runs.docx', 'word/document.xml', `<w:p><w:del><w:r><w:delText>${PARTS[0]}-</w:delText></w:r><w:r><w:delText>${PARTS[1]}-${PARTS[2]}</w:delText></w:r></w:del></w:p>`],
    ['deletion beside a digit.docx', 'word/document.xml', `<w:p><w:r><w:t>Account 12</w:t></w:r><w:del><w:r><w:delText>${INVENTED}</w:delText></w:r></w:del></w:p>`],
    ['main part under another name.docx', 'word/document2.xml', deleted],
    ['comment under another name.docx', 'word/comments1.xml', plain],
    ['header under another name.docx', 'word/headerFirst.xml', plain],
    ['footer under another name.docx', 'word/footerDefault.xml', plain],
    ['footnote under another name.docx', 'word/notes.xml', plain],
    ['building block.docx', 'word/glossary/document.xml', plain],
    ['form field default.docx', 'word/document.xml', `<w:ffData><w:name w:val="SSN"/><w:default w:val="${NINE}"/></w:ffData>`],
    ['picture alt text.docx', 'word/document.xml', `<wp:docPr id="1" descr='Card ${INVENTED}'/>`],
    ['in a CDATA section.docx', 'word/document.xml', `<w:t><![CDATA[${INVENTED}]]></w:t>`],
    ['in an XML comment.docx', 'word/document.xml', `<!-- ${INVENTED} -->`],
    ['as character references.docx', 'word/document.xml', `<w:t>&#49;23&#x2d;45-6789</w:t>`],
    ['written in UTF-16.docx', 'word/comments.xml', Buffer.from(`﻿${plain}`, 'utf16le')],
    ['upper case name.docx', 'WORD/COMMENTS.XML', plain],
    ['threaded comment.xlsx', 'xl/threadedComments/threadedComment1.xml', `<ThreadedComment><text>${INVENTED}</text></ThreadedComment>`],
    ['text box.xlsx', 'xl/drawings/drawing1.xml', `<a:p><a:r><a:t>${INVENTED}</a:t></a:r></a:p>`],
    ['pivot table copy of its data.xlsx', 'xl/pivotCache/pivotCacheRecords1.xml', `<r><s v="${INVENTED}"/></r>`],
    ['link tooltip.xlsx', 'xl/worksheets/sheet1.xml', `<hyperlink ref="A1" tooltip="${INVENTED}"/>`],
    ['modern comment.pptx', 'ppt/comments/modernComment_100_0.xml', `<a:p><a:r><a:t>${INVENTED}</a:t></a:r></a:p>`],
    ['link target.pptx', 'ppt/slides/_rels/slide1.xml.rels', `<Relationship Target="https://x.example/${INVENTED}"/>`],
    ['old drawing.xlsx', 'xl/drawings/vmlDrawing1.vml', `<font>${INVENTED}</font>`],
    ['header.odt', 'styles.xml', `<text:p>${INVENTED}</text:p>`],
    ['tracked deletion.odt', 'content.xml', `<text:tracked-changes><text:p>${INVENTED}</text:p></text:tracked-changes>`],
    ['title.odt', 'meta.xml', `<dc:title>${INVENTED}</dc:title>`],
  ];
  await inScratch(async (dir) => {
    const targets = [];
    for (const [name, part, xml] of cases) {
      const snapshot = path.join(dir, name);
      await writeFile(snapshot, zipStore([{ name: part, data: typeof xml === 'string' ? new TextEncoder().encode(xml) : xml }]));
      targets.push(target(name, snapshot));
    }
    const scan = await scanForPii(targets, nothing);
    const flagged = new Set(scan.flagged.map((doc) => doc.path));
    assert.deepEqual(cases.map(([name]) => name).filter((name) => !flagged.has(name)), []);
    assert.ok(JSON.stringify(scan).includes(`***-**-${PARTS[2]}`) && !JSON.stringify(scan).includes(INVENTED), 'masked, as everywhere');
  });
});

test('an Office file\'s other numbers are not taken for one', async () => {
  const cases: [name: string, part: string, xml: string][] = [
    ['cells of a row.xlsx', 'xl/worksheets/sheet1.xml', `<row><c r="A1"><v>${PARTS[0]}</v></c><c r="B1"><v>-${PARTS[1]}</v></c><c r="C1"><v>-${PARTS[2]}</v></c></row>`],
    ['shape position.pptx', 'ppt/slides/slide1.xml', `<a:off x="${NINE}" y="${NINE}"/>`],
    ['id.docx', 'word/document.xml', `<w:p xr:uid="{${NINE.slice(0, 8)}-0123-4567-8901-234567890123}" w:rsidR="${NINE.slice(0, 8)}"/>`],
    ['dates.docx', 'docProps/core.xml', '<dcterms:created>2026-11-02T08:38:52Z</dcterms:created><dcterms:modified>2026-11-02</dcterms:modified>'],
  ];
  await inScratch(async (dir) => {
    const targets = [];
    for (const [name, part, xml] of cases) {
      const snapshot = path.join(dir, name);
      await writeFile(snapshot, zipStore([{ name: part, data: new TextEncoder().encode(xml) }]));
      targets.push(target(name, snapshot));
    }
    const scan = await scanForPii(targets, nothing);
    assert.deepEqual(scan.flagged.map((doc) => doc.path), []);
    assert.equal(scan.scanned, cases.length);
  });
});

test('the other files made of the same XML parts are read too, and one holding none is refused', async () => {
  const types = ['docm', 'dotx', 'dotm', 'xlsm', 'xltx', 'xltm', 'pptm', 'potx', 'potm', 'ppsx', 'ppsm', 'ods', 'odp', 'odg', 'ott', 'ots', 'otp', 'otg'];
  const part = (text: string) => [{ name: 'word/document.xml', data: new TextEncoder().encode(`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`) }];
  await inScratch(async (dir) => {
    const write = async (name: string, bytes: Uint8Array | string) => {
      const snapshot = path.join(dir, name);
      await writeFile(snapshot, bytes);
      return target(name, snapshot);
    };
    const holding = await Promise.all(types.map((type) => write(`holding.${type}`, zipStore(part(INVENTED)))));
    const clean = await write('clean.docm', zipStore(part('Nothing here.')));
    const noParts = await write('no-parts.ods', zipStore([{ name: 'readme.txt', data: new TextEncoder().encode('Nothing here.') }]));
    const notZip = await write('not-zip.xlsm', 'plain text');
    const binary = await write('binary.xlsb', zipStore([{ name: 'xl/worksheets/sheet1.bin', data: new Uint8Array(8) }]));
    const scan = await scanForPii([...holding, clean, noParts, notZip, binary], nothing);
    assert.deepEqual(scan.flagged.map((doc) => doc.path).sort(), types.map((type) => `holding.${type}`).sort());
    assert.deepEqual(scan.unscanned.map((skip) => [skip.path, skip.reason]), [['binary.xlsb', 'xlsb'], ['no-parts.ods', 'failed: unreadable'], ['not-zip.xlsm', 'failed: archive']]);
    assert.equal(scan.scanned, types.length + 1);
  });
});

test('an Office file too big to read whole is refused, not read in part', async () => {
  const zip = Buffer.from(zipStore([{ name: 'a.xml', data: new TextEncoder().encode('<a>one</a>') }, { name: 'b.xml', data: new TextEncoder().encode('<a>two</a>') }]));
  assert.ok(officeXml(zip, 20).length > 0);
  assert.throws(() => officeXml(zip, 19), /too-large/);
  assert.throws(() => officeXml(zip, 20, 1), /too-large/);
  // Ten characters and sixteen bytes: the limit is on bytes, so wide text gets no more room.
  const wide = Buffer.from(zipStore([{ name: 'a.xml', data: new TextEncoder().encode(`<a>${'日'.repeat(3)}</a>`) }]));
  assert.ok(officeXml(wide, 16).length > 0);
  assert.throws(() => officeXml(wide, 15), /too-large/);
  await inScratch(async (dir) => {
    const snapshot = path.join(dir, 'burst.docx');
    await writeFile(snapshot, zipStore([{ name: 'word/comments.xml', data: new Uint8Array(MAX_PART_BYTES + 1) }]));
    const scan = await scanForPii([target('burst.docx', snapshot)], nothing);
    assert.deepEqual(scan.unscanned.map((skip) => skip.reason), ['failed: too-large']);
    assert.match(piiRefusal(piiGate(scan, [])) ?? '', /1 could not be read/);
  });
});

test('an Office file is read one part at a time, so a part is scanned and dropped before the next is opened (#611)', () => {
  const part = (name: string, text: string) => ({ name, data: new TextEncoder().encode(`<a>${text}</a>`) });
  const parts = officeParts(Buffer.from(zipStore([part('a.xml', 'first'), part('b.xml', 'second')])), 12);
  const first = parts.next();
  assert.equal(first.done, false);
  assert.match(String(first.value), /first/);
  // The second part is opened only when asked for: here it is past the limit, so it fails then and not before.
  assert.throws(() => [...parts], /too-large/);
});

test('an RTF file\'s headers, footers and comments are read, with a number split by formatting', async () => {
  const cases: [name: string, body: string][] = [
    ['header.rtf', `{\\header ${INVENTED}}`],
    ['first page footer.rtf', `{\\footerf\\pard ${INVENTED}\\par}`],
    ['comment.rtf', `{\\*\\annotation ${INVENTED}}`],
    ['split.rtf', `{\\header ${PARTS[0]}-{\\b ${PARTS[1]}}-${PARTS[2]}}`],
    ['font table.rtf', `{\\fonttbl{\\f0 ${INVENTED};}}`],
  ];
  await inScratch(async (dir) => {
    const targets = [];
    for (const [name, body] of cases) {
      const snapshot = path.join(dir, name);
      await writeFile(snapshot, `{\\rtf1\\ansi ${body} Body.\\par}`);
      targets.push(target(name, snapshot));
    }
    const clean = path.join(dir, 'clean.rtf');
    await writeFile(clean, `{\\rtf1\\ansi{\\header Page \\chpgn }{\\pict\\picw123\\pich45 0123456789abcdef}\\rsid12345 Body ${PARTS[0]}.\\par}`);
    const scan = await scanForPii([...targets, target('clean.rtf', clean)], nothing);
    assert.deepEqual(scan.flagged.map((doc) => doc.path).sort(), cases.map(([name]) => name).sort());
  });
});

test('nothing prints the number: the plan table, the guard lines and the details file', async () => {
  await inScratch(async (dir) => {
    const rel = `Deals/W-9 ${INVENTED}.txt`;
    const plan = diffSync([file(rel, 'a')], [row('gone', `Old/${INVENTED}.txt`, 'b'), row('moved', `Was ${INVENTED}/m.pdf`, 'c')]);
    const moved = diffSync([file('Now/m.pdf', 'c')], [row('moved', `Was ${INVENTED}/m.pdf`, 'c')]);
    const input = { files: [], skipped: { dotfile: 0, 'lock-or-placeholder': 0 }, iworkPackages: [], target: 'local', pendingPulls: 0, toIndex: { direct: 0, extracted: 0 }, extractor: 'ready', summary: false };
    for (const each of [plan, moved]) assert.equal(formatReport({ ...input, plan: each }).includes(INVENTED), false);
    assert.match(formatReport({ ...input, plan }), /add .*Deals\/W-# ###-##-####\.txt/);
    const scan = await scanForPii([target(rel), target(`Deals/${INVENTED}.zip`)], nothing);
    const gate = piiGate(scan, []);
    const lines = formatPiiReport(scan, gate, null, false, null).join('\n');
    assert.equal(lines.includes(INVENTED), false);
    assert.match(lines, /W-# ###-##-####\.txt {2}\(ssn-form 1; file name\)/);
    const details = await readFile(await writePiiDetails(dir, 'run', scan, gate, 'local'), 'utf8');
    assert.equal(details.includes(INVENTED), false);
    assert.equal(/\d{3}-\d{2}-\d{4}/.test(details), false);
  });
});

test('documents already in the room are read once under new rules, and not again until the rules change', async () => {
  await inScratch(async (dir) => {
    const stay = row('d-stay', `Deals/W-9 ${INVENTED}.txt`, 'a');
    const plan = diffSync([file(stay.path, 'a'), file('a/new.md', 'b')], [stay]);
    const sent = piiTargets(plan, []);
    assert.deepEqual(sent.map((t) => t.rel), ['a/new.md'], 'the run sends only the new one');
    const first = unreadTargets(plan, sent, await loadCleared(dir, 'local', null));
    assert.deepEqual(first.map((t) => t.id), ['d-stay']);
    const scan = await scanForPii(first, nothing);
    assert.equal(scan.flagged.length, 1, 'a numbered name already in the room is caught');
    await saveCleared(dir, 'local', null, plan);
    assert.deepEqual(unreadTargets(plan, sent, await loadCleared(dir, 'local', null)), [], 'cleared by a run that passed the gate');
    assert.equal(unreadTargets(plan, sent, await loadCleared(dir, 'remote', null)).length, 1, 'each target keeps its own record');
    assert.equal(unreadTargets(plan, sent, await loadCleared(dir, 'local', { fingerprint: 'a' })).length, 1, 'a change to the known SSNs means reading again');
    const changed = diffSync([file(stay.path, 'z')], [stay]);
    assert.deepEqual(piiTargets(changed, []).map((t) => t.id), ['d-stay'], 'a changed file is read as ever');
    assert.equal((await readFile(path.join(dir, 'pii-cleared.local.json'), 'utf8')).includes(INVENTED), false, 'ids and hashes only');
    await writeFile(path.join(dir, 'pii-cleared.local.json'), 'not json');
    assert.equal(unreadTargets(plan, sent, await loadCleared(dir, 'local', null)).length, 1, 'a broken record clears nothing');
    // These rules read iWork files now. Only this gets a privileged one already cleared read, as the index leaves it out.
    await writeFile(path.join(dir, 'pii-cleared.local.json'), JSON.stringify({ rules: '2:0', docs: [`d-stay:${stay.sha256}`] }));
    assert.equal(unreadTargets(plan, sent, await loadCleared(dir, 'local', null)).length, 1, 'a clear under the last rules clears nothing');
  });
});
