#!/usr/bin/env node
/**
 * Validates the plugin manifest, marketplace, MCP config and hook wiring.
 * Usage: node scripts/ci/validate-plugin.js [root]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parseProfiles } = require('../lib/hook-flags');

const EVENTS = new Set([
  'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop', 'SubagentStop',
  'SessionStart', 'SessionEnd', 'PreCompact'
]);
const HOOK_COMMAND = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/hooks\/run-with-flags\.js" (\S+) ([a-z0-9-]+\.js) (\S+)$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function readJson(root, relativePath, errors) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    errors.push(`${relativePath}: missing`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    errors.push(`${relativePath}: invalid JSON (${error.message})`);
    return null;
  }
}

function onlyKeys(object, allowed, label, errors) {
  for (const key of Object.keys(object || {})) {
    if (!allowed.has(key)) errors.push(`${label}: unexpected key "${key}"`);
  }
}

function validateManifest(root) {
  const errors = [];
  const plugin = readJson(root, '.claude-plugin/plugin.json', errors);
  const marketplace = readJson(root, '.claude-plugin/marketplace.json', errors);
  const pkg = readJson(root, 'package.json', errors);
  readJson(root, '.mcp.json', errors);
  if (!plugin) return errors;

  if (!plugin.name) errors.push('plugin.json: name is required');
  if (!SEMVER.test(plugin.version || '')) errors.push('plugin.json: version must be semver (x.y.z)');
  if ('agents' in plugin) errors.push('plugin.json: do not add "agents" (Claude Code rejects it; agents/ is found automatically)');
  if ('hooks' in plugin) errors.push('plugin.json: do not list hooks; hooks/hooks.json loads automatically and listing it loads it twice');
  for (const field of ['skills', 'commands']) {
    if (field in plugin && !Array.isArray(plugin[field])) errors.push(`plugin.json: ${field} must be an array`);
  }
  if (pkg && pkg.version !== plugin.version) {
    errors.push(`version mismatch: package.json ${pkg.version} vs plugin.json ${plugin.version}`);
  }

  if (marketplace) {
    const entry = (marketplace.plugins || []).find(p => p.name === plugin.name);
    if (!entry) errors.push(`marketplace.json: no entry for plugin "${plugin.name}"`);
    else {
      if (entry.source !== './') errors.push('marketplace.json: source must be "./"');
      if (entry.version && entry.version !== plugin.version) {
        errors.push(`version mismatch: marketplace.json ${entry.version} vs plugin.json ${plugin.version}`);
      }
    }
  }

  const changelog = path.join(root, 'CHANGELOG.md');
  if (fs.existsSync(changelog) && !fs.readFileSync(changelog, 'utf8').includes(`## ${plugin.version}`)) {
    errors.push(`CHANGELOG.md: no "## ${plugin.version}" section`);
  }
  return errors;
}

function validateHooks(root) {
  const errors = [];
  const config = readJson(root, 'hooks/hooks.json', errors);
  const metadata = readJson(root, 'hooks/hooks.metadata.json', errors);
  if (!config) return errors;

  onlyKeys(config, new Set(['hooks']), 'hooks.json', errors);
  const wired = [];
  for (const [event, entries] of Object.entries(config.hooks || {})) {
    if (!EVENTS.has(event)) errors.push(`hooks.json: unknown event "${event}"`);
    if (!Array.isArray(entries)) {
      errors.push(`hooks.json: ${event} must be an array`);
      continue;
    }
    entries.forEach((entry, index) => {
      const label = `hooks.json ${event}[${index}]`;
      onlyKeys(entry, new Set(['matcher', 'hooks']), label, errors);
      for (const hook of entry.hooks || []) {
        onlyKeys(hook, new Set(['type', 'command', 'timeout']), label, errors);
        if (hook.type !== 'command') errors.push(`${label}: type must be "command"`);
        const match = HOOK_COMMAND.exec(hook.command || '');
        if (!match) {
          errors.push(`${label}: command must be: node "\${CLAUDE_PLUGIN_ROOT}/scripts/hooks/run-with-flags.js" <id> <script.js> <profiles>`);
          continue;
        }
        const [, id, script, profiles] = match;
        if (!fs.existsSync(path.join(root, 'scripts', 'hooks', script))) errors.push(`${label}: scripts/hooks/${script} not found`);
        if (parseProfiles(profiles).length === 0) errors.push(`${label}: no valid profiles in "${profiles}"`);
        if (!Number.isInteger(hook.timeout) || hook.timeout < 1 || hook.timeout > 120) {
          errors.push(`${label}: timeout must be 1-120 seconds`);
        }
        wired.push({ id, event, matcher: entry.matcher });
      }
    });
  }

  const ids = wired.map(hook => hook.id);
  for (const id of new Set(ids)) {
    if (ids.filter(other => other === id).length > 1) errors.push(`hooks.json: hook id "${id}" is used twice`);
  }

  if (metadata) {
    const described = new Map((metadata.hooks || []).map(entry => [entry.id, entry]));
    for (const hook of wired) {
      const entry = described.get(hook.id);
      if (!entry) {
        errors.push(`hooks.metadata.json: no entry for "${hook.id}"`);
        continue;
      }
      if (entry.event !== hook.event) errors.push(`hooks.metadata.json: "${hook.id}" event ${entry.event} ≠ ${hook.event}`);
      if ((entry.matcher || undefined) !== (hook.matcher || undefined)) {
        errors.push(`hooks.metadata.json: "${hook.id}" matcher ${entry.matcher} ≠ ${hook.matcher}`);
      }
      if (!entry.description) errors.push(`hooks.metadata.json: "${hook.id}" needs a description`);
    }
    for (const id of described.keys()) {
      if (!ids.includes(id)) errors.push(`hooks.metadata.json: "${id}" is not wired in hooks.json`);
    }
  }
  return errors;
}

function validatePlugin(root) {
  return [...validateManifest(root), ...validateHooks(root)];
}

if (require.main === module) {
  const errors = validatePlugin(path.resolve(process.argv[2] || path.join(__dirname, '..', '..')));
  for (const error of errors) console.error(`✗ ${error}`);
  if (errors.length === 0) console.log('✓ plugin manifest and hooks');
  process.exitCode = errors.length ? 1 : 0;
}

module.exports = { validateManifest, validateHooks, validatePlugin };
