'use strict';

/**
 * Decides whether a hook should run.
 *
 * Controls (environment variables win over plugin options):
 * - MSW_HOOKS_ENABLED=true|false              (plugin option: hooks_enabled, default true)
 * - MSW_HOOK_PROFILE=minimal|standard|strict  (plugin option: hook_profile, default standard)
 * - MSW_DISABLED_HOOKS=comma,separated,ids
 *
 * Claude Code exposes plugin options to hooks as CLAUDE_PLUGIN_OPTION_<KEY>.
 */

const PROFILES = ['minimal', 'standard', 'strict'];
const DEFAULT_PROFILE = 'standard';

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function hooksEnabled(env = process.env) {
  return parseBoolean(
    firstDefined(env.MSW_HOOKS_ENABLED, env.CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED),
    true
  );
}

function activeProfile(env = process.env) {
  const value = firstDefined(env.MSW_HOOK_PROFILE, env.CLAUDE_PLUGIN_OPTION_HOOK_PROFILE);
  const normalized = String(value || '').trim().toLowerCase();
  return PROFILES.includes(normalized) ? normalized : DEFAULT_PROFILE;
}

function disabledHooks(env = process.env) {
  return new Set(
    String(env.MSW_DISABLED_HOOKS || '')
      .split(',')
      .map(id => id.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** Parses "standard,strict" or "all" into a list of valid profile names. */
function parseProfiles(csv) {
  const names = String(csv || '')
    .split(',')
    .map(name => name.trim().toLowerCase())
    .filter(Boolean);
  if (names.includes('all')) return [...PROFILES];
  return names.filter(name => PROFILES.includes(name));
}

function isHookEnabled(hookId, profilesCsv, env = process.env) {
  if (!hooksEnabled(env)) return false;
  if (disabledHooks(env).has(String(hookId).trim().toLowerCase())) return false;
  return parseProfiles(profilesCsv).includes(activeProfile(env));
}

module.exports = {
  PROFILES,
  DEFAULT_PROFILE,
  hooksEnabled,
  activeProfile,
  disabledHooks,
  parseProfiles,
  isHookEnabled
};
