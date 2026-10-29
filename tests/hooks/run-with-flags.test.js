'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const RUNNER = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');

function runHook(args, input, env = {}) {
  const started = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [RUNNER, ...args], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, MSW_HOOK_PROFILE: '', MSW_HOOKS_ENABLED: '', MSW_DISABLED_HOOKS: '', ...env }
  });
  return { ...result, ms: Number(process.hrtime.bigint() - started) / 1e6 };
}

const publish = { tool_name: 'Bash', tool_input: { command: 'shopify theme publish' } };
const liveArgs = ['pre:bash:shopify-live', 'shopify-live.js', 'all'];

test('runs the hook and passes its exit code and message through', () => {
  const result = runHook(liveArgs, publish);
  assert.strictEqual(result.status, 2);
  assert.match(result.stderr, /Blocked/);
});

test('safe commands pass', () => {
  const result = runHook(liveArgs, { tool_name: 'Bash', tool_input: { command: 'shopify theme dev' } });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stderr, '');
});

test('kill switch, disable list and profile turn hooks off', () => {
  assert.strictEqual(runHook(liveArgs, publish, { MSW_HOOKS_ENABLED: 'false' }).status, 0);
  assert.strictEqual(runHook(liveArgs, publish, { MSW_DISABLED_HOOKS: 'pre:bash:shopify-live' }).status, 0);
  assert.strictEqual(runHook(liveArgs, publish, { CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED: 'false' }).status, 0);
  const strictOnly = ['pre:bash:shopify-live', 'shopify-live.js', 'strict'];
  assert.strictEqual(runHook(strictOnly, publish).status, 0);
  assert.strictEqual(runHook(strictOnly, publish, { MSW_HOOK_PROFILE: 'strict' }).status, 2);
});

test('malformed input never crashes the hook', () => {
  const result = runHook(['pre:bash:no-verify', 'no-verify.js', 'all'], '{not json');
  assert.strictEqual(result.status, 0);
  assert.strictEqual(runHook(liveArgs, '').status, 0);
});

test('oversized input is truncated, and Shopify commands are then blocked', () => {
  const big = { tool_name: 'Bash', tool_input: { command: `shopify theme dev ${'x'.repeat(5000)}` } };
  const result = runHook(liveArgs, big, { MSW_HOOK_INPUT_MAX_BYTES: '1000' });
  assert.strictEqual(result.status, 2);
});

test('rejects unsafe script names without running anything', () => {
  const result = runHook(['x', '../lib/paths.js', 'all'], publish);
  assert.strictEqual(result.status, 0);
  assert.match(result.stderr, /invalid hook arguments/);
});

test('a missing hook script fails open', () => {
  const result = runHook(['x', 'does-not-exist.js', 'all'], publish);
  assert.strictEqual(result.status, 0);
  assert.match(result.stderr, /skipped/);
});

test('hooks start fast', () => {
  const times = Array.from({ length: 3 }, () => runHook(['pre:bash:no-verify', 'no-verify.js', 'all'], publish).ms);
  const best = Math.min(...times);
  // Mostly Node start-up time; generous so slow CI machines don't flake.
  assert.ok(best < 1500, `best run took ${best.toFixed(0)} ms`);
});
