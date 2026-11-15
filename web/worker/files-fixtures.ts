// SPDX-License-Identifier: Apache-2.0
// Tests only: a fake D1 and R2 for the file routes (files.test.ts) and the visual binder's route
// (visuals-route.test.ts), with the dev identity signed in as the owner or counsel.
import type { Env } from './env.ts';

export const HOST = 'http://localhost:8789';
export const OWNER = 'founder@example.test';

export interface Doc {
  id: string;
  path: string;
  folder: string;
  name: string;
  kind: string;
  content_type: string;
  source: 'mirror' | 'counsel';
  r2_key: string;
}

export const DOCS: Doc[] = [
  { id: 'm1', path: 'Visuals/legallas-visuals.json', folder: 'Visuals', name: 'legallas-visuals.json', kind: 'text', content_type: 'application/json', source: 'mirror', r2_key: 'k-manifest' },
  { id: 'v1', path: 'Visuals/start.html', folder: 'Visuals', name: 'start.html', kind: 'visual', content_type: 'text/html; charset=utf-8', source: 'mirror', r2_key: 'k-start' },
  { id: 'c1', path: 'from-counsel/c1/note.html', folder: 'from-counsel/c1', name: 'note "x".html', kind: 'visual', content_type: 'text/html; charset=utf-8', source: 'counsel', r2_key: 'k-counsel' },
];

export function fakeEnv(objects: Record<string, string>, role: 'owner' | 'counsel' = 'owner') {
  const audits: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind: (...args: unknown[]) => ({
          async first() {
            if (sql.includes('FROM members')) return args[0] === OWNER ? { email: OWNER, role, name: null } : null;
            if (sql.includes('WHERE name = ?1')) return DOCS.find((d) => d.name === args[0] && d.source === 'mirror') ?? null;
            if (sql.includes('WHERE id = ?1')) return DOCS.find((d) => d.id === args[0]) ?? null;
            throw new Error(`unexpected first(): ${sql}`);
          },
          async all() {
            return { results: DOCS.filter((d) => d.kind === 'visual' && d.source === 'mirror' && d.folder === args[0]) };
          },
          async run() {
            audits.push(args);
            return {};
          },
        }),
      };
    },
  };
  const files = {
    async get(key: string) {
      const body = objects[key];
      return body === undefined ? null : { body: new Response(body).body, text: async () => body };
    },
  };
  const env = {
    ASSETS: { fetch: async () => new Response('shell') },
    DB: db,
    FILES: files,
    TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    ALLOW_DEV_IDENTITY: '1',
    DEV_IDENTITY_EMAIL: OWNER,
  } as unknown as Env;
  return { env, audits };
}
