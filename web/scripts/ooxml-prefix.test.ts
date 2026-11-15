// SPDX-License-Identifier: Apache-2.0
// PowerPoint and Excel parts written with other namespace prefixes read the same text as with the usual ones (#276).
// Run from web/: node --test scripts/ooxml-prefix.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { officeTextInChild, type OfficeFormat } from './office.ts';
import { sheetRows, slideLines, usualPrefixes } from './ooxml.ts';
import { findPiiSync } from './pii.ts';

const SML = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const DML = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PML = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
// The SSA's voided sample number, joined at run time so no file holds it whole.
const NUMBER = ['078', '05', '1120'].join('-');
const CTX = { shared: [], styles: '', date1904: false };

/** A stored zip of the given entries. */
function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content);
    const packed = deflateRawSync(data);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** A workbook whose every part uses `x:` (SpreadsheetML) and `rel:` (relationships), as the Open XML SDK can write. */
function xlsx(cell: string): Record<string, string> {
  return {
    'xl/workbook.xml': `<x:workbook xmlns:x="${SML}" xmlns:rel="${REL}"><x:sheets><x:sheet name="Cap table" sheetId="1" rel:id="rId1"/></x:sheets></x:workbook>`,
    'xl/_rels/workbook.xml.rels': `<pr:Relationships xmlns:pr="${PKG}"><pr:Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></pr:Relationships>`,
    'xl/worksheets/sheet1.xml': `<x:worksheet xmlns:x="${SML}"><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>${cell}</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>`,
  };
}

/** A presentation whose slide uses `ns1:` for PresentationML and `ns2:` for DrawingML. */
function pptx(text: string): Record<string, string> {
  return {
    'ppt/slides/slide1.xml': `<ns1:sld xmlns:ns1="${PML}" xmlns:ns2="${DML}"><ns1:cSld><ns1:spTree><ns1:sp><ns1:txBody><ns2:p><ns2:r><ns2:t>${text}</ns2:t></ns2:r></ns2:p></ns1:txBody></ns1:sp></ns1:spTree></ns1:cSld></ns1:sld>`,
  };
}

async function read(format: OfficeFormat, entries: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ooxml-prefix-'));
  try {
    const file = path.join(dir, `000001.${format}`);
    await writeFile(file, zip(entries));
    return await officeTextInChild(file, format);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('other prefixes read as the usual ones', () => {
  const sheet = `<x:worksheet xmlns:x="${SML}"><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Doe</x:t></x:is></x:c><x:c r="B1"><x:v>12</x:v></x:c></x:row></x:sheetData></x:worksheet>`;
  assert.deepEqual(sheetRows(usualPrefixes(sheet), CTX), ['Doe | 12']);
  assert.deepEqual(slideLines(usualPrefixes(pptx('Harbor Labs')['ppt/slides/slide1.xml']!)), ['Harbor Labs']);
  // A default namespace for DrawingML gains the usual a: prefix.
  assert.deepEqual(slideLines(usualPrefixes(`<sld xmlns="${DML}"><p><r><t>Default</t></r></p></sld>`)), ['Default']);
});

test('another namespace bound to a usual prefix is not read as a known one', () => {
  const xml = `<p:sld xmlns:p="${PML}" xmlns:a="urn:example:other"><a:p><a:r><a:t>Not DrawingML</a:t></a:r></a:p></p:sld>`;
  assert.deepEqual(slideLines(usualPrefixes(xml)), []);
});

test('parts with no namespace declarations, and missing parts, are left as written', () => {
  const bare = '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>';
  assert.equal(usualPrefixes(bare), bare);
  assert.equal(usualPrefixes(''), '');
  assert.equal(usualPrefixes('/tmp/outside.xml'), '', 'a stored link reads as no part');
  assert.equal(usualPrefixes('<?xml version="1.0"?>\n<sst/>\n'), '<?xml version="1.0"?>\n<sst/>\n');
});

test('a part whose root never closes fails', () => {
  assert.throws(() => usualPrefixes(`<x:worksheet xmlns:x="${SML}"><x:sheetData><x:row r="1">`), /not closed/);
  assert.throws(() => usualPrefixes('<sst><si><t>cut'), /not closed/);
});

test('a number in an x: workbook or an ns1: slide is flagged, read in the child', async () => {
  const workbook = await read('xlsx', xlsx(`Founder: ${NUMBER}`));
  assert.equal(workbook, `Sheet 1: Cap table\nFounder: ${NUMBER}`);
  assert.ok(findPiiSync(workbook).length > 0);
  const deck = await read('pptx', pptx(`Founder: ${NUMBER}`));
  assert.equal(deck, `Slide 1\nFounder: ${NUMBER}`);
  assert.ok(findPiiSync(deck).length > 0);
});

test('a workbook with a part cut off fails instead of reading short', async () => {
  const entries = xlsx('Doe');
  entries['xl/worksheets/sheet1.xml'] = entries['xl/worksheets/sheet1.xml']!.slice(0, -20);
  await assert.rejects(read('xlsx', entries), { message: 'office text failed: unreadable' });
});
