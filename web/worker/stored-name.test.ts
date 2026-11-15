// SPDX-License-Identifier: Apache-2.0
// The stored name reaches every constant built from it, under the default and under a room's own. What a built Worker
// sees is what a run sees here with the global set: `define` writes a literal where the code reads ROOM_STORED_NAME.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_STORED_NAME, parseStoredName, STORED_NAME } from './stored-name.ts';

/** The constants as a Node process with `global` set sees them. */
function constantsUnder(global: string | undefined): { stored: string; manifest: string; sql: string; hidden: Record<string, boolean> } {
  const preload = global === undefined ? [] : ['--import', `data:text/javascript,globalThis.ROOM_STORED_NAME=${JSON.stringify(global)}`];
  const body = `
    const { STORED_NAME } = await import(${JSON.stringify(new URL('./stored-name.ts', import.meta.url).href)});
    const { MANIFEST_NAME } = await import(${JSON.stringify(new URL('./visuals.ts', import.meta.url).href)});
    const { NOT_HIDDEN_SQL, isHiddenName } = await import(${JSON.stringify(new URL('./files-catalog.ts', import.meta.url).href)});
    const names = ['acme-visuals.json', 'legallas-visuals.json', 'other.json', 'acme-visuals.json.pdf', 'my-acme-x.json', 'Acme-visuals.json'];
    console.log(JSON.stringify({ stored: STORED_NAME, manifest: MANIFEST_NAME, sql: NOT_HIDDEN_SQL, hidden: Object.fromEntries(names.map((n) => [n, isHiddenName(n)])) }));`;
  return JSON.parse(execFileSync(process.execPath, [...preload, '--input-type=module', '--eval', body], { encoding: 'utf8' }));
}

/** The names a query with `sql` keeps out of a table holding `names`. */
function hiddenBySql(sql: string, names: string[]): string[] {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE documents (name TEXT)');
  for (const name of names) db.prepare('INSERT INTO documents VALUES (?)').run(name);
  const kept = new Set((db.prepare(`SELECT name FROM documents WHERE ${sql}`).all() as { name: string }[]).map((row) => row.name));
  db.close();
  return names.filter((name) => !kept.has(name));
}

test('with nothing set, every constant carries the default', () => {
  assert.equal(STORED_NAME, DEFAULT_STORED_NAME);
  const seen = constantsUnder(undefined);
  assert.equal(seen.stored, 'legallas');
  assert.equal(seen.manifest, 'legallas-visuals.json');
  assert.equal(seen.sql, "name NOT GLOB 'legallas-*.json'");
  assert.equal(seen.hidden['legallas-visuals.json'], true);
  assert.equal(seen.hidden['acme-visuals.json'], false);
});

test('a room\'s own name reaches the manifest, the hidden pattern and the SQL', () => {
  const seen = constantsUnder('acme');
  assert.equal(seen.stored, 'acme');
  assert.equal(seen.manifest, 'acme-visuals.json');
  assert.equal(seen.sql, "name NOT GLOB 'acme-*.json'");
  assert.deepEqual(seen.hidden, {
    'acme-visuals.json': true,
    'legallas-visuals.json': false,
    'other.json': false,
    'acme-visuals.json.pdf': false,
    'my-acme-x.json': false,
    'Acme-visuals.json': false,
  });
});

test('the SQL hides what the pattern hides, under either name, so no query can show the manifest', () => {
  const names = ['acme-visuals.json', 'legallas-visuals.json', 'other.json', 'acme-visuals.json.pdf', 'my-acme-x.json', 'Acme-visuals.json'];
  for (const global of [undefined, 'acme']) {
    const seen = constantsUnder(global);
    assert.deepEqual(hiddenBySql(seen.sql, names), names.filter((name) => seen.hidden[name] ?? /^legallas-.*\.json$/.test(name)));
    assert.deepEqual(hiddenBySql(seen.sql, [seen.manifest]), [seen.manifest]);
  }
});

test('a name that would overwrite a field of the bridge message is refused', () => {
  for (const field of ['type', 'slug', 'url', 'ref', 'key']) assert.throws(() => parseStoredName(field), /a field of the bridge message/, field);
  assert.equal(parseStoredName('types'), 'types');
});

test('a name that could break out of the SQL or the pattern stops the Worker at load', () => {
  assert.throws(() => parseStoredName("x' OR 1=1 --"), /storedName must be/);
  assert.throws(
    () => execFileSync(process.execPath, ['--import', 'data:text/javascript,globalThis.ROOM_STORED_NAME="Bad*Name"', '--input-type=module', '--eval', `await import(${JSON.stringify(new URL('./stored-name.ts', import.meta.url).href)})`], { stdio: 'pipe' }),
    /storedName must be/,
  );
});

test('no code writes the name itself where it means the stored name', () => {
  const stored = /legallas-visuals|legallas-\*|legallas-\.\*|#legallas|m\.legallas|\.legallas\s*===|legallas-bridge|\blegallas: 1/;
  const web = join(import.meta.dirname, '..');
  const skip = (file: string) => /\.test(-data)?\.ts$|fixtures?[./]|\/fixtures\//.test(file) || file === 'worker/stored-name.ts';
  const found: string[] = [];
  for (const folder of ['worker', 'mcp', 'scripts', 'src', 'integrations']) {
    for (const entry of readdirSync(join(web, folder), { recursive: true, encoding: 'utf8' })) {
      const file = `${folder}/${entry}`;
      if (!/\.(ts|mjs|astro)$/.test(file) || skip(file)) continue;
      if (stored.test(readFileSync(join(web, file), 'utf8'))) found.push(file);
    }
  }
  assert.deepEqual(found, []);
});
