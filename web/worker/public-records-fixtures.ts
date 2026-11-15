// SPDX-License-Identifier: Apache-2.0
// Test support only: recorded responses for the public-records sources, invented from scratch in each source's
// documented or observed shape. Every name, number and date is fictional (the Doe v. Harbor Labs fixture's world): no
// real person, company, filing or case. The CIKs, accession numbers, entity IDs and docket ids are out of the ranges
// those registers have used, so a link built from one leads nowhere real.
import type { Fetcher } from './public-records-sources.ts';

export const FIXTURE_COMPANY = 'Harbor Labs, Inc.';
export const FIXTURE_PERSON = 'Jane Doe';

/** SEC EDGAR full-text search (efts.sec.gov/LATEST/search-index): Elasticsearch hits. Two filings, one repeated. */
export const EDGAR_HITS = {
  took: 12,
  hits: {
    total: { value: 2, relation: 'eq' },
    hits: [
      {
        _id: '0009990001-26-000001:primary_doc.xml',
        _source: {
          ciks: ['0009990001'],
          display_names: ['Harbor Labs, Inc.  (CIK 0009990001)'],
          form: 'D',
          root_forms: ['D'],
          file_date: '2026-03-02',
          adsh: '0009990001-26-000001',
          biz_locations: ['Denver, CO'],
        },
      },
      {
        _id: '0009990001-26-000001:primary_doc.html',
        _source: { ciks: ['0009990001'], display_names: ['Harbor Labs, Inc.  (CIK 0009990001)'], form: 'D', file_date: '2026-03-02', adsh: '0009990001-26-000001' },
      },
      {
        _id: '0009990002-26-000007:exhibit.htm',
        _source: { ciks: ['0009990002'], display_names: ['Doe Ventures Fund I, L.P.  (CIK 0009990002)'], form: 'D/A', file_date: '2026-05-14', adsh: '0009990002-26-000007' },
      },
    ],
  },
};

/** EDGAR with no match. */
export const EDGAR_EMPTY = { took: 3, hits: { total: { value: 0, relation: 'eq' }, hits: [] } };

/** Colorado Information Marketplace, Business Entities in Colorado (data.colorado.gov/resource/4ykn-tg5h.json). */
export const COLORADO_ROWS = [
  {
    entityid: '20269900001',
    entityname: 'Harbor Labs, Inc.',
    principalcity: 'Denver',
    principalstate: 'CO',
    entitystatus: 'Good Standing',
    entitytype: 'Corporation',
    jurisdictonofformation: 'DE',
    entityformdate: '2026-01-15T00:00:00.000',
  },
  {
    entityid: '20269900002',
    entityname: 'Harbor Labs Holdings LLC',
    principalcity: 'Boulder',
    principalstate: 'CO',
    entitystatus: 'Delinquent',
    entitytype: 'Limited Liability Company',
    jurisdictonofformation: 'CO',
    entityformdate: '2025-11-03T00:00:00.000',
  },
];

/** CourtListener v4 search, type d (dockets). */
export const COURTLISTENER_DOCKETS = {
  count: 1,
  next: null,
  previous: null,
  results: [
    {
      caseName: 'Doe v. Harbor Labs, Inc.',
      docketNumber: '1:26-cv-09901',
      court: 'District Court, D. Colorado',
      court_id: 'cod',
      dateFiled: '2026-04-01',
      dateTerminated: null,
      suitNature: 'Contract: Other',
      docket_id: 990000001,
      docket_absolute_url: '/docket/990000001/doe-v-harbor-labs-inc/',
    },
  ],
};

export const COURTLISTENER_EMPTY = { count: 0, next: null, previous: null, results: [] };

/** A recorded response: a status and a body (JSON unless a string), or a network failure. */
export type Recorded = { status?: number; body: unknown } | 'network_error' | 'timeout';

export interface RecordedFetch {
  fetcher: Fetcher;
  /** Every request made, in order: the URL and its headers. */
  calls: { url: string; headers: Record<string, string> }[];
}

/** A fetch that answers each host from `answers` (by hostname) and records every request; an unknown host throws. */
export function recordedFetch(answers: Record<string, Recorded>): RecordedFetch {
  const calls: RecordedFetch['calls'] = [];
  const fetcher: Fetcher = async (input, init) => {
    const url = new URL(input);
    calls.push({ url: input, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    const answer = answers[url.hostname];
    if (answer === undefined) throw new Error(`unexpected host ${url.hostname}`);
    if (answer === 'network_error') throw new TypeError('fetch failed');
    if (answer === 'timeout') throw new DOMException('The operation timed out.', 'TimeoutError');
    const body = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body);
    return new Response(body, { status: answer.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetcher, calls };
}
