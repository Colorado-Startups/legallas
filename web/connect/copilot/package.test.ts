// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { readPackage } from './build.ts';
import { PACKAGE_FILES, buildPackage, bundledPackage, resolvePlaceholders, zipProblems } from './package.ts';
import { REFERENCE_PLACEHOLDER } from './validate.ts';
import { GENERATED_FILE, renderPackageData } from './package-data.ts';
import { readZipStore, zipStore } from '../../mcp/zip.ts';

const REFERENCE_ID = 'T0FBdXRoQ29uZmlnSWQ';
const WEB = resolve(import.meta.dirname, '../..');

test('package-data.generated.ts matches appPackage/ (run node connect/copilot/package-data.ts)', () => {
  assert.equal(readFileSync(GENERATED_FILE, 'utf8'), renderPackageData(readPackage()));
});

test('the bundled package holds the same files and bytes as appPackage/', () => {
  const bundled = bundledPackage();
  const source = readPackage();
  assert.deepEqual([...bundled.keys()], [...source.keys()]);
  for (const [name, bytes] of source) assert.deepEqual(Buffer.from(bundled.get(name)!), Buffer.from(bytes), name);
  assert.deepEqual(buildPackage(bundled, REFERENCE_ID), buildPackage(source, REFERENCE_ID));
});

test('readZipStore reads back what zipStore writes', () => {
  const entries = [{ name: 'a.json', data: new TextEncoder().encode('{}') }, { name: 'b.png', data: new Uint8Array([1, 2, 3]) }];
  const read = readZipStore(zipStore(entries));
  assert.deepEqual(read.map((e) => [e.name, [...e.data]]), entries.map((e) => [e.name, [...e.data]]));
});

test('zipProblems passes a built package and names what is wrong with a bad one', () => {
  const zip = buildPackage(bundledPackage(), REFERENCE_ID);
  assert.deepEqual(zipProblems(zip), []);
  assert.match(zipProblems(new Uint8Array(40)).join('\n'), /^the ZIP: not a ZIP archive/);
  const damaged = Buffer.from(zip);
  damaged[60] = damaged[60]! ^ 0xff; // inside manifest.json's stored bytes
  assert.match(zipProblems(damaged).join('\n'), /manifest\.json: damaged \(CRC mismatch\)/);
  const entries = readZipStore(zip).filter((e) => e.name !== 'outline.png');
  assert.ok(zipProblems(zipStore(entries)).includes('outline.png: missing from the package'));
  const unresolved = readZipStore(buildPackage(bundledPackage(), REFERENCE_ID)).map((e) =>
    e.name === 'ai-plugin.json' ? { name: e.name, data: bundledPackage().get(e.name)! } : e,
  );
  assert.ok(zipProblems(zipStore(unresolved)).some((p) => p.startsWith('ai-plugin.json: has an unresolved')));
  assert.deepEqual(readZipStore(zip).map((e) => e.name), [...PACKAGE_FILES]);
});

test('a reference ID reaches the JSON as typed, whatever replacement patterns it holds', () => {
  const encoder = new TextEncoder();
  const id = "a$&b$'c$`d$$e";
  const files = new Map([['ai-plugin.json', encoder.encode(`{"id":"${REFERENCE_PLACEHOLDER}"}`)], ['color.png', new Uint8Array([1])]]);
  const out = resolvePlaceholders(files, id);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(out.get('ai-plugin.json')!)), { id });
  assert.deepEqual([...out.get('color.png')!], [1]);
});

/** Relative imports of a module and everything it imports, plus every bare specifier seen on the way. */
function importGraph(entry: string): { files: Set<string>; specifiers: Set<string> } {
  const files = new Set<string>();
  const specifiers = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const source = readFileSync(file, 'utf8');
    const found = [...source.matchAll(/^(?:import|export)\s[^;]*?from\s+'([^']+)'/gm), ...source.matchAll(/import\(\s*'([^']+)'\s*\)/g)];
    for (const spec of found.map((match) => match[1]!)) {
      if (spec.startsWith('.')) visit(join(dirname(file), spec));
      else specifiers.add(spec);
    }
  };
  visit(entry);
  return { files, specifiers };
}

test('the Worker route reaches no node:fs, node:zlib or other Node built-ins', () => {
  const { files, specifiers } = importGraph(join(WEB, 'mcp/copilot-package.ts'));
  assert.ok(files.has(join(WEB, 'connect/copilot/package-data.generated.ts')), [...files].join('\n'));
  assert.ok(files.has(join(WEB, 'connect/copilot/validate.ts')));
  assert.ok(!files.has(join(WEB, 'connect/copilot/png.ts')), 'png.ts imports node:zlib');
  assert.ok(!files.has(join(WEB, 'connect/copilot/build.ts')), 'build.ts imports node:fs');
  assert.deepEqual([...specifiers].filter((s) => s.startsWith('node:')), []);
});
