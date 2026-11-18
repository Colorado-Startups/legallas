// SPDX-License-Identifier: Apache-2.0
// The room backup's R2 half (layout.ts): copy each room bucket into the backup bucket a page at a time, restore a run's
// copies into another bucket, and the checks that keep both away from anything they should not touch. Every byte moves
// between buckets inside the room owner's Cloudflare account, through the Worker's bindings.
import { BackupError, blobKey, type BackupCode, linesText, manifestKey, mapLimit, PAGE, parseManifest, SHA_META, sha256Hex, hex, type ManifestLine, type Source } from './layout.ts';

/** SHA-256 of a body, read once. The Worker passes digestBody; tests pass node:crypto. */
export type HashBody = (body: ReadableStream<Uint8Array>) => Promise<string>;

/** Hashes in the Workers runtime's native DigestStream: no copy of the body in JavaScript. */
export const digestBody: HashBody = async (body) => {
  const digest = new crypto.DigestStream('SHA-256');
  await body.pipeTo(digest);
  return hex(await digest.digest);
};

const CONCURRENCY = 8;

/** A bucket's measured size: its object and byte counts. */
export interface Measure {
  objects: number;
  bytes: number;
}

/** Objects and bytes in a bucket, or under a prefix of it. */
export async function measure(bucket: R2Bucket, prefix?: string): Promise<Measure> {
  let objects = 0;
  let bytes = 0;
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, cursor, limit: PAGE });
    objects += listed.objects.length;
    bytes += listed.objects.reduce((sum, object) => sum + object.size, 0);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return { objects, bytes };
}

/**
 * Refuses a bucket that holds anything outside `allowed` top-level prefixes: a binding pointed at a room bucket by
 * mistake fails here, before the run writes or deletes anything.
 */
export async function onlyUnder(bucket: R2Bucket, allowed: readonly string[], code: BackupCode): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ delimiter: '/', cursor, limit: PAGE });
    const stray = listed.objects.length + listed.delimitedPrefixes.filter((prefix) => !allowed.includes(prefix)).length;
    if (stray > 0) throw new BackupError(code, `the bucket holds ${stray} top-level ${stray === 1 ? 'entry' : 'entries'} the backup did not write`);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

/** Whether the bucket holds no objects. */
export async function isEmpty(bucket: R2Bucket): Promise<boolean> {
  return (await bucket.list({ limit: 1 })).objects.length === 0;
}

/** Deletes every object under `prefix`. Returns how many. */
export async function deleteUnder(bucket: R2Bucket, prefix: string): Promise<number> {
  let deleted = 0;
  for (;;) {
    const listed = await bucket.list({ prefix, limit: PAGE });
    if (listed.objects.length === 0) return deleted;
    await bucket.delete(listed.objects.map((object) => object.key));
    deleted += listed.objects.length;
  }
}

/** What remains of the free tier for one page: stored bytes and writes. */
export interface Budget {
  bytes: number;
  writes: number;
}

/** One page of copied objects, with the cursor where the next page starts. */
export interface CopiedPage {
  /** Where the next page starts; null after the last. */
  cursor: string | null;
  objects: number;
  bytes: number;
  copied: number;
  copiedBytes: number;
  /** Changed or removed between the list and the copy; the next run takes the new version. */
  skipped: number;
  hash: string;
}

type Got = R2ObjectBody | R2Object | null;
const hasBody = (got: Got): got is R2ObjectBody => got !== null && 'body' in got;

/**
 * Copies one list page of a room bucket. An object version the backup already holds is not read again. A new one is
 * read twice, both times only if its etag still matches the listing: once to hash it, once to store it with that hash,
 * which R2 checks on write. Then the page's manifest is written. Nothing is written past the budget.
 */
export async function copyPage(
  source: R2Bucket,
  backup: R2Bucket,
  name: Source,
  run: string,
  page: number,
  cursor: string | undefined,
  hash: HashBody,
  budget: Budget,
): Promise<CopiedPage> {
  const listed = await source.list({ cursor, limit: PAGE });
  const seen = await mapLimit(listed.objects, CONCURRENCY, async (object) => {
    const key = blobKey(name, object.etag, object.key);
    return { object, key, held: await backup.head(key) };
  });
  const fresh = seen.filter((entry) => entry.held === null);
  const freshBytes = fresh.reduce((sum, entry) => sum + entry.object.size, 0);
  if (freshBytes > budget.bytes) throw new BackupError('storage-cap', `${fresh.length} new objects (${freshBytes} bytes) would pass the free-tier storage cap`);
  if (fresh.length + 1 > budget.writes) throw new BackupError('write-cap', `${fresh.length} new objects would pass this run's write cap`);

  const lines = await mapLimit(seen, CONCURRENCY, async ({ object, key, held }): Promise<ManifestLine | null> => {
    if (held) {
      const sha = held.customMetadata?.[SHA_META];
      if (!sha) throw new BackupError('copy-without-hash', 'a backup copy has no recorded SHA-256');
      return { k: object.key, e: object.etag, n: object.size, s: sha };
    }
    const onlyIf = { etagMatches: object.etag };
    const first: Got = await source.get(object.key, { onlyIf });
    if (!hasBody(first)) return null;
    const sha = await hash(first.body);
    const second: Got = await source.get(object.key, { onlyIf });
    if (!hasBody(second)) return null;
    const stored = await backup.put(key, second.body, {
      sha256: sha,
      httpMetadata: second.httpMetadata,
      customMetadata: { ...second.customMetadata, [SHA_META]: sha },
    });
    if (stored.size !== object.size) throw new BackupError('size-mismatch', 'a backup copy is not the size of its original');
    return { k: object.key, e: object.etag, n: object.size, s: sha };
  });

  const kept = lines.filter((line): line is ManifestLine => line !== null);
  const copied = seen.filter((entry, index) => entry.held === null && lines[index] !== null);
  const text = linesText(kept);
  await backup.put(manifestKey(run, name, page), text, { httpMetadata: { contentType: 'application/x-ndjson' } });
  return {
    cursor: listed.truncated ? listed.cursor : null,
    objects: kept.length,
    bytes: kept.reduce((sum, line) => sum + line.n, 0),
    copied: copied.length,
    copiedBytes: copied.reduce((sum, entry) => sum + entry.object.size, 0),
    skipped: lines.length - kept.length,
    hash: await sha256Hex(text),
  };
}

/** One page of restored objects: the counts of objects and bytes. */
export interface RestoredPage {
  objects: number;
  bytes: number;
  /** Copies missing from the backup, refused by R2's SHA-256 check, or not their recorded size. */
  failed: number;
  /** The manifest page's hash as read now; the run's summary rolls up the hash written then. */
  hash: string;
}

/**
 * Restores one manifest page into `target`, each object under `targetKey(key)`. R2 refuses a write whose bytes do not
 * hash to the SHA-256 the run recorded, and the stored size and checksum are compared again.
 */
export async function restorePage(backup: R2Bucket, target: R2Bucket, targetKey: (key: string) => string, name: Source, run: string, page: number): Promise<RestoredPage> {
  const manifest = await backup.get(manifestKey(run, name, page));
  if (!manifest) throw new BackupError('manifest-missing', `page ${page} of a run's manifest is missing`);
  const text = await manifest.text();
  const lines = parseManifest(text);
  const results = await mapLimit(lines, CONCURRENCY, async (line) => {
    const copy = await backup.get(blobKey(name, line.e, line.k));
    if (!copy) return false;
    const { [SHA_META]: _recorded, ...custom } = copy.customMetadata ?? {};
    try {
      const stored = await target.put(targetKey(line.k), copy.body, { sha256: line.s, httpMetadata: copy.httpMetadata, customMetadata: custom });
      const sum = stored.checksums.sha256;
      return stored.size === line.n && sum !== undefined && hex(sum) === line.s;
    } catch {
      return false;
    }
  });
  const restored = lines.filter((_, index) => results[index]);
  return {
    objects: restored.length,
    bytes: restored.reduce((sum, line) => sum + line.n, 0),
    failed: lines.length - restored.length,
    hash: await sha256Hex(text),
  };
}
