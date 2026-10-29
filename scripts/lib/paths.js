'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/** The plugin's root folder (two levels above scripts/lib). */
function pluginRoot() {
  return path.resolve(__dirname, '..', '..');
}

/** Where MySoftware keeps local data. Override with MSW_DATA_DIR. */
function dataDir(env = process.env) {
  const override = String(env.MSW_DATA_DIR || '').trim();
  return override ? path.resolve(override) : path.join(os.homedir(), '.claude', 'mysoftware');
}

/** Walks up from startDir to the nearest folder with a .git entry; falls back to startDir. */
function findProjectRoot(startDir) {
  let current = path.resolve(startDir || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir || process.cwd());
    current = parent;
  }
}

/**
 * Folder name used for a project's session files: the project root's folder
 * name, lowercased, with anything other than a-z, 0-9 turned into "-".
 * The /save-session command documents the same rule.
 */
function projectSlug(startDir) {
  const name = path.basename(findProjectRoot(startDir));
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'project';
}

function sessionsDir(startDir, env = process.env) {
  return path.join(dataDir(env), 'sessions', projectSlug(startDir));
}

module.exports = { pluginRoot, dataDir, findProjectRoot, projectSlug, sessionsDir };
