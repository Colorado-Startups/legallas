// SPDX-License-Identifier: Apache-2.0
// Test support only (never imported by the Worker): the response profile on a ToolContext, a fake legallas-files
// bucket serving the fictional Doe v. Harbor Labs manifest, and result sizes as a compact budget counts them. Shared by the
// document, search, page and law tool tests (session 2b).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { MATTER_KEY } from '../../worker/matter-types.ts';
import type { ResponseProfile, ToolContext } from '../contract.ts';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures');
/** The fictional manifest (fixtures/matter.example.json) and its document ids by path. */
export const MATTER = readFileSync(join(FIXTURES, 'matter.example.json'), 'utf8');
/** The fixture document ids by name. */
export const DOC_IDS = JSON.parse(readFileSync(join(FIXTURES, 'doc-ids.json'), 'utf8')) as Record<string, string>;

/** `ctx` with another response profile than the one its fixture gave it. */
export function withProfile<T extends ToolContext>(ctx: T, profile: ResponseProfile): T {
  return Object.assign(ctx, { profile });
}

/** A legallas-files bucket holding `matter` at meta/matter.json (none when null), honouring etag conditional gets. */
export function matterFiles(matter: string | null, etag = 'e1') {
  const state = { downloads: 0 };
  const bucket = {
    async get(key: string, options?: R2GetOptions) {
      if (key !== MATTER_KEY || matter === null) return null;
      if ((options?.onlyIf as R2Conditional | undefined)?.etagDoesNotMatch === etag) return { key, etag };
      state.downloads += 1;
      return { key, etag, body: true, text: async () => matter };
    },
  };
  return { state, bucket: bucket as unknown as R2Bucket };
}

/** Characters of a result's text content: what the compact budget (9,000) counts. */
export function textChars(result: CallToolResult): number {
  return result.content.reduce((n, item) => n + (item.type === 'text' ? item.text.length : 0), 0);
}
