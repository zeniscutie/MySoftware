#!/usr/bin/env node
/**
 * Entry point for every MySoftware hook.
 *
 * Usage: node run-with-flags.js <hookId> <script.js> <profilesCsv|all>
 *
 * Runs scripts/hooks/<script.js> only when the hook is enabled for the active
 * profile (see scripts/lib/hook-flags.js). Each hook script exports
 * run(input, context) returning { exitCode, stdout, stderr }.
 *
 * Errors inside a hook let the tool call through (fail open), unless the
 * script's failClosed(raw) says the input looks like something it guards.
 */

'use strict';

const path = require('path');
const { isHookEnabled } = require('../lib/hook-flags');
const { readStdin, parseInput, resolveMaxBytes } = require('../lib/hook-input');

const SCRIPT_NAME = /^[a-z0-9-]+\.js$/;

function write(stream, text) {
  if (text) stream.write(text.endsWith('\n') ? text : `${text}\n`);
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const [hookId, scriptName, profilesCsv] = argv;
  if (!hookId || !scriptName || !SCRIPT_NAME.test(scriptName)) {
    write(process.stderr, `[mysoftware] invalid hook arguments: ${argv.join(' ')}`);
    return 0;
  }
  // Read input even when the hook is off, so Claude Code never writes into a closed pipe.
  const { raw, truncated } = await readStdin(process.stdin, resolveMaxBytes(env.MSW_HOOK_INPUT_MAX_BYTES));
  if (!isHookEnabled(hookId, profilesCsv, env)) return 0;

  let hook;
  try {
    hook = require(path.join(__dirname, scriptName));
    const input = parseInput(raw) || {};
    const result = (await hook.run(input, { env, raw, truncated, hookId })) || {};
    write(process.stdout, result.stdout);
    write(process.stderr, result.stderr);
    return Number.isInteger(result.exitCode) ? result.exitCode : 0;
  } catch (error) {
    if (hook && typeof hook.failClosed === 'function' && hook.failClosed(raw)) {
      write(
        process.stderr,
        `[mysoftware] ${hookId} could not check this safely (${error.message}). ` +
          'Blocked to be safe: ask the user before retrying.'
      );
      return 2;
    }
    write(process.stderr, `[mysoftware] ${hookId} skipped: ${error.message}`);
    return 0;
  }
}

if (require.main === module) {
  main().then(code => {
    process.exitCode = code;
  });
}

module.exports = { main };
