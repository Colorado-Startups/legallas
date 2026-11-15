// SPDX-License-Identifier: Apache-2.0
// A public-records check as Ask draws it (worker/agent/protocol.ts ResearchRecords, mcp/tools/public-records.ts
// RecordsView): one card per check, beside the answer, never inside it. Pure, so node tests import it.
//
// Everything here came over the wire and is checked again: unknown shapes are dropped, text stays text (records-card.ts
// sets textContent only), and a link survives only as an https link to one of the sources' own hosts, or as the room's
// own approval page, made relative so it never leaves the room.

/** The hosts a finding or a source link may point to: the sources' own sites (worker/public-records-sources.ts). */
export const RECORD_HOSTS: readonly string[] = [
  'www.sec.gov',
  'efts.sec.gov',
  'adviserinfo.sec.gov',
  'brokercheck.finra.org',
  'data.colorado.gov',
  'www.coloradosos.gov',
  'icis.corp.delaware.gov',
  'www.courtlistener.com',
];

/** A finding on a records card: its title, date and details. */
export interface FindingCard {
  title: string;
  date: string | null;
  details: string[];
  href: string | null;
  checked: string;
}

/** A source on a records card: its name, operator and note. */
export interface SourceCard {
  name: string;
  operator: string;
  note: string;
  checked: string | null;
  href: string | null;
  lookFor: string | null;
  coverage: string;
  findings: FindingCard[];
}

/** A records card: awaiting approval, declined, or checked. */
export type RecordsCard =
  | { kind: 'approval'; title: string; sendsTo: string[]; approveHref: string | null; notice: string }
  | { kind: 'declined'; title: string; message: string; notice: string }
  | { kind: 'checked'; title: string; checked: string; groups: { heading: string; sources: SourceCard[] }[]; notApplicable: string[]; notices: string[] };

type Json = Record<string, unknown>;
const record = (value: unknown): Json | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null);
const text = (value: unknown, max = 2000): string => (typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').slice(0, max) : '');
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** An https link to a source's own host, or null. */
export function recordHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && RECORD_HOSTS.includes(url.hostname) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** The room's approval page for a request, as a path in this room; null for anything else. */
export function approvalHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const id = url.searchParams.get('id');
    return url.protocol === 'https:' && url.pathname === '/checks/' && id && /^[A-Za-z0-9_-]{16,64}$/.test(id) ? `/checks/?id=${id}` : null;
  } catch {
    return null;
  }
}

const KIND: Record<string, string> = { person: 'a person', company: 'a company' };

function title(view: Json): string {
  return `Public records check: "${text(view.name, 120)}" (${KIND[String(view.kind)] ?? 'a name'})`;
}

function sourceCard(raw: unknown): SourceCard | null {
  const s = record(raw);
  if (!s || typeof s.source !== 'string') return null;
  const findings = list(s.findings)
    .map(record)
    .filter((f): f is Json => f !== null && typeof f.title === 'string')
    .map((f) => ({
      title: text(f.title, 300),
      date: typeof f.date === 'string' ? text(f.date, 10) : null,
      details: list(f.details).map((d) => text(d, 300)).filter(Boolean),
      href: recordHref(f.link),
      checked: text(f.checked, 10),
    }));
  return {
    name: text(s.source, 200),
    operator: text(s.operator, 200),
    note: text(s.note),
    checked: typeof s.checked === 'string' ? text(s.checked, 30) : null,
    href: recordHref(s.link),
    lookFor: typeof s.look_for === 'string' ? text(s.look_for) : null,
    coverage: text(s.coverage),
    findings,
  };
}

const GROUPS: [string, readonly string[]][] = [
  ['Searched', ['searched']],
  ['Could not check', ['failed']],
  ['Search these by hand (the name was not sent to them)', ['link_only', 'not_set_up']],
];

/** One card for one check, or null for a shape the page does not know. */
export function recordsCard(raw: unknown): RecordsCard | null {
  const view = record(raw);
  if (!view || typeof view.name !== 'string') return null;
  if (view.status === 'approval_needed') {
    const sendsTo = list(view.would_send_to)
      .map(record)
      .filter((s): s is Json => s !== null)
      .map((s) => `${text(s.source, 200)} (${text(s.host, 100)})`);
    return { kind: 'approval', title: title(view), sendsTo, approveHref: approvalHref(view.approve_at), notice: text(view.notice) };
  }
  if (view.status === 'declined') return { kind: 'declined', title: title(view), message: text(view.message), notice: text(view.notice) };
  if (view.status !== 'checked') return null;
  const sources = list(view.sources).map((s) => ({ raw: record(s), card: sourceCard(s) }));
  const groups = GROUPS.map(([heading, statuses]) => ({
    heading,
    sources: sources.filter((s) => s.card && statuses.includes(String(s.raw?.status))).map((s) => s.card!),
  })).filter((g) => g.sources.length > 0);
  const notApplicable = sources.filter((s) => s.card && s.raw?.status === 'not_applicable').map((s) => `${s.card!.name}: ${s.card!.note}`);
  const notices = [view.records_not_conclusions, view.source_text, view.notice, view.not_a_lawyer].map((n) => text(n)).filter(Boolean);
  return { kind: 'checked', title: title(view), checked: text(view.checked, 30), groups, notApplicable, notices };
}

/** The cards for a turn's checks, unknown shapes dropped. */
export function recordsCards(checks: unknown): RecordsCard[] {
  return list(checks)
    .map(recordsCard)
    .filter((card): card is RecordsCard => card !== null);
}
