// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { swiftShape } from './shape-swift.ts';

test('functions span their code lines; comments, blank lines and braces in strings do not count', () => {
  const src = [
    'struct Ledger {', //  1
    '  /* a block comment', //  2
    '     /* nested */ still comment */', //  3
    '  func total(of items: [Int]) -> Int {', //  4
    '    // comment only', //  5
    '', //  6
    '    let s = "{ not a brace"', //  7
    '    return items.reduce(0, +)', //  8
    '  }', //  9
    '  init() {}', // 10
    '}', // 11
  ].join('\n');
  const shape = swiftShape(src);
  assert.deepEqual(
    shape.functions.map((f) => [f.name, f.line, f.codeLines]),
    [['total', 4, 4], ['init', 10, 1]],
  );
  assert.equal(shape.codeLines, 7);
});

test('a computed property is a body; a stored property and a protocol requirement are not', () => {
  const src = [
    'protocol Named { func name() -> String }',
    'struct View {',
    '  var count: Int = 0',
    '  var body: String {',
    '    "x"',
    '  }',
    '}',
  ].join('\n');
  assert.deepEqual(swiftShape(src).functions.map((f) => [f.name, f.codeLines]), [['body', 3]]);
});

test('multi-line, raw and interpolated strings never unbalance braces', () => {
  const src = ['func a() {', '  let t = """', '  }}} {', '  """', '  let r = #"}"#', '  let i = "\\(x.map { $0 })"', '}', 'func b() {', '}'].join('\n');
  assert.deepEqual(swiftShape(src).functions.map((f) => [f.name, f.line]), [['a', 1], ['b', 8]]);
});

test('force unwraps, try! and as! count unless marked // safe:', () => {
  const src = [
    'let a = value!',
    'let b = try! load()',
    'let c = thing as! Int',
    'let d = value! // safe: checked above',
    '// safe: set in init',
    'let e = other!',
    'if a != b && !flag { }',
  ].join('\n');
  assert.equal(swiftShape(src).unmarkedForces, 3);
});
