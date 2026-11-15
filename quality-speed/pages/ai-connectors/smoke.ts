// SPDX-License-Identifier: Apache-2.0
// The MCP smoke's table (web/scripts/mcp-smoke.ts), read per AI: which of the four connect end to end, by stage. Pure, so the
// tests need no install. A row's name says whose it is: `claude_`, `teams_` and `apim_` (Copilot), `harvey_`, `opencode_`
// (open-weight), the same after `register_`, or none (shared: every AI needs it).
import { AIS, type Ai } from './guides.ts';

export type Outcome = 'pass' | 'fail' | 'skip';
export interface Row {
  name: string;
  outcome: Outcome;
  detail: string;
}

/** The columns of the page's grid, in order. */
export const STAGES = ['discover', 'register', 'sign_in', 'tools', 'revoke'] as const;
export type Stage = (typeof STAGES)[number];

const KIND_OF: Readonly<Record<string, Ai>> = { claude: 'claude', teams: 'copilot', apim: 'copilot', harvey: 'harvey', opencode: 'open_weight' };
/** Copilot's limits: about 9,000 characters a result in its compact profile, and at most 10 tools an agent (web/mcp/contract.ts). */
export const COPILOT_MAX_CHARS = 9_000;
export const COPILOT_MAX_TOOLS = 10;

/** The rows of a smoke run, and whether it reached its closing count line (a crash never does). */
export function parseSmoke(stdout: string): { rows: Row[]; complete: boolean } {
  const rows: Row[] = [];
  for (const line of stdout.split('\n')) {
    const match = /^(PASS|FAIL|SKIP)\s+(\S+)\s*(.*)$/.exec(line);
    if (match) rows.push({ name: match[2]!, outcome: match[1]!.toLowerCase() as Outcome, detail: match[3]! });
  }
  return { rows, complete: /^\d+ pass, \d+ fail, \d+ skip\.$/m.test(stdout) };
}

/** Whose row this is: an AI, `shared`, or `copilot_package` (Copilot only). */
export function ownerOf(name: string): Ai | 'shared' {
  if (name === 'copilot_package_zip') return 'copilot';
  const kind = /^(?:register_)?([a-z]+)(?:_|$)/.exec(name)?.[1];
  return kind && KIND_OF[kind] ? KIND_OF[kind] : 'shared';
}

/** The stage a row proves. */
export function stageOf(name: string): Stage {
  const bare = name.replace(/^(?:claude|teams|apim|harvey|opencode)_/, '');
  if (/^(challenge|protected_resource|authorization_server|client_id_metadata|mcp_discover|connect_page)/.test(bare)) return 'discover';
  if (/^register/.test(bare) || /^copilot_package/.test(bare)) return 'register';
  if (/^(authorize|approve|consent|token|refresh|wrong_resource|no_resource)/.test(bare)) return 'sign_in';
  if (/^(revoke|revoked)/.test(bare)) return 'revoke';
  return 'tools';
}

/** A Copilot row over its limits, read from the smoke's own detail ("text 156 chars", "7 tools"). */
function overCopilotLimits(row: Row): boolean {
  const chars = /text (\d+) chars/.exec(row.detail);
  const tools = /(\d+) tools/.exec(row.detail);
  return (chars !== null && Number(chars[1]) > COPILOT_MAX_CHARS) || (/tools_list$/.test(row.name) && tools !== null && Number(tools[1]) > COPILOT_MAX_TOOLS);
}

export interface Contract {
  /** Per AI, per stage (discovery from the shared rows, the rest from its own): 1 all passed, 0 one failed, null nothing proved it. */
  grid: Record<Ai, Record<Stage, 0 | 1 | null>>;
  /** Per AI: connects end to end. */
  connects: Record<Ai, boolean>;
  pass: number;
  fail: number;
  skip: number;
}

/**
 * An AI connects when the smoke ran to its end, no shared row failed, and every stage has rows that passed: discovery from the
 * shared rows, registration, sign-in, tools and revocation from the AI's own. A skip is the smoke's own "doesn't apply here" (no multi-part document in an empty room) and neither passes
 * nor fails.
 */
export function contract(stdout: string): Contract | null {
  const { rows, complete } = parseSmoke(stdout);
  if (!complete || rows.length === 0) return null;
  const failed = (row: Row) => row.outcome === 'fail' || (ownerOf(row.name) === 'copilot' && overCopilotLimits(row));
  const shared = rows.filter((row) => ownerOf(row.name) === 'shared');
  const sharedOk = !shared.some(failed);
  const grid = {} as Contract['grid'];
  const connects = {} as Contract['connects'];
  for (const ai of AIS) {
    const own = rows.filter((row) => ownerOf(row.name) === ai);
    grid[ai] = Object.fromEntries(STAGES.map((stage) => {
      // Discovery is the same for every app; every other stage needs the AI's own rows.
      const mine = [...own, ...(stage === 'discover' ? shared : [])].filter((row) => stageOf(row.name) === stage && row.outcome !== 'skip');
      return [stage, own.length === 0 || mine.length === 0 ? null : mine.some(failed) ? 0 : 1];
    })) as Record<Stage, 0 | 1 | null>;
    connects[ai] = sharedOk && !own.some(failed) && STAGES.every((stage) => grid[ai][stage] === 1);
  }
  const count = (o: Outcome) => rows.filter((row) => row.outcome === o).length;
  return { grid, connects, pass: count('pass'), fail: count('fail'), skip: count('skip') };
}
