// SPDX-License-Identifier: Apache-2.0
// The binder manifest: what is accepted, what is refused, and how it joins to live documents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ManifestError, parseManifest, resolveBinder } from './visuals.ts';

const manifest = (over: Record<string, unknown> = {}) => ({
  version: 1,
  sections: [
    { slug: 'start', label: 'Start', title: 'Overview', accent: 'gold', icon: 'compass' },
    { slug: 'tab-1', label: 'Tab 1', title: 'Chronology', summary: 'In order' },
  ],
  visuals: [
    { slug: 'start', section: 'start', file: 'start.html', title: 'Start here', overview: true },
    { slug: 't1-built', section: 'tab-1', file: 't1-built.html', title: 'Built together' },
    { slug: 't1', section: 'tab-1', file: 't1.html', title: 'Chronology', overview: true },
  ],
  ...over,
});

test('a valid manifest parses with defaults filled in and unknown fields dropped', () => {
  const parsed = parseManifest({ ...manifest(), extra: 'ignored' });
  assert.equal(parsed.sections[1]!.accent, 'forest');
  assert.equal(parsed.sections[1]!.icon, 'scroll');
  assert.equal(parsed.sections[0]!.summary, null);
  assert.equal(parsed.visuals[1]!.overview, false);
  assert.equal('extra' in parsed, false);
});

test('the manifest is refused when it could inject markup, CSS or paths', () => {
  const bad: [string, Record<string, unknown>][] = [
    ['wrong version', { version: 2 }],
    ['unknown accent', { sections: [{ slug: 's', label: 'L', title: 'T', accent: 'red;}' }], visuals: [] }],
    ['unknown icon', { sections: [{ slug: 's', label: 'L', title: 'T', icon: 'x" onload="' }], visuals: [] }],
    ['slug with markup', { sections: [{ slug: '<b>', label: 'L', title: 'T' }], visuals: [] }],
    ['file climbing out', { visuals: [{ slug: 'a', section: 'start', file: '../secret.html', title: 'T' }] }],
    ['file in a subfolder', { visuals: [{ slug: 'a', section: 'start', file: 'x/a.html', title: 'T' }] }],
    ['file that is not html', { visuals: [{ slug: 'a', section: 'start', file: 'a.pdf', title: 'T' }] }],
    ['unknown section', { visuals: [{ slug: 'a', section: 'nope', file: 'a.html', title: 'T' }] }],
    ['empty title', { visuals: [{ slug: 'a', section: 'start', file: 'a.html', title: '  ' }] }],
    ['duplicate visual', { visuals: [manifest().visuals[0], manifest().visuals[0]] }],
  ];
  for (const [name, over] of bad) assert.throws(() => parseManifest(manifest(over)), ManifestError, name);
  assert.throws(() => parseManifest(null), ManifestError);
  assert.throws(() => parseManifest([]), ManifestError);
});

test('the binder keeps only visuals that are live, overview first, and drops empty sections', () => {
  const docs = [
    { id: 'id-start', path: 'Visuals/start.html' },
    { id: 'id-t1', path: 'Visuals/t1.html' },
    { id: 'id-built', path: 'Visuals/t1-built.html' },
    { id: 'id-other', path: 'Elsewhere/start.html' },
  ];
  const binder = resolveBinder(parseManifest(manifest()), 'Visuals', docs);
  assert.deepEqual(binder.sections.map((s) => [s.slug, s.visuals]), [
    ['start', ['start']],
    ['tab-1', ['t1', 't1-built']],
  ]);
  assert.deepEqual(binder.visuals.map((v) => v.id), ['id-start', 'id-t1', 'id-built']);

  const partial = resolveBinder(parseManifest(manifest()), 'Visuals', [docs[1]!]);
  assert.deepEqual(partial.sections.map((s) => s.slug), ['tab-1']);
  assert.deepEqual(partial.visuals.map((v) => v.slug), ['t1']);
});

test('a manifest at the mirror root joins on bare file names', () => {
  const binder = resolveBinder(parseManifest(manifest()), '', [{ id: 'x', path: 'start.html' }]);
  assert.deepEqual(binder.visuals.map((v) => v.id), ['x']);
});
