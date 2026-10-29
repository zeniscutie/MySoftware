'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('stream');
const { readStdin, parseInput, resolveMaxBytes, DEFAULT_MAX_BYTES } = require('../../scripts/lib/hook-input');

test('reads the whole stream when under the limit', async () => {
  const result = await readStdin(Readable.from([Buffer.from('{"a":'), Buffer.from('1}')]), 100);
  assert.deepStrictEqual(result, { raw: '{"a":1}', truncated: false });
});

test('caps input at maxBytes and marks it truncated', async () => {
  const result = await readStdin(Readable.from([Buffer.from('abcdef'), Buffer.from('ghij')]), 4);
  assert.deepStrictEqual(result, { raw: 'abcd', truncated: true });
});

test('parseInput never throws', () => {
  assert.deepStrictEqual(parseInput('{"tool_name":"Bash"}'), { tool_name: 'Bash' });
  assert.strictEqual(parseInput(''), null);
  assert.strictEqual(parseInput('{not json'), null);
  assert.strictEqual(parseInput('[1,2]'), null);
  assert.strictEqual(parseInput('"text"'), null);
});

test('resolveMaxBytes falls back to the default for bad values', () => {
  assert.strictEqual(resolveMaxBytes('2048'), 2048);
  assert.strictEqual(resolveMaxBytes('-5'), DEFAULT_MAX_BYTES);
  assert.strictEqual(resolveMaxBytes(undefined), DEFAULT_MAX_BYTES);
});
