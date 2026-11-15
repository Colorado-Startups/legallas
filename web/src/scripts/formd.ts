// SPDX-License-Identifier: Apache-2.0
// SEC Form D and Form D/A filings saved as their EDGAR XML (primary_doc.xml), set out as one page of plain text
// with every item labelled as on the form. The sync indexes this text (scripts/extract.ts directTextPages) and
// the text viewer shows the same text (doc-views.ts showText), so a cite's pinpoint quote is found on screen.
// Pure, with no DOM, so Node and the browser share it. A file that is not a Form D, or does not parse, gives
// null, and is shown and indexed as it is. Bump RENDER_VERSION (scripts/extract.ts) when the output changes.
// The page never states what the filing does not: an element the filing leaves out reads "not given", and "None"
// is kept for one that is present and empty.

interface XmlNode {
  name: string;
  text: string;
  children: XmlNode[];
  /** Set when a renderer read this leaf; leaves never read are listed under "Other fields". */
  used: boolean;
}

/** Larger files are left as they are: a Form D is about 10 KB. */
const MAX_CHARS = 1_000_000;
/** Open elements at most; a Form D nests 6 deep. Deeper input is refused, so nothing recurses without bound. */
const MAX_DEPTH = 64;
/** Only XML's five predefined entities and character references are decoded; nothing declares more. */
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
// Comments, the XML declaration, CDATA, a start or end tag (attributes ignored: Form D has none), or text.
// Nothing else matches, so a DOCTYPE (and with it any entity declaration) or an unterminated comment is refused.
const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.:-]*)(?:\s[^>]*?)?(\/?)>|([^<]+)/y;

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] !== '#') return ENTITIES[ref] ?? whole;
    const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** The element tree, or null for anything that is not one well-formed root element at most MAX_DEPTH deep. */
function parseXml(xml: string): XmlNode | null {
  const stack: XmlNode[] = [{ name: '', text: '', children: [], used: false }];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < xml.length) {
    const match = TOKEN.exec(xml);
    if (!match) return null;
    const [, cdata, close, tag, selfClose, text] = match;
    const top = stack[stack.length - 1]!; // safe: the document node is never popped
    if (text !== undefined || cdata !== undefined) {
      top.text += text !== undefined ? decode(text) : cdata;
    } else if (tag && close) {
      if (stack.length < 2 || top.name !== tag.replace(/^.*:/, '')) return null;
      stack.pop();
    } else if (tag) {
      const node: XmlNode = { name: tag.replace(/^.*:/, ''), text: '', children: [], used: false };
      top.children.push(node);
      if (selfClose) continue;
      if (stack.length > MAX_DEPTH) return null;
      stack.push(node);
    }
  }
  const [doc] = stack;
  return stack.length === 1 && doc!.children.length === 1 && doc!.text.trim() === '' ? doc!.children[0]! : null; // safe: checked
}

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

function kids(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((child) => child.name === name) : [];
}

function kid(node: XmlNode | undefined, ...path: string[]): XmlNode | undefined {
  let at = node;
  for (const name of path) at = kids(at, name)[0];
  return at;
}

/** A leaf's text, whitespace collapsed. Marks the leaf as read. */
function read(leaf: XmlNode): string {
  leaf.used = true;
  return clean(leaf.text);
}

/** The text of the leaf at `path`, or '' when absent: for optional parts that are left out when missing. */
function val(node: XmlNode | undefined, ...path: string[]): string {
  const leaf = kid(node, ...path);
  return leaf ? read(leaf) : '';
}

/** What the page says for an element the filing leaves out. */
export const NOT_GIVEN = 'not given';

/** A labelled field: its text when the element is present (even ''), NOT_GIVEN when it is absent. */
function field(node: XmlNode | undefined, ...path: string[]): string {
  const leaf = kid(node, ...path);
  return leaf ? read(leaf) : NOT_GIVEN;
}

/** "Amendment" or "New notice" only as isAmendment says; anything else as filed. */
const filingKind = (flag: string) => (flag === 'true' ? 'Amendment' : flag === 'false' ? 'New notice' : flag);

const yesNo = (flag: string) => (flag === 'true' ? 'Yes' : flag === 'false' ? 'No' : flag);
const grouped = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** "$18,420.55" for a plain number; anything else ("Indefinite", "not given") as it is. */
export function money(amount: string): string {
  const match = /^(\d+)(\.\d+)?$/.exec(amount);
  return match ? `$${grouped(match[1]!)}${match[2] ?? ''}` : amount; // safe: group 1 always matches
}

const count = (n: string) => (/^\d+$/.test(n) ? grouped(n) : n);

/** Item 6 codes as the EDGAR Form D XML technical specification lists them. */
const EXEMPTIONS: Record<string, string> = {
  '04': 'Rule 504(b)(1) (not (i), (ii) or (iii))',
  '04.1': 'Rule 504(b)(1)(i)',
  '04.2': 'Rule 504(b)(1)(ii)',
  '04.3': 'Rule 504(b)(1)(iii)',
  '05': 'Rule 505',
  '06': 'Rule 506',
  '06b': 'Rule 506(b)',
  '06c': 'Rule 506(c)',
  '4a5': 'Securities Act Section 4(a)(5)',
  '3C': 'Investment Company Act Section 3(c)',
};

/** The words for an exemption code, such as Investment Company Act Section 3(c)(7); an unknown code reads "Code X". */
export function exemptionLabel(code: string): string {
  const section = /^3C\.(\d{1,2})$/.exec(code);
  if (section) return `Investment Company Act Section 3(c)(${section[1]})`;
  return EXEMPTIONS[code] ?? `Code ${code}`;
}

function address(node: XmlNode | undefined): string {
  if (!node) return NOT_GIVEN;
  const street = [val(node, 'street1'), val(node, 'street2')].filter(Boolean).join(', ');
  const place = [val(node, 'city'), [val(node, 'stateOrCountry'), val(node, 'zipCode')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const described = val(node, 'stateOrCountryDescription');
  return [street, place].filter(Boolean).join(', ') + (described ? ` (${described})` : '');
}

/** "Pat A. Teller"; EDGAR's "N/A" first name on an entity is left out. */
function personName(node: XmlNode | undefined): string {
  if (!node) return NOT_GIVEN;
  return ['firstName', 'middleName', 'lastName'].map((part) => val(node, part)).filter((part) => part && part.toUpperCase() !== 'N/A').join(' ');
}

function previousNames(list: XmlNode | undefined): string {
  if (!list) return NOT_GIVEN;
  const names = (list?.children ?? []).map(read).filter(Boolean);
  return names.length ? names.join('; ') : 'None';
}

function issuerLines(issuer: XmlNode | undefined): string[] {
  const year = kid(issuer, 'yearOfInc');
  const when = val(year, 'withinFiveYears') === 'true' ? ' (within the last five years)' : '';
  const age = val(year, 'overFiveYears') === 'true' ? 'Over five years ago' : val(year, 'yetToBeFormed') === 'true' ? 'Yet to be formed' : '';
  const other = val(issuer, 'entityTypeOtherDesc');
  return [
    `Name of issuer: ${field(issuer, 'entityName')}`,
    `CIK (filer ID number): ${field(issuer, 'cik')}`,
    `Jurisdiction of incorporation or organization: ${field(issuer, 'jurisdictionOfInc')}`,
    `Entity type: ${field(issuer, 'entityType')}${other ? ` (${other})` : ''}`,
    `Year of incorporation or organization: ${year ? `${[val(year, 'value'), age].filter(Boolean).join(' ')}${when}` : NOT_GIVEN}`,
    `Previous names: ${previousNames(kid(issuer, 'issuerPreviousNameList'))}`,
    `EDGAR previous names: ${previousNames(kid(issuer, 'edgarPreviousNameList'))}`,
  ];
}

function relatedPersons(list: XmlNode | undefined): string[] {
  if (!list) return [`Related persons: ${NOT_GIVEN}`];
  const people = kids(list, 'relatedPersonInfo');
  if (!people.length) return ['None listed'];
  return people.flatMap((person, i) => {
    const roleList = kid(person, 'relatedPersonRelationshipList');
    const roles = kids(roleList, 'relationship').map(read);
    const note = val(person, 'relationshipClarification');
    return [
      `${i + 1}. ${personName(kid(person, 'relatedPersonName'))}`,
      `   Relationship: ${roleList ? roles.join(', ') || 'None' : NOT_GIVEN}`,
      ...(note ? [`   Clarification: ${note}`] : []),
      `   Address: ${address(kid(person, 'relatedPersonAddress'))}`,
    ];
  });
}

function recipients(list: XmlNode | undefined): string[] {
  if (!list) return [`Recipients: ${NOT_GIVEN}`];
  const people = kids(list, 'recipient');
  if (!people.length) return ['Recipients: none listed'];
  return people.flatMap((person, i) => {
    const states = (kid(person, 'statesOfSolicitationList')?.children ?? []).map(read);
    const crd = val(person, 'recipientCRDNumber');
    const dealer = val(person, 'associatedBDName');
    const dealerCrd = val(person, 'associatedBDCRDNumber');
    return [
      `${i + 1}. ${field(person, 'recipientName')}${crd ? ` (CRD ${crd})` : ''}`,
      ...(dealer ? [`   Associated broker-dealer: ${dealer}${dealerCrd ? ` (CRD ${dealerCrd})` : ''}`] : []),
      `   Address: ${address(kid(person, 'recipientAddress'))}`,
      ...(states.length ? [`   States of solicitation: ${states.join(', ')}`] : []),
    ];
  });
}

const SECURITY_TYPES: [string, string][] = [
  ['isEquityType', 'Equity'],
  ['isDebtType', 'Debt'],
  ['isOptionToAcquireType', 'Option, warrant or other right to acquire another security'],
  ['isSecurityToBeAcquiredType', 'Security to be acquired upon exercise of option, warrant or other right'],
  ['isPooledInvestmentFundType', 'Pooled investment fund interests'],
  ['isTenantInCommonType', 'Tenant-in-common securities'],
  ['isMineralPropertyType', 'Mineral property securities'],
];

function securityTypes(types: XmlNode | undefined): string[] {
  if (!types) return [`Types of securities: ${NOT_GIVEN}`];
  const lines = SECURITY_TYPES.filter(([flag]) => val(types, flag) === 'true').map(([, label]) => label);
  if (val(types, 'isOtherType') === 'true') lines.push(`Other: ${field(types, 'descriptionOfOtherType')}`);
  return lines.length ? lines : ['None marked'];
}

/** "$0 (estimate)" for a dollarAmount/isEstimate pair. */
function estimate(node: XmlNode | undefined): string {
  if (!node) return NOT_GIVEN;
  return `${money(field(node, 'dollarAmount'))}${val(node, 'isEstimate') === 'true' ? ' (estimate)' : ''}`;
}

const clarify = (node: XmlNode | undefined) => {
  const text = val(node, 'clarificationOfResponse');
  return text ? [`Clarification: ${text}`] : [];
};

function signatures(block: XmlNode | undefined): string[] {
  if (!block) return [`Signature block: ${NOT_GIVEN}`];
  const signed = kids(block, 'signature');
  const lines = signed.flatMap((sig) => [
    `Issuer: ${field(sig, 'issuerName')}`,
    `Signature: ${field(sig, 'signatureName')}`,
    `Name of signer: ${field(sig, 'nameOfSigner')}`,
    `Title: ${field(sig, 'signatureTitle')}`,
    `Date: ${field(sig, 'signatureDate')}`,
  ]);
  return [...(signed.length ? lines : ['Signatures: none listed']), `Authorized representative: ${yesNo(field(block, 'authorizedRepresentative'))}`];
}

/** Non-empty leaves no renderer read, as "path: value", so nothing in the filing is left out silently. */
function leftovers(node: XmlNode, prefix = ''): string[] {
  const path = prefix ? `${prefix}/${node.name}` : node.name;
  if (!node.children.length) return !node.used && clean(node.text) ? [`${path}: ${clean(node.text)}`] : [];
  return node.children.flatMap((child) => leftovers(child, path));
}

/** Accession number and date from the room's file name (FormD__2011-10-25__Name__0009990007-11-000018.xml). */
function fromFileName(fileName: string): { accession: string; date: string } {
  const accession = /(?<!\d)\d{10}-\d{2}-\d{6}(?!\d)/.exec(fileName)?.[0] ?? '';
  const date = /(?<!\d)\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?!\d)/.exec(fileName.replace(accession, ''))?.[0] ?? '';
  return { accession, date };
}

/** The parts of the filing the sections read, found once; a part the filing leaves out is undefined. */
interface Filing {
  root: XmlNode;
  form: 'D' | 'D/A';
  issuer: XmlNode | undefined;
  offering: XmlNode | undefined;
  name: string;
  cik: string;
  accession: string;
  date: string;
  exemptions: XmlNode | undefined;
  /** The exemption codes claimed. */
  codes: string[];
  relatedList: XmlNode | undefined;
  filing: XmlNode | undefined;
  firstSale: string;
  amounts: XmlNode | undefined;
  investors: XmlNode | undefined;
  /** The related persons' names, for the summary. */
  people: string[];
  sig: XmlNode | undefined;
  industry: XmlNode | undefined;
  size: XmlNode | undefined;
  fees: XmlNode | undefined;
  proceeds: XmlNode | undefined;
  combination: XmlNode | undefined;
  nonAccredited: string;
  otherIssuers: XmlNode[];
}

function readFiling(root: XmlNode, form: 'D' | 'D/A', fileName: string): Filing {
  const issuer = kid(root, 'primaryIssuer');
  const offering = kid(root, 'offeringData');
  const exemptions = kid(offering, 'federalExemptionsExclusions');
  const relatedList = kid(root, 'relatedPersonsList');
  const filing = kid(offering, 'typeOfFiling');
  const investors = kid(offering, 'investors');
  return {
    root, form, issuer, offering,
    name: field(issuer, 'entityName'),
    cik: field(issuer, 'cik'),
    ...fromFileName(fileName),
    exemptions,
    codes: kids(exemptions, 'item').map(read),
    relatedList,
    filing,
    firstSale: val(filing, 'dateOfFirstSale', 'value') || (val(filing, 'dateOfFirstSale', 'yetToOccur') === 'true' ? 'Yet to occur' : NOT_GIVEN),
    amounts: kid(offering, 'offeringSalesAmounts'),
    investors,
    people: kids(relatedList, 'relatedPersonInfo').map((p) => personName(kid(p, 'relatedPersonName'))),
    sig: kid(offering, 'signatureBlock', 'signature'),
    industry: kid(offering, 'industryGroup'),
    size: kid(offering, 'issuerSize'),
    fees: kid(offering, 'salesCommissionsFindersFees'),
    proceeds: kid(offering, 'useOfProceeds'),
    combination: kid(offering, 'businessCombinationTransaction'),
    nonAccredited: val(investors, 'numberNonAccreditedInvestors'),
    otherIssuers: kids(kid(root, 'issuerList'), 'issuer'),
  };
}

/** The title block: the form, the issuer and where the filing came from. */
function titleSection(f: Filing): string[] {
  const { accession, date, cik } = f;
  return [
    `SEC Form ${f.form}, Notice of Exempt Offering of Securities${f.form === 'D/A' ? ' (amendment)' : ''}`,
    `Issuer: ${f.name} (CIK ${cik})`,
    ...(accession ? [`Accession number (from the file name): ${accession}`] : []),
    ...(date ? [`Date in the file name: ${date}`] : []),
    ...(accession && /^\d+$/.test(cik) ? [`EDGAR: https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/`] : []),
    "Set out as text by the room from the filing's EDGAR XML; the XML file is the original.",
  ];
}

/** The summary: the main facts again, restated from the items below. */
function glanceSection(f: Filing): string[] {
  const { form, name, cik, issuer, exemptions, codes, amounts, investors, relatedList, people, sig } = f;
  return [
    'At a glance (restated from the items below):',
    `- Form ${form} for ${name}, CIK ${cik}; jurisdiction ${field(issuer, 'jurisdictionOfInc')}; entity type ${field(issuer, 'entityType')}.`,
    `- Exemptions claimed: ${!exemptions ? NOT_GIVEN : codes.length ? codes.map(exemptionLabel).join('; ') : 'none'}.`,
    `- Total amount sold ${money(field(amounts, 'totalAmountSold'))}; total offering amount ${money(field(amounts, 'totalOfferingAmount'))}; investors ${count(field(investors, 'totalNumberAlreadyInvested'))}.`,
    `- Date of first sale ${f.firstSale}; total remaining ${money(field(amounts, 'totalRemaining'))}.`,
    `- Related persons: ${!relatedList ? NOT_GIVEN : people.length ? people.join('; ') : 'none listed'}.`,
    ...(sig ? [`- Signed ${field(sig, 'signatureDate')} by ${field(sig, 'nameOfSigner')}, ${field(sig, 'signatureTitle')}.`] : []),
  ];
}

/** Items 1 to 3: the issuers, where they are and who is related to them. */
function issuerSections(f: Filing): string[][] {
  const { issuer, root } = f;
  return [
    ["Item 1. Issuer's identity", ...issuerLines(issuer)],
    ...f.otherIssuers.map((other, i) => [`Item 1. Other issuer ${i + 1}`, ...issuerLines(other), `Address: ${address(kid(other, 'issuerAddress'))}`, `Phone: ${field(other, 'issuerPhoneNumber')}`]),
    [
      'Item 2. Principal place of business and contact information',
      `Address: ${address(kid(issuer, 'issuerAddress'))}`,
      `Phone: ${field(issuer, 'issuerPhoneNumber')}`,
    ],
    ['Item 3. Related persons', ...relatedPersons(kid(root, 'relatedPersonsList'))],
  ];
}

/** Items 4 and 5: the industry group and the issuer's size. */
function industrySections(f: Filing): string[][] {
  const { industry, size } = f;
  return [
    [
      'Item 4. Industry group',
      `Industry group: ${field(industry, 'industryGroupType')}`,
      ...(kid(industry, 'investmentFundInfo')
        ? [
            `Investment fund type: ${field(industry, 'investmentFundInfo', 'investmentFundType')}`,
            `Registered or required to register under the Investment Company Act of 1940: ${yesNo(field(industry, 'investmentFundInfo', 'is40Act'))}`,
          ]
        : []),
    ],
    [
      'Item 5. Issuer size',
      ...(kid(size, 'revenueRange') ? [`Revenue range: ${val(size, 'revenueRange')}`] : []),
      ...(kid(size, 'aggregateNetAssetValueRange') ? [`Aggregate net asset value range: ${val(size, 'aggregateNetAssetValueRange')}`] : []),
      ...(kid(size, 'revenueRange') || kid(size, 'aggregateNetAssetValueRange') ? [] : [`Issuer size: ${NOT_GIVEN}`]),
    ],
  ];
}

/** Items 6 to 9: the exemptions claimed, the kind of filing, how long the offering runs and what is offered. */
function offeringTermsSections(f: Filing): string[][] {
  const { exemptions, codes, filing, offering } = f;
  return [
    [
      'Item 6. Federal exemptions and exclusions claimed',
      ...(!exemptions ? [`Exemptions and exclusions: ${NOT_GIVEN}`] : codes.length ? codes.map((code) => `${exemptionLabel(code)} (code ${code})`) : ['None']),
    ],
    [
      'Item 7. Type of filing',
      `New notice or amendment: ${filingKind(field(filing, 'newOrAmendment', 'isAmendment'))}`,
      ...(kid(filing, 'newOrAmendment', 'previousAccessionNumber') ? [`Previous accession number: ${val(filing, 'newOrAmendment', 'previousAccessionNumber')}`] : []),
      `Date of first sale: ${f.firstSale}`,
    ],
    ['Item 8. Duration of offering', `Does the issuer intend this offering to last more than one year: ${yesNo(field(offering, 'durationOfOffering', 'moreThanOneYear'))}`],
    ['Item 9. Types of securities offered', ...securityTypes(kid(offering, 'typesOfSecuritiesOffered'))],
  ];
}

/** Items 10 to 13: the business combination, the minimum investment, sales compensation and the amounts. */
function offeringAmountSections(f: Filing): string[][] {
  const { combination, offering, amounts } = f;
  return [
    [
      'Item 10. Business combination transaction',
      `Is this offering being made in connection with a business combination transaction: ${yesNo(field(combination, 'isBusinessCombinationTransaction'))}`,
      ...clarify(combination),
    ],
    ['Item 11. Minimum investment', `Minimum investment accepted from any outside investor: ${money(field(offering, 'minimumInvestmentAccepted'))}`],
    ['Item 12. Sales compensation', ...recipients(kid(offering, 'salesCompensationList'))],
    [
      'Item 13. Offering and sales amounts',
      `Total offering amount: ${money(field(amounts, 'totalOfferingAmount'))}`,
      `Total amount sold: ${money(field(amounts, 'totalAmountSold'))}`,
      `Total remaining to be sold: ${money(field(amounts, 'totalRemaining'))}`,
      ...clarify(amounts),
    ],
  ];
}

/** Items 14 to 16: the investors, the fees and the use of proceeds. */
function investorSections(f: Filing): string[][] {
  const { investors, fees, proceeds, nonAccredited } = f;
  return [
    [
      'Item 14. Investors',
      `Securities sold to non-accredited investors: ${yesNo(field(investors, 'hasNonAccreditedInvestors'))}`,
      ...(nonAccredited ? [`Number of non-accredited investors: ${count(nonAccredited)}`] : []),
      `Total number of investors who already have invested in the offering: ${count(field(investors, 'totalNumberAlreadyInvested'))}`,
    ],
    [
      "Item 15. Sales commissions and finders' fees expenses",
      `Sales commissions: ${estimate(kid(fees, 'salesCommissions'))}`,
      `Finders' fees: ${estimate(kid(fees, 'findersFees'))}`,
      ...clarify(fees),
    ],
    [
      'Item 16. Use of proceeds',
      `Gross proceeds used for payments to executive officers, directors or promoters: ${estimate(kid(proceeds, 'grossProceedsUsed'))}`,
      ...clarify(proceeds),
    ],
  ];
}

/**
 * The filing as one page of labelled text, or null when `xml` is not a Form D or Form D/A edgarSubmission.
 * `fileName` supplies the accession number and date, which the XML does not carry. The text names "the room", never
 * "the counsel room": scripts/extract.ts indexes it at sync without knowing the room's shape, so a room with no matter
 * must read the same words its viewer shows, and Ask or a connected AI may quote them.
 */
export function renderFormD(xml: string, fileName: string): string | null {
  const source = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
  if (source.length > MAX_CHARS || !source.includes('edgarSubmission')) return null;
  const root = parseXml(source);
  if (root?.name !== 'edgarSubmission') return null;
  const form = val(root, 'submissionType');
  if (form !== 'D' && form !== 'D/A') return null;

  const f = readFiling(root, form, fileName);
  const sections: string[][] = [
    titleSection(f),
    glanceSection(f),
    ...issuerSections(f),
    ...industrySections(f),
    ...offeringTermsSections(f),
    ...offeringAmountSections(f),
    ...investorSections(f),
    ['Signature', ...signatures(kid(f.offering, 'signatureBlock'))],
    ['Submission', `EDGAR schema version: ${field(root, 'schemaVersion')}`, `Test or live: ${field(root, 'testOrLive')}`],
  ];
  const rest = leftovers(root).map((line) => line.replace(/^edgarSubmission\//, ''));
  if (rest.length) sections.push(['Other fields in the XML (not set out above)', ...rest]);
  return sections.map((lines) => lines.join('\n')).join('\n\n') + '\n';
}
