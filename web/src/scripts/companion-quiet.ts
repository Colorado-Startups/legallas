// SPDX-License-Identifier: Apache-2.0

/** The room's stored name as a literal (worker/stored-name.ts): the minified key stays one, and a stored key can be read. */
declare const ROOM_STORED_NAME: string | undefined;
// The companion's Quiet choice, shared by the Ask page (chat-companion.ts) and the page guide (guide.ts) under one
// key, so Quiet set in one place holds in the other. Storage can be blocked; Quiet then starts off and a choice
// lasts for the page only. No other imports, so the guide's eager script stays small.

/** The local-storage key that holds whether the companion is quiet. */
export const QUIET_KEY = `${typeof ROOM_STORED_NAME === 'string' ? ROOM_STORED_NAME : 'legallas'}-companion-quiet`;

/** Whether the reader has turned the companion quiet, read from local storage. */
export function readQuiet(): boolean {
  try {
    return localStorage.getItem(QUIET_KEY) === '1';
  } catch {
    return false;
  }
}

/** Saves in local storage whether the companion is quiet. */
export function writeQuiet(on: boolean): void {
  try {
    localStorage.setItem(QUIET_KEY, on ? '1' : '0');
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}
