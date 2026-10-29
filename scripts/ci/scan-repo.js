#!/usr/bin/env node
/**
 * Fails if any tracked file contains a credential or a personal absolute path.
 * Usage: node scripts/ci/scan-repo.js [root]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { findSecrets } = require('../lib/secrets');

const PERSONAL_PATH = /(?:\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\/|[A-Z]:\\Users\\[A-Za-z0-9._-]+\\)/;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'coverage', 'output']);
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip|gz|wasm)$/i;

function listFiles(root) {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  } catch {
    const files = [];
    const walk = dir => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const relative = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) walk(relative);
        } else files.push(relative);
      }
    };
    walk('.');
    return files;
  }
}

function scanRepo(root) {
  const errors = [];
  for (const file of listFiles(root)) {
    if (BINARY.test(file)) continue;
    const filePath = path.join(root, file);
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, 'utf8');
    for (const name of findSecrets(text)) errors.push(`${file}: contains a ${name}`);
    const personal = PERSONAL_PATH.exec(text);
    if (personal) errors.push(`${file}: contains a personal path (${personal[0]}); use ~ or a relative path`);
  }
  return errors;
}

if (require.main === module) {
  const errors = scanRepo(path.resolve(process.argv[2] || path.join(__dirname, '..', '..')));
  for (const error of errors) console.error(`✗ ${error}`);
  if (errors.length === 0) console.log('✓ no secrets or personal paths');
  process.exitCode = errors.length ? 1 : 0;
}

module.exports = { scanRepo, PERSONAL_PATH };
