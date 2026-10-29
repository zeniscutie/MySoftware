'use strict';

/**
 * pre:write:secrets — blocks Edit/Write/MultiEdit/NotebookEdit calls that
 * would put a Shopify token, live payment key, cloud key or private key into
 * a file. .env files (not templates like .env.example) are allowed: that is
 * where secrets belong, and .gitignore keeps them out of git.
 */

const { findSecrets, isSecretsFile } = require('../lib/secrets');

function newText(toolInput) {
  const parts = [toolInput.content, toolInput.new_string, toolInput.new_source];
  if (Array.isArray(toolInput.edits)) {
    for (const edit of toolInput.edits) parts.push(edit && edit.new_string);
  }
  return parts.filter(part => typeof part === 'string').join('\n');
}

function blocked(found, filePath) {
  return {
    exitCode: 2,
    stderr:
      `[mysoftware] Blocked: this would write a ${found.join(', ')} into ${filePath || 'a file'}. ` +
      'Put secrets in .env (gitignored) and read them from the environment ' +
      '(process.env.SHOPIFY_ADMIN_TOKEN, os.environ["SHOPIFY_ADMIN_TOKEN"]). ' +
      'If this is a real credential that was pasted into the chat, tell the user to rotate it.'
  };
}

function run(input, context = {}) {
  const toolInput = input && input.tool_input;
  if (!toolInput || typeof toolInput !== 'object') {
    const found = findSecrets(context.raw);
    return found.length ? blocked(found) : { exitCode: 0 };
  }
  const filePath = toolInput.file_path || toolInput.notebook_path || '';
  if (isSecretsFile(filePath)) return { exitCode: 0 };

  const found = findSecrets(newText(toolInput));
  if (found.length === 0 && context.truncated) {
    const inRaw = findSecrets(context.raw);
    if (inRaw.length) return blocked(inRaw, filePath);
  }
  return found.length ? blocked(found, filePath) : { exitCode: 0 };
}

function failClosed(raw) {
  return findSecrets(raw).length > 0;
}

module.exports = { run, failClosed };
