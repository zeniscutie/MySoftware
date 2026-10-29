'use strict';

/** Shared helpers for tests: temp folders and fake transcripts. */

const fs = require('fs');
const os = require('os');
const path = require('path');

function tempDir(t, prefix = 'msw-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A project folder with a .git marker, inside a temp dir. */
function tempProject(t, name = 'demo-store') {
  const root = path.join(tempDir(t), name);
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  return root;
}

const user = text => ({ type: 'user', message: { role: 'user', content: text } });
const assistant = (...content) => ({ type: 'assistant', message: { role: 'assistant', content } });
const text = value => ({ type: 'text', text: value });
const toolUse = (name, input) => ({ type: 'tool_use', id: `tool-${name}`, name, input });

function writeTranscript(dir, entries) {
  const filePath = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(filePath, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  return filePath;
}

module.exports = { tempDir, tempProject, user, assistant, text, toolUse, writeTranscript };
