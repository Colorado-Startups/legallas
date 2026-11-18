// SPDX-License-Identifier: Apache-2.0
// Test support only (never imported by the Worker): the Doe v. Harbor Labs fixture matter served by legallas_case_overview
// over real SQLite, under a chosen profile and role, a copy grown to the manifest's limits so entries come in parts,
// and helpers that page through a section and join the parts back. Shared by the overview-*.test.ts files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Role } from '../../worker/env.ts';
import { MATTER_KEY } from '../../worker/matter-types.ts';
import type { ResponseProfile, ToolContext } from '../contract.ts';
import { catalogDb, toolCtx } from './doc-fixtures.ts';
import { overviewTool, resetOverviewCache } from './overview.ts';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures');
/** The example matter manifest as JSON text. */
export const MATTER_JSON = readFileSync(join(FIXTURES, 'matter.example.json'), 'utf8');
/** The fixture document ids by name. */
export const DOC_IDS = JSON.parse(readFileSync(join(FIXTURES, 'doc-ids.json'), 'utf8')) as Record<string, string>;
/** The sections that the overview tool can list. */
export const LIST_SECTIONS = ['tracks', 'violations', 'events', 'people', 'orgs', 'claims', 'money', 'docs'] as const;

/** A loose structured value read from a tool result. */
export type Value = Record<string, any>;

/** What an overview test sets up, such as the manifest to serve. */
export interface OverviewSetup {
  /** The manifest as an object; the DOE fixture by default. */
  matter?: unknown;
  /** As the server resolves it: compact runs as a Microsoft client, standard (the default) as Claude. */
  profile?: ResponseProfile;
  role?: Role;
  /** Document ids filed under a privileged folder. */
  privileged?: readonly string[];
  /** Document ids removed from the room. */
  removed?: readonly string[];
}

/** A ToolContext over the fixture catalog (control numbers DOE-000001 up, in doc-ids.json order) and the matter. */
export function overviewCtx(setup: OverviewSetup = {}): ToolContext {
  resetOverviewCache();
  const text = JSON.stringify(setup.matter ?? JSON.parse(MATTER_JSON));
  const seeds = Object.entries(DOC_IDS).map(([path, id], i) => ({
    id,
    path: setup.privileged?.includes(id) ? `07-Lawyer-Notes-PRIVILEGED/${path.split('/').pop()}` : path,
    controlSeq: i + 1,
    removedAt: setup.removed?.includes(id) ? '2026-09-30T00:00:00Z' : null,
  }));
  const { ctx } = toolCtx(catalogDb(seeds).db, undefined, setup.role ?? 'counsel');
  (ctx.env as { FILES: unknown }).FILES = { get: async (key: string) => (key === MATTER_KEY ? { key, etag: 'e1', body: true, text: async () => text } : null) };
  return setup.profile === 'compact' ? { ...ctx, clientKind: 'microsoft', profile: 'compact' } : ctx;
}

/** Runs the overview tool with parsed arguments and returns its output, its value and its text. */
export async function call(ctx: ToolContext, args: Record<string, unknown> = {}) {
  const out = await overviewTool.handler(overviewTool.inputSchema.parse(args), ctx);
  return { out, value: out.structuredContent as Value, text: (out.content[0] as { text: string }).text };
}

/** Every page of a section (the summary included), following nextCursor to the end. */
export async function pages(ctx: ToolContext, section: string): Promise<{ value: Value; text: string; result: CallToolResult }[]> {
  const out: { value: Value; text: string; result: CallToolResult }[] = [];
  let cursor: string | undefined;
  do {
    const { out: result, value, text } = await call(ctx, cursor ? { section, cursor } : { section });
    assert.equal(result.isError, undefined, `${section} page ${out.length + 1}`);
    out.push({ value, text, result });
    cursor = value.nextCursor ?? undefined;
    assert.ok(out.length < 500, 'the cursor always moves on');
  } while (cursor);
  return out;
}

const isObj = (v: unknown): v is Value => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * `addition` merged into `whole`: lists concatenate, nested objects merge, and a list item marked `continues` merges
 * into the item before it in that list. `truncated` carries over; nothing else may repeat.
 */
function mergeInto(whole: Value, addition: Value): void {
  for (const [key, value] of Object.entries(addition)) {
    if (key === 'id' || key === 'continues') continue;
    // A key that names the prototype chain is never data.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (key === 'truncated') {
      whole.truncated = true;
    } else if (Array.isArray(value)) {
      const list: unknown[] = (whole[key] ??= []);
      for (const item of value) {
        if (isObj(item) && item.continues === true) {
          assert.ok(isObj(list.at(-1)), `${key}: a continued item follows the item it continues`);
          if (typeof item.id === 'string') assert.equal((list.at(-1) as Value).id, item.id);
          mergeInto(list.at(-1) as Value, item);
        } else {
          list.push(structuredClone(item));
        }
      }
    } else if (isObj(value)) {
      mergeInto((whole[key] ??= {}), value);
    } else {
      assert.ok(!(key in whole), `${key}: a field comes once, on the first part or fragment`);
      whole[key] = value;
    }
  }
}

/** Entries with their parts joined: a part after the first, and a continued list item, add their lists in order. */
export function joinParts(items: readonly Value[]): Value[] {
  const out: Value[] = [];
  for (const item of items) {
    const { part, parts, ...rest } = item;
    if (typeof part === 'number' && part > 1) {
      assert.equal(out.at(-1)!.id, rest.id, 'a part follows the part before it');
      assert.ok(part <= parts);
      mergeInto(out.at(-1)!, rest);
    } else {
      const whole: Value = {};
      mergeInto(whole, rest);
      out.push({ id: rest.id, ...whole });
    }
  }
  return out;
}

/** A section's entries, every page walked and every part joined. */
export async function entriesOf(ctx: ToolContext, section: string): Promise<Value[]> {
  return joinParts((await pages(ctx, section)).flatMap((p) => p.value.entries));
}

/**
 * The fixture grown to the manifest's limits where counsel's briefs are longest: the complaint track with 60 points
 * of 3 proofs each (the first with 20), 20 exhibits, 12 hurdles and 20 dates, violation C with 40 steps, 120 defined
 * terms, a prior-case claim of 6 elements with 5 proofs each, and a person with 8 dated links. The claim and the
 * person fit one standard entry but not one compact page.
 */
export function bigMatter(): Value {
  const matter = JSON.parse(MATTER_JSON);
  const track = matter.tracks[0];
  const [point] = track.points;
  const cites = matter.tracks[0].brief.exhibits.map((x: Value) => x.cite);
  const cite = (i: number) => cites[i % cites.length];
  const long = (tag: string, i: number, n: number) => `${tag} ${i}: ${'Doe v. Harbor Labs record line. '.repeat(20)}`.slice(0, n);
  track.points = Array.from({ length: 60 }, (_, i) => ({
    ...point, id: `pt-big-${i}`, text: long('Point', i, 200),
    proof: Array.from({ length: i ? 3 : 20 }, (_, k) => ({ cite: cite(i + k), strength: k ? 'corroborating' : 'direct', note: long('Proof', i, 160) })),
  }));
  track.counts = [];
  const brief = track.brief;
  brief.exhibits = Array.from({ length: 20 }, (_, i) => ({ cite: cite(i), proves: long('Exhibit', i, 120) }));
  brief.hurdles = Array.from({ length: 12 }, (_, i) => ({ id: `h-big-${i}`, title: long('Hurdle', i, 80), text: long('Hurdle text', i, 200), cites: [cite(i)] }));
  brief.dates = Array.from({ length: 20 }, (_, i) => ({ date: '2012-05-11', text: long('Date', i, 120), cites: [cite(i)] }));
  const violation = matter.violations[2];
  const [step] = violation.steps;
  violation.steps = Array.from({ length: 40 }, (_, i) => ({ ...step, id: `st-big-${i}`, label: long('Step', i, 80), note: long('Why', i, 120) }));
  const [term] = matter.meta.definedTerms;
  matter.meta.definedTerms = Array.from({ length: 120 }, (_, i) => ({ ...term, term: `Term ${i}`, means: long('Means', i, 400) }));
  const claim = matter.claims[0];
  claim.elements = Array.from({ length: 6 }, (_, i) => ({
    id: `el-big-${i}`, text: long('Element', i, 100), authority: long('Authority', i, 40),
    proof: Array.from({ length: 5 }, (_, k) => ({ cite: cite(i + k), strength: 'direct', note: long('Shows', k, 40) })),
  }));
  const statement = (i: number, k: number) => ({
    held: true, since: '2011', until: null, asOf: '2013-02-26', basis: 'document', share: null, direct: null, note: long('Says', i * 2 + k, 60), cites: [cite(i + k)],
  });
  const targets = matter.orgs.map((o: Value) => o.id).slice(0, 8);
  matter.links.push(...targets.map((to: string, i: number) => ({
    from: 'per-low', to, label: long('Tie', i, 30), cites: [cite(i)], statements: [statement(i, 0), statement(i, 1)],
  })));
  return matter;
}
