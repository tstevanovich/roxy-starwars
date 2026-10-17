import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// Exercise the packages actually used by Stylelint, including its transitive override.
const requireFromStylelint = createRequire(import.meta.resolve('stylelint'));
const micromatch = requireFromStylelint('micromatch');
const requireFromMicromatch = createRequire(requireFromStylelint.resolve('micromatch'));
const braces = requireFromMicromatch('braces');

test('the guarded dependency preserves stylesheet glob matching and expansion', () => {
  assert.deepEqual(
    micromatch(
      ['client/src/app.css', 'client/src/theme.scss', 'client/src/App.jsx'],
      '**/*.{css,scss}'
    ),
    ['client/src/app.css', 'client/src/theme.scss']
  );
  assert.deepEqual(braces.expand('client/{src,test}/*.{css,scss}'), [
    'client/src/*.css',
    'client/src/*.scss',
    'client/test/*.css',
    'client/test/*.scss'
  ]);
  assert.deepEqual(braces.expand('file-{01..03}.css'), [
    'file-01.css',
    'file-02.css',
    'file-03.css'
  ]);
});

test('deeply nested strings are rejected before exhausting the call stack', () => {
  const patterns = [
    '{'.repeat(3500) + 'a' + '}'.repeat(3500),
    '('.repeat(3500) + 'a' + ')'.repeat(3500),
    '{('.repeat(1700) + 'a' + ')}'.repeat(1700),
    '{'.repeat(3500) + 'a'
  ];
  for (const pattern of patterns) {
    for (const operation of [braces.parse, braces.compile, braces.expand, braces.stringify]) {
      assert.throws(() => operation(pattern), {
        name: 'SyntaxError',
        message: /exceeds max depth/
      });
    }
  }
});

test('recursive walkers also reject a deeply nested caller-supplied AST', () => {
  function deepAst() {
    let node = { type: 'text', value: 'a' };
    for (let depth = 0; depth < 150; depth++) node = { type: 'paren', nodes: [node] };
    return { type: 'root', nodes: [node] };
  }
  for (const operation of [braces.compile, braces.expand, braces.stringify]) {
    assert.throws(() => operation(deepAst()), {
      name: 'RangeError',
      message: /exceeds max depth/
    });
  }
});
