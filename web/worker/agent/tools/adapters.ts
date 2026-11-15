// SPDX-License-Identifier: Apache-2.0
// The research agent's tools: the record and law tools counsel's AIs use (web/mcp/tools), imported unedited and run
// under the member's own role, so privilege filters, live-document checks and caps are the MCP's own: the first six
// here, and comments, files, visuals and full briefs in extra.ts. Each call gets a ToolContext with clientKind
// 'unknown', its profile (extra.ts profileFor) and a no-op audit (the question writes one ai_question row instead,
// turn.ts), and its own recording search binding, so parallel calls never mix their answers.
//
// What a call found goes to the evidence book (evidence.ts), rebuilt on the server: search passages by replaying the
// recorded AI Search answers through the room's own retrieve(), pages from the read result with their page markers,
// law through retrieveLaw(), a visual's text (extra.ts). The model reads only compactResult (compact.ts), and a
// result carrying anything but text is refused. Logs carry a tool name and an error name, never a query or text.
import type { CallToolResult } from '@modelcontextprotocol/server';
import { tool, type ToolSet } from 'ai';
import type { McpEnv, ToolContext, ToolDefinition } from '../../../mcp/contract.ts';
import { getDocumentTool, listDocumentsTool } from '../../../mcp/tools/documents.ts';
import { overviewTool } from '../../../mcp/tools/overview.ts';
import { readPagesTool } from '../../../mcp/tools/pages.ts';
import { proposeDraftTool } from '../../../mcp/tools/propose.ts';
import { recordsTool, type RecordsView } from '../../../mcp/tools/public-records.ts';
import { searchLawTool, tracksFor } from '../../../mcp/tools/search-law.ts';
import { searchTool } from '../../../mcp/tools/search.ts';
import { viewVisualTool } from '../../../mcp/tools/visuals.ts';
import { askVisuals } from '../../ask.ts';
import { canPerform } from '../../auth.ts';
import type { Member } from '../../env.ts';
import { lawEnabled, retrieveLaw } from '../../law.ts';
import { proposalsEnabled, type ProposalSetting } from '../../proposals.ts';
import { publicRecordsEnabled, type PublicRecordsVars } from '../../public-records.ts';
import { liveDocuments, RETRIEVAL, retrieve } from '../../retrieval.ts';
import { BudgetExhausted } from '../../spend.ts';
import { MAX_SEARCHES, MAX_TOOL_CALLS } from '../ceiling.ts';
import { Evidence, recordingSearch, replaySearch } from './evidence.ts';
import { collectVisual, EXTRA_DESCRIPTIONS, extraTools, profileFor, textOnly, toolView, unfenced } from './extra.ts';
import type { QueuedImage } from './images.ts';
import { roomNamesOf } from '../../room-names.ts';
import { sentence } from '../../room-settings.ts';
import { STORED_NAME } from '../../stored-name.ts';

export { unfenced } from './extra.ts';

/** The bindings the tools read: the room's own, with the AI Search ones already metered (spend.ts). */
export interface ResearchToolEnv extends PublicRecordsVars, ProposalSetting {
  DB: D1Database;
  INDEX: R2Bucket;
  FILES: R2Bucket;
  SEARCH: Pick<AiSearchInstance, 'search'>;
  CONTROL_PREFIX?: string;
  /** The assistant's name (worker/room-names.ts) for the research step's system prompt; unset, the default. */
  ASSISTANT_NAME?: string;
  ASK_VISUALS?: string;
  LAW_LIBRARY?: string;
  LAW?: R2Bucket;
  LAW_SEARCH?: Pick<AiSearchInstance, 'search'>;
}

/** How the research agent names itself where a tool might show the client (props.clientName). */
export const RESEARCH_CLIENT = { clientId: `${STORED_NAME}-research`, clientName: `${sentence(STORED_NAME)} research` } as const;

/** Everything the tools of one turn share. */
export interface ToolState {
  env: ResearchToolEnv;
  /** Re-read from D1 at the start of the turn (turn.ts): its role is the one every tool runs under. */
  member: Member;
  evidence: Evidence;
  calls: number;
  /** The meter that refused a search this turn, if one did. */
  refused: 'search_semantic' | null;
  /** Visual PNGs waiting for the next tool step's vision input (images.ts stepWithImages). */
  images: QueuedImage[];
  /**
   * What legallas_check_public_records returned this turn (an approval link, a decline, or a check), shown to the member
   * as its own card beside the answer (turn.ts `data-records`), never through the final answer: public records are not
   * the case record, and the member reads them with their sources, links and notices exactly as the tool gave them.
   */
  records: RecordsView[];
  /** Called after every tool call, so the page's counts move. */
  onProgress(): void;
}

const CALL_LIMIT = 'limit: this question has used its tool calls. Reply DONE.';
const SEARCH_LIMIT = 'limit: this question has used its searches. Read pages of the documents found, or reply DONE.';
/** The tool result given when this month's search allowance is used. */
export const SEARCH_BUDGET = "search_budget: this month's search allowance is used. Read pages of documents already found, or reply DONE.";
/** The tool result given when a tool did not answer. */
export const FAILED = 'tool_failed: the tool did not answer. Try another tool, or reply DONE.';
/** Records results kept for the member's card in one turn. */
export const MAX_RECORDS = 3;

/** The ToolContext one call runs with: the member's role, standard results, no per-tool audit. */
export function researchContext(env: ResearchToolEnv, member: Member, now: Date = new Date()): ToolContext {
  return {
    env: env as unknown as McpEnv,
    props: { email: member.email, role: member.role, ...RESEARCH_CLIENT },
    member,
    now,
    clientKind: 'unknown',
    profile: 'standard',
    audit: async () => undefined,
  };
}

type Args = Record<string, unknown>;

/** Search passages: the recorded answers replayed through retrieve(), cut as the tool cut them, kept where it showed them. */
async function collectSearch(state: ToolState, args: Args, value: Args, answers: Parameters<typeof replaySearch>[0]): Promise<void> {
  const shown = new Set(((value.results as Args[] | undefined) ?? []).map((result) => result.id));
  if (shown.size === 0) return;
  const { chunks, citable } = await retrieve(replaySearch(answers), state.env.DB, String(args.query), state.member.role, RETRIEVAL, {
    includeVisuals: askVisuals(state.env),
  });
  const limit = typeof args.limit === 'number' ? args.limit : chunks.length;
  state.evidence.addChunks(chunks.slice(0, limit).filter((chunk) => shown.has(chunk.docId)), citable);
}

/**
 * Pages: each returned page becomes a passage under its own marker. Page text cannot carry a marker of its own (the
 * index breaks up "[[", mcp/pages-text.ts), and the document is checked live and visible to this role again.
 */
async function collectPages(state: ToolState, value: Args): Promise<void> {
  const id = typeof value.id === 'string' ? value.id : null;
  const pages = (value.pages as { page?: unknown; text?: unknown }[] | undefined) ?? [];
  if (!id || pages.length === 0) return;
  const citable = await liveDocuments(state.env.DB, [id], state.member.role, { withoutVisuals: !askVisuals(state.env) });
  const name = citable.get(id)?.name ?? '';
  const chunks = pages
    .filter((entry) => Number.isInteger(entry.page) && typeof entry.text === 'string' && entry.text !== '')
    .map((entry) => ({ docId: id, name, text: `[[doc:${id} p:${entry.page as number}]]\n${unfenced(entry.text as string)}` }));
  state.evidence.addChunks(chunks, citable);
}

/** Law: the recorded answers replayed through retrieveLaw() with the tool's own options, kept where it showed them. */
async function collectLaw(state: ToolState, args: Args, value: Args, answers: Parameters<typeof replaySearch>[0]): Promise<void> {
  const env = state.env;
  const shown = new Set(((value.results as Args[] | undefined) ?? []).map((result) => result.citation));
  if (shown.size === 0 || !env.LAW) return;
  const track = args.track === 'civil' || args.track === 'regulator' ? args.track : 'any';
  const limit = typeof args.limit === 'number' ? args.limit : undefined;
  const { passages, citable } = await retrieveLaw(replaySearch(answers), env.LAW, String(args.query), { limit, tracks: tracksFor(track) });
  state.evidence.addLaw(passages.filter((passage) => shown.has(passage.cite)), citable);
}

/** One tool call: limits, the tool itself under the member's role, the evidence it found, then the model's view. */
async function call(state: ToolState, def: ToolDefinition<any>, input: Args): Promise<string> {
  if (state.calls >= MAX_TOOL_CALLS) return CALL_LIMIT;
  const searching = def.name === searchTool.name || def.name === searchLawTool.name;
  if (searching && state.evidence.searches >= MAX_SEARCHES) return SEARCH_LIMIT;
  state.calls++;
  if (searching) state.evidence.searches++;
  // The model names documents by this turn's aliases (R1, R2): a document id, and each source a draft cites.
  const resolved = typeof input.id === 'string' ? { ...input, id: state.evidence.resolve(input.id) } : input;
  const args = Array.isArray(input.sources)
    ? { ...resolved, sources: (input.sources as Args[]).map((source) => (typeof source.document_id === 'string' ? { ...source, document_id: state.evidence.resolve(source.document_id) } : source)) }
    : resolved;
  const record = recordingSearch(state.env.SEARCH);
  const law = state.env.LAW_SEARCH ? recordingSearch(state.env.LAW_SEARCH) : null;
  const env = { ...state.env, SEARCH: record.binding, ...(law ? { LAW_SEARCH: law.binding } : {}) };
  const base = researchContext(env, state.member);
  // Ask is the member's own room, not a connection, so the records check's propose consent is the member asking here;
  // each check still needs their approval on /checks/ before anything leaves the room. A draft Ask proposes is made
  // as the member, through Ask (via: the assistant's name), and waits for their approval on /proposals/ like any other.
  const props =
    def.name === recordsTool.name
      ? { ...base.props, propose: true as const }
      : def.name === proposeDraftTool.name
        ? { ...base.props, clientName: roomNamesOf(state.env).assistantName, propose: true as const, ask: true as const }
        : base.props;
  const ctx: ToolContext = { ...base, props, profile: profileFor(def.name) };
  let result: CallToolResult;
  try {
    result = await def.handler(args, ctx);
  } catch (error) {
    if (error instanceof BudgetExhausted) {
      state.refused = 'search_semantic';
      return SEARCH_BUDGET;
    }
    console.error('research_tool_failed', def.name, error instanceof Error ? error.name : typeof error);
    return FAILED;
  }
  // Never bytes to the model: the research context is never 'claude', so this only fires if that ever changes.
  if (!textOnly(result)) {
    console.error('research_tool_refused', def.name, 'not_text');
    return FAILED;
  }
  if (!result.isError && result.structuredContent) {
    const value = result.structuredContent as Args;
    if (def.name === recordsTool.name && state.records.length < MAX_RECORDS) state.records.push(value as unknown as RecordsView);
    try {
      if (def.name === searchTool.name) await collectSearch(state, args, value, record.answers);
      else if (def.name === readPagesTool.name) await collectPages(state, value);
      else if (def.name === searchLawTool.name && law) await collectLaw(state, args, value, law.answers);
      else if (def.name === viewVisualTool.name) await collectVisual(state, args, value);
    } catch (error) {
      // The model still gets its result; the answer just cannot cite what was not kept.
      console.error('research_evidence_failed', def.name, error instanceof Error ? error.name : typeof error);
    }
  }
  state.onProgress();
  return toolView(def.name, args, result, state.evidence);
}

/** Short descriptions: every step sends them, so each word costs neurons four times a question. */
const DESCRIPTIONS: Record<string, string> = {
  [searchTool.name]: 'Search the case documents by meaning and keywords. Returns passages with a document alias (R1, R2, ...), control number, title, folder and page.',
  [readPagesTool.name]: 'Read pages of one document, given its alias from another result. Use it on the documents a search found.',
  [listDocumentsTool.name]: 'List the documents in the room, by folder or most recent first.',
  [getDocumentTool.name]: "One document's details (title, folder, pages, control number), given its alias.",
  [searchLawTool.name]: 'Search the law library: public statutes, rules, jury instructions and opinions, separate from the case documents.',
  [proposeDraftTool.name]:
    'Propose a new draft (title, text, why, the documents it relies on) for the member to approve in the room. Only when the member asks for a draft. Nothing changes until they approve it.',
  [recordsTool.name]:
    "Check a person or company in public records (SEC filings, Colorado's business register, federal dockets) before a deal. Only when the member asks. The member approves the name first; the member sees the result as its own card.",
  ...EXTRA_DESCRIPTIONS,
};

/** The tools for one turn, as AI SDK tools. search_law only when the law library is on; extra.ts says when the rest are. */
export function researchTools(state: ToolState): ToolSet {
  const defs: ToolDefinition<any>[] = [searchTool, readPagesTool, overviewTool, listDocumentsTool, getDocumentTool];
  if (lawEnabled(state.env as McpEnv)) defs.push(searchLawTool);
  defs.push(...extraTools(state.env, state.member));
  if (publicRecordsEnabled(state.env)) defs.push(recordsTool);
  // The same propose tool a connected AI calls, while the room's proposals are on; approving stays with the member.
  if (proposalsEnabled(state.env) && canPerform(state.member.role, 'propose')) defs.push(proposeDraftTool);
  return Object.fromEntries(
    defs.map((def) => [def.name, tool({ description: DESCRIPTIONS[def.name] ?? def.description, inputSchema: def.inputSchema, execute: (input: Args) => call(state, def, input) })]),
  ) as ToolSet;
}

/** A fresh state for one turn. */
export function toolState(env: ResearchToolEnv, member: Member, onProgress: () => void = () => undefined): ToolState {
  return { env, member, evidence: new Evidence(), calls: 0, refused: null, images: [], records: [], onProgress };
}
