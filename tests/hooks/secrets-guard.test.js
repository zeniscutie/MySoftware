'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { run, failClosed } = require('../../scripts/hooks/secrets-guard');

const token = `${'shp'}at_${'0f'.repeat(16)}`;

test('blocks a token in Write content', () => {
  const result = run({ tool_name: 'Write', tool_input: { file_path: 'scripts/sync.mjs', content: `const t = "${token}";` } });
  assert.strictEqual(result.exitCode, 2);
  assert.match(result.stderr, /Shopify Admin API access token/);
  assert.match(result.stderr, /scripts\/sync\.mjs/);
});

test('blocks a token in Edit, MultiEdit and NotebookEdit', () => {
  assert.strictEqual(run({ tool_input: { file_path: 'a.js', old_string: 'x', new_string: token } }).exitCode, 2);
  assert.strictEqual(
    run({ tool_input: { file_path: 'a.js', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: token }] } }).exitCode,
    2
  );
  assert.strictEqual(run({ tool_input: { notebook_path: 'n.ipynb', new_source: token } }).exitCode, 2);
});

test('allows tokens in real .env files but not in templates', () => {
  assert.strictEqual(run({ tool_input: { file_path: '/store/.env', content: `SHOPIFY_ADMIN_TOKEN=${token}` } }).exitCode, 0);
  assert.strictEqual(run({ tool_input: { file_path: '/store/.env.local', content: token } }).exitCode, 0);
  assert.strictEqual(run({ tool_input: { file_path: '/store/.env.example', content: token } }).exitCode, 2);
});

test('the old_string (removing a token) does not trigger a block', () => {
  assert.strictEqual(run({ tool_input: { file_path: 'a.js', old_string: token, new_string: 'process.env.TOKEN' } }).exitCode, 0);
});

test('allows ordinary content', () => {
  assert.strictEqual(run({ tool_input: { file_path: 'a.js', content: 'const token = process.env.SHOPIFY_ADMIN_TOKEN;' } }).exitCode, 0);
});

test('falls back to scanning raw input when the input is unreadable or truncated', () => {
  assert.strictEqual(run({}, { raw: `{"content":"${token}` }).exitCode, 2);
  assert.strictEqual(run({}, { raw: '{"content":"hello' }).exitCode, 0);
  assert.strictEqual(
    run({ tool_input: { file_path: 'a.js', content: 'cut off' } }, { truncated: true, raw: `..."${token}` }).exitCode,
    2
  );
  assert.ok(failClosed(token));
  assert.ok(!failClosed('nothing here'));
});
