// SPDX-License-Identifier: Apache-2.0
// Loaded with --import into every test process of one run (collect.ts). Two jobs:
// - MUTANT_FILE set: serves MUTANT_SOURCE in its place from memory, so mutants run side by side and no file in the
//   checkout changes. An import with a query (`?fresh`) gets the mutant too.
// - MUTANT_SEEN set: appends each project file the run loads to that file, so a mutant runs only the tests that load it.
import { appendFileSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const file = process.env.MUTANT_FILE;
const seen = process.env.MUTANT_SEEN;
const target = file ? pathToFileURL(file).href : null;
const source = file ? readFileSync(process.env.MUTANT_SOURCE ?? '', 'utf8') : null;

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    const bare = url.split(/[?#]/)[0]!;
    if (seen && bare.startsWith('file:') && !bare.includes('/node_modules/')) appendFileSync(seen, `${bare}\n`);
    return bare === target && source !== null ? { ...loaded, source } : loaded;
  },
});
