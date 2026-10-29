'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { findSecrets, isSecretsFile } = require('../../scripts/lib/secrets');

// Built at runtime so this file never contains a real-looking token.
const fakeToken = prefix => `${prefix}_${'a1'.repeat(16)}`;

test('finds each Shopify token type', () => {
  for (const prefix of ['shpat', 'shpss', 'shpca', 'shppa']) {
    const found = findSecrets(`const token = "${fakeToken(prefix)}";`);
    assert.strictEqual(found.length, 1, prefix);
    assert.match(found[0], new RegExp(prefix));
  }
});

test('finds other credentials', () => {
  assert.strictEqual(findSecrets(`key = "${'sk_live_'}${'x'.repeat(24)}"`).length, 1);
  assert.strictEqual(findSecrets(`${'AKIA'}${'ABCDEFGHIJKLMNOP'}`).length, 1);
  assert.strictEqual(findSecrets(`-----BEGIN ${'RSA PRIVATE'} KEY-----`).length, 1);
});

test('ignores placeholders and prose', () => {
  assert.deepStrictEqual(findSecrets('SHOPIFY_ADMIN_TOKEN=shpat_your_token_here'), []);
  assert.deepStrictEqual(findSecrets('tokens start with shpat_ and live in .env'), []);
  assert.deepStrictEqual(findSecrets(''), []);
});

test('only real .env files are secrets files', () => {
  assert.ok(isSecretsFile('/project/.env'));
  assert.ok(isSecretsFile('C:\\project\\.env.local'));
  assert.ok(isSecretsFile('.env.production'));
  assert.ok(!isSecretsFile('.env.example'));
  assert.ok(!isSecretsFile('.env.sample'));
  assert.ok(!isSecretsFile('config/env.js'));
  assert.ok(!isSecretsFile(''));
});
