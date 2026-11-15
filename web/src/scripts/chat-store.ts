// SPDX-License-Identifier: Apache-2.0
// Quick Ask history, kept ONLY in this browser (IndexedDB), never on the server. The record carries the
// verified email from /api/me; if a different person signs in on this browser profile, the old history is
// wiped before anything is shown. "Clear history" and Sign out delete the whole database.
// Research threads are not kept here: they are saved in the room on Cloudflare, in the member's own research
// agent, deletable, and deleted 90 days after their last question (plan D12; research-panel.ts). Sign out does not
// delete them.
// Every call fails soft: with storage blocked (private windows) the chat still works, it just forgets.
import type { ValidCitation, ValidLaw } from './sanitize.ts';

/** The room's stored name as a literal (worker/stored-name.ts): the minified key stays one, and a stored key can be read. */
declare const ROOM_STORED_NAME: string | undefined;

/** One question and its answer in the chat history, with its citations and outcome. */
export interface Turn {
  question: string;
  answer: string;
  citations: ValidCitation[];
  /** Validated law citations (law library on); absent on older turns and when it is off. */
  law?: ValidLaw[];
  dontKnow: boolean;
  /** The model stopped at max_tokens, so the answer ends mid-thought; absent on older turns and finished ones. */
  truncated?: boolean;
  failed: boolean;
  at: string;
}

interface Saved {
  email: string;
  turns: Turn[];
}

/** The IndexedDB database name for this room's chat history. */
export const DB_NAME = `${typeof ROOM_STORED_NAME === 'string' ? ROOM_STORED_NAME : 'legallas'}-chat`;
const STORE = 'history';
const KEY = 'current';
/** The most turns kept in the saved chat history. */
export const MAX_TURNS = 100;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await request(work(db.transaction(STORE, mode).objectStore(STORE)));
  } finally {
    db.close();
  }
}

/** Deletes every saved conversation on this browser profile. Resolves even if storage is unavailable. */
export async function clearHistory(): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      // Another tab holds it open: the delete completes when that tab closes the connection.
      req.onblocked = () => resolve();
    });
  } catch {
    // Storage blocked: there is nothing to clear.
  }
}

/** The saved turns for `email`. A record for anyone else is wiped first and nothing is returned. */
export async function loadHistory(email: string): Promise<Turn[]> {
  try {
    const saved = (await withStore('readonly', (store) => store.get(KEY))) as Saved | undefined;
    if (!saved) return [];
    if (saved.email !== email || !Array.isArray(saved.turns)) {
      await clearHistory();
      return [];
    }
    return saved.turns.slice(-MAX_TURNS);
  } catch {
    return [];
  }
}

/** Saves the latest turns, up to the limit, under the member's email. */
export async function saveHistory(email: string, turns: readonly Turn[]): Promise<void> {
  try {
    const record: Saved = { email, turns: turns.slice(-MAX_TURNS) };
    await withStore('readwrite', (store) => store.put(record, KEY));
  } catch {
    // Storage blocked or full: keep the conversation on screen only.
  }
}
