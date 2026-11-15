// SPDX-License-Identifier: Apache-2.0
// The public-records sources (worker/public-records-sources.ts) against recorded, invented responses: what each source
// returns becomes findings with a source, a link and the date checked; a missing record is said plainly; a failed
// source is reported as failed, never as "nothing found"; a source that bars bots is never fetched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanDate,
  cleanField,
  coloradoUrl,
  courtListenerUrl,
  docketLink,
  edgarFilingLink,
  edgarUrl,
  missingSetting,
  parseColorado,
  parseCourtListener,
  parseEdgar,
  runSources,
  sendsTo,
  SOURCES,
  type SourceResult,
} from './public-records-sources.ts';
import {
  COLORADO_ROWS,
  COURTLISTENER_DOCKETS,
  COURTLISTENER_EMPTY,
  EDGAR_EMPTY,
  EDGAR_HITS,
  FIXTURE_COMPANY,
  FIXTURE_PERSON,
  recordedFetch,
  type Recorded,
} from './public-records-fixtures.ts';

const CHECKED = '2026-11-01T14:05:00.000Z';
const NOW = () => new Date(CHECKED);
/** Every setting on: an SEC contact and a CourtListener token (both invented). */
const ALL_SET = { PUBLIC_RECORDS: '1', PUBLIC_RECORDS_CONTACT: 'owner@example.test', COURTLISTENER_TOKEN: 'a'.repeat(40) };
const ALL_AUTOMATED = ['sec_edgar', 'co_open_data', 'courtlistener'];
/** Hosts whose terms or robots rules bar bots, or whose terms could not be read: never fetched. */
const NEVER_FETCHED = ['adviserinfo.sec.gov', 'api.adviserinfo.sec.gov', 'brokercheck.finra.org', 'api.brokercheck.finra.org', 'www.coloradosos.gov', 'www.sos.state.co.us', 'icis.corp.delaware.gov'];

const byId = (results: SourceResult[], id: string) => results.find((r) => r.id === id)!;

test('the catalog: every source the brief names, linked only where bots are barred or terms unread', () => {
  assert.deepEqual(
    SOURCES.map((s) => [s.id, s.mode]),
    [
      ['sec_edgar', 'automated'],
      ['sec_adviser', 'link_only'],
      ['finra_brokercheck', 'link_only'],
      ['co_open_data', 'automated'],
      ['co_sos', 'link_only'],
      ['de_entity', 'link_only'],
      ['courtlistener', 'automated'],
    ],
  );
  for (const source of SOURCES) {
    assert.match(source.link, /^https:\/\//, source.id);
    assert.ok(source.why.length > 40 && source.coverage.length > 40, `${source.id} says why and what it covers`);
    for (const kind of source.kinds) assert.ok(source.lookFor[kind], `${source.id} says what to look for (${kind})`);
    if (source.mode === 'automated') assert.ok(source.host && !NEVER_FETCHED.includes(source.host), source.id);
  }
});

test('EDGAR: filings become findings with the filing link, the filer and the date checked; repeats are dropped', () => {
  const { findings, total } = parseEdgar(EDGAR_HITS, CHECKED);
  assert.equal(total, 2);
  assert.equal(findings.length, 2, 'the second document of the same filing is the same filing');
  assert.deepEqual(findings[0], {
    source: 'SEC EDGAR full-text search',
    title: 'Harbor Labs, Inc. (CIK 0009990001)',
    details: ['Form D', 'Filer: Harbor Labs, Inc. (CIK 0009990001)', 'Company filings: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0009990001'],
    date: '2026-03-02',
    link: 'https://www.sec.gov/Archives/edgar/data/9990001/000999000126000001/0009990001-26-000001-index.htm',
    checked: CHECKED,
  });
  assert.equal(findings[1].details[0], 'Form D/A');
  assert.deepEqual(parseEdgar(EDGAR_EMPTY, CHECKED), { findings: [], total: 0 });
  assert.throws(() => parseEdgar({ error: 'nope' }, CHECKED), /expected format/);
});

test('Colorado: rows become findings with the entity ID, status, type, formation and the record link', () => {
  const { findings } = parseColorado(COLORADO_ROWS, CHECKED);
  assert.equal(findings.length, 2);
  assert.deepEqual(findings[0], {
    source: 'Colorado business entities (Colorado Information Marketplace)',
    title: 'Harbor Labs, Inc.',
    details: ['Entity ID: 20269900001', 'Status: Good Standing', 'Type: Corporation', 'Formed in: DE', 'Principal office: Denver, CO'],
    date: '2026-01-15',
    link: 'https://data.colorado.gov/resource/4ykn-tg5h.json?entityid=20269900001',
    checked: CHECKED,
  });
  // A column the dataset renamed or dropped is left out, not invented.
  const [sparse] = parseColorado([{ entityid: '20269900003', entityname: 'Doe Widgets LLC' }], CHECKED).findings;
  assert.deepEqual(sparse.details, ['Entity ID: 20269900003']);
  assert.equal(sparse.date, null);
  assert.deepEqual(parseColorado([], CHECKED).findings, []);
  assert.throws(() => parseColorado({ message: 'error' }, CHECKED), /expected format/);
});

test('CourtListener: dockets become findings with the court, number, dates and the docket link', () => {
  const { findings, total } = parseCourtListener(COURTLISTENER_DOCKETS, CHECKED);
  assert.equal(total, 1);
  assert.deepEqual(findings[0], {
    source: 'CourtListener dockets',
    title: 'Doe v. Harbor Labs, Inc.',
    details: ['Court: District Court, D. Colorado', 'Case number: 1:26-cv-09901', 'Nature of suit: Contract: Other'],
    date: '2026-04-01',
    link: 'https://www.courtlistener.com/docket/990000001/doe-v-harbor-labs-inc/',
    checked: CHECKED,
  });
  assert.deepEqual(parseCourtListener(COURTLISTENER_EMPTY, CHECKED), { findings: [], total: 0 });
});

test('links are built only from ids and paths of the right shape, on the source\'s own host', () => {
  assert.equal(edgarFilingLink('0009990001', '../../etc'), null);
  assert.equal(edgarFilingLink('x', '0009990001-26-000001'), null);
  assert.equal(docketLink('https://evil.example/docket/1/', null), null);
  assert.equal(docketLink('//evil.example/docket/1/', null), null);
  assert.equal(docketLink('/docket/12/a-case/', null), 'https://www.courtlistener.com/docket/12/a-case/');
  assert.equal(docketLink('/admin/', 7), 'https://www.courtlistener.com/docket/7/');
  const odd = parseCourtListener({ count: 1, results: [{ caseName: 'X', docket_absolute_url: 'javascript:alert(1)' }] }, CHECKED);
  assert.deepEqual(odd.findings, [], 'no safe link, no finding');
  const colorado = parseColorado([{ entityid: '1; drop', entityname: 'Doe Widgets LLC' }], CHECKED);
  assert.deepEqual(colorado.findings, []);
});

test('text from a source is made plain: control and direction characters out, cut to length', () => {
  assert.equal(cleanField('Harbor‮ Labs\u0000\n Inc'), 'Harbor Labs Inc');
  assert.equal(cleanField('x'.repeat(300)).length, 200);
  assert.equal(cleanField({ a: 1 }), '');
  assert.equal(cleanDate('2026-01-15T00:00:00.000'), '2026-01-15');
  assert.equal(cleanDate('15/01/2026'), null);
});

test('the name goes into each query as one quoted phrase, safely encoded', () => {
  assert.equal(edgarUrl(FIXTURE_COMPANY), 'https://efts.sec.gov/LATEST/search-index?q=%22Harbor%20Labs%2C%20Inc.%22');
  assert.equal(courtListenerUrl(FIXTURE_PERSON), 'https://www.courtlistener.com/api/rest/v4/search/?type=d&q=%22Jane%20Doe%22');
  const colorado = new URL(coloradoUrl("Doe's Widgets"));
  assert.equal(colorado.searchParams.get('$where'), "upper(entityname) like '%DOE''S WIDGETS%'", 'a quote is doubled for SoQL');
  assert.equal(colorado.searchParams.get('$limit'), '10');
});

test('what the name would go to depends on the kind and the room\'s settings', () => {
  assert.deepEqual(sendsTo('company', ALL_SET).map((s) => s.id), ALL_AUTOMATED);
  assert.deepEqual(sendsTo('person', ALL_SET).map((s) => s.id), ['sec_edgar', 'courtlistener'], 'the entity register is not searched for a person');
  assert.deepEqual(sendsTo('company', { PUBLIC_RECORDS: '1' }).map((s) => s.id), ['co_open_data'], 'no contact, no token');
  assert.deepEqual(sendsTo('person', { PUBLIC_RECORDS: '1' }), [], 'nothing would leave the room');
  assert.match(missingSetting('sec_edgar', { PUBLIC_RECORDS_CONTACT: 'not an email\r\nX-Evil: 1' })!, /PUBLIC_RECORDS_CONTACT/, 'a malformed contact never reaches a header');
  assert.match(missingSetting('courtlistener', { COURTLISTENER_TOKEN: 'short' })!, /COURTLISTENER_TOKEN/);
});

test('a full check: three sources searched once each with the right headers; the rest linked, never fetched', async () => {
  const recorded = recordedFetch({
    'efts.sec.gov': { body: EDGAR_HITS },
    'data.colorado.gov': { body: COLORADO_ROWS },
    'www.courtlistener.com': { body: COURTLISTENER_DOCKETS },
  });
  const results = await runSources(FIXTURE_COMPANY, 'company', ALL_SET, ALL_AUTOMATED, recorded.fetcher, NOW);
  assert.deepEqual(results.map((r) => [r.id, r.status]), [
    ['sec_edgar', 'searched'],
    ['sec_adviser', 'link_only'],
    ['finra_brokercheck', 'link_only'],
    ['co_open_data', 'searched'],
    ['co_sos', 'link_only'],
    ['de_entity', 'link_only'],
    ['courtlistener', 'searched'],
  ]);
  assert.equal(recorded.calls.length, 3, 'one request per automated source');
  for (const call of recorded.calls) assert.ok(!NEVER_FETCHED.includes(new URL(call.url).hostname));
  const sec = recorded.calls.find((c) => c.url.startsWith('https://efts.sec.gov/'))!;
  assert.equal(sec.headers['user-agent'], 'Legallas public records check owner@example.test', 'the SEC hears who is asking');
  const court = recorded.calls.find((c) => c.url.startsWith('https://www.courtlistener.com/'))!;
  assert.equal(court.headers.authorization, `Token ${'a'.repeat(40)}`);
  for (const result of results.filter((r) => r.status === 'searched')) {
    assert.equal(result.checked, CHECKED);
    assert.ok(result.sent_to);
    for (const finding of result.findings) {
      assert.equal(finding.source, result.source, 'each finding names its source');
      assert.match(finding.link, /^https:\/\//, 'each finding has a link');
      assert.equal(finding.checked, CHECKED, 'each finding has the date checked');
    }
  }
  for (const result of results.filter((r) => r.status === 'link_only')) {
    assert.equal(result.checked, null);
    assert.equal(result.sent_to, null);
    assert.ok(result.look_for, `${result.id} says what to look for`);
    assert.match(result.note, /^Not searched automatically\./);
  }
});

test('a missing record is said plainly, and never read as a clean record', async () => {
  const recorded = recordedFetch({
    'efts.sec.gov': { body: EDGAR_EMPTY },
    'data.colorado.gov': { body: [] },
    'www.courtlistener.com': { body: COURTLISTENER_EMPTY },
  });
  const results = await runSources(FIXTURE_COMPANY, 'company', ALL_SET, ALL_AUTOMATED, recorded.fetcher, NOW);
  for (const id of ALL_AUTOMATED) {
    const result = byId(results, id);
    assert.equal(result.status, 'searched', id);
    assert.deepEqual(result.findings, []);
    assert.match(result.note, /No record found under this name\. That only means this search of this source returned no match; it does not mean there is no record\./);
    assert.ok(result.coverage, `${id} says what it does not cover`);
  }
});

test('failed sources: refused, down, slow, malformed or too busy each say "could not check", and the others still run', async () => {
  const cases: [string, Recorded, RegExp][] = [
    ['refused', { status: 403, body: { detail: 'Forbidden' } }, /refused the request \(HTTP 403\)/],
    ['token rejected', { status: 401, body: { detail: 'Invalid token.' } }, /refused the request \(HTTP 401\)/],
    ['busy', { status: 429, body: {} }, /slow down \(HTTP 429\)/],
    ['down', { status: 503, body: 'Service Unavailable' }, /error \(HTTP 503\)/],
    ['malformed', { body: '<html>not json</html>' }, /not in the expected format/],
    ['wrong shape', { body: { unexpected: true } }, /not in the expected format/],
    ['network', 'network_error', /could not be reached/],
    ['slow', 'timeout', /did not answer in time/],
  ];
  for (const [label, answer, reason] of cases) {
    const recorded = recordedFetch({ 'efts.sec.gov': answer, 'data.colorado.gov': { body: COLORADO_ROWS }, 'www.courtlistener.com': answer });
    const results = await runSources(FIXTURE_COMPANY, 'company', ALL_SET, ALL_AUTOMATED, recorded.fetcher, NOW);
    for (const id of ['sec_edgar', 'courtlistener']) {
      const failed = byId(results, id);
      assert.equal(failed.status, 'failed', `${label}: ${id}`);
      assert.match(failed.note, /^Could not check: /, label);
      assert.match(failed.note, reason, label);
      assert.match(failed.note, /Nothing can be said about what it holds; search it by hand\./, label);
      assert.doesNotMatch(failed.note, /No record found/, `${label}: a failure is never "nothing found"`);
      assert.deepEqual(failed.findings, []);
      assert.equal(failed.checked, CHECKED, 'a failed source still says when it was tried');
    }
    assert.equal(byId(results, 'co_open_data').status, 'searched', `${label}: the working source still reports`);
    assert.equal(byId(results, 'co_open_data').findings.length, 2);
  }
});

test('sources not set up are linked with the reason, and the name is not sent to them', async () => {
  const recorded = recordedFetch({ 'data.colorado.gov': { body: COLORADO_ROWS } });
  const results = await runSources(FIXTURE_COMPANY, 'company', { PUBLIC_RECORDS: '1' }, ['co_open_data'], recorded.fetcher, NOW);
  assert.equal(byId(results, 'sec_edgar').status, 'not_set_up');
  assert.match(byId(results, 'sec_edgar').note, /no contact address set for the SEC/);
  assert.equal(byId(results, 'courtlistener').status, 'not_set_up');
  assert.match(byId(results, 'courtlistener').note, /no CourtListener API token/);
  assert.deepEqual(recorded.calls.map((c) => new URL(c.url).hostname), ['data.colorado.gov']);
});

test('a source the member did not approve is not searched, even once it is set up', async () => {
  const recorded = recordedFetch({ 'data.colorado.gov': { body: COLORADO_ROWS } });
  const results = await runSources(FIXTURE_COMPANY, 'company', ALL_SET, ['co_open_data'], recorded.fetcher, NOW);
  assert.deepEqual(recorded.calls.map((c) => new URL(c.url).hostname), ['data.colorado.gov']);
  assert.match(byId(results, 'sec_edgar').note, /approval did not include it/);
});

test('a person: entity registers say they do not apply; nothing is fetched from them', async () => {
  const recorded = recordedFetch({ 'efts.sec.gov': { body: EDGAR_EMPTY }, 'www.courtlistener.com': { body: COURTLISTENER_EMPTY } });
  const results = await runSources(FIXTURE_PERSON, 'person', ALL_SET, ['sec_edgar', 'courtlistener'], recorded.fetcher, NOW);
  assert.equal(byId(results, 'co_open_data').status, 'not_applicable');
  assert.equal(byId(results, 'de_entity').status, 'not_applicable');
  assert.match(byId(results, 'de_entity').note, /covers companies, not people/);
  assert.deepEqual(recorded.calls.map((c) => new URL(c.url).hostname).sort(), ['efts.sec.gov', 'www.courtlistener.com']);
});
