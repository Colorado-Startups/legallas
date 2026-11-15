// SPDX-License-Identifier: Apache-2.0
// The company room's folder list never stays on its Loading line when its chunk fails to load (#219).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootCompanyHome, FOLDERS_FAILED } from './company-home-boot.ts';

function page(shape?: string) {
  const status = { textContent: 'Loading the folders.' as string | null };
  const doc = {
    documentElement: { dataset: shape ? { roomShape: shape } : {} },
    querySelector: (selectors: string) => (selectors === '[data-company-status]' ? status : null),
  };
  return { doc, status };
}

test('a chunk that fails to load shows the error line, not Loading', async () => {
  const { doc, status } = page('company');
  await bootCompanyHome(doc, () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
  assert.equal(status.textContent, FOLDERS_FAILED);
});

test('a chunk that loads leaves the line to the folder list', async () => {
  const { doc, status } = page('company');
  let loads = 0;
  await bootCompanyHome(doc, async () => void (loads += 1));
  assert.equal(loads, 1);
  assert.equal(status.textContent, 'Loading the folders.');
});

test('a room with a matter never loads the folder list', async () => {
  for (const shape of [undefined, 'case']) {
    const { doc } = page(shape);
    let loads = 0;
    await bootCompanyHome(doc, async () => void (loads += 1));
    assert.equal(loads, 0, String(shape));
  }
});

test('a page without the status line fails quietly', async () => {
  const doc = { documentElement: { dataset: { roomShape: 'company' } }, querySelector: () => null };
  await bootCompanyHome(doc, () => Promise.reject(new Error('gone')));
});

test('CompanyHome.astro loads the folder list through the boot, never a bare import', async () => {
  const { readFileSync } = await import('node:fs');
  const astro = readFileSync(new URL('../components/CompanyHome.astro', import.meta.url), 'utf8');
  assert.match(astro, /bootCompanyHome\(document, \(\) => import\('\.\.\/scripts\/company-home\.ts'\)\)/);
  assert.doesNotMatch(astro, /void import\(/);
});
