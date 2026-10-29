'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  readTail,
  summarizeTranscriptText,
  formatSummary,
  saveSummary,
  pruneAutoFiles,
  latestSessionFile
} = require('../../scripts/lib/session-summary');
const { tempDir, user, assistant, text, toolUse } = require('../helpers');

const lines = entries => entries.map(entry => JSON.stringify(entry)).join('\n');

test('extracts prompts, edited files, tool counts and last reply', () => {
  const summary = summarizeTranscriptText(
    lines([
      user('Add a size chart section'),
      assistant(text('Reading the product template.'), toolUse('Read', { file_path: '/p/templates/product.json' })),
      user([{ type: 'tool_result', tool_use_id: 'x', content: 'file contents' }]),
      assistant(toolUse('Write', { file_path: '/p/sections/size-chart.liquid' })),
      assistant(toolUse('Edit', { file_path: '/p/templates/product.json' })),
      user('<command-name>/save-session</command-name>'),
      assistant(text('Done. The section is in place.'))
    ])
  );
  assert.deepStrictEqual(summary.prompts, ['Add a size chart section']);
  assert.deepStrictEqual(summary.filesChanged, ['/p/sections/size-chart.liquid', '/p/templates/product.json']);
  assert.deepStrictEqual(summary.toolCounts, { Read: 1, Write: 1, Edit: 1 });
  assert.strictEqual(summary.lastReply, 'Done. The section is in place.');
});

test('skips broken lines and meta entries', () => {
  const summary = summarizeTranscriptText(
    `not json\n${JSON.stringify({ ...user('hidden'), isMeta: true })}\n${JSON.stringify(user('visible'))}`
  );
  assert.deepStrictEqual(summary.prompts, ['visible']);
});

test('keeps the first two and last prompts when there are many', () => {
  const entries = Array.from({ length: 10 }, (_, i) => user(`prompt ${i}`));
  const { prompts } = summarizeTranscriptText(lines(entries));
  assert.deepStrictEqual(prompts, ['prompt 0', 'prompt 1', '…', 'prompt 6', 'prompt 7', 'prompt 8', 'prompt 9']);
});

test('clips long prompts', () => {
  const { prompts } = summarizeTranscriptText(lines([user('x'.repeat(1000))]));
  assert.strictEqual(prompts[0].length, 300);
  assert.ok(prompts[0].endsWith('…'));
});

test('readTail drops the partial first line when it starts mid-file', t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'big.jsonl');
  fs.writeFileSync(file, `${'a'.repeat(50)}\n{"ok":1}\n`);
  assert.strictEqual(readTail(file, 12), '{"ok":1}\n');
  assert.strictEqual(readTail(file, 1000), `${'a'.repeat(50)}\n{"ok":1}\n`);
});

test('formatSummary shows paths relative to the project', () => {
  const root = path.resolve('/work/store');
  const markdown = formatSummary(
    { prompts: ['Do it'], filesChanged: [path.join(root, 'sections', 'a.liquid')], toolCounts: { Edit: 2 }, lastReply: 'ok' },
    { kind: 'session end', projectRoot: root, now: new Date('2026-10-29T10:00:00Z') }
  );
  assert.match(markdown, /# Session notes \(auto, session end\)/);
  assert.match(markdown, /Saved: 2026-10-29T10:00:00.000Z/);
  assert.ok(markdown.includes(`- ${path.join('sections', 'a.liquid')}`));
  assert.match(markdown, /Edit 2/);
});

test('saveSummary reuses one file per session and prunes old auto files only', t => {
  const dir = tempDir(t);
  const now = new Date('2026-10-29T10:00:00Z');
  const first = saveSummary(dir, 'one', { sessionId: 'abc-123-def-456', now });
  const second = saveSummary(dir, 'two', { sessionId: 'abc-123-def-456', now: new Date('2026-10-30T10:00:00Z') });
  assert.strictEqual(first, second);
  assert.strictEqual(path.basename(first), '2026-10-29-auto-abc123de.md');
  assert.strictEqual(fs.readFileSync(first, 'utf8'), 'two');

  fs.writeFileSync(path.join(dir, '2026-10-01-manual-notes.md'), 'keep me');
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(dir, `2026-09-0${i}-auto-old${i}.md`), 'old');
  pruneAutoFiles(dir, 2);
  const left = fs.readdirSync(dir);
  assert.ok(left.includes('2026-10-01-manual-notes.md'));
  assert.strictEqual(left.filter(name => name.includes('-auto-')).length, 2);
});

test('latestSessionFile returns the newest markdown file or null', t => {
  const dir = tempDir(t);
  assert.strictEqual(latestSessionFile(path.join(dir, 'missing')), null);
  fs.writeFileSync(path.join(dir, 'a.md'), 'a');
  fs.writeFileSync(path.join(dir, 'b.md'), 'b');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c');
  const later = new Date(Date.now() + 60000);
  fs.utimesSync(path.join(dir, 'a.md'), later, later);
  assert.strictEqual(path.basename(latestSessionFile(dir).filePath), 'a.md');
});
