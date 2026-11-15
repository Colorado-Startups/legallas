// SPDX-License-Identifier: Apache-2.0
// Test fixtures for deal rooms (imported only by *.test.ts): the fictional Harbor Labs record on real SQLite (every
// migration applied), three rooms, three investors, the owner and counsel, and documents placed to probe the room
// rule's edges: a sibling folder with the same prefix, a folder name with a LIKE wildcard, another case, a privileged
// path, a document the manifest marks privileged, a removed one, a room data file, counsel's upload and the record.
import type { DatabaseSync } from 'node:sqlite';
import type { Env } from './env.ts';
import { MATTER_KEY } from './matter-types.ts';
import { testDb, type TestDb } from './sqlite-d1.ts';
import { STORED_NAME } from './stored-name.ts';

export const HOST = 'http://localhost:8789';
export const OWNER = 'founder@example.test';
export const COUNSEL = 'counsel@firm.example';
/** In rooms A and C. */
export const IVY = 'ivy@fund.example';
/** In room A. */
export const OTTO = 'otto@angels.example';
/** In room B. */
export const BEA = 'bea@group.example';
export const STRANGER = 'stranger@example.test';

export const ROOM_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
export const ROOM_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
/** Shows the same folder as A, so one document sits in two rooms. */
export const ROOM_C = 'cccccccc-0000-4000-8000-00000000000c';
export const NO_ROOM = 'dddddddd-0000-4000-8000-00000000000d';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Every fixture document: its id, path, kind, and what a guest of room A (or B) should see of it. */
export const DOC = {
  term: { id: id(1), path: 'Deals/Harbor Seed/Term sheet.pdf' },
  cap: { id: id(2), path: 'Deals/Harbor Seed/Financials/Cap table.csv', kind: 'csv' },
  privilegedPath: { id: id(3), path: 'Deals/Harbor Seed/Counsel PRIVILEGED/Memo.pdf' },
  privilegedMark: { id: id(4), path: 'Deals/Harbor Seed/Board minutes.pdf' },
  sibling: { id: id(5), path: 'Deals/Harbor Seed Two/Pitch.pdf' },
  otherCase: { id: id(6), path: 'deals/harbor seed/Lower.pdf' },
  dataFile: { id: id(7), path: `Deals/Harbor Seed/${STORED_NAME}-binder.json`, kind: 'file' },
  removed: { id: id(8), path: 'Deals/Harbor Seed/Old deck.pdf', removed: true },
  record: { id: id(9), path: '08-Court-Pleadings/Complaint.pdf' },
  upload: { id: id(10), path: `from-counsel/${id(10)}/Reply.pdf`, source: 'counsel' },
  visual: { id: id(11), path: 'Deals/Harbor Seed/Model.html', kind: 'visual' },
  wildcard: { id: id(12), path: 'Deals/Doe_Labs/Deck.pdf' },
  lookalike: { id: id(13), path: 'Deals/DoeXLabs/Plan.pdf' },
  adjacent: { id: id(14), path: 'Deals/Harbor Seed.pdf' },
} as const;

type Seed = { id: string; path: string; kind?: string; removed?: boolean; source?: string };

/** What a guest of room A lists, by path. */
export const ROOM_A_PATHS = [DOC.cap.path, DOC.visual.path, DOC.term.path];

const T0 = '2026-01-01T00:00:00.000Z';
const JOINED = '2026-01-02T00:00:00.000Z';
const FAR = '2099-01-01T00:00:00.000Z';

export interface InviteSeed {
  room: string;
  email: string;
  role?: string;
  invitedAt?: string;
  acceptBy?: string;
  joinedAt?: string | null;
  expiresAt?: string;
  revokedAt?: string | null;
}

let grants = 0;

/** One room_members row: joined, ending in 2099, unless told otherwise. Returns its id. */
export function invite(sqlite: DatabaseSync, seed: InviteSeed): string {
  const grantId = `grant-${++grants}`;
  sqlite
    .prepare(
      'INSERT INTO room_members (id, room_id, email, role, invited_by, invited_at, accept_by, joined_at, expires_at, revoked_at) ' +
        "VALUES (?1, ?2, ?3, ?4, 'owner-cli', ?5, ?6, ?7, ?8, ?9)",
    )
    .run(
      grantId,
      seed.room,
      seed.email,
      seed.role ?? 'investor',
      seed.invitedAt ?? T0,
      seed.acceptBy ?? '2026-01-15T00:00:00.000Z',
      seed.joinedAt === undefined ? JOINED : seed.joinedAt,
      seed.expiresAt ?? FAR,
      seed.revokedAt ?? null,
    );
  return grantId;
}

export function addRoom(sqlite: DatabaseSync, roomId: string, name: string, folders: string[], kind: 'deal' | 'matter' = 'deal'): void {
  sqlite.prepare("INSERT INTO rooms (id, kind, name, created_by) VALUES (?1, ?2, ?3, 'owner-cli')").run(roomId, kind, name);
  for (const folder of folders) {
    sqlite.prepare("INSERT INTO room_folders (id, room_id, folder, added_by) VALUES (?1, ?2, ?3, 'owner-cli')").run(`${roomId}:${folder}`, roomId, folder);
  }
}

/** The whole fixture on a fresh database. */
export function roomsDb(): TestDb {
  const t = testDb();
  const { sqlite } = t;
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?1, 'owner', 'Founder')").run(OWNER);
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?1, 'counsel', 'Counsel')").run(COUNSEL);
  for (const doc of Object.values(DOC) as Seed[]) {
    const slash = doc.path.lastIndexOf('/');
    sqlite
      .prepare(
        'INSERT INTO documents (id, path, folder, name, kind, content_type, size, pages, r2_key, source, updated_at, removed_at) ' +
          "VALUES (?1, ?2, ?3, ?4, ?5, ?6, 10, 3, ?7, ?8, '2026-02-01T00:00:00.000Z', ?9)",
      )
      .run(
        doc.id,
        doc.path,
        doc.path.slice(0, slash),
        doc.path.slice(slash + 1),
        doc.kind ?? 'pdf',
        doc.kind === 'csv' ? 'text/csv' : doc.kind === 'visual' ? 'text/html' : 'application/pdf',
        `r2-${doc.id}`,
        doc.source ?? 'mirror',
        doc.removed ? '2026-03-01T00:00:00.000Z' : null,
      );
  }
  addRoom(sqlite, ROOM_A, 'Harbor Labs seed', ['Deals/Harbor Seed']);
  addRoom(sqlite, ROOM_B, 'Doe Labs', ['Deals/Doe_Labs']);
  addRoom(sqlite, ROOM_C, 'Harbor Labs bridge', ['Deals/Harbor Seed']);
  invite(sqlite, { room: ROOM_A, email: IVY });
  invite(sqlite, { room: ROOM_C, email: IVY });
  invite(sqlite, { room: ROOM_A, email: OTTO });
  invite(sqlite, { room: ROOM_B, email: BEA });
  return t;
}

/** The manifest marking DOC.privilegedMark privileged. */
export const MARKS_MANIFEST = JSON.stringify({ version: 1, meta: { builtAt: '2026-01-01T00:00:00Z' }, docs: { [DOC.privilegedMark.id]: { privileged: true } } });

/** legallas-files: ten bytes per document, and the manifest at MATTER_KEY when given; its text is its etag. */
export function fakeFiles(manifest: string | null = MARKS_MANIFEST): R2Bucket {
  const bytes = new TextEncoder().encode('0123456789');
  return {
    async get(key: string, options?: { range?: { offset: number; length: number }; onlyIf?: { etagDoesNotMatch?: string } }) {
      if (key === MATTER_KEY) {
        if (manifest === null) return null;
        if (options?.onlyIf?.etagDoesNotMatch === manifest) return { key, etag: manifest };
        return { key, etag: manifest, text: async () => manifest };
      }
      if (!key.startsWith('r2-')) return null;
      const part = options?.range ? bytes.slice(options.range.offset, options.range.offset + options.range.length) : bytes;
      return { key, size: bytes.length, body: new Response(part).body };
    },
  } as unknown as R2Bucket;
}

export interface RoomsEnvOptions {
  enabled?: boolean;
  manifest?: string | null;
}

/** A room env for one signed-in email (the localhost dev identity), recording every asset the gate serves. */
export function roomsEnv(db: D1Database, email: string, options: RoomsEnvOptions = {}): { env: Env; assets: string[] } {
  const assets: string[] = [];
  const env = {
    DB: db,
    FILES: fakeFiles(options.manifest === undefined ? MARKS_MANIFEST : options.manifest),
    ASSETS: {
      fetch: async (request: Request) => {
        assets.push(new URL(request.url).pathname);
        return new Response('<html>APP-SHELL</html>', { headers: { 'Content-Type': 'text/html' } });
      },
    },
    TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    LEGALLAS_MODEL: 'x',
    DAILY_QUESTION_CAP: '100',
    ALERTS_ENABLED: '0',
    ALLOW_DEV_IDENTITY: '1',
    DEV_IDENTITY_EMAIL: email,
    ...(options.enabled === false ? {} : { ROOMS_ENABLED: '1' }),
  } as unknown as Env;
  return { env, assets };
}

/** Headers a same-origin write from the room's own page carries. */
export const SAME_ORIGIN = { Origin: HOST, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' };
