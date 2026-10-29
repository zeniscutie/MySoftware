#!/usr/bin/env node
/**
 * Validates agents/, commands/ and skills/ against the house conventions.
 * Usage: node scripts/ci/validate-content.js [root]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./frontmatter');

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KNOWN_TOOLS = new Set([
  'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch',
  'NotebookEdit', 'TodoWrite', 'Task', 'Agent'
]);
const MODELS = new Set(['inherit', 'sonnet', 'opus', 'haiku']);
const SKILL_SECTIONS = ['## When to Use', '## How It Works', '## Examples'];
const MAX_SKILL_LINES = 500;
const MIN_DESCRIPTION = 40;

function markdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => name.endsWith('.md')).sort();
}

function readFrontmatter(filePath, errors, label) {
  const parsed = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
  if (!parsed) errors.push(`${label}: missing YAML frontmatter`);
  return parsed;
}

function checkDescription(data, errors, label) {
  const description = data.description;
  if (typeof description !== 'string' || description.trim().length < MIN_DESCRIPTION) {
    errors.push(`${label}: description must say when to use it (at least ${MIN_DESCRIPTION} characters)`);
  }
}

function validateAgents(root) {
  const errors = [];
  const dir = path.join(root, 'agents');
  for (const file of markdownFiles(dir)) {
    const label = `agents/${file}`;
    const base = file.replace(/\.md$/, '');
    if (!NAME.test(base)) errors.push(`${label}: file name must be lowercase-with-hyphens`);
    const parsed = readFrontmatter(path.join(dir, file), errors, label);
    if (!parsed) continue;
    const { data, body } = parsed;
    if (data.name !== base) errors.push(`${label}: name "${data.name}" must match the file name "${base}"`);
    checkDescription(data, errors, label);
    if (typeof data.tools !== 'string' || !data.tools.trim()) {
      errors.push(`${label}: tools must be a comma-separated list on one line (e.g. "Read, Grep, Glob")`);
    } else {
      for (const tool of data.tools.split(',').map(t => t.trim()).filter(Boolean)) {
        if (!KNOWN_TOOLS.has(tool)) errors.push(`${label}: unknown tool "${tool}"`);
      }
    }
    if (data.model !== undefined && !MODELS.has(data.model)) {
      errors.push(`${label}: model must be one of ${[...MODELS].join(', ')}`);
    }
    if (!/^##\s/m.test(body)) errors.push(`${label}: body needs at least one "## " section`);
  }
  return errors;
}

function validateCommands(root) {
  const errors = [];
  const dir = path.join(root, 'commands');
  for (const file of markdownFiles(dir)) {
    const label = `commands/${file}`;
    if (!NAME.test(file.replace(/\.md$/, ''))) errors.push(`${label}: file name must be lowercase-with-hyphens`);
    const parsed = readFrontmatter(path.join(dir, file), errors, label);
    if (!parsed) continue;
    checkDescription(parsed.data, errors, label);
    if (!parsed.body.trim()) errors.push(`${label}: empty body`);
  }
  return errors;
}

function validateSkills(root) {
  const errors = [];
  const dir = path.join(root, 'skills');
  if (!fs.existsSync(dir)) return errors;
  for (const name of fs.readdirSync(dir).sort()) {
    const skillDir = path.join(dir, name);
    if (!fs.statSync(skillDir).isDirectory()) continue;
    const label = `skills/${name}/SKILL.md`;
    if (!NAME.test(name)) errors.push(`skills/${name}: folder name must be lowercase-with-hyphens`);
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      errors.push(`${label}: missing`);
      continue;
    }
    const text = fs.readFileSync(skillFile, 'utf8');
    const parsed = readFrontmatter(skillFile, errors, label);
    if (!parsed) continue;
    if (parsed.data.name !== name) errors.push(`${label}: name "${parsed.data.name}" must match the folder name`);
    checkDescription(parsed.data, errors, label);
    for (const section of SKILL_SECTIONS) {
      if (!parsed.body.split(/\r?\n/).includes(section)) errors.push(`${label}: missing section "${section}"`);
    }
    const lines = text.split(/\r?\n/).length;
    if (lines > MAX_SKILL_LINES) {
      errors.push(`${label}: ${lines} lines; keep under ${MAX_SKILL_LINES} and move detail to references/`);
    }
  }
  return errors;
}

function validateContent(root) {
  return [...validateAgents(root), ...validateCommands(root), ...validateSkills(root)];
}

if (require.main === module) {
  const errors = validateContent(path.resolve(process.argv[2] || path.join(__dirname, '..', '..')));
  for (const error of errors) console.error(`✗ ${error}`);
  if (errors.length === 0) console.log('✓ agents, commands and skills');
  process.exitCode = errors.length ? 1 : 0;
}

module.exports = { validateAgents, validateCommands, validateSkills, validateContent };
