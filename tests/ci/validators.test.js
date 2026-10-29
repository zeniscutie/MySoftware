'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('../../scripts/ci/frontmatter');
const { validateContent } = require('../../scripts/ci/validate-content');
const { validatePlugin } = require('../../scripts/ci/validate-plugin');
const { scanRepo } = require('../../scripts/ci/scan-repo');
const { tempDir } = require('../helpers');

const ROOT = path.join(__dirname, '..', '..');

/** Copies the real plugin into a temp folder so a test can break one thing. */
function copyPlugin(t) {
  const dir = tempDir(t, 'msw-plugin-');
  for (const entry of ['.claude-plugin', '.mcp.json', 'agents', 'commands', 'skills', 'hooks', 'scripts', 'rules', 'package.json', 'CHANGELOG.md']) {
    fs.cpSync(path.join(ROOT, entry), path.join(dir, entry), { recursive: true });
  }
  return dir;
}

const write = (dir, file, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
};
const editJson = (dir, file, change) => {
  const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  change(data);
  fs.writeFileSync(path.join(dir, file), JSON.stringify(data, null, 2));
};

test('the real plugin passes every validator', () => {
  assert.deepStrictEqual(validateContent(ROOT), []);
  assert.deepStrictEqual(validatePlugin(ROOT), []);
  assert.deepStrictEqual(scanRepo(ROOT), []);
});

test('frontmatter parser handles scalars, folded lines, lists and maps', () => {
  const parsed = parseFrontmatter([
    '---',
    'name: x',
    'description: "first part',
    '  second part"',
    'tools:',
    '  - Read',
    '  - Grep',
    'metadata:',
    '  origin: ECC',
    '---',
    'body'
  ].join('\n'));
  assert.strictEqual(parsed.data.name, 'x');
  assert.strictEqual(parsed.data.description, '"first part second part"');
  assert.deepStrictEqual(parsed.data.tools, ['Read', 'Grep']);
  assert.deepStrictEqual(parsed.data.metadata, { origin: 'ECC' });
  assert.strictEqual(parsed.body, 'body');
  assert.strictEqual(parseFrontmatter('no frontmatter'), null);
});

test('catches broken agents', t => {
  const dir = copyPlugin(t);
  write(dir, 'agents/Bad_Name.md', '---\nname: other\ndescription: short\ntools:\n  - Read\nmodel: gpt\n---\nno sections');
  const errors = validateContent(dir).join('\n');
  assert.match(errors, /lowercase-with-hyphens/);
  assert.match(errors, /must match the file name/);
  assert.match(errors, /description must say when/);
  assert.match(errors, /comma-separated list on one line/);
  assert.match(errors, /model must be one of/);
  assert.match(errors, /needs at least one "## " section/);
});

test('catches unknown agent tools', t => {
  const dir = copyPlugin(t);
  write(dir, 'agents/helper.md', `---\nname: helper\ndescription: ${'Use when helping with things. '.repeat(3)}\ntools: Read, Teleport\n---\n## Role\n`);
  assert.match(validateContent(dir).join('\n'), /unknown tool "Teleport"/);
});

test('catches broken commands and skills', t => {
  const dir = copyPlugin(t);
  write(dir, 'commands/no-front.md', '# nothing');
  write(dir, 'skills/half-done/SKILL.md', `---\nname: half-done\ndescription: ${'Use when testing the validator. '.repeat(3)}\n---\n## When to Use\n`);
  fs.mkdirSync(path.join(dir, 'skills', 'empty-skill'));
  const errors = validateContent(dir).join('\n');
  assert.match(errors, /commands\/no-front\.md: missing YAML frontmatter/);
  assert.match(errors, /half-done\/SKILL\.md: missing section "## How It Works"/);
  assert.match(errors, /empty-skill\/SKILL\.md: missing/);
});

test('catches manifest problems', t => {
  const dir = copyPlugin(t);
  editJson(dir, '.claude-plugin/plugin.json', plugin => {
    plugin.agents = './agents/';
    plugin.skills = './skills/';
    plugin.version = '9.9.9';
  });
  const errors = validatePlugin(dir).join('\n');
  assert.match(errors, /do not add "agents"/);
  assert.match(errors, /skills must be an array/);
  assert.match(errors, /version mismatch: package\.json/);
  assert.match(errors, /CHANGELOG\.md: no "## 9\.9\.9"/);
});

test('catches hook wiring problems', t => {
  const dir = copyPlugin(t);
  editJson(dir, 'hooks/hooks.json', config => {
    config.description = 'not allowed';
    config.hooks.Stop = [{ hooks: [{ type: 'command', command: 'bash ./x.sh', timeout: 5 }] }];
    config.hooks.PreToolUse[0].hooks.push({
      type: 'command',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/run-with-flags.js" pre:bash:extra missing.js bogus'
    });
  });
  editJson(dir, 'hooks/hooks.metadata.json', metadata => {
    metadata.hooks.push({ id: 'ghost', event: 'Stop', description: 'not wired' });
  });
  const errors = validatePlugin(dir).join('\n');
  assert.match(errors, /hooks\.json: unexpected key "description"/);
  assert.match(errors, /command must be: node/);
  assert.match(errors, /scripts\/hooks\/missing\.js not found/);
  assert.match(errors, /no valid profiles in "bogus"/);
  assert.match(errors, /timeout must be 1-120 seconds/);
  assert.match(errors, /no entry for "pre:bash:extra"/);
  assert.match(errors, /"ghost" is not wired/);
});

test('repository scan catches tokens and personal paths', t => {
  const dir = tempDir(t);
  write(dir, 'config.js', `export const token = "${'shp'}at_${'ab'.repeat(16)}";`);
  write(dir, 'notes.md', `see ${'/Users/'}someone/store`);
  write(dir, 'ok.md', 'tokens live in ~/.claude and .env');
  const errors = scanRepo(dir).join('\n');
  assert.match(errors, /config\.js: contains a Shopify Admin API access token/);
  assert.match(errors, /notes\.md: contains a personal path/);
  assert.doesNotMatch(errors, /ok\.md/);
});
