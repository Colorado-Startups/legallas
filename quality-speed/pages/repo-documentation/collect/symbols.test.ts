// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repo } from './fixture.ts';
import { symbolRows } from './symbols.ts';

test('TypeScript exports count when a /** */ comment sits right above them; tests and fixtures are left out', () => {
  const r = repo({
    'web/worker/a.ts': [
      '/** Documents the first one. */',
      'export function one() {}',
      '/** Short. */',
      'export function short() {}',
      '// A line comment is not a doc comment.',
      'export const two = 2;',
      '/*',
      ' * A block comment is not one either.',
      ' */',
      'export class Three {}',
      '/**',
      ' * A multi-line doc comment.',
      ' */',
      'export interface Four {}',
      'function internal() {}',
    ].join('\n'),
    'web/worker/a.test.ts': 'export const ignored = 1;\n',
    'web/fixtures/f.ts': 'export const ignored = 1;\n',
  });
  try {
    assert.deepEqual(
      symbolRows(r.corpus()).map((s) => [s.name, s.documented]),
      [['one', true], ['short', false], ['two', false], ['Three', false], ['Four', true]],
    );
  } finally {
    r.done();
  }
});

test('Swift: public declarations, @Model classes and views need ///; attributes between are skipped', () => {
  const r = repo({
    'Sources/Core/A.swift': [
      '/// Runs the first one.',
      '@MainActor',
      'public func one() {}',
      'public struct Two {}',
      'extension Two {',
      '    public init(x: Int) {}',
      '}',
      '/// A matter in the room.',
      '@Model',
      'final class Matter {}',
    ].join('\n'),
    'LegallasApp/Legallas/V.swift': 'struct HomeView: View {}\n',
  });
  try {
    assert.deepEqual(
      symbolRows(r.corpus()).map((s) => [s.name, s.documented]),
      [['HomeView', false], ['one', true], ['Two', false], ['init', false], ['Matter', true]],
    );
  } finally {
    r.done();
  }
});
