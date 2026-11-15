// SPDX-License-Identifier: Apache-2.0
// Tests only: a room for the sync endpoints, on real SQLite with the real migrations (sqlite-d1.ts) and an in-memory R2
// that keeps R2's rules for what these routes rely on: a sha256 that doesn't match fails the put, parts other than the
// last must be equal and at least 5 MiB, and a completed upload is gone. Client ID and emails are invented.
import { createHash } from 'node:crypto';
import type { Env } from './env.ts';
import { testDb, type TestDb } from './sqlite-d1.ts';

export const CLIENT = 'client-one.access';
export const OWNER = 'founder@example.test';
export const NOW = '2026-11-01T12:00:00.000Z';
export const ORIGIN = 'https://room.example.test';

// Workers' FixedLengthStream: passes bytes through and errors unless exactly `size` arrive.
(globalThis as Record<string, unknown>).FixedLengthStream = class {
  constructor(size: number) {
    let seen = 0;
    return new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > size) controller.error(new Error('too long'));
        else controller.enqueue(chunk);
      },
      flush(controller) {
        if (seen !== size) controller.error(new Error('too short'));
      },
    });
  }
};

async function bytesOf(value: unknown): Promise<Uint8Array> {
  if (value instanceof Uint8Array) return value;
  if (value === null || value === undefined) return new Uint8Array(0);
  return new Uint8Array(await new Response(value as BodyInit).arrayBuffer());
}

interface Stored {
  bytes: Uint8Array;
  contentType: string | undefined;
  sha256: string | undefined;
}

const toBuffer = (hex: string) => {
  const buffer = Buffer.from(hex, 'hex');
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

export class FakeBucket {
  readonly objects = new Map<string, Stored>();
  readonly deleted: string[] = [];
  private readonly uploads = new Map<string, { key: string; contentType: string | undefined; parts: Map<number, Uint8Array> }>();
  private next = 1;

  private view(key: string, stored: Stored) {
    return {
      key,
      size: stored.bytes.byteLength,
      etag: `etag-${key}`,
      checksums: stored.sha256 ? { sha256: toBuffer(stored.sha256) } : {},
      httpMetadata: { contentType: stored.contentType },
    };
  }

  async put(key: string, value: unknown, options: { sha256?: string; httpMetadata?: { contentType?: string }; onlyIf?: Headers } = {}) {
    // Create-once: R2 evaluates this as part of the write.
    if (options.onlyIf?.get('If-None-Match') === '*' && this.objects.has(key)) return null;
    const bytes = await bytesOf(value);
    if (options.sha256 && createHash('sha256').update(bytes).digest('hex') !== options.sha256) throw new Error('BadDigest');
    const stored = { bytes, contentType: options.httpMetadata?.contentType, sha256: options.sha256 };
    this.objects.set(key, stored);
    return this.view(key, stored);
  }

  async head(key: string) {
    const stored = this.objects.get(key);
    return stored ? this.view(key, stored) : null;
  }

  async get(key: string) {
    const stored = this.objects.get(key);
    return stored ? { ...this.view(key, stored), body: new Response(stored.bytes).body } : null;
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.deleted.push(key);
      this.objects.delete(key);
    }
  }

  async createMultipartUpload(key: string, options: { httpMetadata?: { contentType?: string } } = {}) {
    const uploadId = `upload/${this.next++}+id`;
    this.uploads.set(uploadId, { key, contentType: options.httpMetadata?.contentType, parts: new Map() });
    return this.resumeMultipartUpload(key, uploadId);
  }

  resumeMultipartUpload(key: string, uploadId: string) {
    const live = () => {
      const upload = this.uploads.get(uploadId);
      if (!upload || upload.key !== key) throw new Error('NoSuchUpload');
      return upload;
    };
    return {
      key,
      uploadId,
      uploadPart: async (partNumber: number, value: unknown) => {
        const upload = live();
        upload.parts.set(partNumber, await bytesOf(value));
        return { partNumber, etag: `part-${partNumber}` };
      },
      abort: async () => {
        live();
        this.uploads.delete(uploadId);
      },
      complete: async (parts: { partNumber: number; etag: string }[]) => {
        const upload = live();
        const ordered = parts.map((part) => {
          const bytes = upload.parts.get(part.partNumber);
          if (!bytes || part.etag !== `part-${part.partNumber}`) throw new Error('InvalidPart');
          return bytes;
        });
        for (const bytes of ordered.slice(0, -1)) {
          if (bytes.byteLength !== ordered[0]!.byteLength) throw new Error('InvalidPart: uneven parts');
          if (bytes.byteLength < 5 * 1024 * 1024) throw new Error('EntityTooSmall');
        }
        const size = ordered.reduce((sum, bytes) => sum + bytes.byteLength, 0);
        const whole = new Uint8Array(size);
        let offset = 0;
        for (const bytes of ordered) {
          whole.set(bytes, offset);
          offset += bytes.byteLength;
        }
        this.uploads.delete(uploadId);
        // A multipart object carries no sha256, as in R2.
        const stored = { bytes: whole, contentType: upload.contentType, sha256: undefined };
        this.objects.set(key, stored);
        return this.view(key, stored);
      },
    };
  }
}

export interface SyncRoom extends TestDb {
  env: Env;
  files: FakeBucket;
  index: FakeBucket;
  jobs: unknown[];
}

/** A room with the endpoints on, an owner, and one live sync token for that owner. */
export function syncRoom(overrides: Partial<Env> = {}): SyncRoom {
  const { db, sqlite } = testDb();
  sqlite.exec(`INSERT INTO members (email, role) VALUES ('${OWNER}', 'owner'), ('counsel@example.test', 'counsel')`);
  sqlite.exec(`INSERT INTO sync_tokens (client_id, owner_email) VALUES ('${CLIENT}', '${OWNER}')`);
  const files = new FakeBucket();
  const index = new FakeBucket();
  const jobs: unknown[] = [];
  const env = {
    DB: db,
    FILES: files,
    INDEX: index,
    SEARCH: {
      jobs: {
        async create(params: unknown) {
          jobs.push(params);
          return { id: 'job-1' };
        },
      },
    },
    ASSETS: { fetch: async () => new Response('shell') },
    TEAM_DOMAIN: 'https://team.example.test',
    ACCESS_AUD: 'people-aud',
    SYNC_ENDPOINTS: '1',
    SYNC_ACCESS_AUD: 'sync-aud',
    ...overrides,
  } as unknown as Env;
  return { db, sqlite, env, files, index, jobs };
}
