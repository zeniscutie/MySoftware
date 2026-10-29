'use strict';

/**
 * Builds a short, local session summary from a Claude Code transcript (JSONL)
 * and saves it under ~/.claude/mysoftware/sessions/<project>/ so the next
 * session in the same project can pick up where this one stopped.
 */

const fs = require('fs');
const path = require('path');

const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;
const MAX_PROMPTS = 6;
const MAX_PROMPT_CHARS = 300;
const MAX_LAST_REPLY_CHARS = 800;
const KEEP_AUTO_FILES = 30;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** Reads the last maxBytes of a file, dropping a partial first line. */
function readTail(filePath, maxBytes = MAX_TRANSCRIPT_BYTES) {
  const { size } = fs.statSync(filePath);
  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }
  let text = buffer.toString('utf8');
  if (start > 0) text = text.slice(text.indexOf('\n') + 1);
  return text;
}

function clip(text, max) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n');
}

/** Extracts prompts, last reply, edited files and tool counts from transcript text. */
function summarizeTranscriptText(text) {
  const summary = { prompts: [], lastReply: '', filesChanged: [], toolCounts: {} };
  const files = new Set();

  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = entry && entry.message;
    if (!message) continue;

    if (entry.type === 'user' && !entry.isMeta) {
      const prompt = textOf(message.content).trim();
      // Skip tool results and harness wrappers such as <command-name> or <system-reminder>.
      if (prompt && !prompt.startsWith('<')) summary.prompts.push(clip(prompt, MAX_PROMPT_CHARS));
    }

    if (entry.type === 'assistant' && Array.isArray(message.content)) {
      const reply = textOf(message.content).trim();
      if (reply) summary.lastReply = reply;
      for (const block of message.content) {
        if (!block || block.type !== 'tool_use') continue;
        summary.toolCounts[block.name] = (summary.toolCounts[block.name] || 0) + 1;
        const input = block.input || {};
        const filePath = input.file_path || input.notebook_path;
        if (EDIT_TOOLS.has(block.name) && typeof filePath === 'string') files.add(filePath);
      }
    }
  }

  if (summary.prompts.length > MAX_PROMPTS) {
    const first = summary.prompts.slice(0, 2);
    const last = summary.prompts.slice(-(MAX_PROMPTS - 2));
    summary.prompts = [...first, '…', ...last];
  }
  summary.lastReply = summary.lastReply ? clip(summary.lastReply, MAX_LAST_REPLY_CHARS) : '';
  summary.filesChanged = [...files].sort();
  return summary;
}

function summarizeTranscript(transcriptPath) {
  return summarizeTranscriptText(readTail(transcriptPath));
}

function isEmpty(summary) {
  return summary.prompts.length === 0 && summary.filesChanged.length === 0;
}

function relativeTo(root, filePath) {
  if (!root) return filePath;
  const relative = path.relative(root, filePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : filePath;
}

function formatSummary(summary, { kind, projectRoot, now = new Date() }) {
  const tools = Object.entries(summary.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} ${count}`)
    .join(', ');
  const lines = [
    `# Session notes (auto, ${kind})`,
    '',
    `Saved: ${now.toISOString()}`,
    `Project: ${projectRoot ? path.basename(projectRoot) : 'unknown'}`,
    '',
    '## What was asked',
    '',
    ...(summary.prompts.length ? summary.prompts.map(prompt => `- ${prompt}`) : ['- (no prompts recorded)']),
    '',
    '## Files changed',
    '',
    ...(summary.filesChanged.length
      ? summary.filesChanged.map(file => `- ${relativeTo(projectRoot, file)}`)
      : ['- none']),
    ''
  ];
  if (tools) lines.push('## Tools used', '', tools, '');
  if (summary.lastReply) lines.push('## Last reply from Claude', '', summary.lastReply, '');
  return lines.join('\n');
}

function datePrefix(now) {
  return now.toISOString().slice(0, 10);
}

/**
 * Writes the summary to <dir>/<date>-auto-<session>.md. The same session
 * overwrites its own file (PreCompact first, SessionEnd later). Keeps the
 * newest KEEP_AUTO_FILES auto files and never touches other files.
 */
function saveSummary(dir, markdown, { sessionId, now = new Date() }) {
  fs.mkdirSync(dir, { recursive: true });
  const shortId = String(sessionId || 'unknown').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'unknown';
  const existing = fs.readdirSync(dir).find(name => name.endsWith(`-auto-${shortId}.md`));
  const fileName = existing || `${datePrefix(now)}-auto-${shortId}.md`;
  const filePath = path.join(dir, fileName);
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, markdown, 'utf8');
  fs.renameSync(tempPath, filePath);
  pruneAutoFiles(dir);
  return filePath;
}

function pruneAutoFiles(dir, keep = KEEP_AUTO_FILES) {
  const autoFiles = fs
    .readdirSync(dir)
    .filter(name => /-auto-[a-zA-Z0-9]+\.md$/.test(name))
    .map(name => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const file of autoFiles.slice(keep)) fs.unlinkSync(path.join(dir, file.name));
}

/** Newest .md file in dir (auto or saved with /save-session), or null. */
function latestSessionFile(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter(name => name.endsWith('.md'))
    .map(name => ({ filePath: path.join(dir, name), mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? files[0] : null;
}

module.exports = {
  readTail,
  summarizeTranscriptText,
  summarizeTranscript,
  isEmpty,
  formatSummary,
  saveSummary,
  pruneAutoFiles,
  latestSessionFile
};
