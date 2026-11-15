// SPDX-License-Identifier: Apache-2.0
// eval:mcp and the response profiles (mcp/contract.ts v2, D6): the --profile flag, the replica passing a profile on
// each call, compact scoring that follows search cursors, and the size probe checking every result against its
// profile's budget, here through the real tools on the replica with a fake search. No network, no case content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localRunner, pagedSearchVia, parseMcpEvalArgs, probeBudgets, PROFILE_BUDGETS, replicaRunner, resultItems, type ToolCall } from './mcp-eval.ts';
import { passagesFrom } from './mcp-eval-score.ts';
import { createReplica, loadModule, REPLICA_PROFILES, type ReplicaProfile, type ToolHandler } from './mcp-replica.ts';

const MATTER = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'matter.example.json'), 'utf8');
const IDS = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'doc-ids.json'), 'utf8')) as Record<string, string>;

/** documents rows as the remote SELECT * returns them, for every fixture document. */
const ROWS = Object.entries(IDS).map(([path, id], i) => ({
  id, path, folder: path.slice(0, path.lastIndexOf('/')), name: path.slice(path.lastIndexOf('/') + 1), kind: 'pdf', content_type: 'application/pdf',
  size: 1, pages: 9, r2_key: `${id}-key`, source: 'mirror', updated_at: '2026-10-01T00:00:00Z', control_seq: i + 1,
}));

/** A search answering every query with 20 long passages, one per fixture document. */
const SEARCH = {
  search: async () => ({
    search_query: '',
    chunks: ROWS.slice(0, 20).map((row, i) => ({ id: `c${i}`, type: 'text', score: 0.9, text: `[[doc:${row.id} p:2]]\n${'Placeholder passage text. '.repeat(120)}`, item: { key: `text/${row.id}.p1.md` } })),
  }),
};

test('arguments: --profile picks the scoring profile, for the replica only', () => {
  assert.equal(parseMcpEvalArgs(['--replica', '--profile', 'compact']).profile, 'compact');
  assert.equal(parseMcpEvalArgs(['--replica']).profile, undefined, 'standard unless asked');
  assert.throws(() => parseMcpEvalArgs(['--profile', 'compact']), /--profile is for --replica/);
  assert.throws(() => parseMcpEvalArgs(['--replica', '--profile', 'tiny']), /usage/);
});

test('the compact budget is the contract\'s COMPACT_LIMITS', async () => {
  const { COMPACT_LIMITS } = await loadModule<{ COMPACT_LIMITS: { maxItems: number; maxChars: number } }>('mcp/contract.ts');
  assert.deepEqual(PROFILE_BUDGETS.compact, COMPACT_LIMITS);
  assert.deepEqual([...REPLICA_PROFILES], ['standard', 'compact']);
});

test('replica: each call carries its profile on the context, the replica\'s own unless the call names one', async () => {
  const seen: unknown[] = [];
  const tool: ToolHandler = {
    async handler(_args, ctx) {
      const { profile, clientKind, props } = ctx as { profile: string; clientKind: string; props: { clientId: string } };
      seen.push([profile, clientKind, props.clientId]);
      return { content: [] };
    },
  };
  const replica = await createReplica({ search: SEARCH, rows: [], controlPrefix: 'DOE', tools: { legallas_search: tool }, profile: 'compact' });
  await replica.search('q', 5);
  await replica.callTool('legallas_search', { query: 'q' }, 'standard');
  const plain = await createReplica({ search: SEARCH, rows: [], controlPrefix: 'DOE', tools: { legallas_search: tool } });
  await plain.search('q', 5);
  assert.deepEqual(seen, [['compact', 'microsoft', 'replica-compact'], ['standard', 'claude', 'replica-standard'], ['standard', 'claude', 'replica-standard']]);
});

test('compact scoring follows next_cursor until it has the passages asked for, and stops on an error', async () => {
  const calls: Record<string, unknown>[] = [];
  const pages = [['a', 'b'], ['c', 'd'], ['e']];
  const call: ToolCall = async (_name, args) => {
    calls.push(args);
    const at = args.cursor === undefined ? 0 : Number(args.cursor);
    const results = pages[at]!.map((id) => ({ id, name: `${id}.pdf`, page: 1, text: 'x' }));
    return { result: { content: [], structuredContent: at + 1 < pages.length ? { results, next_cursor: String(at + 1) } : { results } }, error: null };
  };
  const all = await pagedSearchVia(call)('q', 10);
  assert.deepEqual(passagesFrom(all.result).map((p) => p.id), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(calls.map((c) => c.cursor), [undefined, '1', '2']);
  calls.length = 0;
  assert.equal(passagesFrom((await pagedSearchVia(call)('q', 3)).result).length, 4, 'stops once it has enough');
  assert.equal(calls.length, 2);
  calls.length = 0;
  assert.equal(passagesFrom((await localRunner(call).search('q', 10)).result).length, 5, 'local scoring follows cursors too');
  const failing: ToolCall = async () => ({ result: { isError: true, content: [{ type: 'text', text: 'search_budget: x' }] }, error: null });
  assert.equal((await pagedSearchVia(failing)('q', 5)).result!.isError, true);
});

test('compact results with no structured content: paging and item counts read the minified text', async () => {
  const pages = [['a', 'b'], ['c']];
  const call: ToolCall = async (_name, args) => {
    const at = args.cursor === undefined ? 0 : Number(args.cursor);
    const value = { results: pages[at]!.map((id) => ({ id, name: `${id}.pdf`, page: 1, text: 'x' })), ...(at + 1 < pages.length ? { next_cursor: String(at + 1) } : {}) };
    return { result: { content: [{ type: 'text', text: JSON.stringify(value) }] }, error: null };
  };
  assert.deepEqual(passagesFrom((await pagedSearchVia(call)('q', 10)).result).map((p) => p.id), ['a', 'b', 'c']);
  assert.equal(resultItems({ content: [{ type: 'text', text: JSON.stringify({ results: [1, 2], documents: [1, 2, 3], total: 9 }) }] }), 3);
});

test('size probe: every profile, every tool, each result checked against its own profile\'s budget', async () => {
  const sizes: Record<ReplicaProfile, number> = { standard: 20_000, compact: 20_000 };
  const callFor = (profile: ReplicaProfile): ToolCall => async (name) => {
    if (name === 'legallas_case_overview') return { result: { isError: true, content: [{ type: 'text', text: 'overview_unavailable: Secret' }] }, error: null };
    return { result: { content: [{ type: 'text', text: 'x'.repeat(sizes[profile]) }], structuredContent: { results: [{ id: 'd1' }] } }, error: null };
  };
  const { lines, over } = await probeBudgets(callFor, 'Secret question?');
  assert.equal(lines.length, 2 * (9 + 2));
  assert.equal(over, 2, 'compact search and list are over 9,000 characters; standard is within 60,000');
  assert.match(lines.find((l) => l.includes('standard') && l.includes('legallas_search'))!, /20000 chars, 1 items, \d+ bytes {2}ok$/);
  assert.match(lines.find((l) => l.includes('compact') && l.includes('legallas_list_documents'))!, /OVER 9000 chars or 25 items$/);
  assert.match(lines[0]!, /^SIZE {2}standard {2}legallas_case_overview summary\s+code overview_unavailable$/);
  assert.doesNotMatch(lines.join('\n'), /Secret/);
  assert.equal(resultItems({ structuredContent: { results: [1, 2], documents: [1, 2, 3], total: 9 } }), 3);
});

test('size probe on the replica: every tool it checks stays within each profile\'s budget', async () => {
  const replica = await createReplica({ search: SEARCH, rows: ROWS, controlPrefix: 'DOE', matter: MATTER });
  const runner = replicaRunner((profile) => async (name, args) => ({ result: await replica.callTool(name as 'legallas_search', args, profile), error: null }), 'compact');
  const { lines, over } = await runner.probe('Secret question?');
  assert.equal(over, 0, lines.filter((l) => / OVER /.test(l)).join('\n'));
  assert.equal(lines.length, 2 * (9 + 2), 'every overview section, the search and the catalog, under both profiles');
  for (const line of lines) assert.match(line, / ok$/, line);
  const mine = lines.filter((l) => /legallas_search|legallas_list_documents/.test(l));
  assert.equal(mine.length, 4);
  const compactSearch = mine.find((l) => l.includes('compact') && l.includes('legallas_search'))!;
  assert.ok(Number(/(\d+) chars/.exec(compactSearch)![1]) <= 9000);
  const scored = await runner.search('Secret question?', 20);
  assert.equal(passagesFrom(scored.result).length, 20, 'compact scoring pages through all 20 passages');
});

test('the replica shapes results as runTool does: compact once as minified text and a small view, standard unchanged', async () => {
  const replica = await createReplica({ search: SEARCH, rows: ROWS, controlPrefix: 'DOE', matter: MATTER });
  const standard = await replica.callTool('legallas_list_documents', {}, 'standard');
  const compact = await replica.callTool('legallas_list_documents', {}, 'compact');
  assert.ok(standard.structuredContent, 'standard keeps structured content');
  assert.equal((standard.content as { text: string }[])[0]!.text, JSON.stringify(standard.structuredContent), 'and the same JSON as text, minified');
  const text = (compact.content as { type: string; text: string }[]);
  assert.equal(text.length, 1);
  assert.equal(text[0]!.text, JSON.stringify(JSON.parse(text[0]!.text)), 'minified');
  assert.ok(JSON.stringify(compact.structuredContent).length < text[0]!.text.length, 'compact keeps the catalog as a small view');
  const runner = replicaRunner((profile) => async (name, args) => ({ result: await replica.callTool(name as 'legallas_search', args, profile), error: null }), 'compact');
  const { lines } = await runner.probe('Secret question?');
  const list = lines.find((l) => l.includes('compact') && l.includes('legallas_list_documents'))!;
  assert.match(list, /[1-9]\d* items/, 'the probe still counts compact items, read from the text');
});
