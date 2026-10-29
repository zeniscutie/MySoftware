'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { run } = require('../../scripts/hooks/no-verify');

const bash = command => ({ tool_name: 'Bash', tool_input: { command } });
const exitCode = command => run(bash(command)).exitCode;

test('blocks commands that skip git hooks', () => {
  for (const command of [
    'git commit -m "wip" --no-verify',
    'git push --no-verify origin main',
    'git commit -n -m wip',
    'git commit -anm wip',
    'cd store && git commit --no-verify -m x',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git -C ../theme commit --no-verify'
  ]) {
    assert.strictEqual(exitCode(command), 2, command);
  }
});

test('allows normal git commands', () => {
  for (const command of [
    'git commit -m "fix size chart"',
    'git commit -am "update -n flag docs"',
    'git commit -m "-nope"',
    'git push origin main',
    'git push -n origin main',
    'git log -n 5',
    'echo "--no-verify"',
    'npm test'
  ]) {
    assert.strictEqual(exitCode(command), 0, command);
  }
});

test('explains what to do instead', () => {
  const result = run(bash('git commit --no-verify'));
  assert.match(result.stderr, /Fix whatever the hook reports/);
});

test('ignores input without a command', () => {
  assert.strictEqual(run({}).exitCode, 0);
  assert.strictEqual(run({ tool_input: { command: 42 } }).exitCode, 0);
});
