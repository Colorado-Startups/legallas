// SPDX-License-Identifier: Apache-2.0
// The kinds of source the law library builds from, and where each comes from. Public, free, official or public domain
// sources only: state statutes from the legislature's own downloads (the Colorado General Assembly's C.R.S., OLLS),
// eCFR and the Law Revision Counsel's U.S. Code for federal law, the Caselaw Access Project (Harvard Law School Library, public domain) for opinion
// text with CourtListener as the reading link. No commercial service and no annotation text. What a room's library
// holds is its own choice: its law packs (pack.ts) list the sources, here or in `sources`, and name their hosts.
//
// Every URL is fixed by a pack. The build never puts anything from the room, the record or a question into a URL, so
// the only words that ever leave this machine are the statute numbers, rule numbers and reporter cites a pack names.
import type { LawTrack } from '../../worker/law-cite.ts';
import type { LawPack } from './pack.ts';

/** Hosts the core sources fetch from. fetch.ts refuses every other host, except a law pack's own (pack.ts). */
export const ALLOWED_HOSTS = new Set([
  'www.ecfr.gov',
  // govinfo: Statute Compilations and the eCFR bulk files (default-pack.ts).
  'www.govinfo.gov',
  // The Law Revision Counsel's current U.S. Code, for `usc` sources; govinfo's yearly edition lags a year or more (#336).
  'uscode.house.gov',
  'static.case.law',
  'www.courtlistener.com',
  // CourtListener's file store, for the slip opinion PDFs a pack allows by name (`slipCases`).
  'storage.courtlistener.com',
]);

/** One C.R.S. article from an OLLS title download (DOCX; the PDF is the reading link). */
export interface CrsSource {
  kind: 'crs';
  title: number;
  article: string;
  track: LawTrack;
  /** Sections that only a regulator acts on, tagged regulator whatever the article's track. */
  regulatorOnly?: RegExp;
  /** Only these sections of the article (each must be found); the whole article when absent. */
  sections?: readonly string[];
}

/** A name practitioners use for C.R.S. sections, added to the headings of those whose number `section` matches. */
export interface CrsCommonName {
  section: RegExp;
  name: string;
}

/** C.R.S. editions to try, newest first; the first that downloads is used and recorded. */
export const CRS_EDITIONS = [2026, 2025, 2024];

/** The Colorado legislature URL of one CRS title as a Word file. */
export function crsDocxUrl(edition: number, title: number): string {
  return `https://content.leg.colorado.gov/sites/default/files/images/olls/crs${edition}-title-${String(title).padStart(2, '0')}.docx`;
}

/** The Colorado legislature URL of one CRS title as a PDF. */
export function crsPdfUrl(edition: number, title: number): string {
  return `https://content.leg.colorado.gov/sites/default/files/images/olls/crs${edition}-title-${String(title).padStart(2, '0')}.pdf`;
}

/** One eCFR section, read through the versioner API at the title's latest issue date. */
export interface EcfrSource {
  kind: 'ecfr';
  title: number;
  section: string;
  track: LawTrack;
}

/** The eCFR API URL that lists the titles. */
export const ECFR_TITLES_URL = 'https://www.ecfr.gov/api/versioner/v1/titles.json';

/** The eCFR API URL of one section's XML on a date; throws on a malformed date or section. */
export function ecfrXmlUrl(date: string, title: number, section: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[0-9a-z.-]+(?:\([0-9a-z]{1,4}\)-[0-9]{1,3})?$/.test(section)) throw new Error('bad eCFR section');
  return `https://www.ecfr.gov/api/versioner/v1/full/${date}/title-${title}.xml?section=${section}`;
}

/** The eCFR page URL of one section. */
export function ecfrReadUrl(title: number, section: string): string {
  return `https://www.ecfr.gov/current/title-${title}/section-${section}`;
}

/** One U.S. Code section from uscode.house.gov, the current Code. */
export interface UscSource {
  kind: 'usc';
  title: number;
  section: string;
  track: LawTrack;
  /** Only these subsections, as label paths ("c/7" is (c)(7)), with their lead-in lines; the whole section when absent. */
  keep?: readonly string[];
}

/** The House U.S. Code URL of one section. */
export function uscUrl(title: number, section: string): string {
  return `https://uscode.house.gov/us/usc/t${title}/s${section}/`;
}

/** Every fixed URL `packs` name (the C.R.S. and eCFR URLs are built from their numbers), for the guard test. */
export function manifestUrls(packs: readonly LawPack[] = []): string[] {
  return [
    ECFR_TITLES_URL,
    ...packs.flatMap((pack) => {
      const { crs = [], ecfr = [], usc = [], cases = [] } = pack.sources ?? {};
      return [
        ...crs.flatMap((s) => CRS_EDITIONS.flatMap((e) => [crsDocxUrl(e, s.title), crsPdfUrl(e, s.title)])),
        ...ecfr.flatMap((s) => [ecfrXmlUrl('2026-01-01', s.title, s.section), ecfrReadUrl(s.title, s.section)]),
        ...usc.map((s) => uscUrl(s.title, s.section)),
        ...cases.flatMap((c) => [c.text, c.url]),
        ...pack.urls(),
      ];
    }),
  ];
}
