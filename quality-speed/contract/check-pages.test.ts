// SPDX-License-Identifier: Apache-2.0
// The folder check, on temporary folders holding invented metrics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPages } from './check-pages.ts';
import { PAGES, REPO } from './pages.ts';

const example = (name: string) => fileURLToPath(new URL(`./example/${name}`, import.meta.url));

function withPages(run: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'qs-pages-'));
  try {
    for (const page of PAGES) mkdirSync(path.join(dir, page));
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the real pages folder passes', () => {
  assert.deepEqual(checkPages(fileURLToPath(new URL('../pages', import.meta.url))), []);
});

test('an empty folder has no list yet, which is allowed', () => {
  withPages((dir) => assert.deepEqual(checkPages(dir), []));
});

test('a page with the three example files passes', () => {
  withPages((dir) => {
    copyFileSync(example('manifest.json'), path.join(dir, 'code', 'manifest.json'));
    copyFileSync(example('ideal.json'), path.join(dir, 'code', 'ideal.json'));
    writeFileSync(path.join(dir, 'code', 'metrics.json'), readFileSync(example('metrics.json'), 'utf8').replaceAll('Colorado-Startups/legallas/', `Colorado-Startups/${REPO}/`));
    assert.deepEqual(checkPages(dir), []);
  });
});

test('a signed-off list needs an ideal.json, and a draft does not', () => {
  withPages((dir) => {
    copyFileSync(example('manifest.json'), path.join(dir, 'code', 'manifest.json'));
    assert.deepEqual(checkPages(dir), ['pages/code: a signed-off manifest.json needs an ideal.json']);
    const { signoff_comment: _signoff, ...draft } = JSON.parse(readFileSync(example('manifest.json'), 'utf8'));
    writeFileSync(path.join(dir, 'code', 'manifest.json'), JSON.stringify(draft));
    assert.deepEqual(checkPages(dir), []);
  });
});

test('a page with no folder is allowed, so a new page is one line in pages.ts', () => {
  withPages((dir) => {
    rmSync(path.join(dir, 'issues'), { recursive: true });
    assert.deepEqual(checkPages(dir), []);
  });
  assert.deepEqual(checkPages(path.join(tmpdir(), 'qs-pages-not-here')), []);
});

test('an unknown folder and a file on the wrong page fail', () => {
  withPages((dir) => {
    mkdirSync(path.join(dir, 'blog'));
    copyFileSync(example('manifest.json'), path.join(dir, 'agents', 'manifest.json'));
    const errors = checkPages(dir).join('\n');
    assert.match(errors, /closed list of pages/);
    assert.match(errors, /pages\/agents\/manifest\.json: manifest: page does not match/);
  });
});

test('a symlink anywhere under pages, or a loose file, fails', () => {
  withPages((dir) => {
    symlinkSync(tmpdir(), path.join(dir, 'made-up'));
    assert.match(checkPages(dir).join(), /a symlink is not allowed/);
  });
  withPages((dir) => {
    symlinkSync(example('manifest.json'), path.join(dir, 'code', 'manifest.json'));
    assert.match(checkPages(dir).join(), /a symlink is not allowed/);
  });
  withPages((dir) => {
    mkdirSync(path.join(dir, 'code', 'a', 'b'), { recursive: true });
    symlinkSync(tmpdir(), path.join(dir, 'code', 'a', 'b', 'deep'));
    assert.match(checkPages(dir).join(), /a symlink is not allowed/);
  });
  withPages((dir) => {
    writeFileSync(path.join(dir, 'notes.txt'), 'x');
    assert.match(checkPages(dir).join(), /only folders belong here/);
  });
  withPages((dir) => {
    writeFileSync(path.join(dir, '.DS_Store'), 'x');
    assert.deepEqual(checkPages(dir), []);
  });
});

test('pages itself may not be a symlink, even a dangling one', () => {
  withPages((dir) => {
    const link = path.join(dir, 'pages-link');
    symlinkSync(path.join(dir, 'code'), link);
    assert.match(checkPages(link).join(), /a symlink is not allowed/);
    const dangling = path.join(dir, 'dangling-link');
    symlinkSync(path.join(dir, 'not-here'), dangling);
    assert.match(checkPages(dangling).join(), /a symlink is not allowed/);
  });
});

test('metrics with no manifest, broken JSON and a bad record all fail', () => {
  withPages((dir) => {
    writeFileSync(path.join(dir, 'sec', 'manifest.json'), JSON.stringify({ page: 'sec', metrics: [], changes: [] }));
    writeFileSync(path.join(dir, 'sec', 'metrics.json'), 'not json');
    assert.match(checkPages(dir).join(), /pages\/sec\/metrics\.json: metrics: must be a list/);
    writeFileSync(path.join(dir, 'issues', 'manifest.json'), '{');
    writeFileSync(path.join(dir, 'settings', 'manifest.json'), JSON.stringify({ page: 'settings', signoff_comment: 9, metrics: [], changes: [] }));
    copyFileSync(example('manifest.json'), path.join(dir, 'code', 'manifest.json'));
    writeFileSync(path.join(dir, 'code', 'metrics.json'), JSON.stringify([{ id: 'unlisted' }]));
    writeFileSync(path.join(dir, 'agents', 'metrics.json'), '[]');
    const errors = checkPages(dir).join('\n');
    assert.match(errors, /pages\/agents: metrics\.json needs a manifest\.json/);
    assert.match(errors, /pages\/issues\/manifest\.json: not valid JSON/);
    assert.match(errors, /pages\/settings\/manifest\.json: metrics: needs at least one quality/);
    assert.match(errors, /pages\/code\/metrics\.json: records\[0\]/);
  });
});

test('an ideal.json is checked when present: the example passes, a bad one and broken JSON fail', () => {
  withPages((dir) => {
    copyFileSync(example('ideal.json'), path.join(dir, 'code', 'ideal.json'));
    assert.deepEqual(checkPages(dir), []);
    writeFileSync(path.join(dir, 'sec', 'ideal.json'), JSON.stringify({ ideal: 'x', sources: [] }));
    writeFileSync(path.join(dir, 'issues', 'ideal.json'), '{');
    const errors = checkPages(dir).join('\n');
    assert.match(errors, /pages\/sec\/ideal\.json: ideal: sources must list 1 to 5 documents/);
    assert.match(errors, /pages\/issues\/ideal\.json: not valid JSON/);
  });
});
