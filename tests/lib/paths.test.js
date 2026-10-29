'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pluginRoot, dataDir, findProjectRoot, projectSlug, sessionsDir } = require('../../scripts/lib/paths');

function tempProject(name) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'msw-paths-'));
  const root = path.join(base, name);
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, 'sections', 'deep'), { recursive: true });
  return { base, root };
}

test('pluginRoot is the repository root', () => {
  assert.ok(fs.existsSync(path.join(pluginRoot(), '.claude-plugin', 'plugin.json')));
});

test('dataDir defaults to ~/.claude/mysoftware and honours MSW_DATA_DIR', () => {
  assert.strictEqual(dataDir({}), path.join(os.homedir(), '.claude', 'mysoftware'));
  assert.strictEqual(dataDir({ MSW_DATA_DIR: 'relative-dir' }), path.resolve('relative-dir'));
});

test('findProjectRoot walks up to the folder with .git', t => {
  const { base, root } = tempProject('Store Theme');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  assert.strictEqual(findProjectRoot(path.join(root, 'sections', 'deep')), root);
});

test('projectSlug lowercases and hyphenates the root folder name', t => {
  const { base, root } = tempProject('My Store_Theme (v2)');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  assert.strictEqual(projectSlug(path.join(root, 'sections')), 'my-store-theme-v2');
});

test('sessionsDir combines data dir and slug', t => {
  const { base, root } = tempProject('shop');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  assert.strictEqual(sessionsDir(root, { MSW_DATA_DIR: base }), path.join(base, 'sessions', 'shop'));
});
