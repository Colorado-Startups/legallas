// SPDX-License-Identifier: Apache-2.0
// A local R2 that stays up for the whole run. Each `wrangler r2 object put --local` starts Node, wrangler and an emulator, about a
// second, and the emulator answers concurrent calls with 500s, so a sync of hundreds of objects takes minutes. Here one emulator,
// through wrangler's getPlatformProxy, serves every call, on the same files `wrangler dev` reads. D1 and everything else stay on the CLI.
import { readFile, writeFile } from 'node:fs/promises';
import { assertKey, assertReadKey, cliWrangler, FILES_BUCKET, INDEX_BUCKET, type Wrangler } from './wrangler.ts';

/** The calls this file makes on an R2 binding. */
export interface LocalBucket {
  put(key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
}

/** `cli` with these buckets' calls answered by their bindings. Any other bucket stays on the CLI. */
export function withLocalBuckets(cli: Wrangler, buckets: Readonly<Record<string, LocalBucket>>, close: () => Promise<void>): Wrangler {
  return {
    ...cli,
    async r2Put(bucket, key, file, contentType) {
      const local = buckets[bucket];
      if (!local) return cli.r2Put(bucket, key, file, contentType);
      await local.put(assertKey(key), await readFile(file), { httpMetadata: { contentType } });
    },
    async r2Get(bucket, key, file) {
      const local = buckets[bucket];
      if (!local) return cli.r2Get(bucket, key, file);
      const object = await local.get(assertReadKey(key));
      // As the CLI words it, because callers tell a missing object from a broken run by these words (fts-index.ts MISSING_OBJECT).
      if (!object) throw new Error('The specified key does not exist.');
      await writeFile(file, Buffer.from(await object.arrayBuffer()));
    },
    async r2Delete(bucket, key) {
      const local = buckets[bucket];
      if (!local) return cli.r2Delete(bucket, key);
      await local.delete(assertKey(key));
    },
    close,
  };
}

/** The local wrangler a long run should use. Its `close` must run, because the emulator keeps the process alive until then. */
export async function localWrangler(): Promise<Wrangler> {
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy<{ FILES: LocalBucket; INDEX: LocalBucket }>({ remoteBindings: false });
  return withLocalBuckets(cliWrangler('local'), { [FILES_BUCKET]: proxy.env.FILES, [INDEX_BUCKET]: proxy.env.INDEX }, proxy.dispose);
}

/** The local legallas-law bucket (wrangler.jsonc's LAW), on the files `wrangler dev` reads. Its `close` must run. */
export async function localLawBucket(): Promise<{ bucket: LocalBucket; close: () => Promise<void> }> {
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy<{ LAW?: LocalBucket }>({ remoteBindings: false });
  if (!proxy.env.LAW) {
    await proxy.dispose();
    throw new Error('wrangler.jsonc binds no LAW bucket: start it from wrangler.example.jsonc (node scripts/dev-room.ts)');
  }
  return { bucket: proxy.env.LAW, close: proxy.dispose };
}
