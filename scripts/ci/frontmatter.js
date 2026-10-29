'use strict';

/**
 * Minimal YAML frontmatter reader for agent, command and skill files.
 * Supports `key: value`, quoted values, folded continuation lines, `key:`
 * followed by `- item` lists, and one level of nested `key: value` maps.
 * Returns { data, body } or null when the file has no frontmatter.
 */

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && /^(["']).*\1$/.test(trimmed)) return trimmed.slice(1, -1);
  return trimmed;
}

function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(String(text));
  if (!match) return null;

  const data = {};
  let lastKey = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indented = /^\s+/.test(line);
    const listItem = /^\s*-\s+(.*)$/.exec(line);

    if (indented && lastKey) {
      if (listItem) {
        if (!Array.isArray(data[lastKey])) data[lastKey] = [];
        data[lastKey].push(unquote(listItem[1]));
        continue;
      }
      const nested = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (nested && (data[lastKey] === '' || typeof data[lastKey] === 'object')) {
        if (typeof data[lastKey] !== 'object' || Array.isArray(data[lastKey])) data[lastKey] = {};
        data[lastKey][nested[1]] = unquote(nested[2]);
        continue;
      }
      if (typeof data[lastKey] === 'string') {
        data[lastKey] = `${data[lastKey]} ${line.trim()}`.trim();
        continue;
      }
    }

    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (pair) {
      data[pair[1]] = unquote(pair[2]);
      lastKey = pair[1];
    }
  }
  return { data, body: text.slice(match[0].length) };
}

module.exports = { parseFrontmatter };
