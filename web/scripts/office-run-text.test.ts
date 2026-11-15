// SPDX-License-Identifier: Apache-2.0
// A comment or CDATA section inside a Word or OpenDocument text run doesn't split or hide what Word shows (#282).
// Run from web/: node --test scripts/office-run-text.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { docxText, odtText, runText } from './office-read.ts';
import { findPiiSync } from './pii.ts';

/** A zip archive of the given entries, deflated. */
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

// The SSA's voided sample number, in pieces joined at run time.
const [AREA, GROUP, SERIAL] = ['078', '05', '1120'];
const NUMBER = `${AREA}-${GROUP}-${SERIAL}`;
const SPLITS = [
  `${AREA}-${GROUP}-<!-- x -->${SERIAL}`,
  `<![CDATA[${AREA}-${GROUP}-]]><![CDATA[${SERIAL}]]>`,
  `${AREA}-<![CDATA[${GROUP}]]>-<!-- a > b -->${SERIAL}`,
];

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const docx = (run: string) =>
  zip({
    '[Content_Types].xml': '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml': `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${run}</w:t></w:r></w:p></w:body></w:document>`,
  });
const odt = (run: string) =>
  zip({ 'content.xml': `<office:document-content xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>${run}</text:p></office:text></office:body></office:document-content>` });

test('runText drops comments, keeps CDATA as written, and decodes entities elsewhere', () => {
  assert.equal(runText('a &amp; b<!-- gone -->c'), 'a & bc');
  assert.equal(runText('<![CDATA[&amp; <kept>]]>'), '&amp; <kept>', 'CDATA is not decoded');
  for (const split of SPLITS) assert.equal(runText(split), NUMBER, split);
});

test('a number split by a comment or CDATA reads whole from Word and OpenDocument, and is flagged', () => {
  for (const split of SPLITS) {
    for (const [name, text] of [['docx', docxText(docx(split))], ['odt', odtText(odt(split))]] as const) {
      assert.equal(text, NUMBER, `${name}: ${split}`);
      assert.ok(findPiiSync(text).length > 0, `${name}: ${split}`);
    }
  }
});
