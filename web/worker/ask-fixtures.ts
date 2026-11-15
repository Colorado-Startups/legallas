// SPDX-License-Identifier: Apache-2.0
// Test fixtures for Ask Legallas (imported only by *.test.ts): the room's real SQLite database and fake AI wire
// formats (room-fixtures.ts) behind an Env whose AI and AI Search are fakes that record their calls and never touch
// the network, and the same-origin POST the room's page sends.
import type { DatabaseSync } from 'node:sqlite';
import type { Env } from './env.ts';
import { d1, modelSse, OWNER, schemaDb, seed, type FakeChunk } from './room-fixtures.ts';

export const HOST = 'http://localhost:8789';
/** Ask's model in the harness: the example's default (wrangler.example.jsonc LEGALLAS_MODEL). */
export const ASK_MODEL = '@cf/openai/gpt-oss-120b';

export interface Harness {
  env: Env;
  db: DatabaseSync;
  searches: unknown[];
  runs: { model: string; input: { messages: { role: string; content: string }[]; [k: string]: unknown }; options?: unknown }[];
}

export interface HarnessOptions {
  chunks?: FakeChunk[];
  answer?: string | ((prompt: string) => string);
  cap?: string;
  members?: Record<string, string>;
  email?: string;
  searchFails?: boolean;
  extraVars?: Partial<Env>;
  /** The published manifest's text, for the case picture (ask-brief.ts); none is published by default. */
  matter?: string;
  /** The model's finish_reason at the end of every stream ("length" for an answer cut at max_tokens); none by default. */
  stop?: string;
  /** An error for env.AI.run to throw on this call (0-based, every model counted), or null to answer; none by default. */
  refuse?: (model: string, call: number) => Error | null;
}

export function harness(opts: HarnessOptions = {}): Harness {
  const db = schemaDb();
  seed(db, opts.members);
  const searches: unknown[] = [];
  const runs: Harness['runs'] = [];
  const search = {
    async search(params: unknown) {
      searches.push(params);
      if (opts.searchFails) throw new Error('search down');
      return { search_query: '', chunks: (opts.chunks ?? []).map((c, i) => ({ id: `c${i}`, type: 'text', score: 0.9, text: c.text, item: { key: c.key } })) };
    },
  };
  const ai = {
    async run(model: string, input: Harness['runs'][number]['input'], options?: unknown) {
      runs.push({ model, input, options });
      const refusal = opts.refuse?.(model, runs.length - 1) ?? null;
      if (refusal) throw refusal;
      const prompt = input.messages.map((m) => m.content).join('\n');
      const answer = typeof opts.answer === 'function' ? opts.answer(prompt) : (opts.answer ?? 'An answer.');
      return modelSse(answer, undefined, opts.stop);
    },
  };
  const env = {
    ASSETS: { fetch: async () => new Response('APP') },
    DB: d1(db),
    // legallas-files serving only the manifest; a fresh body on every get, so the matter cache always re-reads.
    FILES: {
      async get(key: string) {
        if (key !== 'meta/matter.json' || opts.matter === undefined) return null;
        const text = opts.matter;
        return { key, etag: 'm1', body: true, text: async () => text };
      },
      // What room-shape.ts asks a room with COMPANY_ROOM_ENABLED "1": is a matter published?
      async head(key: string) {
        return key === 'meta/matter.json' && opts.matter !== undefined ? { key, etag: 'm1' } : null;
      },
    },
    SEARCH: search,
    AI: ai,
    TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    LEGALLAS_MODEL: ASK_MODEL,
    DAILY_QUESTION_CAP: opts.cap ?? '100',
    ALLOW_DEV_IDENTITY: '1',
    DEV_IDENTITY_EMAIL: opts.email ?? OWNER,
    // The fakes stand in for the remote bindings on localhost, so the harness opts in (worker/spend.ts withSpendGuards).
    LEGALLAS_DEV_REMOTE_AI: '1',
    ...opts.extraVars,
  } as unknown as Env;
  return { env, db, searches, runs };
}

/** A same-origin POST to /api/ask, as the room's own page sends it. */
export function askRequest(body: unknown, host = HOST, path = '/api/ask'): Request {
  return new Request(`${host}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: host, 'Sec-Fetch-Site': 'same-origin' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
