// SPDX-License-Identifier: Apache-2.0
// The sync engine's other way to reach a room: its own sync endpoints (docs/design/sync-endpoints.md), with an Access
// service token, instead of Wrangler with an account-wide one. `npm run sync -- --room` uses it, and the helper runs that.
// It implements the Wrangler interface, so the dry run, the fingerprint, the SSN guard and apply.ts are the same code
// either way; what differs is that the record goes up as a plan, never SQL (wrangler.ts SyncRecordWriter).
//
// The credentials come from the environment and go only in the Access headers, on every request. They are never logged,
// and errors carry a short code and the kind of call, never a file name, a path or a secret.
import { roomDrafts, type Draft, type DraftSource } from './saveback.ts';
import { createWriteStream, openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { MAX_UPLOAD_BYTES } from '../worker/files-upload.ts';
import { VISUAL_AI_PREFIX } from '../worker/side-files.ts';
import { LEASE_HEADER, MONTHLY_UPLOAD_GB } from '../worker/sync-rules.ts';
import type { LocalFile, SyncPlan } from './diff.ts';
import { sha256File } from './snapshot.ts';
import { MIRROR_ROWS_SQL, PENDING_PULLS_SQL } from './sqlplan.ts';
import type { SideFileStore } from './visual-ai.ts';
import { FILES_BUCKET, INDEX_BUCKET, type SyncRecordWriter, type Wrangler } from './wrangler.ts';

/** Entries in one record request: worker/sync.ts MAX_RECORD_OPS. */
export const RECORD_BATCH = 100;
/** How often a run renews its lease. It lasts five minutes without one (worker/sync.ts LEASE_TTL_MS). */
export const LEASE_RENEW_MS = 60_000;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;
const INDEX_KEY = /^text\/([0-9a-f-]{36})\.p([1-9][0-9]*)\.md$/;
/** worker/auth.ts LOCAL_HOSTS: this computer's own `wrangler dev`. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/** What a person can do about a refusal that's theirs to fix. */
const HINTS: Readonly<Record<string, string>> = {
  upload_budget: " This month's upload cap is full. Sync again next month.",
  bad_setting: ` SYNC_MONTHLY_GB must be a number above 0 and no more than ${MONTHLY_UPLOAD_GB}.`,
};

/** A refusal or failure from the room. `code` is the room's short error code, or the HTTP status when it gave none. */
export class RoomSyncError extends Error {
  override name = 'RoomSyncError';
  readonly code: string;
  readonly status: number;
  constructor(what: string, code: string, status: number) {
    super(`The room refused ${what}: ${code}.${HINTS[code] ?? ''}`);
    this.code = code;
    this.status = status;
  }
}

/** Another device holds the lease. */
export class LeaseHeld extends Error {
  override name = 'LeaseHeld';
  constructor(device: string | null, until: string | null) {
    super(`${device ? `"${device}"` : 'Another device'} is syncing this room${until ? ` (its lease lasts until ${until})` : ''}. Nothing was changed. Run again later, or with --take-over to take over from it.`);
  }
}

export interface RoomSyncOptions {
  origin: string;
  clientId: string;
  clientSecret: string;
  /** What another device is told when this one holds the lease. The same name takes a crashed run's lease straight back. */
  device: string;
  takeOver?: boolean;
  log?: (line: string) => void;
  fetcher?: typeof fetch;
  /** Tests only: a smaller delay between tries. */
  retryDelayMs?: number;
  /** Tests only: files over this go up in parts. Otherwise MAX_UPLOAD_BYTES. */
  singlePutBytes?: number;
  /** Tests only: instead of the part size the room gives. */
  partBytes?: number;
}

export interface RoomSync extends Wrangler {
  record: SyncRecordWriter;
  sideFiles: SideFileStore;
  /** Takes the lease, and keeps it renewed until release. Throws LeaseHeld when another device has it. */
  acquire(): Promise<void>;
  /** Gives the lease back. Safe to call without one, and more than once. */
  release(): Promise<void>;
  /** Approved drafts the room has not had saved to the folder yet (saveback.ts). */
  drafts(): Promise<Draft[]>;
  /** Reads a draft and marks drafts saved, under this sync's lease. */
  draftSource: DraftSource;
}

/**
 * The room's origin, from ROOM_SYNC_ORIGIN or the room config's host. The secret goes in every request, so only https
 * will do, except to this computer's own `wrangler dev`.
 */
export function roomOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new Error('The room address is not a valid address.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) throw new Error('The room address must use https.');
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('The room address must be the room host alone, with no path.');
  return url.origin;
}

/** A name for this computer, which another device is told when this one holds the lease. */
export function deviceName(host: string = hostname()): string {
  return host.replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 80).trim() || 'computer';
}

/**
 * A plan as record requests, in the order the room must apply them: removals free paths for renames, renames for adds.
 * Page counts go last, once every row they name exists, which leaves the rows as sqlplan.ts syncSql would.
 */
export function recordBatches(plan: SyncPlan<LocalFile>, now: string, pages: ReadonlyMap<string, number>, size = RECORD_BATCH): unknown[] {
  type Entry = { group: 'removals' | 'renames' | 'changes' | 'adds'; value: unknown } | { group: 'pages'; id: string; count: number };
  const op = (entry: { id: string; path: string; size: number; sha256: string; r2Key: string }) => ({
    id: entry.id,
    path: entry.path,
    size: entry.size,
    sha256: entry.sha256,
    r2_key: entry.r2Key,
  });
  const entries: Entry[] = [
    ...plan.removals.map((row): Entry => ({ group: 'removals', value: row.id })),
    ...plan.renames.map((rename): Entry => ({ group: 'renames', value: { id: rename.id, path: rename.path } })),
    ...plan.changes.map((change): Entry => ({ group: 'changes', value: op(change) })),
    ...plan.adds.map((add): Entry => ({ group: 'adds', value: op(add) })),
    ...[...pages].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, count]): Entry => ({ group: 'pages', id, count })),
  ];
  const batches: unknown[] = [];
  for (let start = 0; start < entries.length; start += size) {
    const batch = { run: now, removals: [] as unknown[], renames: [] as unknown[], changes: [] as unknown[], adds: [] as unknown[], pages: {} as Record<string, number> };
    for (const entry of entries.slice(start, start + size)) {
      if (entry.group === 'pages') batch.pages[entry.id] = entry.count;
      else batch[entry.group].push(entry.value);
    }
    batches.push(batch);
  }
  return batches;
}

/** Each byte range of a file in parts of `partBytes`. */
export function partRanges(size: number, partBytes: number): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (let start = 0; start < size; start += partBytes) ranges.push({ start, end: Math.min(start + partBytes, size) });
  return ranges;
}

interface Call {
  method: string;
  /** Already encoded, under the origin. */
  path: string;
  /** Names the kind of call in an error. Never a file name. */
  what: string;
  /** Called per attempt. */
  body?: () => RequestInit['body'];
  headers?: Record<string, string>;
  /** Statuses returned to the caller rather than raised. */
  accept?: readonly number[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sends calls to the room with the Access headers and the lease when held, and tries again on a transient failure. */
interface Transport {
  send(call: Call): Promise<Response>;
  sendJson(call: Omit<Call, 'body' | 'headers'>, value: unknown): Promise<Response>;
  lease(): string | null;
  setLease(value: string | null): void;
}

function roomTransport(options: RoomSyncOptions): Transport {
  const fetcher = options.fetcher ?? fetch;
  const retryDelay = options.retryDelayMs ?? RETRY_DELAY_MS;
  const access = { 'CF-Access-Client-Id': options.clientId, 'CF-Access-Client-Secret': options.clientSecret };
  let lease: string | null = null;

  const once = async (call: Call): Promise<Response> => {
    const headers: Record<string, string> = { ...access, ...call.headers, ...(lease ? { [LEASE_HEADER]: lease } : {}) };
    const body = call.body?.();
    // A redirect here is Access sending the client to a sign-in page: that is a refusal, not somewhere to follow.
    return fetcher(`${options.origin}${call.path}`, { method: call.method, headers, redirect: 'manual', ...(body !== undefined ? { body } : {}) });
  };

  /** Sends a call, trying again after a network failure or a server error. Every call the engine makes can be repeated. */
  const send = async (call: Call): Promise<Response> => {
    for (let attempt = 1; ; attempt += 1) {
      let response: Response | null = null;
      try {
        response = await once(call);
      } catch {
        if (attempt >= ATTEMPTS) throw new RoomSyncError(call.what, 'network_failure', 0);
      }
      if (response) {
        if (response.status < 300 || call.accept?.includes(response.status)) return response;
        if (response.status < 500 || attempt >= ATTEMPTS) throw new RoomSyncError(call.what, await errorCode(response), response.status);
      }
      await sleep(retryDelay * 2 ** (attempt - 1));
    }
  };

  const sendJson = (call: Omit<Call, 'body' | 'headers'>, value: unknown): Promise<Response> => {
    const text = JSON.stringify(value);
    return send({ ...call, body: () => text, headers: { 'Content-Type': 'application/json' } });
  };

  return {
    send,
    sendJson,
    lease: (): string | null => lease,
    setLease: (value: string | null): void => {
      lease = value;
    },
  };
}

/** How the engine puts a file's bytes in the room: one request, or parts for a large original. */
interface Uploads {
  putOriginal(key: string, file: string, contentType: string): Promise<void>;
  putRaw(where: string, what: string, file: string, headers?: Record<string, string>): Promise<void>;
}

function roomUploads(transport: Transport, options: RoomSyncOptions): Uploads {
  const { send, sendJson } = transport;

  const putLarge = async (key: string, file: string, size: number, contentType: string): Promise<void> => {
    const base = `/api/sync/files/${key}/uploads`;
    const started = (await (await sendJson({ method: 'POST', path: base, what: 'a large file' }, { contentType })).json()) as { upload: string; part_bytes: number };
    const uploadPath = `${base}/${encodeURIComponent(started.upload)}`;
    const blob = await openAsBlob(file);
    const parts: unknown[] = [];
    try {
      for (const [index, range] of partRanges(size, options.partBytes ?? started.part_bytes).entries()) {
        const part = await send({
          method: 'PUT',
          path: `${uploadPath}/parts/${index + 1}`,
          what: 'part of a large file',
          body: () => blob.slice(range.start, range.end) as RequestInit['body'],
        });
        parts.push(await part.json());
      }
      await sendJson({ method: 'POST', path: `${uploadPath}/complete`, what: 'a large file' }, { size, parts });
    } catch (error) {
      await send({ method: 'DELETE', path: uploadPath, what: 'stopping a large file' }).catch(() => undefined);
      throw error;
    }
  };

  const putOriginal = async (key: string, file: string, contentType: string): Promise<void> => {
    const { size } = await stat(file);
    if (size > (options.singlePutBytes ?? MAX_UPLOAD_BYTES)) return putLarge(key, file, size, contentType);
    const [blob, sha256] = await Promise.all([openAsBlob(file), sha256File(file)]);
    await send({
      method: 'PUT',
      path: `/api/sync/files/${key}`,
      what: 'a file',
      body: () => blob as RequestInit['body'],
      headers: { 'Content-Type': contentType, 'X-Sync-Sha256': sha256 },
    });
  };

  const putRaw = async (where: string, what: string, file: string, headers?: Record<string, string>): Promise<void> => {
    const blob = await openAsBlob(file);
    await send({ method: 'PUT', path: where, what, body: () => blob as RequestInit['body'], ...(headers ? { headers } : {}) });
  };

  return { putOriginal, putRaw };
}

function indexPath(key: string): string {
  const match = INDEX_KEY.exec(key);
  if (!match) throw new Error('Refusing an index key that sync did not generate');
  return `/api/sync/index/${match[1]}/${match[2]}`;
}

function sidePath(key: string): string {
  if (!key.startsWith(VISUAL_AI_PREFIX)) throw new Error('Refusing a side-file key that sync did not generate');
  return `/api/sync/side/${encodeURIComponent(key.slice(VISUAL_AI_PREFIX.length))}`;
}

interface RoomState {
  rows: Record<string, unknown>[];
  pending: { id: string; name: string }[];
  index?: Record<string, { sha256: string; parts: number; extractor?: number; render?: number; text?: number }>;
  drafts?: Draft[];
}

/** Reads what the room knows: the mirror rows, pending counsel uploads, the index record and approved drafts. */
async function roomState(transport: Transport): Promise<RoomState> {
  return (await (await transport.send({ method: 'GET', path: '/api/sync/state', what: 'reading its state' })).json()) as RoomState;
}

/** The reads a sync would make in SQL, answered from the room's state; the room runs no SQL for a sync. */
function roomQueries(transport: Transport): Pick<Wrangler, 'd1Query' | 'd1File' | 'indexRecord'> {
  return {
    async d1Query(sql) {
      // r2_key stands in for the id: the room never sends its keys. Nothing reads a row's key here (a sync's own
      // uploads have their own keys, the room keeps what they replace), and a pull goes by id.
      if (sql === MIRROR_ROWS_SQL) return (await roomState(transport)).rows.map((row) => ({ ...row, r2_key: row.id, source: 'mirror', removed_at: null }));
      if (sql === PENDING_PULLS_SQL) return (await roomState(transport)).pending.map((row) => ({ ...row, r2_key: row.id }));
      throw new Error('The room runs no SQL for a sync.');
    },
    async d1File() {
      throw new Error('The room runs no SQL for a sync.');
    },
    async indexRecord() {
      return (await roomState(transport)).index ?? {};
    },
  };
}

/** The files bucket and the index bucket, through the room's endpoints. */
function roomStorage(transport: Transport, uploads: Uploads, log: (line: string) => void): Pick<Wrangler, 'r2Put' | 'r2Get' | 'r2Delete'> {
  const { send } = transport;
  let toldSearchFull = false;
  return {
    async r2Put(bucket, key, file, contentType, text) {
      if (bucket === FILES_BUCKET) return uploads.putOriginal(key, file, contentType);
      if (bucket === INDEX_BUCKET) {
        const record = text ? { 'X-Index-Sha256': text.sha256, 'X-Index-Stamp': JSON.stringify(text.stamp) } : undefined;
        return uploads.putRaw(indexPath(key), 'an index part', file, record).catch((error: unknown) => {
          if (error instanceof RoomSyncError && error.code === 'ingest_budget' && !toldSearchFull) {
            toldSearchFull = true;
            log('Search is full for this month: documents still reach the room, but their new text is not searchable until the 1st (UTC). A later sync catches up.');
          }
          throw error;
        });
      }
      throw new Error('Refusing an unknown bucket');
    },
    async r2Get(bucket, key, file) {
      if (bucket !== FILES_BUCKET) throw new Error('Refusing an unknown bucket');
      const response = await send({ method: 'GET', path: `/api/sync/pulls/${encodeURIComponent(key)}`, what: 'a counsel upload' });
      if (!response.body) throw new RoomSyncError('a counsel upload', 'empty_response', response.status);
      await pipeline(Readable.fromWeb(response.body as NodeReadableStream), createWriteStream(file, { mode: 0o600 }));
    },
    async r2Delete(bucket, key) {
      if (bucket === FILES_BUCKET) await send({ method: 'DELETE', path: `/api/sync/files/${key}`, what: 'removing an upload' });
      else if (bucket === INDEX_BUCKET) await send({ method: 'DELETE', path: indexPath(key), what: 'removing an index part' });
      else throw new Error('Refusing an unknown bucket');
    },
  };
}

/** The sync's record as a plan, and the side files, through the room's endpoints. */
function roomRecord(transport: Transport, uploads: Uploads): { record: SyncRecordWriter; sideFiles: SideFileStore } {
  const { send, sendJson } = transport;
  return {
    record: {
      async apply(plan, now, pages) {
        for (const batch of recordBatches(plan, now, pages)) {
          await sendJson({ method: 'POST', path: '/api/sync/record', what: 'the record' }, batch);
        }
      },
      async markPulled(ids, now) {
        for (let start = 0; start < ids.length; start += RECORD_BATCH) {
          await sendJson({ method: 'POST', path: '/api/sync/pulls', what: 'marking uploads pulled' }, { run: now, ids: ids.slice(start, start + RECORD_BATCH) });
        }
      },
    },
    sideFiles: {
      put: async (key, file) => {
        await uploads.putRaw(sidePath(key), 'a side file', file);
      },
      delete: async (key) => {
        await send({ method: 'DELETE', path: sidePath(key), what: 'removing a side file' });
      },
    },
  };
}

/** Takes the lease, keeps it renewed, and gives it back. */
function roomLease(transport: Transport, options: RoomSyncOptions): Pick<RoomSync, 'acquire' | 'release'> {
  let stopRenewing = () => {};
  return {
    async acquire() {
      const response = await transport.sendJson({ method: 'POST', path: '/api/sync/lease', what: 'the lease', accept: [409] }, { device: options.device, ...(options.takeOver ? { takeover: true } : {}) });
      const body = (await response.json()) as { lease?: string; device?: string | null; expires_at?: string | null };
      if (response.status === 409 || !body.lease) throw new LeaseHeld(body.device ?? null, body.expires_at ?? null);
      transport.setLease(body.lease);
      const timer = setInterval(() => {
        // A failed renewal is not fatal by itself: the lease stands until someone takes it, and then the next write says so.
        void transport.send({ method: 'PUT', path: '/api/sync/lease', what: 'renewing the lease' }).catch(() => undefined);
      }, LEASE_RENEW_MS);
      timer.unref();
      stopRenewing = () => clearInterval(timer);
    },
    async release() {
      stopRenewing();
      if (!transport.lease()) return;
      // Best effort: a lease not given back only makes another device wait five minutes, or take over.
      await transport.send({ method: 'DELETE', path: '/api/sync/lease', what: 'giving the lease back' }).catch(() => undefined);
      transport.setLease(null);
    },
  };
}

export function roomSync(options: RoomSyncOptions): RoomSync {
  const log = options.log ?? (() => undefined);
  const transport = roomTransport(options);
  const uploads = roomUploads(transport, options);
  const { send, sendJson } = transport;
  return {
    target: 'remote',
    ...roomQueries(transport),
    ...roomStorage(transport, uploads, log),
    ...roomRecord(transport, uploads),
    ...roomLease(transport, options),
    async aiSearchJobsAvailable() {
      return true;
    },
    async drafts() {
      return (await roomState(transport)).drafts ?? [];
    },
    draftSource: roomDrafts((method, route, body) =>
      body === undefined ? send({ method, path: route, what: 'an approved draft' }) : sendJson({ method, path: route, what: 'marking drafts saved' }, body),
    ),
    async aiSearchJobCreate() {
      const response = await send({ method: 'POST', path: '/api/sync/reindex', what: 'starting a search index job', accept: [502] });
      if (response.status === 502) log('AI Search will pick the new text up on its own schedule.');
    },
  };
}

/** The room's error code from a response, or the status. Access's own refusals are HTML, and this never quotes them. */
async function errorCode(response: Response): Promise<string> {
  try {
    const { error } = (await response.json()) as { error?: unknown };
    if (typeof error === 'string' && /^[a-z_]{1,40}$/.test(error)) return error;
  } catch {
    // Not JSON.
  }
  return `HTTP ${response.status}`;
}
