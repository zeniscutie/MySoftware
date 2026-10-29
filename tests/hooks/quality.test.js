'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { run, planCheck } = require('../../scripts/hooks/quality');
const { tempDir } = require('../helpers');

function makeTheme(t) {
  const root = tempDir(t, 'msw-theme-');
  fs.mkdirSync(path.join(root, 'layout'));
  fs.mkdirSync(path.join(root, 'sections'));
  fs.writeFileSync(path.join(root, 'layout', 'theme.liquid'), '{{ content_for_layout }}');
  const file = path.join(root, 'sections', 'hero.liquid');
  fs.writeFileSync(file, '<h1>{{ section.settings.title }}</h1>');
  return { root, file };
}

function makeJsProject(t) {
  const root = tempDir(t, 'msw-js-');
  fs.mkdirSync(path.join(root, 'node_modules', 'eslint', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js'), '');
  fs.mkdirSync(path.join(root, 'src'));
  const file = path.join(root, 'src', 'index.ts');
  fs.writeFileSync(file, 'export const x = 1;');
  return { root, file };
}

const edited = filePath => ({ tool_name: 'Edit', tool_input: { file_path: filePath } });

test('plans Theme Check for files inside a theme', t => {
  const { root, file } = makeTheme(t);
  const plan = planCheck(file, 'linux');
  assert.strictEqual(plan.label, 'Theme Check');
  assert.deepStrictEqual(plan.args, ['theme', 'check', '--path', root, '--fail-level', 'error']);
  assert.strictEqual(plan.shell, false);
  assert.strictEqual(planCheck(file, 'win32').shell, true);
});

test('plans the project eslint for JS/TS and ruff for Python', t => {
  const { root, file } = makeJsProject(t);
  const plan = planCheck(file, 'linux');
  assert.strictEqual(plan.label, 'ESLint');
  assert.strictEqual(plan.command, process.execPath);
  assert.deepStrictEqual(plan.args, [path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js'), file]);
  assert.strictEqual(planCheck(path.join(root, 'job.py'), 'linux').label, 'Ruff');
});

test('no checker for JSON outside a theme, unknown types, or JS without eslint', t => {
  const dir = tempDir(t);
  assert.strictEqual(planCheck(path.join(dir, 'data.json'), 'linux'), null);
  assert.strictEqual(planCheck(path.join(dir, 'notes.md'), 'linux'), null);
  assert.strictEqual(planCheck(path.join(dir, 'a.js'), 'linux'), null);
});

test('reports checker failures back to Claude', t => {
  const { file } = makeTheme(t);
  const spawn = () => ({ status: 1, stdout: 'sections/hero.liquid: MissingTemplate', stderr: '' });
  const result = run(edited(file), { spawn });
  assert.strictEqual(result.exitCode, 2);
  assert.match(result.stderr, /Theme Check found problems/);
  assert.match(result.stderr, /MissingTemplate/);
});

test('stays quiet when the check passes, is missing or times out', t => {
  const { file } = makeTheme(t);
  assert.strictEqual(run(edited(file), { spawn: () => ({ status: 0 }) }).exitCode, 0);
  assert.strictEqual(run(edited(file), { spawn: () => ({ error: new Error('ENOENT'), status: null }) }).exitCode, 0);
  assert.strictEqual(run(edited(file), { spawn: () => ({ status: null, signal: 'SIGTERM' }) }).exitCode, 0);
  assert.strictEqual(run(edited(path.join(path.dirname(file), 'missing.liquid')), { spawn: () => ({ status: 1 }) }).exitCode, 0);
  assert.strictEqual(run({}, {}).exitCode, 0);
});

test('long checker output is cut', t => {
  const { file } = makeTheme(t);
  const stdout = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
  const { stderr } = run(edited(file), { spawn: () => ({ status: 1, stdout }) });
  assert.match(stderr, /line 39\n…/);
  assert.doesNotMatch(stderr, /line 40/);
});
