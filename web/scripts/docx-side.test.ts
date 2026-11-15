// SPDX-License-Identifier: Apache-2.0
// A Word file's footnotes, endnotes, headers and footers reach the index on every computer; comments and tracked
// deletions don't (#223). Run from web/: node --test scripts/docx-side.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { officeText } from './office.ts';
import { docxSideText, docxText } from './office-read.ts';

/** A zip archive of the given entries, deflated as Word writes them. */
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

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/** An invented .docx whose body, footnote, endnote, header, footer and comment each hold a marker, as Word lays one out. */
function sample(): Buffer {
  const parts: Record<string, [string, string, string]> = {
    'word/footnotes.xml': ['footnotes', 'footnotes', `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1">${para('FOOTNOTE MARKER Harbor Labs')}</w:footnote></w:footnotes>`],
    'word/endnotes.xml': ['endnotes', 'endnotes', `<w:endnotes xmlns:w="${W}"><w:endnote w:id="1">${para('ENDNOTE MARKER')}</w:endnote></w:endnotes>`],
    'word/header1.xml': ['header', 'header', `<w:hdr xmlns:w="${W}">${para('HEADER MARKER Doe v. Harbor Labs')}</w:hdr>`],
    'word/footer1.xml': ['footer', 'footer', `<w:ftr xmlns:w="${W}">${para('FOOTER MARKER Confidential')}</w:ftr>`],
    'word/comments.xml': ['comments', 'comments', `<w:comments xmlns:w="${W}"><w:comment w:id="0">${para('COMMENT MARKER')}</w:comment></w:comments>`],
  };
  const body = `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${para('BODY MARKER Stock Purchase Agreement')}<w:p><w:r><w:t>Kept</w:t></w:r><w:del w:id="9"><w:r><w:delText>DELETED MARKER</w:delText></w:r></w:del></w:p><w:sectPr><w:headerReference w:type="default" r:id="rId3"/><w:footerReference w:type="default" r:id="rId4"/></w:sectPr></w:body></w:document>`;
  const ids = ['rId1', 'rId2', 'rId3', 'rId4', 'rId5'];
  return zip({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${TYPE}.document.main+xml"/>${Object.entries(parts).map(([name, [type]]) => `<Override PartName="/${name}" ContentType="${TYPE}.${type}+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Object.entries(parts).map(([name, [, rel]], i) => `<Relationship Id="${ids[i]}" Type="${R}/${rel}" Target="${path.posix.basename(name)}"/>`).join('')}</Relationships>`,
    'word/document.xml': body,
    ...Object.fromEntries(Object.entries(parts).map(([name, [, , xml]]) => [name, xml])),
  });
}

const SIDE = ['FOOTNOTE MARKER Harbor Labs', 'ENDNOTE MARKER', 'HEADER MARKER Doe v. Harbor Labs', 'FOOTER MARKER Confidential'];

test('footnotes, endnotes, headers and footers are read with no outside tool; comments and deletions are not', () => {
  assert.equal(docxSideText(sample()), SIDE.join('\n'));
  const text = docxText(sample());
  assert.equal(text, ['BODY MARKER Stock Purchase Agreement', 'Kept', ...SIDE].join('\n'));
  assert.doesNotMatch(text, /COMMENT MARKER|DELETED MARKER/);
});

test('on the Mac, textutil\'s body is followed by the same parts', { skip: process.platform !== 'darwin' && 'textutil is macOS only' }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'docx-side-'));
  try {
    const file = path.join(dir, '000001.docx');
    await writeFile(file, sample());
    const text = await officeText(file, 'docx');
    assert.match(text, /BODY MARKER Stock Purchase Agreement/);
    for (const line of SIDE) assert.ok(text.includes(line), line);
    assert.doesNotMatch(text, /COMMENT MARKER|DELETED MARKER/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
