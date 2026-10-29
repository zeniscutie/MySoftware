#!/usr/bin/env node
/**
 * Finds every *.test.js file under tests/ and runs them with the built-in
 * node:test runner. Optional filter: MSW_TEST_ONLY=hooks,lib runs only files
 * whose path contains one of the comma-separated patterns.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TESTS_DIR = __dirname;

function findTestFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'fixtures') continue;
      files.push(...findTestFiles(fullPath));
    } else if (entry.name.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function applyFilter(files, filter) {
  const patterns = String(filter || '')
    .split(',')
    .map(pattern => pattern.trim())
    .filter(Boolean);
  if (patterns.length === 0) return files;
  return files.filter(file => {
    const relative = path.relative(TESTS_DIR, file).split(path.sep).join('/');
    return patterns.some(pattern => relative.includes(pattern));
  });
}

function main() {
  const files = applyFilter(findTestFiles(TESTS_DIR), process.env.MSW_TEST_ONLY);
  if (files.length === 0) {
    console.log('No test files matched.');
    return 0;
  }
  const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status === null ? 1 : result.status;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { findTestFiles, applyFilter };
