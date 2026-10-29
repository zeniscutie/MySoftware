'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { findTestFiles, applyFilter } = require('../run-all');

const TESTS_DIR = path.join(__dirname, '..');

test('findTestFiles finds this file', () => {
  const files = findTestFiles(TESTS_DIR);
  assert.ok(files.includes(__filename));
});

test('applyFilter keeps only files matching a pattern', () => {
  const files = [
    path.join(TESTS_DIR, 'hooks', 'a.test.js'),
    path.join(TESTS_DIR, 'lib', 'b.test.js')
  ];
  assert.deepStrictEqual(applyFilter(files, 'hooks'), [files[0]]);
  assert.deepStrictEqual(applyFilter(files, 'hooks, lib'), files);
});

test('applyFilter with no filter returns everything', () => {
  const files = [path.join(TESTS_DIR, 'x.test.js')];
  assert.deepStrictEqual(applyFilter(files, ''), files);
  assert.deepStrictEqual(applyFilter(files, undefined), files);
});
