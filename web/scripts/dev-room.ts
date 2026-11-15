// SPDX-License-Identifier: Apache-2.0
// A fixture room's own settings, from the examples, for .github/workflows/fixture-room.yml:
//
//   node scripts/dev-room.ts --fixture case|company
//
// case: wrangler.jsonc and wrangler.mcp.jsonc are the examples. company: the company room also gets room.config.json
// (its name, entity type and formation date, all invented), the checklist turned on, and both Workers given the room
// config's defines, as a room's own files give them (worker/config.test.ts). Refuses to replace a file that exists.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { roomDefines } from './config.ts';
import { parseWranglerJsonc } from '../worker/wrangler-config.ts';
import { COMPANY_NAME } from './dev-fixture-company.ts';

const WEB_DIR = path.resolve(import.meta.dirname, '..');
const USAGE = 'usage: node scripts/dev-room.ts --fixture case|company';

/** The company fixture's room config. A Delaware corporation formed just before its first documents (2011-06-02). */
export const COMPANY_ROOM_CONFIG = { companyName: COMPANY_NAME, entityType: 'delaware-c-corporation', formationDate: '2011-06-01' } as const;

export interface RoomFiles {
  'room.config.json'?: string;
  'wrangler.jsonc': string;
  'wrangler.mcp.jsonc': string;
}

/** The files a fixture room starts from. Pure: `read` gives an example's text. */
export function fixtureRoomFiles(fixture: 'case' | 'company', read: (name: string) => string): RoomFiles {
  const web = read('wrangler.example.jsonc');
  const mcp = read('wrangler.mcp.example.jsonc');
  if (fixture === 'case') return { 'wrangler.jsonc': web, 'wrangler.mcp.jsonc': mcp };
  const define = roomDefines(COMPANY_ROOM_CONFIG);
  const room = parseWranglerJsonc(web);
  room.vars = { ...room.vars, CHECKLIST_ENABLED: '1' };
  room.define = { ...room.define, ...define };
  const server = parseWranglerJsonc(mcp);
  server.define = { ...server.define, ...define };
  const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  return { 'room.config.json': text(COMPANY_ROOM_CONFIG), 'wrangler.jsonc': text(room), 'wrangler.mcp.jsonc': text(server) };
}

function main(args: readonly string[]): void {
  const fixture = args.length === 2 && args[0] === '--fixture' && (args[1] === 'case' || args[1] === 'company') ? args[1] : null;
  if (!fixture) throw new Error(USAGE);
  const files = fixtureRoomFiles(fixture, (name) => readFileSync(path.join(WEB_DIR, name), 'utf8'));
  for (const name of Object.keys(files)) if (existsSync(path.join(WEB_DIR, name))) throw new Error(`${name} exists: this writes a fixture room's files, never over a room's own`);
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(WEB_DIR, name), text);
  process.stdout.write(`Fixture room (${fixture}): ${Object.keys(files).join(', ')}\n`);
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
