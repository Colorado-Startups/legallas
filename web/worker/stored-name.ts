// SPDX-License-Identifier: Apache-2.0
// The name a room's stored data carries: the link prefixes and bridge message inside its exported visuals, the binder
// manifest's file name, and the room data files the catalog hides. What is stored keeps the name it was written with,
// so a room that already holds data under another name sets that name (`storedName` in its room config) and nothing
// stored has to change, and an older build can still read it.
//
// It is fixed when the code is built, so each use stays a constant. astro.config.mjs defines ROOM_STORED_NAME for the
// pages from the room config, a room's Wrangler configs define it for the Workers (`define`), and `npm run` starts each
// script with scripts/room-preload.ts, which sets the global. `node --test` sets nothing, so tests run on the
// default. worker/config.test.ts holds the Wrangler configs to the room config, and scripts/config.ts stops a script
// that started without the preload.

declare const ROOM_STORED_NAME: string | undefined;

export const DEFAULT_STORED_NAME = 'legallas';

/** It lands in SQL, a CSS selector, a script and file names unquoted, so lower-case letters and digits only. */
const STORED_NAME_PATTERN = /^[a-z][a-z0-9]{0,15}$/;

/** The fields of a visual's bridge message (worker/visualprep.ts). The name is set beside them, so it can't be one. */
const BRIDGE_FIELDS: readonly string[] = ['type', 'slug', 'url', 'ref', 'key'];

/** The name from a config value: the default when unset, and an error for anything else, since a wrong one hides data. */
export function parseStoredName(value: unknown): string {
  if (value === undefined || value === null) return DEFAULT_STORED_NAME;
  if (typeof value !== 'string' || !STORED_NAME_PATTERN.test(value)) {
    throw new Error('room config: storedName must be a lower-case letter, then up to 15 lower-case letters or digits');
  }
  if (BRIDGE_FIELDS.includes(value)) throw new Error(`room config: storedName can't be ${value}, a field of the bridge message`);
  return value;
}

export const STORED_NAME = parseStoredName(typeof ROOM_STORED_NAME === 'undefined' ? undefined : ROOM_STORED_NAME);
