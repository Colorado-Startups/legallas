// SPDX-License-Identifier: Apache-2.0
// Tiny writers for the Word and PowerPoint samples, in the style of web/scripts/dev-pdf.ts: deterministic bytes, a
// stored zip, no packages. Excel comes from dev-pdf's xlsxBytes as it stands.
import { devPdf } from './web.ts';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const esc = (text: string) => text.replace(/[<>&"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PRES_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const DRAW_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

const pack = (parts: readonly [string, string][]) => devPdf.zipStored(parts.map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') })));

/** A Word document of plain paragraphs. */
export function docxBytes(paragraphs: readonly string[]): Buffer {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join('');
  return pack([
    ['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`],
    ['_rels/.rels', `${XML}<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="word/document.xml"/></Relationships>`],
    ['word/document.xml', `${XML}<w:document xmlns:w="${WORD_NS}"><w:body>${body}<w:sectPr/></w:body></w:document>`],
  ]);
}

const NS = `xmlns:a="${DRAW_NS}" xmlns:r="${REL_NS}" xmlns:p="${PRES_NS}"`;
const NO_TREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';

function slideXml(lines: readonly string[]): string {
  const paragraphs = lines.map((line) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${esc(line)}</a:t></a:r></a:p>`).join('');
  const box = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="457200"/><a:ext cx="8229600" cy="5943600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
  return `${XML}<p:sld ${NS}><p:cSld><p:spTree>${NO_TREE}${box}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const THEME = `${XML}<a:theme xmlns:a="${DRAW_NS}" name="Sample"><a:themeElements><a:clrScheme name="Sample"><a:dk1><a:srgbClr val="1F3A2E"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F3A2E"/></a:dk2><a:lt2><a:srgbClr val="FAF7F0"/></a:lt2><a:accent1><a:srgbClr val="A98B4F"/></a:accent1><a:accent2><a:srgbClr val="A98B4F"/></a:accent2><a:accent3><a:srgbClr val="A98B4F"/></a:accent3><a:accent4><a:srgbClr val="A98B4F"/></a:accent4><a:accent5><a:srgbClr val="A98B4F"/></a:accent5><a:accent6><a:srgbClr val="A98B4F"/></a:accent6><a:hlink><a:srgbClr val="1F3A2E"/></a:hlink><a:folHlink><a:srgbClr val="1F3A2E"/></a:folHlink></a:clrScheme><a:fontScheme name="Sample"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Sample"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

/** A PowerPoint file with one text box per slide. */
export function pptxBytes(slides: readonly (readonly string[])[]): Buffer {
  const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${REL_NS}/${type}" Target="${target}"/>`;
  const rels = (inner: string) => `${XML}<Relationships xmlns="${PKG_REL_NS}">${inner}</Relationships>`;
  const emptySlide = `<p:cSld><p:spTree>${NO_TREE}</p:spTree></p:cSld>`;
  const overrides = slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
  return pack([
    ['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${overrides}</Types>`],
    ['_rels/.rels', rels(rel('rId1', 'officeDocument', 'ppt/presentation.xml'))],
    ['ppt/presentation.xml', `${XML}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`],
    ['ppt/_rels/presentation.xml.rels', rels(rel('rId1', 'slideMaster', 'slideMasters/slideMaster1.xml') + slides.map((_, i) => rel(`rId${i + 2}`, 'slide', `slides/slide${i + 1}.xml`)).join(''))],
    ['ppt/slideMasters/slideMaster1.xml', `${XML}<p:sldMaster ${NS}>${emptySlide}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', rels(rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml') + rel('rId2', 'theme', '../theme/theme1.xml'))],
    ['ppt/slideLayouts/slideLayout1.xml', `${XML}<p:sldLayout ${NS} type="blank">${emptySlide}</p:sldLayout>`],
    ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels(rel('rId1', 'slideMaster', '../slideMasters/slideMaster1.xml'))],
    ['ppt/theme/theme1.xml', THEME],
    ...slides.flatMap((lines, i): [string, string][] => [
      [`ppt/slides/slide${i + 1}.xml`, slideXml(lines)],
      [`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels(rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'))],
    ]),
  ]);
}
