'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { run, failClosed } = require('../../scripts/hooks/shopify-live');

const bash = command => ({ tool_name: 'Bash', tool_input: { command } });
const exitCode = (command, context) => run(bash(command), context).exitCode;

test('blocks commands that change the live store', () => {
  for (const command of [
    'shopify theme push --live',
    'shopify theme push -l',
    'shopify theme push --theme 123 --allow-live',
    'shopify theme push',
    'shopify theme push --store our-store.myshopify.com',
    'shopify theme publish --theme 123',
    'shopify theme delete -t 123 -f',
    'shopify theme:push --live',
    'shopify app deploy',
    'shopify app deploy --force',
    'shopify app release --version v2',
    'npx shopify theme publish',
    'cd theme && shopify theme push --live --store x',
    './node_modules/.bin/shopify app deploy'
  ]) {
    assert.strictEqual(exitCode(command), 2, command);
  }
});

test('allows previews, reads and non-Shopify commands', () => {
  for (const command of [
    'shopify theme dev --store our-store.myshopify.com',
    'shopify theme push --unpublished',
    'shopify theme push -u --store x',
    'shopify theme push --development',
    'shopify theme push --theme 123456 --only sections/a.liquid',
    'shopify theme push --theme=123456',
    'shopify theme pull --theme 123',
    'shopify theme check',
    'shopify theme list',
    'shopify app dev',
    'shopify app function run --path extensions/x',
    'shopify version',
    'echo "shopify theme publish"',
    'git push'
  ]) {
    assert.strictEqual(exitCode(command), 0, command);
  }
});

test('MSW_ALLOW_LIVE=1 prefix lets an approved command through', () => {
  assert.strictEqual(exitCode('MSW_ALLOW_LIVE=1 shopify theme publish --theme 123'), 0);
  assert.strictEqual(exitCode('MSW_ALLOW_LIVE=1 npx shopify app deploy'), 0);
  // Approval applies only to the command it prefixes.
  assert.strictEqual(exitCode('MSW_ALLOW_LIVE=1 shopify theme dev && shopify theme publish'), 2);
  assert.strictEqual(exitCode('MSW_ALLOW_LIVE=0 shopify theme publish'), 2);
});

test('block message tells Claude to ask first', () => {
  const { stderr } = run(bash('shopify theme publish'));
  assert.match(stderr, /Ask the user first/);
  assert.match(stderr, /MSW_ALLOW_LIVE=1/);
});

test('truncated input mentioning shopify is blocked', () => {
  assert.strictEqual(exitCode('shopify theme dev', { truncated: true }), 2);
  assert.strictEqual(exitCode('npm test', { truncated: true }), 0);
});

test('unreadable input is blocked only if it looks like a Shopify command', () => {
  assert.strictEqual(run({}, { raw: '{"command":"shopify theme publish' }).exitCode, 2);
  assert.strictEqual(run({}, { raw: '{"command":"ls' }).exitCode, 0);
  assert.strictEqual(run({}, {}).exitCode, 0);
  assert.ok(failClosed('shopify  app deploy'));
  assert.ok(!failClosed('npm run build'));
});
