// SPDX-License-Identifier: Apache-2.0
// The real host of scripts/close-out.ts: wrangler for D1 and AI Search, the Cloudflare API with wrangler's own login for
// R2 and KV. The command's steps and their tests use the `CloseOutHost` interface; only the command line builds this one.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withFreshToken, withRateRetry, wranglerTokens, type TokenSource } from './law/replica.ts';
import { accountId, parseD1Json, wrangler } from './wrangler.ts';
import type { CloseOutHost, R2Entry, RoomResources } from './close-out.ts';

const API = 'https://api.cloudflare.com/client/v4';
const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');
const n = (value: unknown) => Number(value ?? 0);

type Call = (method: string, resource: string, body?: unknown, raw?: boolean) => Promise<unknown>;

/** A call on the Cloudflare API for this account. 404 is null; other failures carry the status only. */
function restCaller(account: string, tokens: TokenSource, fetcher: typeof fetch = fetch): Call {
  return async (method, resource, body, raw = false) => {
    const response = await withRateRetry(() =>
      withFreshToken(tokens, (token) =>
        fetcher(`${API}/accounts/${account}/${resource}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        }),
      ),
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`cloudflare_${method.toLowerCase()}_${response.status}`);
    if (raw) return response.text();
    return response.json().catch(() => ({}));
  };
}

/** The room's D1 database and AI Search instance, through wrangler. */
function wranglerHost(room: RoomResources): Pick<CloseOutHost, 'query' | 'execute' | 'searchExists' | 'deleteSearch'> {
  return {
    async query(sql) {
      return parseD1Json(await wrangler(['d1', 'execute', room.database, '--remote', '--json', '--command', sql]));
    },
    async execute(statements) {
      const dir = path.join(tmpdir(), `legallas-close-out-${process.pid}`);
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, 'statements.sql');
      try {
        await writeFile(file, `${statements.join('\n')}\n`);
        await wrangler(['d1', 'execute', room.database, '--remote', '--yes', '--file', file]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    async searchExists(instance) {
      return wrangler(['ai-search', 'get', instance, '--json']).then(
        () => true,
        () => false,
      );
    },
    async deleteSearch(instance) {
      await wrangler(['ai-search', 'delete', instance, '--force']);
    },
  };
}

type ObjectPage = { result?: { key?: unknown; size?: unknown }[]; result_info?: { cursor?: unknown; is_truncated?: unknown } } | null;

/** The R2 buckets: objects, their lock rules, and the buckets themselves. */
function bucketHost(call: Call): Pick<CloseOutHost, 'listObjects' | 'readObject' | 'deleteObject' | 'deleteBucket' | 'lockRules' | 'clearLockRules'> {
  return {
    async listObjects(bucket, prefix = '') {
      const objects: R2Entry[] = [];
      let cursor = '';
      for (;;) {
        const query = `per_page=1000${prefix ? `&prefix=${encodeURIComponent(prefix)}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const body = (await call('GET', `r2/buckets/${bucket}/objects?${query}`)) as ObjectPage;
        if (body === null) return null;
        for (const object of body.result ?? []) if (typeof object.key === 'string') objects.push({ key: object.key, size: n(object.size) });
        if (body.result_info?.is_truncated !== true || typeof body.result_info.cursor !== 'string') return objects;
        cursor = body.result_info.cursor;
      }
    },
    async readObject(bucket, key) {
      return String(await call('GET', `r2/buckets/${bucket}/objects/${encodeKey(key)}`, undefined, true));
    },
    async deleteObject(bucket, key) {
      await call('DELETE', `r2/buckets/${bucket}/objects/${encodeKey(key)}`);
    },
    async deleteBucket(bucket) {
      await call('DELETE', `r2/buckets/${bucket}`);
    },
    async lockRules(bucket) {
      const body = (await call('GET', `r2/buckets/${bucket}/lock`)) as { result?: { rules?: unknown[] } } | null;
      return body?.result?.rules?.length ?? 0;
    },
    async clearLockRules(bucket) {
      await call('PUT', `r2/buckets/${bucket}/lock`, { rules: [] });
    },
  };
}

/** The KV namespace, the scratch and room databases, through the Cloudflare API. */
function storeHost(call: Call): Pick<CloseOutHost, 'listKeys' | 'deleteKeys' | 'deleteNamespace' | 'deleteDatabase'> {
  return {
    async listKeys(namespace) {
      const keys: string[] = [];
      let cursor = '';
      for (;;) {
        const body = (await call('GET', `storage/kv/namespaces/${namespace}/keys?limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)) as { result?: { name?: unknown }[]; result_info?: { cursor?: unknown } } | null;
        if (body === null) return null;
        for (const key of body.result ?? []) if (typeof key.name === 'string') keys.push(key.name);
        if (typeof body.result_info?.cursor !== 'string' || body.result_info.cursor === '') return keys;
        cursor = body.result_info.cursor;
      }
    },
    async deleteKeys(namespace, keys) {
      await call('POST', `storage/kv/namespaces/${namespace}/bulk/delete`, keys);
    },
    async deleteNamespace(namespace) {
      await call('DELETE', `storage/kv/namespaces/${namespace}`);
    },
    async deleteDatabase(id) {
      await call('DELETE', `d1/database/${id}`);
    },
  };
}

export async function cliHost(room: RoomResources): Promise<CloseOutHost> {
  const call = restCaller(await accountId(), wranglerTokens());
  return { ...wranglerHost(room), ...bucketHost(call), ...storeHost(call) };
}
