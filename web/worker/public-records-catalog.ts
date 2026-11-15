// SPDX-License-Identifier: Apache-2.0
// The public sources a records check covers and what each one allows (docs/design/public-records-sources.md records
// why): a site whose terms or robots rules bar automated searches, or whose terms could not be read, is linked for the
// member with what to look for, never fetched. worker/public-records-sources.ts searches the automated ones.
import type { CheckKind } from './public-records.ts';

export type SourceId = 'sec_edgar' | 'sec_adviser' | 'finra_brokercheck' | 'co_open_data' | 'co_sos' | 'de_entity' | 'courtlistener';

/** How a source is used: searched by the room (when its setting allows), or linked for the member to search. */
export type SourceMode = 'automated' | 'link_only';

export interface SourceInfo {
  id: SourceId;
  /** What the member reads. */
  name: string;
  /** Who runs it. */
  operator: string;
  mode: SourceMode;
  /** The host an automated search sends the name to. */
  host?: string;
  /** The page a member searches by hand. */
  link: string;
  /** Which kinds it can search. */
  kinds: readonly CheckKind[];
  /** Why it is linked rather than searched, or what an automated search needs. Plain words. */
  why: string;
  /** What to look for, per kind, when the member searches by hand or reads a result. */
  lookFor: Partial<Record<CheckKind, string>>;
  /** What it covers and does not, said plainly, so an empty result is not read as a clean record. */
  coverage: string;
}

export const SOURCES: readonly SourceInfo[] = [
  {
    id: 'sec_edgar',
    name: 'SEC EDGAR full-text search',
    operator: 'U.S. Securities and Exchange Commission',
    mode: 'automated',
    host: 'efts.sec.gov',
    link: 'https://www.sec.gov/edgar/search/',
    kinds: ['person', 'company'],
    why: 'The SEC allows automated tools that identify themselves with a contact address and stay under 10 requests a second. The room sends one request, and only when it has a contact address set (PUBLIC_RECORDS_CONTACT).',
    lookFor: {
      person: 'Search the exact name in quotes. Look for Form D notices that list the person as an executive officer, director or promoter of an offering, and for other filings that name them. Note each filing\'s form, date and company.',
      company: 'Search the exact name in quotes. Look for the company\'s own filings (Form D notices of exempt offerings, registration statements, annual and current reports) and filings by others that name it. Open the company\'s filing list from a result.',
    },
    coverage: 'Electronic filings since 2001 whose text contains the name. Older filings, paper filings and companies that never filed with the SEC are not here.',
  },
  {
    id: 'sec_adviser',
    name: 'SEC Investment Adviser Public Disclosure',
    operator: 'U.S. Securities and Exchange Commission',
    mode: 'link_only',
    link: 'https://adviserinfo.sec.gov/',
    kinds: ['person', 'company'],
    why: 'Its terms of use could not be read from here, and its search runs on the same system as FINRA BrokerCheck, whose terms bar automated searches. Until its terms are read and allow it, it is not searched automatically.',
    lookFor: {
      person: 'Search the name. Look for registration as an investment adviser representative, the firms and dates, and any disclosures (regulatory actions, customer complaints, terminations). Confirm it is the same person by the CRD number and employment history.',
      company: 'Search the firm name. Look for SEC or state registration, the Form ADV, the firm\'s CRD and SEC numbers, and any disclosures.',
    },
    coverage: 'Investment advisers registered with the SEC or a state, and their representatives, as they report themselves on Form ADV and Form U4.',
  },
  {
    id: 'finra_brokercheck',
    name: 'FINRA BrokerCheck',
    operator: 'Financial Industry Regulatory Authority',
    mode: 'link_only',
    link: 'https://brokercheck.finra.org/',
    kinds: ['person', 'company'],
    why: 'BrokerCheck\'s terms of use bar data mining, scraping and robots, so it is never searched automatically.',
    lookFor: {
      person: 'Search the name. Look for registration as a broker, the firms and dates, exams passed, and the disclosures section (customer disputes, regulatory events, terminations, criminal matters). Confirm it is the same person by the CRD number.',
      company: 'Search the firm name. Look for registration as a brokerage firm, its CRD number, and the disclosures section.',
    },
    coverage: 'Brokers and brokerage firms registered with FINRA now or in the past, as reported on Forms U4, U5 and BD.',
  },
  {
    id: 'co_open_data',
    name: 'Colorado business entities (Colorado Information Marketplace)',
    operator: 'State of Colorado (data from the Colorado Secretary of State)',
    mode: 'automated',
    host: 'data.colorado.gov',
    link: 'https://data.colorado.gov/d/4ykn-tg5h',
    kinds: ['company'],
    why: 'Colorado publishes its business entity register on its open data portal, through an API built for programs. The room sends one request per check.',
    lookFor: {
      company: 'Look for the entity\'s exact name, its status (good standing, delinquent, dissolved), its type, the date it was formed, the state it was formed in and its principal address. Confirm the details on the Secretary of State\'s own record using the entity ID.',
    },
    coverage: 'Entities registered with the Colorado Secretary of State, as the state last published them. It is searched by entity name, not by the people behind an entity.',
  },
  {
    id: 'co_sos',
    name: 'Colorado Secretary of State business search',
    operator: 'Colorado Secretary of State',
    mode: 'link_only',
    link: 'https://www.coloradosos.gov/ucc/pages/biz/bizSearch.xhtml',
    kinds: ['person', 'company'],
    why: 'Its terms and robots rules could not be read from here, so it is not searched automatically. The same register is searched through the state\'s open data portal instead.',
    lookFor: {
      person: 'Search by individual name where the search offers it (for example a registered agent). Look for entities the person is named on, and read each entity\'s filing history.',
      company: 'Search the entity name. Look for its status, filing history, registered agent, periodic reports and any trade names. Use the entity ID to be sure it is the right one.',
    },
    coverage: 'Entities, trade names and filings on the Colorado Secretary of State\'s register.',
  },
  {
    id: 'de_entity',
    name: 'Delaware Division of Corporations entity search',
    operator: 'State of Delaware, Division of Corporations',
    mode: 'link_only',
    link: 'https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx',
    kinds: ['company'],
    why: 'Delaware prohibits data mining of its entity search, warns that automated tools can lose access, and puts the search behind a challenge. It is never searched automatically.',
    lookFor: {
      company: 'Search the entity name. The free search shows the entity\'s file number, incorporation or formation date, kind, and registered agent. Its status and tax standing cost a fee from the Division; ask for a certificate of good standing if the deal depends on it.',
    },
    coverage: 'Entities formed in or registered with Delaware. It searches entity names and file numbers, not people, and the free result is limited.',
  },
  {
    id: 'courtlistener',
    name: 'CourtListener dockets',
    operator: 'Free Law Project',
    mode: 'automated',
    host: 'www.courtlistener.com',
    link: 'https://www.courtlistener.com/',
    kinds: ['person', 'company'],
    why: 'CourtListener offers a REST API for programs, which refuses requests without the user\'s own API token. The room sends one request, and only when it has a token set (COURTLISTENER_TOKEN).',
    lookFor: {
      person: 'Search the RECAP Archive (federal dockets) for the name as a party. Look at each case\'s court, number, dates, nature of suit and the other parties, and open the docket before drawing anything from it.',
      company: 'Search the RECAP Archive (federal dockets) for the name as a party. Look at each case\'s court, number, dates, nature of suit and the other parties, and open the docket before drawing anything from it.',
    },
    coverage: 'Federal court dockets that someone has bought from PACER and shared, plus some others. Many federal dockets and almost all state court cases (including Colorado\'s) are not here, so no result does not mean no case.',
  },
];

export function sourceInfo(id: SourceId): SourceInfo {
  return SOURCES.find((source) => source.id === id)!;
}
