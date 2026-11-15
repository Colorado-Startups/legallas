// SPDX-License-Identifier: Apache-2.0
// The three public sources a records check searches automatically, and the runner over every source in the catalog
// (worker/public-records-catalog.ts). docs/design/public-records-sources.md records why: a site whose terms or robots
// rules bar automated searches, or whose terms could not be read, is never fetched; the member gets its link and what
// to look for instead.
//
// Automated, each only after the member approved the name (worker/public-records.ts):
// - SEC EDGAR full-text search (efts.sec.gov), when the room sets PUBLIC_RECORDS_CONTACT: the SEC lets declared
//   automated tools in (a User-Agent with a contact address, at most 10 requests a second). One request per check.
// - The Colorado Information Marketplace's "Business Entities in Colorado" dataset (data.colorado.gov, the state's
//   open data portal, a Socrata API built for programs), for a company. One request per check.
// - CourtListener's REST API (v4 search, dockets), when the room sets COURTLISTENER_TOKEN: the API refuses requests
//   without a token. One request per check.
// Linked only: the SEC's adviser search, FINRA BrokerCheck, the Colorado Secretary of State's own business search and
// Delaware's entity search.
//
// Everything a source returns is untrusted: each field is cleaned (control and direction characters out, cut to a
// length), links are built on the source's own host only from ids and paths that match a strict pattern, and no
// redirect is followed. A failed source is reported as failed, never as "nothing found".
import { courtListenerToken, secContact, type CheckKind, type PublicRecordsVars } from './public-records.ts';
import { SOURCES, sourceInfo, type SourceId, type SourceInfo } from './public-records-catalog.ts';

export { SOURCES, sourceInfo, type SourceId, type SourceInfo, type SourceMode } from './public-records-catalog.ts';

/** Where a source stands for one check. */
export type SourceStatus =
  /** Searched; findings may be empty. */
  | 'searched'
  /** Tried and failed: nothing can be said about what it holds. */
  | 'failed'
  /** Could be searched automatically, but the room has not set what it needs. */
  | 'not_set_up'
  /** Never searched automatically: its terms bar it, or could not be read. */
  | 'link_only'
  /** Does not cover this kind (a person in an entity register). */
  | 'not_applicable';

/** One record a source returned, as the check shows it. */
export interface Finding {
  /** The source's name, so a finding read alone still says where it came from. */
  source: string;
  /** The record's own name or title, as the source gives it. */
  title: string;
  /** Short facts, as the source gives them (form, court, status). */
  details: string[];
  /** The record's own date (a filing date, a formation date), when the source gives one. */
  date: string | null;
  /** A link to the record at the source. */
  link: string;
  /** When the room checked the source (ISO 8601). */
  checked: string;
}

export interface SourceResult {
  id: SourceId;
  source: string;
  operator: string;
  status: SourceStatus;
  /** When the room checked the source, for searched and failed sources (ISO 8601). */
  checked: string | null;
  /** The host the name went to, for searched and failed sources. */
  sent_to: string | null;
  findings: Finding[];
  /** How many records the source said match, when it said; may exceed findings. */
  total: number | null;
  /** The source's search page. */
  link: string;
  /** What happened, in plain words. */
  note: string;
  look_for: string | null;
  coverage: string;
}

/** The fetch the sources use; tests pass recorded responses. */
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** Records shown per source. The source's own count says how many more there are. */
export const MAX_FINDINGS = 10;
/** How long one source may take. */
export const SOURCE_TIMEOUT_MS = 8000;
const MAX_FIELD_CHARS = 200;
/** The most response bytes read from one source. */
const MAX_RESPONSE_BYTES = 2_000_000;

/**
 * Text from a source made plain: control, format and direction characters out, spaces collapsed, cut to `max`
 * characters. The readable report escapes it again for Markdown (mcp/tools/public-records.ts).
 */
export function cleanField(value: unknown, max = MAX_FIELD_CHARS): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const plain = String(value)
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...plain].length > max ? `${[...plain].slice(0, max - 1).join('')}…` : plain;
}

/** A YYYY-MM-DD date from a source's date or timestamp; null for anything else. */
export function cleanDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(value.trim());
  return match && !Number.isNaN(Date.parse(match[1])) ? match[1] : null;
}

class SourceError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = 'SourceError';
    this.reason = reason;
  }
}

/** A source's JSON, or a SourceError saying plainly why not. */
async function fetchJson(fetcher: Fetcher, url: string, headers: Record<string, string>): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, { method: 'GET', headers: { accept: 'application/json', ...headers }, redirect: 'error', signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    throw new SourceError(name === 'TimeoutError' || name === 'AbortError' ? 'it did not answer in time' : 'it could not be reached');
  }
  if (response.status === 401 || response.status === 403) throw new SourceError(`it refused the request (HTTP ${response.status})`);
  if (response.status === 429) throw new SourceError('it asked the room to slow down (HTTP 429)');
  if (!response.ok) throw new SourceError(`it answered with an error (HTTP ${response.status})`);
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_RESPONSE_BYTES) throw new SourceError('its answer was too large to read');
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new SourceError('its answer was too large to read');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SourceError('its answer was not in the expected format');
  }
}

type Json = Record<string, unknown>;
const record = (value: unknown): Json | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null);
const firstString = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);

// --- SEC EDGAR full-text search -------------------------------------------------------------------------------

/** The full-text search API the SEC's own search page calls. Not in the SEC's list of documented APIs. */
export const EDGAR_SEARCH = 'https://efts.sec.gov/LATEST/search-index';

export function edgarUrl(name: string): string {
  return `${EDGAR_SEARCH}?q=${encodeURIComponent(`"${name}"`)}`;
}

const CIK = /^\d{1,10}$/;
const ACCESSION = /^(\d{10})-(\d{2})-(\d{6})$/;

/** The filing's index page on EDGAR, from its CIK and accession number; null when either is malformed. */
export function edgarFilingLink(cik: string, accession: string): string | null {
  if (!CIK.test(cik) || !ACCESSION.test(accession)) return null;
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${accession}-index.htm`;
}

/** Findings from an EDGAR full-text search answer (Elasticsearch hits). */
export function parseEdgar(body: unknown, checked: string): { findings: Finding[]; total: number | null } {
  const hits = record(record(body)?.hits);
  if (!hits || !Array.isArray(hits.hits)) throw new SourceError('its answer was not in the expected format');
  const totalValue = record(hits.total)?.value;
  const total = typeof totalValue === 'number' && Number.isInteger(totalValue) && totalValue >= 0 ? totalValue : null;
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const raw of hits.hits) {
    const source = record(record(raw)?._source);
    if (!source) continue;
    const accession = typeof source.adsh === 'string' ? source.adsh : String(record(raw)?._id ?? '').split(':')[0];
    const cik = String(firstString(source.ciks) ?? '');
    const link = edgarFilingLink(cik, accession);
    if (!link || seen.has(accession)) continue;
    seen.add(accession);
    const form = cleanField(source.form ?? firstString(source.root_forms), 20);
    const company = cleanField(firstString(source.display_names));
    const details = [form ? `Form ${form}` : '', company ? `Filer: ${company}` : '', `Company filings: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik.padStart(10, '0')}`].filter(Boolean);
    findings.push({ source: sourceInfo('sec_edgar').name, title: company || `Filing ${accession}`, details, date: cleanDate(source.file_date), link, checked });
    if (findings.length >= MAX_FINDINGS) break;
  }
  return { findings, total };
}

// --- Colorado Information Marketplace: Business Entities in Colorado ---------------------------------------------

export const CO_DATASET = 'https://data.colorado.gov/resource/4ykn-tg5h.json';
const CO_ENTITY_ID = /^\d{6,14}$/;

/** A SoQL string literal: single quotes doubled. */
const soqlString = (text: string) => `'${text.replace(/'/g, "''")}'`;

export function coloradoUrl(name: string): string {
  const where = `upper(entityname) like ${soqlString(`%${name.toUpperCase()}%`)}`;
  return `${CO_DATASET}?$where=${encodeURIComponent(where)}&$order=${encodeURIComponent('entityname')}&$limit=${MAX_FINDINGS}`;
}

/** The dataset's own record for one entity ID, as a link; null for a malformed ID. */
export function coloradoRecordLink(entityId: string): string | null {
  return CO_ENTITY_ID.test(entityId) ? `${CO_DATASET}?entityid=${entityId}` : null;
}

/** Findings from the dataset's rows. Columns are read by name and any that are missing are left out. */
export function parseColorado(body: unknown, checked: string): { findings: Finding[]; total: number | null } {
  if (!Array.isArray(body)) throw new SourceError('its answer was not in the expected format');
  const findings: Finding[] = [];
  for (const raw of body) {
    const row = record(raw);
    if (!row) continue;
    const id = String(row.entityid ?? '');
    const link = coloradoRecordLink(id);
    const title = cleanField(row.entityname);
    if (!link || !title) continue;
    const jurisdiction = cleanField(row.jurisdictonofformation ?? row.jurisdictionofformation, 40);
    const place = [cleanField(row.principalcity, 60), cleanField(row.principalstate, 20)].filter(Boolean).join(', ');
    const details = [
      `Entity ID: ${id}`,
      row.entitystatus ? `Status: ${cleanField(row.entitystatus, 60)}` : '',
      row.entitytype ? `Type: ${cleanField(row.entitytype, 60)}` : '',
      jurisdiction ? `Formed in: ${jurisdiction}` : '',
      place ? `Principal office: ${place}` : '',
    ].filter(Boolean);
    findings.push({ source: sourceInfo('co_open_data').name, title, details, date: cleanDate(row.entityformdate), link, checked });
    if (findings.length >= MAX_FINDINGS) break;
  }
  return { findings, total: null };
}

// --- CourtListener dockets ------------------------------------------------------------------------------------

export const COURTLISTENER_SEARCH = 'https://www.courtlistener.com/api/rest/v4/search/';
const DOCKET_PATH = /^\/docket\/\d{1,12}\/(?:[a-z0-9-]{0,200}\/)?$/;

export function courtListenerUrl(name: string): string {
  return `${COURTLISTENER_SEARCH}?type=d&q=${encodeURIComponent(`"${name}"`)}`;
}

/** The docket's page on CourtListener: its own path when it has the docket shape, else built from its id. */
export function docketLink(path: unknown, id: unknown): string | null {
  if (typeof path === 'string' && DOCKET_PATH.test(path)) return `https://www.courtlistener.com${path}`;
  if ((typeof id === 'number' && Number.isInteger(id) && id > 0) || (typeof id === 'string' && /^\d{1,12}$/.test(id))) return `https://www.courtlistener.com/docket/${id}/`;
  return null;
}

/** Findings from a CourtListener search answer (type d: dockets). */
export function parseCourtListener(body: unknown, checked: string): { findings: Finding[]; total: number | null } {
  const value = record(body);
  if (!value || !Array.isArray(value.results)) throw new SourceError('its answer was not in the expected format');
  const total = typeof value.count === 'number' && Number.isInteger(value.count) && value.count >= 0 ? value.count : null;
  const findings: Finding[] = [];
  for (const raw of value.results) {
    const row = record(raw);
    if (!row) continue;
    const link = docketLink(row.docket_absolute_url ?? row.absolute_url, row.docket_id);
    if (!link) continue;
    const title = cleanField(row.caseName) || 'Untitled case';
    const terminated = cleanDate(row.dateTerminated);
    const details = [
      row.court ? `Court: ${cleanField(row.court, 120)}` : '',
      row.docketNumber ? `Case number: ${cleanField(row.docketNumber, 60)}` : '',
      row.suitNature ? `Nature of suit: ${cleanField(row.suitNature, 120)}` : '',
      terminated ? `Closed: ${terminated}` : '',
    ].filter(Boolean);
    findings.push({ source: sourceInfo('courtlistener').name, title, details, date: cleanDate(row.dateFiled), link, checked });
    if (findings.length >= MAX_FINDINGS) break;
  }
  return { findings, total };
}

// --- Running a check ------------------------------------------------------------------------------------------

/** What an automated source needs before it can run: null when it can, else the plain reason it cannot. */
export function missingSetting(id: SourceId, env: PublicRecordsVars): string | null {
  if (id === 'sec_edgar' && !secContact(env)) {
    return 'Not searched: the room has no contact address set for the SEC (PUBLIC_RECORDS_CONTACT), which its fair-access rules require of automated tools.';
  }
  if (id === 'courtlistener' && !courtListenerToken(env)) {
    return "Not searched: the room has no CourtListener API token set (COURTLISTENER_TOKEN), and CourtListener's API refuses requests without one.";
  }
  return null;
}

/** The hosts the name would go to for this kind, with the room's settings: what the member approves. */
export function sendsTo(kind: CheckKind, env: PublicRecordsVars): SourceInfo[] {
  return SOURCES.filter((source) => source.mode === 'automated' && source.kinds.includes(kind) && missingSetting(source.id, env) === null);
}

function base(source: SourceInfo, kind: CheckKind): Omit<SourceResult, 'status' | 'checked' | 'sent_to' | 'note'> {
  return {
    id: source.id,
    source: source.name,
    operator: source.operator,
    findings: [],
    total: null,
    link: source.link,
    look_for: source.lookFor[kind] ?? null,
    coverage: source.coverage,
  };
}

/** A source's result without searching it: not applicable, not set up, or linked only. */
export function unsearched(source: SourceInfo, kind: CheckKind, env: PublicRecordsVars): SourceResult | null {
  if (!source.kinds.includes(kind)) {
    const what = kind === 'person' ? 'companies, not people' : 'people, not companies';
    return { ...base(source, kind), status: 'not_applicable', checked: null, sent_to: null, look_for: null, note: `Not searched: it covers ${what}.` };
  }
  if (source.mode === 'link_only') return { ...base(source, kind), status: 'link_only', checked: null, sent_to: null, note: `Not searched automatically. ${source.why}` };
  const missing = missingSetting(source.id, env);
  if (missing) return { ...base(source, kind), status: 'not_set_up', checked: null, sent_to: null, note: missing };
  return null;
}

/** One automated source, searched once. Never throws: a failure is its own result. */
async function searchSource(source: SourceInfo, name: string, kind: CheckKind, env: PublicRecordsVars, fetcher: Fetcher, now: () => Date): Promise<SourceResult> {
  const checked = now().toISOString();
  const head = { ...base(source, kind), checked, sent_to: source.host ?? null };
  try {
    let parsed: { findings: Finding[]; total: number | null };
    if (source.id === 'sec_edgar') parsed = parseEdgar(await fetchJson(fetcher, edgarUrl(name), { 'user-agent': `Legallas public records check ${secContact(env)}` }), checked);
    else if (source.id === 'co_open_data') parsed = parseColorado(await fetchJson(fetcher, coloradoUrl(name), {}), checked);
    else if (source.id === 'courtlistener') parsed = parseCourtListener(await fetchJson(fetcher, courtListenerUrl(name), { authorization: `Token ${courtListenerToken(env)}` }), checked);
    else throw new SourceError('it is not searched automatically');
    const shown = parsed.findings.length;
    const more = parsed.total !== null && parsed.total > shown ? ` The source reports ${parsed.total} in all; open its search page for the rest.` : '';
    const note =
      shown === 0
        ? `No record found under this name. That only means this search of this source returned no match; it does not mean there is no record.`
        : `${shown} record${shown === 1 ? '' : 's'} found under this name.${more} A record under the same name may be about someone else.`;
    return { ...head, status: 'searched', findings: parsed.findings, total: parsed.total, note };
  } catch (error) {
    const reason = error instanceof SourceError ? error.reason : 'something went wrong reading it';
    console.error('public_records_source_failed', source.id, error instanceof Error ? error.name : typeof error);
    return { ...head, status: 'failed', note: `Could not check: ${reason}. Nothing can be said about what it holds; search it by hand.` };
  }
}

/**
 * Every source for one approved check, in SOURCES order: the automated ones the member approved (`approved`, source
 * ids) searched at once, the rest explained. A source set up after the approval is not searched: the name goes only
 * where the member saw it would.
 */
export async function runSources(name: string, kind: CheckKind, env: PublicRecordsVars, approved: readonly string[], fetcher: Fetcher, now: () => Date = () => new Date()): Promise<SourceResult[]> {
  return Promise.all(
    SOURCES.map((source) => {
      const skipped = unsearched(source, kind, env);
      if (skipped) return skipped;
      if (!approved.includes(source.id)) {
        return { ...base(source, kind), status: 'not_set_up' as const, checked: null, sent_to: null, note: 'Not searched: the approval did not include it. Run the check again to ask the member.' };
      }
      return searchSource(source, name, kind, env, fetcher, now);
    }),
  );
}
