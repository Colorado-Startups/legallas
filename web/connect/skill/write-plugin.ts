// SPDX-License-Identifier: Apache-2.0
// Writes the Claude plugin (mcp/claude-plugin.ts) unzipped into a folder, so CI can run `claude plugin validate` on
// exactly what GET /connect/legallas-claude-plugin.zip serves, with the default names:
//   node connect/skill/write-plugin.ts <folder>
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pluginEntries } from '../../mcp/claude-plugin.ts';
import { roomNames } from '../../worker/room-names.ts';

const out = process.argv[2];
if (!out) {
  console.error('Pass the folder to write the plugin into.');
  process.exitCode = 2;
} else {
  for (const entry of pluginEntries(roomNames())) {
    const path = join(out, entry.name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, entry.data);
  }
  console.log(`Wrote the Claude plugin to ${out}.`);
}
