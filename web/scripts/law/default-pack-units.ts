// SPDX-License-Identifier: Apache-2.0
// What the default law pack holds: which acts and rule sets, in what order, from where. No law text lives here or
// anywhere in this repository. Each install downloads the text into its owner's own account (default-pack.ts), which
// is what lets the pack cover sources whose text can't clearly ship. The list and its reasons are in
// docs/design/law-pack-plan.toml, under the same ids; a pack unit is one whole act or rule set, and a law unit
// (types.ts) is one citable section of it.
import type { LawKind, LawTrack } from '../../worker/law-cite.ts';
import { cfrAnnualUrl } from './cfr-annual.ts';
import { uscUrl } from './sources.ts';
import type { RuleSet } from './uscourts-rules.ts';

/** The level of law a pack unit covers: federal, Delaware or Colorado. */
export type PackLevel = 'federal' | 'Delaware' | 'Colorado';
/** The layer a pack unit belongs to: agreements, securities or other. */
export type PackLayer = 'agreements' | 'securities' | 'other';
/** The path through the product that a pack unit serves, such as startup-forms or fights. */
export type PackPath = 'startup-forms' | 'startup-raises' | 'angels-invest' | 'angels-create-groups' | 'vcs-invest' | 'fights';

/** What must come back for an act to count as whole. A later amendment can add sections; these stop a partial one. */
export interface WholeCheck {
  /** Fewer sections than this and the unit fails. */
  minSections: number;
  /** Sections that must be present, first and last among them. */
  sections: readonly string[];
}

/** Where a pack unit's text comes from, such as a govinfo statute compilation. */
export type PackSource =
  /** A govinfo Statute Compilation. `uncoded`: act sections the file gives no U.S. Code note for, checked by hand. */
  | { kind: 'compilation'; pkg: string; act: string; uscTitle: number; uncoded?: Readonly<Record<string, string>> }
  /** Whole C.F.R. parts from govinfo's eCFR bulk file. `rule`: what practitioners call a section, as in "Securities Act Rule 144". */
  | { kind: 'ecfr-parts'; title: number; parts: readonly number[]; rule: string }
  /** A whole chapter of the Delaware Code, or one whole subchapter of it ("02" for subchapter II). */
  | { kind: 'delaware'; title: number; chapter: string; subchapter?: string }
  /** Whole articles of a C.R.S. title (or only `sections` of them, or only whole `parts`) from the olls.info download. */
  | { kind: 'crs'; title: number; articles: readonly string[]; sections?: readonly string[]; parts?: readonly number[] }
  /** Sections of one U.S. Code title, each from its page on uscode.house.gov, which is current where govinfo's edition lags a year or more. */
  | { kind: 'uscode'; title: number; sections: readonly string[]; name: string }
  /**
   * Sections of one C.F.R. title, each its own file in govinfo's annual edition (cfr-annual.ts): for a few sections of a
   * title whose eCFR bulk file is too large to read for them. `name` is what lawyers call the rules ("Treas. Reg.").
   */
  | { kind: 'cfr-sections'; title: number; sections: readonly string[]; name: string }
  /**
   * Text only a person may download: the site's terms bar robots, or it offers machines no stable way in. The address
   * names the copy in the raw cache and is never fetched. `parser` is null until the layout has been checked on a real copy.
   */
  | { kind: 'person'; address: string; steps: string; parser: 'colorado-rules' | null }
  /** The SEC staff's interpretations of the Securities Act rules, from sec.gov. */
  | { kind: 'sec-interpretations' }
  /** Part 279 from the eCFR bulk file and the Form ADV instructions from sec.gov. */
  | { kind: 'form-adv' }
  /** Form D's terms and instructions from sec.gov. The rule that names it, 17 CFR 239.500, comes with Part 239. */
  | { kind: 'form-d' }
  /** A federal rule set from its House Judiciary Committee print on uscourts.gov (uscourts-rules.ts), one unit per rule. */
  | { kind: 'uscourts-rules'; set: RuleSet }
  /** Named in documents and linked; no text is stored. */
  | { kind: 'cited' };

/** One unit of the default law pack plan, with a stable id. */
export interface PackUnit {
  /** The plan's id. Stable; never reused. */
  id: string;
  title: string;
  citation: string;
  level: PackLevel;
  layer: PackLayer;
  paths: readonly PackPath[];
  /** The page a person opens to read it. */
  link: string;
  source: PackSource;
  track: LawTrack;
  kind: LawKind;
  whole?: WholeCheck;
}

function compilation(id: string, title: string, citation: string, paths: readonly PackPath[], pkg: string, whole: WholeCheck, uncoded?: Readonly<Record<string, string>>): PackUnit {
  return {
    id,
    title,
    citation,
    level: 'federal',
    layer: 'securities',
    paths,
    link: `https://www.govinfo.gov/content/pkg/${pkg}/pdf/${pkg}.pdf`,
    source: { kind: 'compilation', pkg, act: title, uscTitle: 15, ...(uncoded ? { uncoded } : {}) },
    track: 'both',
    kind: 'statute',
    whole,
  };
}

function secRules(id: string, title: string, citation: string, paths: readonly PackPath[], parts: readonly number[], rule: string, whole: WholeCheck): PackUnit {
  return {
    id,
    title,
    citation,
    level: 'federal',
    layer: 'securities',
    paths,
    link: `https://www.ecfr.gov/current/title-17/chapter-II/part-${parts.at(-1)}`,
    source: { kind: 'ecfr-parts', title: 17, parts, rule },
    track: 'both',
    kind: 'regulation',
    whole,
  };
}

function delaware(id: string, title: string, citation: string, layer: PackLayer, paths: readonly PackPath[], code: { title: number; chapter: string; subchapter?: string }, whole: WholeCheck): PackUnit {
  return {
    id,
    title,
    citation,
    level: 'Delaware',
    layer,
    paths,
    link: `https://delcode.delaware.gov/title${code.title}/c${code.chapter}/${code.subchapter ? `sc${code.subchapter}/` : ''}index.html`,
    source: { kind: 'delaware', ...code },
    track: 'both',
    kind: 'statute',
    whole,
  };
}

function colorado(id: string, title: string, citation: string, layer: PackLayer, paths: readonly PackPath[], code: { title: number; articles: readonly string[]; sections?: readonly string[]; parts?: readonly number[] }, whole: WholeCheck): PackUnit {
  return {
    id,
    title,
    citation,
    level: 'Colorado',
    layer,
    paths,
    link: `https://olls.info/crs/crs2026-title-${String(code.title).padStart(2, '0')}.pdf`,
    source: { kind: 'crs', ...code },
    track: 'both',
    kind: 'statute',
    whole,
  };
}

/** A U.S. Code section's page on uscode.house.gov (sources.ts uscUrl, which the core `usc` source reads too). */
export const uscodeUrl = uscUrl;

/** Each section is its own page, so every one must come back. `name` is what lawyers call the act, for each section's title. */
function uscode(id: string, title: string, citation: string, paths: readonly PackPath[], code: { title: number; sections: readonly string[]; name: string }): PackUnit {
  return {
    id,
    title,
    citation,
    level: 'federal',
    layer: 'other',
    paths,
    link: uscodeUrl(code.title, code.sections[0]!),
    source: { kind: 'uscode', ...code },
    track: 'both',
    kind: 'statute',
    whole: { minSections: code.sections.length, sections: code.sections },
  };
}

/** Each section is its own file, so every one must come back. The link is the first section's PDF, the official text. */
function cfrSections(id: string, title: string, citation: string, paths: readonly PackPath[], rules: { title: number; sections: readonly string[]; name: string }): PackUnit {
  return {
    id,
    title,
    citation,
    level: 'federal',
    layer: 'other',
    paths,
    link: cfrAnnualUrl(rules.title, rules.sections[0]!, 'pdf'),
    source: { kind: 'cfr-sections', ...rules },
    track: 'both',
    kind: 'regulation',
    whole: { minSections: rules.sections.length, sections: rules.sections },
  };
}

/** Article numbers from `first` to `last`. */
function articles(first: number, last: number, repealed: readonly number[] = []): string[] {
  return Array.from({ length: last - first + 1 }, (_, i) => first + i)
    .filter((n) => !repealed.includes(n))
    .map(String);
}

function cited(id: string, title: string, citation: string, level: PackLevel, layer: PackLayer, paths: readonly PackPath[], link: string): PackUnit {
  return { id, title, citation, level, layer, paths, link, source: { kind: 'cited' }, track: 'both', kind: 'statute' };
}

const ALL_PATHS: readonly PackPath[] = ['startup-forms', 'startup-raises', 'angels-invest', 'angels-create-groups', 'vcs-invest', 'fights'];

/**
 * Every unit, stored ones in upload order: when a month's AI Search allowance can't hold the whole pack, acts go up whole
 * in this order and the rest wait (plan.ts stagePlan). The two largest, the Exchange Act and its rules, come last. The rest
 * follow the plan's build order, so the documents a founder needs first are searchable first.
 */
export const DEFAULT_PACK_UNITS: readonly PackUnit[] = [
  colorado('co-llc-act', 'Colorado Limited Liability Company Act', 'C.R.S. 7-80-101 to 7-80-1224', 'agreements', ['startup-forms', 'startup-raises', 'angels-invest', 'angels-create-groups', 'vcs-invest', 'fights'], { title: 7, articles: ['80'] }, { minSections: 80, sections: ['7-80-101', '7-80-404', '7-80-1224'] }),
  // Articles 104 and 124 are repealed whole.
  colorado('co-bca', 'Colorado Business Corporation Act', 'C.R.S. 7-101-101 to 7-117-105', 'agreements', ['startup-forms', 'startup-raises', 'fights'], { title: 7, articles: articles(101, 117, [104]) }, { minSections: 157, sections: ['7-101-101', '7-108-101', '7-113-101', '7-117-105'] }),
  colorado('co-corps-associations', 'Colorado Corporations and Associations Act', 'C.R.S. 7-90-101 to 7-90-1005', 'agreements', ['startup-forms', 'startup-raises', 'angels-create-groups', 'vcs-invest', 'fights'], { title: 7, articles: ['90'] }, { minSections: 85, sections: ['7-90-101', '7-90-1005'] }),
  colorado('co-partnership-act', 'Colorado Uniform Partnership Act (1997)', 'C.R.S. 7-64-101 to 7-64-1206', 'agreements', ['angels-create-groups', 'vcs-invest'], { title: 7, articles: ['64'] }, { minSections: 57, sections: ['7-64-101', '7-64-1206'] }),
  colorado('co-trade-names', 'Colorado trade name statute', 'C.R.S. 7-71-101 to 7-71-112', 'other', ['startup-forms'], { title: 7, articles: ['71'] }, { minSections: 11, sections: ['7-71-101', '7-71-112'] }),
  colorado('co-trade-secrets', 'Colorado Uniform Trade Secrets Act', 'C.R.S. 7-74-101 to 7-74-110', 'other', ['startup-forms', 'fights'], { title: 7, articles: ['74'] }, { minSections: 9, sections: ['7-74-101', '7-74-110'] }),
  colorado('co-noncompete', 'Colorado restrictive covenant statute', 'C.R.S. 8-2-113', 'other', ['startup-forms', 'fights'], { title: 8, articles: ['2'], sections: ['8-2-113'] }, { minSections: 1, sections: ['8-2-113'] }),
  colorado('co-wage-act', 'Colorado Wage Act', 'C.R.S. 8-4-101 and following', 'other', ['startup-forms', 'fights'], { title: 8, articles: ['4'] }, { minSections: 29, sections: ['8-4-101', '8-4-109', '8-4-127'] }),
  colorado('co-family-leave', 'Colorado family and medical leave law, including the Healthy Families and Workplaces Act and the Paid Family and Medical Leave Insurance Act', 'C.R.S. 8-13.3-201 to 8-13.3-524', 'other', ['startup-forms'], { title: 8, articles: ['13.3'] }, { minSections: 47, sections: ['8-13.3-201', '8-13.3-403', '8-13.3-507', '8-13.3-524'] }),
  colorado('co-equal-pay', 'Colorado Equal Pay for Equal Work Act', 'C.R.S. 8-5-101 to 8-5-203', 'other', ['startup-forms'], { title: 8, articles: ['5'] }, { minSections: 7, sections: ['8-5-101', '8-5-201', '8-5-203'] }),
  colorado('co-workers-comp', "Workers' Compensation Act of Colorado: insurance", 'C.R.S. 8-44-101 to 8-44-206', 'other', ['startup-forms'], { title: 8, articles: ['44'] }, { minSections: 22, sections: ['8-44-101', '8-44-206'] }),
  colorado('co-unemployment', 'Colorado Employment Security Act: premiums and coverage', 'C.R.S. 8-76-101 to 8-76-116', 'other', ['startup-forms'], { title: 8, articles: ['76'] }, { minSections: 14, sections: ['8-76-101', '8-76-116'] }),
  colorado('co-new-hire', 'Colorado state directory of new hires', 'C.R.S. 26-13-125', 'other', ['startup-forms'], { title: 26, articles: ['13'], sections: ['26-13-125'] }, { minSections: 1, sections: ['26-13-125'] }),
  colorado('co-ueta', 'Colorado Uniform Electronic Transactions Act', 'C.R.S. 24-71.3-101 to 24-71.3-121', 'other', ['startup-forms'], { title: 24, articles: ['71.3'] }, { minSections: 20, sections: ['24-71.3-101', '24-71.3-121'] }),
  colorado('co-securities-act', 'Colorado Securities Act', 'C.R.S. 11-51-101 and following', 'securities', ['startup-forms', 'startup-raises', 'angels-invest', 'angels-create-groups', 'vcs-invest', 'fights'], { title: 11, articles: ['51'] }, { minSections: 67, sections: ['11-51-101', '11-51-201', '11-51-308', '11-51-501', '11-51-604', '11-51-1008'] }),
  colorado('co-lp-act', 'Colorado Uniform Limited Partnership Act of 1981', 'C.R.S. 7-62-101 to 7-62-1105', 'agreements', ['angels-invest', 'vcs-invest'], { title: 7, articles: ['62'] }, { minSections: 53, sections: ['7-62-101', '7-62-1105'] }),
  colorado('co-nonprofit-law', 'Colorado nonprofit forms: Uniform Unincorporated Nonprofit Association Act and Revised Nonprofit Corporation Act', 'C.R.S. 7-30; 7-121 to 7-137', 'agreements', ['angels-create-groups'], { title: 7, articles: ['30', ...articles(121, 137, [124])] }, { minSections: 153, sections: ['7-30-101', '7-121-101', '7-137-301'] }),
  delaware('de-dgcl', 'Delaware General Corporation Law', '8 Del. C. ch. 1', 'agreements', ['startup-forms', 'startup-raises', 'fights'], { title: 8, chapter: '001' }, {
    minSections: 196,
    sections: ['101', '141', '228', '251', '398'],
  }),
  delaware('de-franchise-tax', 'Delaware franchise tax on domestic corporations', '8 Del. C. ch. 5', 'agreements', ['startup-forms'], { title: 8, chapter: '005' }, {
    minSections: 17,
    sections: ['501', '503', '518'],
  }),
  delaware('de-llc-act', 'Delaware Limited Liability Company Act', '6 Del. C. ch. 18', 'agreements', ['startup-forms', 'angels-invest', 'angels-create-groups', 'vcs-invest', 'fights'], { title: 6, chapter: '018' }, {
    minSections: 101,
    sections: ['18-101', '18-215', '18-1101', '18-1208'],
  }),
  delaware('de-securities-act', 'Delaware Securities Act', '6 Del. C. ch. 73', 'securities', ['startup-raises', 'vcs-invest', 'fights'], { title: 6, chapter: '073' }, {
    minSections: 36,
    sections: ['73-101', '73-103', '73-704'],
  }),
  delaware('de-lp-act', 'Delaware Revised Uniform Limited Partnership Act', '6 Del. C. ch. 17', 'agreements', ['angels-invest', 'vcs-invest', 'fights'], { title: 6, chapter: '017' }, {
    minSections: 106,
    sections: ['17-101', '17-305', '17-1101', '17-1208'],
  }),
  delaware('de-wage-act', 'Delaware Wage Payment and Collection Act', '19 Del. C. ch. 11', 'other', ['fights'], { title: 19, chapter: '011' }, {
    minSections: 16,
    sections: ['1101', '1115'],
  }),
  delaware('de-court-of-chancery', 'Court of Chancery', '10 Del. C. ch. 3', 'other', ['fights'], { title: 10, chapter: '003' }, {
    minSections: 42,
    sections: ['301', '341', '342', '375'],
  }),
  delaware('de-civil-process', 'Process; Commencement of Actions', '10 Del. C. ch. 31', 'other', ['fights'], { title: 10, chapter: '031' }, {
    minSections: 14,
    sections: ['3101', '3104', '3114'],
  }),
  delaware('de-limitations', 'Limitation of Actions: Personal Actions', '10 Del. C. ch. 81', 'other', ['fights'], { title: 10, chapter: '081' }, {
    minSections: 41,
    sections: ['8101', '8106', '8146'],
  }),
  // Whole, so 2707 (restrictive covenants) and 2708 (choosing Delaware law) are searchable, not only cited (#311).
  delaware('de-contracts', 'Delaware contracts: choice of law, restrictive covenants, consumer contracts', '6 Del. C. ch. 27', 'agreements', ['startup-raises', 'fights'], { title: 6, chapter: '027' }, {
    minSections: 28,
    sections: ['2701', '2707', '2708', '2735', '2737'],
  }),
  compilation('us-securities-act', 'Securities Act of 1933', '15 U.S.C. 77a et seq.', ['startup-forms', 'startup-raises', 'angels-create-groups'], 'COMPS-1884', {
    minSections: 46,
    sections: ['77a', '77b', '77c', '77d', '77e', '77k', '77l', '77q', '77r', '77aa', '77mm'],
  }),
  secRules('us-sec-part-230', 'SEC General Rules under the Securities Act, including Regulation D, Regulation A, Rules 144, 147, 148, 152, 241 and 701, and Regulation S', '17 CFR Part 230', ['startup-forms', 'startup-raises', 'angels-invest', 'angels-create-groups', 'vcs-invest'], [230], 'Securities Act Rule', {
    minSections: 200,
    sections: ['230.100', '230.144', '230.144A', '230.501', '230.502', '230.503', '230.504', '230.506', '230.1001'],
  }),
  secRules('us-sec-part-227', 'Regulation Crowdfunding', '17 CFR Part 227', ['startup-raises'], [227], 'Regulation Crowdfunding Rule', {
    minSections: 21,
    sections: ['227.100', '227.504'],
  }),
  secRules('us-sec-parts-232-239', 'Regulation S-T and SEC forms under the Securities Act', '17 CFR Parts 232 and 239', ['startup-raises', 'vcs-invest'], [232, 239], 'Rule', {
    minSections: 72,
    sections: ['232.10', '232.501', '239.0-1', '239.500', '239.900'],
  }),
  compilation('us-advisers-act', 'Investment Advisers Act of 1940', '15 U.S.C. 80b-1 et seq.', ['angels-invest', 'angels-create-groups', 'vcs-invest'], 'COMPS-1878', {
    minSections: 27,
    sections: ['80b-1', '80b-2', '80b-3', '80b-3a', '80b-6', '80b-18c'],
  }),
  secRules('us-sec-part-275', 'SEC Rules under the Advisers Act', '17 CFR Part 275', ['angels-invest', 'angels-create-groups', 'vcs-invest'], [275], 'Advisers Act Rule', {
    minSections: 35,
    sections: ['275.0-2', '275.203(l)-1', '275.203(m)-1', '275.206(4)-2', '275.206(4)-5', '275.222-2'],
  }),
  compilation('us-ica', 'Investment Company Act of 1940', '15 U.S.C. 80a-1 et seq.', ['angels-invest', 'angels-create-groups', 'vcs-invest'], 'COMPS-1879', {
    minSections: 62,
    sections: ['80a-1', '80a-2', '80a-3', '80a-64'],
  }),
  secRules('us-sec-part-270', 'SEC Rules under the Investment Company Act', '17 CFR Part 270', ['angels-invest', 'vcs-invest'], [270], 'Investment Company Act Rule', {
    minSections: 172,
    sections: ['270.0-1', '270.2a51-1', '270.3c-1', '270.60a-1'],
  }),
  {
    id: 'us-sec-staff-guidance',
    title: 'SEC staff guidance on exempt offerings and brokers',
    citation: 'Corporation Finance Interpretations, Securities Act Rules; Guide to Broker-Dealer Registration (2008); JOBS Act broker FAQ (2013); staff letter on Rule 506(c) (2025-03-12); investor bulletins on SAFEs and on investment clubs',
    level: 'federal',
    layer: 'securities',
    paths: ['startup-raises', 'angels-invest', 'angels-create-groups'],
    link: 'https://www.sec.gov/rules-regulations/staff-guidance/corporation-finance-interpretations/securities-act-rules',
    source: { kind: 'sec-interpretations' },
    // Staff views, not rules.
    track: 'regulator',
    kind: 'guidance',
    whole: { minSections: 600, sections: ['110.01', '279.01', '510.01', '656.02'] },
  },
  {
    id: 'us-sec-part-279',
    title: 'SEC forms under the Advisers Act',
    citation: '17 CFR Part 279; Form ADV and General Instructions',
    level: 'federal',
    layer: 'securities',
    paths: ['angels-create-groups', 'vcs-invest'],
    link: 'https://www.sec.gov/files/formadv-instructions.pdf',
    source: { kind: 'form-adv' },
    track: 'both',
    kind: 'regulation',
    whole: { minSections: 7, sections: ['279.1', 'General Instructions', 'Instructions for Part 1A', 'Glossary of Terms'] },
  },
  {
    id: 'us-sec-form-d',
    title: 'Form D, Notice of Exempt Offering of Securities',
    citation: 'Form D (OMB 3235-0076); Terms of Submission, General Instructions and Item-by-Item Instructions',
    level: 'federal',
    layer: 'securities',
    paths: ['startup-raises', 'angels-create-groups', 'vcs-invest'],
    link: 'https://www.sec.gov/files/formd.pdf',
    source: { kind: 'form-d' },
    track: 'both',
    kind: 'regulation',
    whole: { minSections: 19, sections: ['Terms of Submission', 'General Instructions', 'Item 1', 'Item 7', 'Item 16', 'Signature and Submission'] },
  },
  colorado('co-anti-discrimination', 'Colorado Anti-discrimination Act', 'C.R.S. 24-34-300.5 to 24-34-806', 'other', ['startup-forms', 'fights'], { title: 24, articles: ['34'], parts: [3, 4, 5, 6, 7, 8] }, { minSections: 54, sections: ['24-34-300.5', '24-34-402', '24-34-407', '24-34-601', '24-34-806'] }),
  colorado('co-tax-code', 'Colorado tax administration, income tax and sales and use tax', 'C.R.S. title 39, articles 21, 22 and 26', 'other', ALL_PATHS, { title: 39, articles: ['21', '22', '26'] }, { minSections: 395, sections: ['39-21-101', '39-21-116.5', '39-22-101', '39-22-301', '39-22-532', '39-22-604', '39-26-101', '39-26-713', '39-26-901'] }),
  colorado('co-business-property-tax', 'Colorado business personal property tax sections', 'C.R.S. 39-3-118, 39-3-119.5, 39-5-108', 'other', ['startup-forms'], { title: 39, articles: ['3', '5'], sections: ['39-3-118', '39-3-119.5', '39-5-108'] }, { minSections: 3, sections: ['39-3-118', '39-3-119.5', '39-5-108'] }),
  uscode('us-tax-code', 'Internal Revenue Code sections startup, angel and fund documents depend on', '26 U.S.C. 11, 41, 67, 83, 351, 357, 368, 382, 409A, 422, 512, 701, 721, 1045, 1061, 1202, 1244, 1361, 1362, 1446, 3111, 6039, 6041, 6045, 6072, 6109, 6223, 6501, 6672, 6698, 7704', ALL_PATHS, {
    title: 26,
    name: 'Internal Revenue Code',
    sections: ['11', '41', '67', '83', '351', '357', '368', '382', '409A', '422', '512', '701', '721', '1045', '1061', '1202', '1244', '1361', '1362', '1446', '3111', '6039', '6041', '6045', '6072', '6109', '6223', '6501', '6672', '6698', '7704'],
  }),
  cfrSections('us-tax-regulations', 'Treasury regulations startup, angel and fund documents depend on', '26 CFR 1.83-2, 1.409A-1, 1.422-2, 1.1362-6, 1.6072-2, 31.6302-1, 301.6109-1, 301.7701-3', ['startup-forms', 'startup-raises', 'angels-create-groups', 'vcs-invest', 'fights'], {
    title: 26,
    name: 'Treas. Reg.',
    sections: ['1.83-2', '1.409A-1', '1.422-2', '1.1362-6', '1.6072-2', '31.6302-1', '301.6109-1', '301.7701-3'],
  }),
  uscode('us-patent-basics', 'Patent Act: what can be patented, inventors and assignment', '35 U.S.C. 100 to 103, 111, 115, 116, 118, 261, 262', ['startup-forms', 'startup-raises', 'fights'], { title: 35, name: 'Patent Act', sections: ['100', '101', '102', '103', '111', '115', '116', '118', '261', '262'] }),
  colorado('co-unemployment-employer', 'Colorado Employment Security Act: who is an employer', 'C.R.S. 8-70-113', 'other', ['startup-forms'], { title: 8, articles: ['70'], sections: ['8-70-113'] }, { minSections: 1, sections: ['8-70-113'] }),
  delaware('de-corporate-income-tax', 'Delaware corporation income tax', '30 Del. C. ch. 19', 'other', ['startup-forms'], { title: 30, chapter: '019' }, { minSections: 10, sections: ['1901', '1902', '1912'] }),
  delaware('de-unclaimed-property', 'Delaware unclaimed property law', '12 Del. C. ch. 11, subchapter II', 'other', ['startup-forms', 'vcs-invest'], { title: 12, chapter: '011', subchapter: '02' }, { minSections: 60, sections: ['1130', '1149', '1156', '1191'] }),
  uscode('us-copyright-basics', 'Copyright Act: subject matter, ownership, transfers, duration and registration', '17 U.S.C. 101, 102, 106, 201 to 204, 302, 411, 412', ['startup-forms', 'startup-raises', 'fights'], { title: 17, name: 'Copyright Act', sections: ['101', '102', '106', '201', '202', '203', '204', '302', '411', '412'] }),
  uscode('us-trademark-basics', 'Lanham Act: registration, assignment and infringement', '15 U.S.C. 1051, 1057, 1060, 1065, 1114, 1125, 1127', ['startup-forms', 'startup-raises', 'fights'], { title: 15, name: 'Lanham Act', sections: ['1051', '1057', '1060', '1065', '1114', '1125', '1127'] }),
  // A first hire's law, opened 2026-11-13 for the Employment law page.
  colorado('co-minimum-wage', 'Colorado minimum wage law', 'C.R.S. 8-6-101 to 8-6-120', 'other', ['startup-forms'], { title: 8, articles: ['6'] }, { minSections: 22, sections: ['8-6-101', '8-6-111', '8-6-118', '8-6-120'] }),
  colorado('co-hiring-limits', 'Colorado limits on what hiring may ask or check', 'C.R.S. 8-2-126 to 8-2-131', 'other', ['startup-forms'], { title: 8, articles: ['2'], sections: ['8-2-126', '8-2-127', '8-2-128', '8-2-128.5', '8-2-129', '8-2-130', '8-2-131'] }, { minSections: 7, sections: ['8-2-126', '8-2-130', '8-2-131'] }),
  colorado('co-unemployment-general', 'Colorado Employment Security Act: the contractor test and misclassification', 'C.R.S. 8-70-115, 8-72-114', 'other', ['startup-forms', 'fights'], { title: 8, articles: ['70', '72'], sections: ['8-70-115', '8-72-114'] }, { minSections: 2, sections: ['8-70-115', '8-72-114'] }),
  colorado('co-workers-comp-general', "Workers' Compensation Act of Colorado: who is an employee and an employer", 'C.R.S. 8-40-202, 8-40-203', 'other', ['startup-forms'], { title: 8, articles: ['40'], sections: ['8-40-202', '8-40-203'] }, { minSections: 2, sections: ['8-40-202', '8-40-203'] }),
  uscode('us-flsa-act', 'Fair Labor Standards Act', '29 U.S.C. 201 to 219', ['startup-forms'], {
    title: 29,
    name: 'Fair Labor Standards Act',
    // 205, 208, 216a and 218a are repealed: their pages carry no text.
    sections: ['201', '202', '203', '204', '206', '207', '209', '210', '211', '212', '213', '214', '215', '216', '216b', '217', '218', '218b', '218c', '218d', '219'],
  }),
  cfrSections('us-flsa-rules', 'Fair Labor Standards Act rules: pay records and who is an employee', '29 CFR 516.1, 516.2, 516.5, 516.6; 29 CFR Part 795', ['startup-forms'], {
    title: 29,
    name: '29 C.F.R.',
    sections: ['516.1', '516.2', '516.5', '516.6', '795.100', '795.105', '795.110', '795.115'],
  }),
  // 8 CFR 274a.2, the Form I-9 rule, isn't stored: its annual edition file carries an effective date note this reader stops at.
  uscode('us-i9', 'Immigration and Nationality Act: verifying each new hire may work', '8 U.S.C. 1324a', ['startup-forms'], { title: 8, name: 'Immigration and Nationality Act', sections: ['1324a'] }),
  // IP law, opened 2026-11-13 for the Intellectual property law page: the sections its needs cite, not whole titles yet.
  colorado('co-trademarks', 'Colorado trademark registration statute', 'C.R.S. 7-70-101 to 7-70-109', 'other', ['startup-forms'], { title: 7, articles: ['70'] }, { minSections: 9, sections: ['7-70-101', '7-70-104', '7-70-109'] }),
  delaware('de-trade-secrets', 'Delaware Uniform Trade Secrets Act', '6 Del. C. ch. 20', 'other', ['startup-forms', 'fights'], { title: 6, chapter: '020' }, { minSections: 9, sections: ['2001', '2006', '2009'] }),
  // The chapter's 801 to 804, on public transit, come with 805.
  delaware('de-employee-inventions', "Delaware protection of employees' rights: the employee invention rule", '19 Del. C. ch. 8', 'other', ['startup-forms'], { title: 19, chapter: '008' }, { minSections: 5, sections: ['801', '805'] }),
  uscode('us-patent-act', 'Patent Act: the benefit of an earlier filing date', '35 U.S.C. 119', ['startup-raises'], { title: 35, name: 'Patent Act', sections: ['119'] }),
  cfrSections('us-patent-rules', 'Patent rules: provisional applications, maintenance fees and assignment records', '37 CFR 1.12, 1.53, 1.78, 1.362, 3.11, 3.54', ['startup-raises', 'angels-invest'], {
    title: 37,
    name: '37 C.F.R.',
    sections: ['1.12', '1.53', '1.78', '1.362', '3.11', '3.54'],
  }),
  uscode('us-trademark-act', 'Lanham Act: refusals, office actions, maintenance and renewal', '15 U.S.C. 1052, 1058, 1059, 1062', ['startup-forms'], { title: 15, name: 'Lanham Act', sections: ['1052', '1058', '1059', '1062'] }),
  cfrSections('us-trademark-rules', 'Trademark rules: filing bases, office actions, statements of use and maintenance', '37 CFR 2.34, 2.62, 2.88, 2.89, 2.160, 2.182', ['startup-forms'], {
    title: 37,
    name: '37 C.F.R.',
    sections: ['2.34', '2.62', '2.88', '2.89', '2.160', '2.182'],
  }),
  {
    id: 'us-civil-rules',
    title: 'Federal Rules of Civil Procedure',
    citation: 'Fed. R. Civ. P. 1 to 87',
    level: 'federal',
    layer: 'other',
    paths: ['fights'],
    link: 'https://www.uscourts.gov/forms-rules/current-rules-practice-procedure/federal-rules-civil-procedure',
    source: { kind: 'uscourts-rules', set: 'civil' },
    track: 'both',
    kind: 'regulation',
    // 94 rules in the print as amended to December 1, 2025; 74, 75, 76 and 84 are abrogated.
    whole: { minSections: 90, sections: ['1', '4', '4.1', '26', '34', '37', '45', '87'] },
  },
  {
    id: 'us-evidence-rules',
    title: 'Federal Rules of Evidence',
    citation: 'Fed. R. Evid. 101 to 1103',
    level: 'federal',
    layer: 'other',
    paths: ['fights'],
    link: 'https://www.uscourts.gov/forms-rules/current-rules-practice-procedure/federal-rules-evidence',
    source: { kind: 'uscourts-rules', set: 'evidence' },
    track: 'both',
    kind: 'regulation',
    // 69 rules in the print as amended to December 1, 2025.
    whole: { minSections: 66, sections: ['101', '502', '803', '1101', '1103'] },
  },
  // Arbitration and obstruction statutes for the court rules page, each read on its official host 2026-11-13. Chapter 4
  // of title 9 says which predispute agreements stop binding.
  uscode('us-arbitration-act', 'Federal Arbitration Act', '9 U.S.C. 1 to 16, 401, 402', ['startup-forms', 'fights'], {
    title: 9,
    name: 'Federal Arbitration Act',
    sections: [...Array.from({ length: 16 }, (_, i) => String(i + 1)), '401', '402'],
  }),
  colorado('co-arbitration-act', 'Colorado Uniform Arbitration Act', 'C.R.S. 13-22-201 to 13-22-230', 'other', ['startup-forms', 'fights'], { title: 13, articles: ['22'], parts: [2] }, { minSections: 31, sections: ['13-22-201', '13-22-203.5', '13-22-217', '13-22-223', '13-22-230'] }),
  delaware('de-arbitration-act', 'Delaware Uniform Arbitration Act', '10 Del. C. ch. 57', 'other', ['startup-forms', 'fights'], { title: 10, chapter: '057' }, { minSections: 25, sections: ['5701', '5708', '5714', '5725'] }),
  delaware('de-rapid-arbitration-act', 'Delaware Rapid Arbitration Act', '10 Del. C. ch. 58', 'other', ['startup-forms', 'fights'], { title: 10, chapter: '058' }, { minSections: 12, sections: ['5801', '5803', '5809', '5812'] }),
  uscode('us-preservation', 'Obstruction of justice: tampering with records and destroying them', '18 U.S.C. 1512, 1519', ['fights'], { title: 18, name: 'Federal criminal code', sections: ['1512', '1519'] }),
  // The two largest, last.
  compilation('us-exchange-act', 'Securities Exchange Act of 1934', '15 U.S.C. 78a et seq.', ['startup-raises', 'angels-create-groups', 'fights'],
    'COMPS-1885',
    { minSections: 76, sections: ['78a', '78c', '78j', '78l', '78o', '78t', '78u-1', '78ff', '78rr'] },
    // Section 21A prints no U.S. Code note; 15 U.S.C. 78u-1 is its section (civil penalties for insider trading).
    { '21A': '78u-1' },
  ),
  secRules('us-sec-part-240', 'SEC General Rules under the Exchange Act', '17 CFR Part 240', ['startup-raises', 'fights'], [240], 'Exchange Act Rule', {
    minSections: 535,
    sections: ['240.0-1', '240.3a4-1', '240.10b-5', '240.12g-1', '240.12h-1', '240.15a-6', '240.36a1-2'],
  }),

  // Named in documents and linked, not stored.
  cited('us-esign', 'Electronic Signatures in Global and National Commerce Act', '15 U.S.C. 7001 and following', 'federal', 'other', ['startup-forms'], 'https://uscode.house.gov/us/usc/t15/s7001/'),
  cited('us-tax-founder', 'Tax items founder documents depend on', '26 U.S.C. 83, 409A, 422, 1202, 351, 357, 368, 721; 26 CFR 1.83-2, 1.409A-1, 301.7701-3; Rev. Proc. 2001-43; Rev. Rul. 2004-59; IRS Publication 541', 'federal', 'other', ['startup-forms', 'startup-raises', 'fights'], 'https://uscode.house.gov/us/usc/t26/s1202/'),
  cited('us-fincen-boi', 'FinCEN beneficial ownership rule', '31 U.S.C. 5336; 31 CFR 1010.380', 'federal', 'other', ['startup-forms'], 'https://www.fincen.gov/boi'),
  cited('co-income-tax', 'Colorado income tax sections documents lean on', 'C.R.S. 39-22-301, 39-22-343, 39-22-344, 39-22-601(5.5)', 'Colorado', 'other', ['startup-forms', 'vcs-invest'], 'https://olls.info/crs/crs2026-title-39.pdf'),
  cited('de-ueta', 'Delaware Uniform Electronic Transactions Act', '6 Del. C. ch. 12A', 'Delaware', 'other', ['startup-forms'], 'https://delcode.delaware.gov/title6/c012a/index.html'),
  cited('co-usury', 'Colorado interest statute', 'C.R.S. 5-12-103', 'Colorado', 'agreements', ['startup-raises'], 'https://olls.info/crs/crs2026-title-05.pdf'),
  cited('co-angel-credit', 'Colorado Advanced Industries Investment Tax Credit', 'C.R.S. 39-22-532; 24-48.5-112', 'Colorado', 'other', ['startup-forms', 'angels-invest'], 'https://oedit.colorado.gov/advanced-industries-investment-tax-credit'),
  cited('us-tax-angel', "Tax items an angel's records depend on", '26 U.S.C. 67(h), 1202, 1045, 1244; Form 8949', 'federal', 'other', ['angels-invest'], 'https://uscode.house.gov/us/usc/t26/s1045/'),
  cited('us-erisa-plan-assets', 'ERISA plan asset rule', '29 U.S.C. 1002(42); 29 CFR 2510.3-101', 'federal', 'other', ['startup-raises', 'vcs-invest'], 'https://www.ecfr.gov/current/title-29/section-2510.3-101'),
  cited('us-fincen-adviser-aml', 'FinCEN investment adviser AML rule', '89 FR 72156; delay at 91 FR 36; 31 CFR 1032', 'federal', 'other', ['vcs-invest'], 'https://www.fincen.gov/news/news-releases/fincen-issues-final-rule-postpone-effective-date-investment-adviser-rule-2028'),
  cited('us-foreign-investment', 'CFIUS and outbound investment rules', '50 U.S.C. 4565; 31 CFR Part 800; 31 CFR Part 850', 'federal', 'other', ['vcs-invest'], 'https://www.ecfr.gov/current/title-31/part-850'),
  cited('us-tax-fund', 'Tax items fund documents depend on', '26 U.S.C. 1061, 512(c), 7704; Forms 1065 and K-1', 'federal', 'other', ['startup-forms', 'vcs-invest'], 'https://uscode.house.gov/us/usc/t26/s1061/'),
  cited('de-chancery-rules', 'Court of Chancery rules and guidelines on preservation, production, subpoenas and privilege logs', 'Ct. Ch. R. 34, 37(e), 45; Guidelines for Preservation of ESI; Guidelines for Persons Litigating in the Court of Chancery', 'Delaware', 'other', ['fights'], 'https://courts.delaware.gov/forms/download.aspx?id=160908'),
  cited('co-civil-rules', 'Colorado Rules of Civil Procedure, Rule 37', 'C.R.C.P. 37', 'Colorado', 'other', ['fights'], 'https://www.coloradojudicial.gov/'),
  cited('us-trade-secrets', 'Defend Trade Secrets Act', '18 U.S.C. 1833, 1836', 'federal', 'other', ['startup-forms', 'fights'], 'https://uscode.house.gov/us/usc/t18/s1836/'),
  cited('us-flsa', 'Fair Labor Standards Act, executive exemption', '29 U.S.C. 213(a)(1); 29 CFR Part 541', 'federal', 'other', ['fights'], 'https://www.ecfr.gov/current/title-29/part-541'),
  cited('us-ftc-noncompete', 'FTC non-compete rule, removed', '16 CFR Part 910 (removed and reserved)', 'federal', 'other', ['fights'], 'https://www.federalregister.gov/documents/full_text/xml/2026/02/12/2026-02866.xml'),
  // Court rules. Colorado's rules text is published under terms that need permission, so it is never stored. Delaware's
  // courts reserve all rights in theirs, so it is cited. The federal rules are stored above. The two district courts'
  // local rules are federal works, cited until a reader for each court's PDF has been checked on a real copy.
  cited('de-chancery-court-rules', 'Rules of the Court of Chancery of the State of Delaware', 'Ct. Ch. R. 1 to 207', 'Delaware', 'other', ['fights'], 'https://courts.delaware.gov/forms/download.aspx?id=160908'),
  cited('co-civil-procedure', 'Colorado Rules of Civil Procedure', 'C.R.C.P.', 'Colorado', 'other', ['fights'], 'https://www.coloradojudicial.gov/supreme-court/adopted-proposed-rule-changes'),
  cited('d-colo-local-rules', 'Local Rules of Practice of the United States District Court for the District of Colorado', 'D.C.COLO.LCivR 26.1, 30.1 to 30.3, 37.1, 45.1', 'federal', 'other', ['fights'], 'https://www.cod.uscourts.gov/Portals/0/Documents/LocalRules/2025_Final_Local_Rules.pdf'),
  cited('d-del-local-rules', 'District of Delaware Default Standard for Discovery, Including Discovery of Electronically Stored Information, and Local Rules', 'D. Del. Default Standard for Discovery; D. Del. LR 26.1, 26.2, 30.1, 37.1', 'federal', 'other', ['fights'], 'https://www.ded.uscourts.gov/sites/ded/files/pages/Electronic%20Discovery%20Default%20Standard_0.pdf'),
  // Sites that bar or refuse machines, so cited and linked (2026-11-07). law-cite.ts: regulator-only material is never civil authority.
  { ...cited('co-securities-rules', 'Rules under the Colorado Securities Act', '3 CCR 704-1', 'Colorado', 'securities', ['startup-raises', 'angels-create-groups', 'vcs-invest'], 'https://www.coloradosos.gov/CCR/DisplayRule.do?action=ruleinfo&ruleId=2207'), track: 'regulator', kind: 'regulation' },
  { ...cited('de-securities-rules', 'Rules Pursuant to the Delaware Securities Act', 'Title 6, Rules (formerly 200), Delaware Administrative Code', 'Delaware', 'securities', ['startup-raises', 'vcs-invest'], 'https://regulations.delaware.gov/AdminCode/title6/Rules'), track: 'regulator', kind: 'regulation' },
  // The Division of Labor Standards and Statistics answers machines with 403 (2026-11-13); a person reads each year's order.
  { ...cited('co-comps-order', 'Colorado COMPS Order #40', '7 CCR 1103-1', 'Colorado', 'other', ['startup-forms', 'fights'], 'https://cdle.colorado.gov/sites/cdle/files/adopted_2026_comps_order_%2340_7_ccr_1103-1_12.8.25.pdf'), kind: 'regulation' },
  { ...cited('co-pay-calc-order', 'Colorado pay calculation order', '7 CCR 1103-14', 'Colorado', 'other', ['startup-forms'], 'https://cdle.colorado.gov/sites/cdle/files/adopted_2026_pay_calc_order_7_ccr_1103-14_12.8.25.pdf'), kind: 'regulation' },
  // Agency guidance on AI in the Federal Register, read whole on govinfo 2026-11-13. Each office's view, not a statute or rule.
  { ...cited('us-ai-authorship-guidance', 'Copyright Registration Guidance: Works Containing Material Generated by Artificial Intelligence', '88 FR 16190', 'federal', 'other', ['startup-forms', 'startup-raises'], 'https://www.govinfo.gov/content/pkg/FR-2023-03-16/pdf/2023-05321.pdf'), track: 'regulator', kind: 'guidance' },
  { ...cited('us-ai-inventorship-guidance', 'Revised Inventorship Guidance for AI-Assisted Inventions', '90 FR 54636', 'federal', 'other', ['startup-forms', 'startup-raises'], 'https://www.govinfo.gov/content/pkg/FR-2025-11-28/pdf/2025-21457.pdf'), track: 'regulator', kind: 'guidance' },
];

/**
 * Units a room built with the defaults doesn't hold yet: a room adds them with LEGALLAS_LAW_NEXT=1 (default-pack.ts), so
 * a live room builds exactly what it did until it opts in. In the plan, each carries flag = "next". None today: the nine
 * opened on 2026-11-02 joined the defaults on 2026-11-09. A new unit waits here until its dry run against the real site.
 */
export const NEXT_PACK_UNITS: readonly PackUnit[] = [];

/** The default units with the next ones added before the two largest, which still go up last. */
export function withNextUnits(): PackUnit[] {
  const largest = DEFAULT_PACK_UNITS.findIndex((unit) => unit.id === 'us-exchange-act');
  return [...DEFAULT_PACK_UNITS.slice(0, largest), ...NEXT_PACK_UNITS, ...DEFAULT_PACK_UNITS.slice(largest)];
}
