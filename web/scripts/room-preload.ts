// SPDX-License-Identifier: Apache-2.0
// Gives a script the settings a room's build fixes (worker/room-settings.ts, worker/stored-name.ts). `npm run` starts each
// script with `node --import` on this file, so the globals are set before anything reads them. Only node: built-ins here: a
// module that imported either file first would keep the defaults for the whole run.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const web = path.resolve(import.meta.dirname, '..');

// scripts/config.ts CONFIG_NAMES, in the same order (scripts/config.test.ts checks).
for (const name of ['room.config.json', 'legallas.config.json']) {
  let text: string;
  try {
    text = readFileSync(path.join(web, name), 'utf8');
  } catch {
    continue;
  }
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // JSON.parse quotes the input around the error, and the config holds local paths: never pass it on.
    throw new Error(`${name} is not valid JSON`);
  }
  // The rule of scripts/config.ts roomGlobalName (scripts/config.test.ts checks): `mcpHost` is ROOM_MCP_HOST. A key nothing
  // reads is a global nothing reads.
  for (const [key, value] of Object.entries(config)) {
    (globalThis as Record<string, unknown>)[`ROOM_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`] = value;
  }
  break;
}
