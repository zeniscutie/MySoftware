'use strict';

/**
 * pre:bash:shopify-live — stops Shopify CLI commands that change the live
 * store until the user has said yes:
 *
 * - `shopify theme push` to the live theme (--live / -l / --allow-live / -a)
 * - `shopify theme push` with no target (no --unpublished, --development or --theme)
 * - `shopify theme publish` and `shopify theme delete`
 * - `shopify app deploy` and `shopify app release`
 *
 * After the user approves, Claude re-runs the command prefixed with
 * MSW_ALLOW_LIVE=1. Previews (`theme dev`, `theme push --unpublished`) pass.
 */

const { splitCommands, isProgram } = require('../lib/shell-words');

const LIVE_FLAGS = new Set(['--live', '-l', '--allow-live', '-a']);
const TARGET_FLAGS = new Set(['--unpublished', '-u', '--development', '-d', '--theme', '-t']);

function hasFlag(args, flags) {
  return args.some(arg => flags.has(arg) || flags.has(arg.split('=')[0]));
}

function isApproved(wordsBefore) {
  return wordsBefore.some(word => /^MSW_ALLOW_LIVE=(1|true|yes)$/i.test(word));
}

/** Returns a reason string when the command would change the live store, else null. */
function findLiveChange(words) {
  const shopifyIndex = words.findIndex(word => isProgram(word, 'shopify'));
  if (shopifyIndex === -1) return null;
  if (isApproved(words.slice(0, shopifyIndex))) return null;

  const rest = words.slice(shopifyIndex + 1);
  // Accept both `shopify theme push` and the older `shopify theme:push`.
  const positional = rest.filter(word => !word.startsWith('-')).flatMap(word => word.split(':'));
  const [topic, action] = positional;
  const args = rest.filter(word => word.startsWith('-'));

  if (topic === 'theme') {
    if (action === 'publish') return '`shopify theme publish` makes a theme live for customers';
    if (action === 'delete') return '`shopify theme delete` permanently removes a theme';
    if (action === 'push') {
      if (hasFlag(args, LIVE_FLAGS)) return '`shopify theme push` to the live theme';
      if (!hasFlag(args, TARGET_FLAGS)) {
        return '`shopify theme push` without a target theme (add --unpublished, --development or --theme <id>)';
      }
    }
  }
  if (topic === 'app' && (action === 'deploy' || action === 'release')) {
    return `\`shopify app ${action}\` releases a new app version to the store`;
  }
  return null;
}

function blocked(reason) {
  return {
    exitCode: 2,
    stderr:
      `[mysoftware] Blocked: ${reason}. This can change what customers see or what runs on the live store. ` +
      'Ask the user first: say exactly what will change and on which store/theme. ' +
      'Only if they explicitly say yes, re-run the same command prefixed with MSW_ALLOW_LIVE=1. ' +
      'For previews use `shopify theme dev` or `shopify theme push --unpublished`.'
  };
}

function run(input, context = {}) {
  const command = input && input.tool_input && input.tool_input.command;
  if (typeof command !== 'string') {
    // Input we could not read: block only if it looks like a Shopify command.
    return context.raw && failClosed(context.raw) ? blocked('a Shopify CLI command that could not be checked') : { exitCode: 0 };
  }
  for (const words of splitCommands(command)) {
    const reason = findLiveChange(words);
    if (reason) return blocked(reason);
  }
  if (context.truncated && /shopify/i.test(command)) {
    return blocked('a Shopify CLI command too long to check');
  }
  return { exitCode: 0 };
}

function failClosed(raw) {
  return /shopify[^\n]{0,80}\b(theme|app)\b/i.test(String(raw || ''));
}

module.exports = { run, failClosed, findLiveChange };
