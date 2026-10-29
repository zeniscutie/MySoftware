'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('package is private so it is never published to npm', () => {
  assert.strictEqual(pkg.private, true);
});

test('package has no runtime dependencies (hooks must run with plain node)', () => {
  assert.deepStrictEqual(pkg.dependencies || {}, {});
});

test('package requires a supported Node version', () => {
  assert.match(pkg.engines.node, /^>=\d+/);
  assert.ok(Number(pkg.engines.node.replace('>=', '')) >= 22);
});

test('.gitignore keeps .env files out of git', () => {
  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/);
  assert.ok(gitignore.includes('.env'));
  assert.ok(gitignore.includes('.env.*'));
});
