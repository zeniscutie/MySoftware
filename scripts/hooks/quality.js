'use strict';

/**
 * post:edit:quality (strict profile only) — after Claude edits a file, runs
 * the matching checker if the project has it, and reports problems back to
 * Claude. It never blocks the edit (it already happened).
 *
 * - .liquid / theme .json  -> shopify theme check (Shopify CLI on PATH)
 * - .js .jsx .mjs .cjs .ts .tsx -> the project's own eslint (node_modules/eslint)
 * - .py                    -> ruff check (ruff on PATH)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TIMEOUT_MS = 45000;
const MAX_LINES = 40;
const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const UNSAFE_FOR_SHELL = /["&|<>^%!`$;]/;

function findUp(startDir, test) {
  let current = startDir;
  for (;;) {
    if (test(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function themeRoot(filePath) {
  return findUp(path.dirname(filePath), dir =>
    fs.existsSync(path.join(dir, 'config', 'settings_schema.json')) ||
    fs.existsSync(path.join(dir, 'layout', 'theme.liquid'))
  );
}

function firstLines(text) {
  const lines = String(text || '').trim().split(/\r?\n/);
  return lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), '…'].join('\n') : lines.join('\n');
}

/** Picks the checker for a file, or null. Returns { label, command, args, cwd, shell }. */
function planCheck(filePath, platform = process.platform) {
  const ext = path.extname(filePath).toLowerCase();
  const onWindows = platform === 'win32';

  if (ext === '.liquid' || ext === '.json') {
    const root = themeRoot(filePath);
    if (!root) return null;
    // shopify is a .cmd shim on Windows, which needs a shell; skip odd paths there.
    if (onWindows && UNSAFE_FOR_SHELL.test(root)) return null;
    return {
      label: 'Theme Check',
      command: 'shopify',
      args: ['theme', 'check', '--path', onWindows ? `"${root}"` : root, '--fail-level', 'error'],
      cwd: root,
      shell: onWindows
    };
  }

  if (JS_EXTENSIONS.has(ext)) {
    const root = findUp(path.dirname(filePath), dir =>
      fs.existsSync(path.join(dir, 'node_modules', 'eslint', 'bin', 'eslint.js'))
    );
    if (!root) return null;
    return {
      label: 'ESLint',
      command: process.execPath,
      args: [path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js'), filePath],
      cwd: root,
      shell: false
    };
  }

  if (ext === '.py') {
    return { label: 'Ruff', command: 'ruff', args: ['check', filePath], cwd: path.dirname(filePath), shell: false };
  }
  return null;
}

function run(input, context = {}) {
  const toolInput = (input && input.tool_input) || {};
  const filePath = toolInput.file_path;
  if (typeof filePath !== 'string' || !fs.existsSync(filePath)) return { exitCode: 0 };

  const check = planCheck(path.resolve(filePath));
  if (!check) return { exitCode: 0 };

  const spawn = context.spawn || spawnSync;
  const result = spawn(check.command, check.args, {
    cwd: check.cwd,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    shell: check.shell
  });
  // Checker not installed, timed out, or could not start: stay quiet.
  if (result.error || result.status === null || result.status === 0) return { exitCode: 0 };

  const output = firstLines(`${result.stdout || ''}\n${result.stderr || ''}`);
  return {
    exitCode: 2,
    stderr: `[mysoftware] ${check.label} found problems after editing ${filePath}:\n${output}\nFix these before moving on.`
  };
}

module.exports = { run, planCheck };
