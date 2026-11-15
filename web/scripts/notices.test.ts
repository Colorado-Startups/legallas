// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildNotices, packageDir } from './notices.ts';

test('packageDir finds the package of a module path, a query or a virtual helper, and skips our own code', () => {
  assert.equal(packageDir('/w/node_modules/a/node_modules/@s/b/dist/x.js?url', '/w'), '/w/node_modules/a/node_modules/@s/b');
  assert.equal(packageDir('node_modules/jose/dist/index.js', '/w'), '/w/node_modules/jose');
  assert.equal(packageDir('\0rolldown/runtime.js', '/w'), '/w/node_modules/rolldown');
  assert.equal(packageDir('src/scripts/doc-pdf.ts', '/w'), null);
});

test('buildNotices carries every package and copied licence, and fails on one whose only licence is empty or code', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'notices-'));
  try {
    const pkg = (dir: string, name: string, licence?: string) => {
      mkdirSync(path.join(root, dir), { recursive: true });
      writeFileSync(path.join(root, dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', license: 'MIT' }));
      if (licence) writeFileSync(path.join(root, dir, 'LICENSE'), licence);
    };
    pkg('node_modules/a', 'a', 'A licence');
    pkg('node_modules/@s/b', '@s/b', '  \n');
    writeFileSync(path.join(root, 'node_modules/@s/b/notice.js'), 'export const notice = 1;');
    mkdirSync(path.join(root, 'dist', 'pdfjs'), { recursive: true });
    writeFileSync(path.join(root, 'dist', 'pdfjs', 'LICENSE_FOXIT'), 'Foxit licence');
    const meta = path.join(root, 'meta.json');
    writeFileSync(meta, JSON.stringify({ inputs: { 'node_modules/a/i.js': {}, 'node_modules/@s/b/i.js?url': {}, 'src/x.ts': {} } }));
    const extras = path.join(root, 'extras');
    mkdirSync(extras);
    const run = () => buildNotices(path.join(root, 'dist'), [meta], root, extras);
    assert.throws(run, /no licence text for @s\/b@1\.0\.0/);
    writeFileSync(path.join(extras, '@s__b.txt'), 'Reviewed b licence');
    const text = run();
    for (const part of ['@s/b 1.0.0 (MIT)', 'Reviewed b licence', 'a 1.0.0 (MIT)', 'A licence', 'pdfjs/LICENSE_FOXIT', 'Foxit licence']) assert.ok(text.includes(part), part);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
