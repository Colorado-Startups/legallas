// SPDX-License-Identifier: Apache-2.0
// legallas_case_overview: the published matter as a member sees it (owner: session B1; full briefs and response
// profiles, session 2a). The manifest is read from legallas-files like worker/routes/matter.ts (parsed once per isolate
// per R2 etag) and filtered through worker/matter-serve.ts serveMatter against the documents the member may see in the
// room right now (hidden room data files, and privileged folders for a role without viewPrivileged, left out); its docs
// section never lists a folder guide (worker/agent-files.ts), like legallas_list_documents. Long
// sections come back in pages with an opaque cursor, sized to the client's profile (overview-page.ts); tracks come with
// their whole brief (overview-brief.ts) and the summary with the case header (overview-summary.ts). Text that addresses
// an AI is fenced as untrusted, the entry or cite holding it loses its cites, and the page carries Ask's reminder first
// (mcp/untrusted.ts), with room left for it. While the room's checklist is on, a checklist section lists the company
// checklist's items, published matter or not (overview-checklist.ts).
import { z } from 'zod';
import { isAgentFile } from '../../worker/agent-files.ts';
import { canPerform } from '../../worker/auth.ts';
import { NOT_HIDDEN_SQL } from '../../worker/files-catalog.ts';
import { MatterError } from '../../worker/matter-fields.ts';
import { parseMatter } from '../../worker/matter.ts';
import { serveMatter, type LiveDocs } from '../../worker/matter-serve.ts';
import { MATTER_KEY, type Matter, type ServedMatter } from '../../worker/matter-types.ts';
import { privilegeFilter } from '../../worker/privilege.ts';
import { checklistEnabled } from '../../worker/checklist.ts';
import type { McpEnv, ToolContext, ToolDefinition } from '../contract.ts';
import { caseField, docLink, formatControl, jsonResult, retrievedOn, toolError } from '../format.ts';
import { trackEntry, trackLookup } from './overview-brief.ts';
import { checklistEntries } from './overview-checklist.ts';
import { decodePosition, encodePosition, FITS, fitPage, withNoteRoom, type Fit, type Position } from './overview-page.ts';
import { compactView, OVERVIEW_OUTPUT } from './output.ts';
import { viewMeta } from '../apps/views.ts';
import { summaryPage } from './overview-summary.ts';
import { citeRenderer, proofEntry, prose, type Render } from './overview-text.ts';

export {
  decodeCursor, encodeCursor, MAX_ENTRY_CHARS, PAGE_BUDGET_CHARS, PAGE_ENTRIES, pageOf, shrinkEntry,
} from './overview-page.ts';
import { withToolPrefix } from '../tool-prefix.ts';
import { markUntrusted, noted, untrustedIn } from '../untrusted.ts';
import { priorStatus } from '../../worker/room-settings.ts';
export { MAX_DEFINED_TERMS } from './overview-summary.ts';
export { MAX_TEXT_CHARS } from './overview-text.ts';

/** Tracks and violations lead: they are what counsel is preparing now. Claims are the operative pleading's counts. */
const CASE_SECTIONS = ['summary', 'tracks', 'violations', 'events', 'people', 'orgs', 'claims', 'money', 'docs'] as const;
/** With the company checklist, last: listed only while the room's checklist is on (inputSchemaFor). */
const SECTIONS = [...CASE_SECTIONS, 'checklist'] as const;
type ListSection = Exclude<(typeof CASE_SECTIONS)[number], 'summary'>;
const LIST_SECTIONS: readonly ListSection[] = ['tracks', 'violations', 'events', 'people', 'orgs', 'claims', 'money', 'docs'];
/**
 * Sections whose entries standard splits into parts when too long for a page; others keep the cut they always had
 * (overview.test.ts pins it). Compact splits every section, since its pages are small enough to cut real entries.
 */
const WHOLE: ReadonlySet<string> = new Set(['tracks', 'violations']);

const SECTION_HELP = 'Which part of the case picture to return. "summary" gives counts and the case header.';
const CURSOR_HELP = 'From a previous call, to fetch the next page of a long section.';

/** Every section, the checklist's included: what the handler takes. */
const inputSchema = z.object({
  section: z.enum(SECTIONS).default('summary').describe(`${SECTION_HELP} "checklist" gives the company checklist: each item's status, due dates and matched documents.`),
  cursor: z.string().max(64).optional().describe(CURSOR_HELP),
});

/** What a room with its checklist off lists: the case picture's sections, word for word as before the checklist. */
const caseSchema = z.object({
  section: z.enum(CASE_SECTIONS).default('summary').describe(SECTION_HELP),
  cursor: z.string().max(64).optional().describe(CURSOR_HELP),
});

const NOT_PUBLISHED = 'The case overview is not published yet. Use legallas_search or legallas_list_documents to work from the documents.';

let cached: { etag: string; matter: Matter } | null = null;

/** Test support: forget the per-isolate cache. */
export function resetOverviewCache(): void {
  cached = null;
}

/** The parsed manifest, or null when none is published. Throws MatterError or SyntaxError on a bad file. */
async function loadMatter(files: R2Bucket, now: Date): Promise<Matter | null> {
  const held = cached;
  const object = await files.get(MATTER_KEY, held ? { onlyIf: { etagDoesNotMatch: held.etag } } : undefined);
  if (!object) {
    cached = null;
    return null;
  }
  // A failed precondition returns the object without a body: the cached parse is still current.
  if (held && !('body' in object)) return held.matter;
  const matter = parseMatter(JSON.parse(await (object as R2ObjectBody).text()), { now });
  cached = { etag: object.etag, matter };
  return matter;
}

interface Live {
  controls: LiveDocs;
  names: ReadonlyMap<string, string>;
  /** Folder guides among them, by lowercase id: still live for cites, never listed as documents. */
  guides: ReadonlySet<string>;
}

/** Live, non-hidden documents `role` may see, with control numbers and names, in one query with no IN list (D1 binds at most 100). */
async function liveDocs(db: D1Database, role: ToolContext['member']['role']): Promise<Live> {
  const { results } = await db
    .prepare(`SELECT id, path, name, control_seq FROM documents WHERE removed_at IS NULL AND ${NOT_HIDDEN_SQL}${privilegeFilter(role)}`)
    .all<{ id: string; path: string; name: string; control_seq: number | null }>();
  return {
    controls: new Map(results.map((row) => [row.id.toLowerCase(), row.control_seq ?? null])),
    names: new Map(results.map((row) => [row.id.toLowerCase(), row.name])),
    guides: new Set(results.filter((row) => isAgentFile(row.path)).map((row) => row.id.toLowerCase())),
  };
}

/**
 * The served manifest without folder guides in its docs (a guide in a privileged folder gets an entry from the
 * matter build), so the docs section and its count list only case documents.
 */
function withoutGuides(served: ServedMatter, guides: ReadonlySet<string>): ServedMatter {
  if (guides.size === 0) return served;
  return { ...served, docs: Object.fromEntries(Object.entries(served.docs).filter(([id]) => !guides.has(id.toLowerCase()))) };
}

function dollars(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** A link's dated statements, one per source, for an assistant to weigh against each other. */
function statementsOf(link: ServedMatter['links'][number], cite: Render) {
  return (link.statements ?? []).map((st) => ({
    held: st.held, since: st.since, until: st.until, asOf: st.asOf, basis: st.basis, share: st.share, direct: st.direct,
    note: prose(st.note), cites: st.cites.map(cite),
  }));
}

/** Relationship edges leaving a party, folded into its entry so every link is reachable from people or orgs. */
function linksFrom(served: ServedMatter, id: string, cite: Render) {
  return served.links.filter((l) => l.from === id).map((l) => {
    const statements = statementsOf(l, cite);
    return { to: l.to, label: prose(l.label), cites: l.cites.map(cite), ...(statements.length ? { statements } : {}) };
  });
}

function claimEntry(claim: ServedMatter['claims'][number], cite: Render) {
  return {
    id: claim.id,
    count: claim.count,
    type: claim.type,
    label: prose(claim.label),
    against: claim.against,
    elements: claim.elements.map((el) => ({
      id: el.id,
      text: prose(el.text),
      authority: prose(el.authority),
      proof: el.proof.map((p) => proofEntry(p, cite)),
    })),
    cites: claim.cites.map(cite),
  };
}

function figureValue(value: number | null, unit: 'usd' | 'count'): string | number | null {
  return value === null ? null : unit === 'usd' ? dollars(value) : value;
}

function violationEntry(v: ServedMatter['violations'][number], cite: Render) {
  return {
    id: v.id,
    mark: v.mark,
    title: prose(v.title),
    summary: prose(v.summary),
    period: v.period,
    actors: v.actors,
    entities: v.entities,
    events: v.events,
    money: v.money,
    steps: v.steps.map((s) => ({
      id: s.id, date: s.date, label: prose(s.label), entities: s.entities,
      moves: s.moves.map((m) => ({ from: m.from, to: m.to, label: prose(m.label) })), cites: s.cites.map(cite),
      ...(s.note ? { note: prose(s.note) } : {}),
    })),
    figures: v.figures.map((x) => ({
      id: x.id, label: prose(x.label), value: figureValue(x.value, x.unit), unit: x.unit, limit: figureValue(x.limit, x.unit),
      note: prose(x.note), cites: x.cites.map(cite), ...(x.group ? { group: prose(x.group) } : {}),
    })),
    cites: v.cites.map(cite),
    ...(v.contrast ? {
      contrast: v.contrast.map((side) => ({
        heading: prose(side.heading), date: side.date, speaker: side.speaker, quote: prose(side.quote), cites: side.cites.map(cite),
      })),
    } : {}),
  };
}

/** Every entry of a section, in manifest order (documents by control number). */
function sectionEntries(section: ListSection, served: ServedMatter, live: Live, prefix: string | undefined): unknown[] {
  const cite = citeRenderer(prefix);
  switch (section) {
    case 'tracks': {
      const look = trackLookup(served, live.names, prefix);
      return served.tracks.map((t) => trackEntry(t, look));
    }
    case 'violations':
      return served.violations.map((v) => violationEntry(v, cite));
    case 'events':
      return served.events.map((e) => ({
        id: e.id, date: e.date, type: e.type, title: prose(e.title), summary: prose(e.summary), actors: e.actors, claims: e.claims, cites: e.cites.map(cite),
      }));
    case 'people':
      return served.people.map((p) => ({
        id: p.id, name: p.name, role: p.role, side: p.side, title: prose(p.title), orgs: p.orgs, links: linksFrom(served, p.id, cite), cites: p.cites.map(cite),
      }));
    case 'orgs':
      return served.orgs.map((o) => ({
        id: o.id, name: o.name, kind: o.kind, side: o.side, parent: o.parent, formed: o.formed, links: linksFrom(served, o.id, cite), cites: o.cites.map(cite),
      }));
    case 'claims':
      return served.claims.map((c) => claimEntry(c, cite));
    case 'money':
      return served.money.map((m) => ({
        id: m.id, date: m.date, amount: dollars(m.amountCents), amountCents: m.amountCents, kind: m.kind ?? null, from: m.from, to: m.to, label: prose(m.label), cites: m.cites.map(cite),
      }));
    case 'docs':
      return Object.entries(served.docs)
        .sort(([a, x], [b, y]) => (x.control ?? Number.MAX_SAFE_INTEGER) - (y.control ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b))
        .map(([id, d]) => ({
          id, control: formatControl(prefix, d.control), title: caseField(live.names.get(id) ?? null), date: d.date, type: prose(d.type), from: d.from, to: d.to,
          summary: prose(d.summary), privileged: d.privileged, link: docLink(id),
        }));
  }
}

function sectionCounts(served: ServedMatter): Record<string, number> {
  return Object.fromEntries(LIST_SECTIONS.map((s) => [s, s === 'docs' ? Object.keys(served.docs).length : served[s].length]));
}

/**
 * One page of a list section from `start`, marked before paging and paged with room for the note the section's marks
 * bring, so cursors stay stable.
 */
function sectionPage(section: string, all: readonly unknown[], start: Position, fit: Fit, retrieved: string): Record<string, unknown> {
  const entries = markUntrusted(all);
  const { items, next } = fitPage(entries, start, withNoteRoom(fit, untrustedIn(entries)), WHOLE.has(section) || fit.profile === 'compact');
  return noted({
    retrieved,
    section,
    total: entries.length,
    offset: start.offset,
    entries: items,
    nextCursor: next === null ? null : encodePosition(section, next, fit.profile),
  });
}

/** The served manifest with the live documents it was served against; null before a publish, 'bad' for a bad file. */
async function readServed(ctx: ToolContext): Promise<{ served: ServedMatter; live: Live } | null | 'bad'> {
  try {
    const matter = await loadMatter(ctx.env.FILES, ctx.now);
    if (!matter) return null;
    const live = await liveDocs(ctx.env.DB, ctx.member.role);
    return { served: withoutGuides(serveMatter(matter, live.controls), live.guides), live };
  } catch (error) {
    if (!(error instanceof MatterError || error instanceof SyntaxError)) throw error;
    // The error code only: a MatterError message names a field and may quote a value.
    console.error('mcp_bad_matter', error.name);
    return 'bad';
  }
}

/** The legallas_case_overview tool, which gives a case overview. */
export const overviewTool: ToolDefinition<typeof inputSchema> = {
  name: 'legallas_case_overview',
  title: 'Case overview',
  description:
    'The case picture the room publishes: the tracks counsel is preparing and the violations they rest on, with ' +
    'points to prove and their proof, grouped per violation, and for a track with a brief its theory, cast, hurdles, ' +
    'dates to confirm, key exhibits, drafts and counts; then parties, people, chronology of events, the claims of the pleading (when ' +
    `the summary has a priorCase, that pleading ${priorStatus} and its claims are history), and money facts, each with ` +
    'citations to documents and pages (control number, page and room link). Start with section "summary", ' +
    'then page through a section with its cursor. An entry too long for one page comes in parts sharing its id ' +
    '(part, parts): join their lists in order, and merge a list item marked continues into the item before it.',
  inputSchema,
  inputSchemaFor: (env: McpEnv) => (checklistEnabled(env) ? inputSchema : caseSchema),
  outputSchema: OVERVIEW_OUTPUT,
  // The board, the timeline and the summary tiles an AI draws from this result (mcp/apps/view/overview.ts).
  _meta: viewMeta('overview'),
  async handler({ section, cursor }, ctx) {
    if (!canPerform(ctx.member.role, 'view')) return toolError('forbidden', 'This member cannot read the case overview.');
    // Unknown clients are compact (D6), so anything but standard is sized compact.
    const fit = ctx.profile === 'standard' ? FITS.standard : FITS.compact;
    let start: Position = { offset: 0, part: 0 };
    if (cursor !== undefined) {
      const decoded = decodePosition(cursor, section, fit.profile);
      if (decoded === null) return toolError('bad_cursor', `Use the nextCursor from a previous ${section} result, or omit cursor to start over.`);
      start = decoded;
    }
    if (section === 'checklist' && !checklistEnabled(ctx.env)) return toolError('unavailable', 'The company checklist is off in this room.');
    await ctx.audit('ai_read', null);
    const retrieved = retrievedOn(ctx.now);
    // A compact caller keeps a small structured copy too, for the views that read the overview (output.ts compactView).
    const done = (value: Record<string, unknown>) => jsonResult(value, ctx.profile === 'compact' ? compactView(value) : undefined);
    // The company checklist stands apart from the published matter: it reads with none published, and the summary counts it.
    const checklist = section === 'checklist' || section === 'summary' ? await checklistEntries(ctx) : null;
    if (section === 'checklist') return done(sectionPage(section, checklist ?? [], start, fit, retrieved));
    const listed: Record<string, number> = checklist ? { checklist: checklist.length } : {};
    const read = await readServed(ctx);
    if (read === 'bad') return toolError('overview_unavailable', 'The case overview could not be read. Ask the room owner to publish it again.');
    if (!read) {
      return done({ retrieved, section, published: false, message: withToolPrefix(NOT_PUBLISHED, ctx.toolPrefix), ...(checklist ? { counts: listed } : {}) });
    }
    const { served, live } = read;
    const prefix = ctx.env.CONTROL_PREFIX;
    if (section === 'summary') {
      const cursorAt = (offset: number) => encodePosition(section, { offset, part: 0 }, fit.profile);
      return done(summaryPage(served, prefix, { ...sectionCounts(served), ...listed }, start.offset, fit, cursorAt, retrieved));
    }
    return done(sectionPage(section, sectionEntries(section, served, live, prefix), start, fit, retrieved));
  },
};
