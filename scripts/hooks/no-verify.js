'use strict';

/**
 * pre:bash:no-verify — blocks git commands that skip the repository's own
 * git hooks: `git commit --no-verify` / `-n`, `git push --no-verify`, and
 * `git -c core.hooksPath=...`.
 */

const { splitCommands, isProgram } = require('../lib/shell-words');

const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
const COMMIT_OPTIONS_WITH_VALUE = new Set([
  '-m', '-F', '-C', '-c', '-t', '--message', '--file', '--author', '--date',
  '--template', '--reuse-message', '--reedit-message', '--fixup', '--squash', '--cleanup'
]);
// Short commit options that take a value; anything after them in a cluster is that value.
const COMMIT_SHORT_WITH_VALUE = 'mFCct';

function commitSkipsHooks(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (COMMIT_OPTIONS_WITH_VALUE.has(arg)) {
      i++;
      continue;
    }
    if (!/^-[a-zA-Z]+$/.test(arg)) continue;
    for (const flag of arg.slice(1)) {
      if (flag === 'n') return arg;
      if (COMMIT_SHORT_WITH_VALUE.includes(flag)) {
        if (arg.endsWith(flag)) i++;
        break;
      }
    }
  }
  return null;
}

function findViolation(words) {
  const gitIndex = words.findIndex(word => isProgram(word, 'git'));
  if (gitIndex === -1) return null;

  let i = gitIndex + 1;
  while (i < words.length && words[i].startsWith('-')) {
    const option = words[i];
    if (option === '-c' && /^core\.hookspath=/i.test(words[i + 1] || '')) return 'core.hooksPath override';
    if (/^-ccore\.hookspath=/i.test(option)) return 'core.hooksPath override';
    i += GIT_OPTIONS_WITH_VALUE.has(option) ? 2 : 1;
  }
  const subcommand = words[i];
  if (!subcommand) return null;
  const args = words.slice(i + 1);

  if (args.includes('--no-verify')) return `git ${subcommand} --no-verify`;
  if (subcommand === 'commit') {
    const flag = commitSkipsHooks(args);
    if (flag) return `git commit ${flag} (-n skips hooks)`;
  }
  return null;
}

function run(input) {
  const command = input && input.tool_input && input.tool_input.command;
  if (typeof command !== 'string') return { exitCode: 0 };

  for (const words of splitCommands(command)) {
    const violation = findViolation(words);
    if (violation) {
      return {
        exitCode: 2,
        stderr:
          `[mysoftware] Blocked: ${violation}. Git hooks catch problems before they reach the store. ` +
          'Fix whatever the hook reports instead of skipping it. If the user explicitly wants to skip, ' +
          'they can run the command themselves.'
      };
    }
  }
  return { exitCode: 0 };
}

module.exports = { run, findViolation };
