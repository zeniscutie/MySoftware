'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { splitCommands, isProgram } = require('../../scripts/lib/shell-words');

test('splits on && || ; | and newlines', () => {
  assert.deepStrictEqual(splitCommands('cd theme && shopify theme push --live; echo done | cat\nls'), [
    ['cd', 'theme'],
    ['shopify', 'theme', 'push', '--live'],
    ['echo', 'done'],
    ['cat'],
    ['ls']
  ]);
});

test('keeps quoted text together and does not split inside quotes', () => {
  assert.deepStrictEqual(splitCommands(`git commit -m "fix: a && b" --no-verify`), [
    ['git', 'commit', '-m', 'fix: a && b', '--no-verify']
  ]);
  assert.deepStrictEqual(splitCommands(`echo 'shopify theme publish'`), [['echo', 'shopify theme publish']]);
});

test('handles escapes, empty quotes and subshells', () => {
  assert.deepStrictEqual(splitCommands('echo a\\ b ""'), [['echo', 'a b', '']]);
  assert.deepStrictEqual(splitCommands('echo $(shopify theme publish)'), [['echo'], ['shopify', 'theme', 'publish']]);
  assert.deepStrictEqual(splitCommands('(cd x && git push --no-verify)'), [['cd', 'x'], ['git', 'push', '--no-verify']]);
});

test('empty input gives no commands', () => {
  assert.deepStrictEqual(splitCommands(''), []);
  assert.deepStrictEqual(splitCommands(undefined), []);
});

test('isProgram matches bare names, paths and Windows shims', () => {
  assert.ok(isProgram('shopify', 'shopify'));
  assert.ok(isProgram('./node_modules/.bin/shopify', 'shopify'));
  assert.ok(isProgram('C:\\tools\\shopify.cmd', 'shopify'));
  assert.ok(!isProgram('shopify-theme', 'shopify'));
});
