// SPDX-License-Identifier: Apache-2.0
// The invented files the sync page measures with, written fresh each run. Every word is made up here; each sample
// plants words (DOE...) that must reach the index text. Two samples per type: a plain one, then an edit of it into a
// richer one (Word runs split mid-word and a table, Excel shared strings and a second sheet, PowerPoint notes, a
// second PDF page). Pages, Numbers and Keynote samples come from #66's invented files once they land.

// The PDF and Excel writers of the dev fixture, loaded by URL so web's own settings type-check them (collect.ts says why).
const { pdfBytes, xlsxBytes, zipStored } = await import(new URL('../../../web/scripts/dev-pdf.ts', import.meta.url).href);

export type FileType = 'pages' | 'numbers' | 'keynote' | 'word' | 'excel' | 'powerpoint' | 'pdf';

export interface Sample {
  /** Path inside the company folder, '/'-separated. Both samples of a type share it: the second is an edit. */
  rel: string;
  bytes: Buffer;
  words: string[];
}

export interface Planted {
  rel: string;
  /** A file's bytes, or a folder's entries (a package). */
  bytes?: Buffer;
  entries?: Record<string, Buffer>;
  words: string[];
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OFFICE = 'application/vnd.openxmlformats-officedocument';

const ooxml = (main: string, mainType: string, parts: Record<string, string>, types: Record<string, string>) =>
  zipStored(
    Object.entries({
      '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${main}" ContentType="${mainType}"/>${Object.entries(types).map(([part, type]) => `<Override PartName="/${part}" ContentType="${type}"/>`).join('')}</Types>`,
      '_rels/.rels': `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="${main}"/></Relationships>`,
      ...parts,
    }).map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') })),
  );

const rels = (targets: [string, string][]) =>
  `${XML}<Relationships xmlns="${PKG}">${targets.map(([type, target], i) => `<Relationship Id="rId${i + 1}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`;

/** A Word paragraph; each argument is its own run, so a word can be split across runs. */
const para = (...runs: string[]) => `<w:p>${runs.map((t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`).join('')}</w:p>`;

function docx(body: string): Buffer {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  return ooxml('word/document.xml', `${OFFICE}.wordprocessingml.document.main+xml`, { 'word/document.xml': `${XML}<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>` }, {});
}

/** Shared strings and two sheets, as Excel saves them. */
function xlsxShared(sheets: [string, string[][]][]): Buffer {
  const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const strings = [...new Set(sheets.flatMap(([, rows]) => rows.flat()))];
  const col = (c: number) => String.fromCharCode(65 + c);
  const sheet = (rows: string[][]) =>
    `${XML}<worksheet xmlns="${S}"><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => `<c r="${col(c)}${r + 1}" t="s"><v>${strings.indexOf(v)}</v></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const parts: Record<string, string> = {
    'xl/workbook.xml': `${XML}<workbook xmlns="${S}" xmlns:r="${REL}"><sheets>${sheets.map(([name], i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': rels([...sheets.map((_, i): [string, string] => ['worksheet', `worksheets/sheet${i + 1}.xml`]), ['sharedStrings', 'sharedStrings.xml']]),
    'xl/sharedStrings.xml': `${XML}<sst xmlns="${S}" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`,
  };
  const types: Record<string, string> = { 'xl/sharedStrings.xml': `${OFFICE}.spreadsheetml.sharedStrings+xml` };
  sheets.forEach(([, rows], i) => {
    parts[`xl/worksheets/sheet${i + 1}.xml`] = sheet(rows);
    types[`xl/worksheets/sheet${i + 1}.xml`] = `${OFFICE}.spreadsheetml.worksheet+xml`;
  });
  return ooxml('xl/workbook.xml', `${OFFICE}.spreadsheetml.sheet.main+xml`, parts, types);
}

/** Slides in order, each with optional speaker notes. */
function pptx(slides: { lines: string[]; notes?: string[] }[]): Buffer {
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const text = (lines: string[]) => `<p:cSld><p:spTree><p:sp><p:txBody>${lines.map((l) => `<a:p><a:r><a:t>${l}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp></p:spTree></p:cSld>`;
  const parts: Record<string, string> = {
    'ppt/presentation.xml': `${XML}<p:presentation ${NS} xmlns:r="${REL}"><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': rels(slides.map((_, i) => ['slide', `slides/slide${i + 1}.xml`])),
  };
  const types: Record<string, string> = {};
  slides.forEach((slide, i) => {
    parts[`ppt/slides/slide${i + 1}.xml`] = `${XML}<p:sld ${NS}>${text(slide.lines)}</p:sld>`;
    types[`ppt/slides/slide${i + 1}.xml`] = `${OFFICE}.presentationml.slide+xml`;
    if (!slide.notes) return;
    parts[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = rels([['notesSlide', `../notesSlides/notesSlide${i + 1}.xml`]]);
    parts[`ppt/notesSlides/notesSlide${i + 1}.xml`] = `${XML}<p:notes ${NS}>${text(slide.notes)}</p:notes>`;
    types[`ppt/notesSlides/notesSlide${i + 1}.xml`] = `${OFFICE}.presentationml.notesSlide+xml`;
  });
  return ooxml('ppt/presentation.xml', `${OFFICE}.presentationml.presentation.main+xml`, parts, types);
}

const w = (type: string, n: number) => `DOE${type}${n}`;

/** The two samples of each type this repository can write. iWork types have none until #66 brings them. */
export function samples(): Partial<Record<FileType, [Sample, Sample]>> {
  return {
    word: [
      { rel: 'Samples/Board consent.docx', bytes: docx(para(`Board consent ${w('WORDA', 1)}`) + para(`Founders approve the plan ${w('WORDA', 2)}`)), words: [w('WORDA', 1), w('WORDA', 2)] },
      {
        rel: 'Samples/Board consent.docx',
        bytes: docx(
          para('Board consent ', 'DOEWO', 'RDB1') +
            `<w:tbl><w:tr><w:tc>${para('Shares')}</w:tc><w:tc>${para(w('WORDB', 2))}</w:tc></w:tr><w:tr><w:tc>${para('Vesting')}</w:tc><w:tc>${para(w('WORDB', 3))}</w:tc></w:tr></w:tbl>` +
            para('Signed'),
        ),
        words: [w('WORDB', 1), w('WORDB', 2), w('WORDB', 3)],
      },
    ],
    excel: [
      { rel: 'Samples/Cap table.xlsx', bytes: xlsxBytes([['Holder', 'Shares'], [w('EXCELA', 1), '4000000'], [w('EXCELA', 2), '1000000']]), words: [w('EXCELA', 1), w('EXCELA', 2)] },
      {
        rel: 'Samples/Cap table.xlsx',
        bytes: xlsxShared([['Cap table', [['Holder', 'Class'], [w('EXCELB', 1), 'Common']]], ['Vesting', [['Cliff', w('EXCELB', 2)], ['Months', w('EXCELB', 3)]]]]),
        words: [w('EXCELB', 1), w('EXCELB', 2), w('EXCELB', 3)],
      },
    ],
    powerpoint: [
      { rel: 'Samples/Seed deck.pptx', bytes: pptx([{ lines: ['Seed round', w('DECKA', 1)] }]), words: [w('DECKA', 1)] },
      {
        rel: 'Samples/Seed deck.pptx',
        bytes: pptx([{ lines: ['Seed round', w('DECKB', 1)] }, { lines: ['Use of funds', w('DECKB', 2)], notes: ['Say the runway', w('DECKB', 3)] }]),
        words: [w('DECKB', 1), w('DECKB', 2), w('DECKB', 3)],
      },
    ],
    pdf: [
      { rel: 'Samples/Advisor agreement.pdf', bytes: pdfBytes([[`Advisor agreement ${w('PDFA', 1)}`, `Two years of advice ${w('PDFA', 2)}`]]), words: [w('PDFA', 1), w('PDFA', 2)] },
      { rel: 'Samples/Advisor agreement.pdf', bytes: pdfBytes([[`Advisor agreement ${w('PDFB', 1)}`], [`Signature page ${w('PDFB', 2)}`]]), words: [w('PDFB', 1), w('PDFB', 2)] },
    ],
  };
}

const cut = (bytes: Buffer): Buffer => bytes.subarray(0, Math.floor(bytes.length * 0.55));

/** Files the engine can't read, by computer. The package goes in a folder of its own (`collect.ts`). */
export function planted(computer: 'mac' | 'windows'): Planted[] {
  const cutPdf = { rel: 'Planted/Old minutes.pdf', bytes: cut(pdfBytes([[`Minutes ${w('CUT', 1)}`], [`Second page ${w('CUT', 2)}`]])), words: [w('CUT', 1), w('CUT', 2)] };
  if (computer === 'windows') {
    return [
      { rel: 'Planted/Broken offer.docx', bytes: Buffer.from('This is not a Word file.'), words: [] },
      { rel: 'Planted/Old budget.xlsx', bytes: cut(xlsxBytes([['Budget', w('CUTX', 1)]])), words: [w('CUTX', 1)] },
      cutPdf,
    ];
  }
  return [
    cutPdf,
    { rel: 'Planted/Broken memo.pages', bytes: Buffer.from('This is not a Pages file.'), words: [] },
    {
      rel: 'Board deck.key',
      entries: { 'Index.zip': zipStored([{ name: 'Index/Document.iwa', data: Buffer.from(w('PKG', 1)) }]), 'Metadata/Properties.plist': Buffer.from('<plist/>') },
      words: [],
    },
  ];
}

/** Everyday clutter the guard skips, which the gate still fingerprints, and a draft whose name is already taken. */
export const CLUTTER: Record<string, Buffer> = {
  '.DS_Store': Buffer.from('invented'),
  '~$Board consent.docx': Buffer.from('lock'),
  '.Old notes.pdf.icloud': Buffer.from('stub'),
  'Drafts/Advisor agreement.md': Buffer.from('# Advisor agreement\n\nAn earlier draft.\n'),
};

/** About a seed-stage folder: one invented PDF per checklist item, and recordings for its weight. */
export function filler(recordingBytes: number): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  for (let i = 1; i <= 85; i++) files[`Checklist/Item ${String(i).padStart(2, '0')}.pdf`] = pdfBytes([[`Checklist item ${i}`, 'An invented document.']]);
  for (let i = 1; i <= 4; i++) files[`Recordings/Board meeting ${i}.m4a`] = Buffer.alloc(recordingBytes, i);
  return files;
}
