'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  hooksEnabled,
  activeProfile,
  disabledHooks,
  parseProfiles,
  isHookEnabled
} = require('../../scripts/lib/hook-flags');

test('hooks are enabled by default and can be turned off', () => {
  assert.strictEqual(hooksEnabled({}), true);
  assert.strictEqual(hooksEnabled({ MSW_HOOKS_ENABLED: 'false' }), false);
  assert.strictEqual(hooksEnabled({ MSW_HOOKS_ENABLED: '0' }), false);
  assert.strictEqual(hooksEnabled({ MSW_HOOKS_ENABLED: 'nonsense' }), true);
});

test('plugin option is used when the env var is absent; env var wins', () => {
  assert.strictEqual(hooksEnabled({ CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED: 'false' }), false);
  assert.strictEqual(
    hooksEnabled({ CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED: 'false', MSW_HOOKS_ENABLED: 'true' }),
    true
  );
  assert.strictEqual(activeProfile({ CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'strict' }), 'strict');
  assert.strictEqual(
    activeProfile({ CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'strict', MSW_HOOK_PROFILE: 'minimal' }),
    'minimal'
  );
});

test('invalid or empty profile falls back to standard', () => {
  assert.strictEqual(activeProfile({}), 'standard');
  assert.strictEqual(activeProfile({ MSW_HOOK_PROFILE: 'paranoid' }), 'standard');
  assert.strictEqual(activeProfile({ MSW_HOOK_PROFILE: ' STRICT ' }), 'strict');
});

test('disabled hooks are parsed case-insensitively', () => {
  assert.deepStrictEqual([...disabledHooks({ MSW_DISABLED_HOOKS: 'Session:Start, pre:compact,,' })], [
    'session:start',
    'pre:compact'
  ]);
});

test('parseProfiles understands all and drops unknown names', () => {
  assert.deepStrictEqual(parseProfiles('all'), ['minimal', 'standard', 'strict']);
  assert.deepStrictEqual(parseProfiles('standard,bogus,strict'), ['standard', 'strict']);
  assert.deepStrictEqual(parseProfiles(''), []);
});

test('isHookEnabled combines kill switch, disable list and profile', () => {
  assert.strictEqual(isHookEnabled('x', 'standard,strict', {}), true);
  assert.strictEqual(isHookEnabled('x', 'strict', {}), false);
  assert.strictEqual(isHookEnabled('x', 'all', { MSW_HOOK_PROFILE: 'minimal' }), true);
  assert.strictEqual(isHookEnabled('x', 'all', { MSW_DISABLED_HOOKS: 'x' }), false);
  assert.strictEqual(isHookEnabled('x', 'all', { MSW_HOOKS_ENABLED: 'off' }), false);
});
