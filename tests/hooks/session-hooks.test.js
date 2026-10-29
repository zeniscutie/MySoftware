'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sessionStart = require('../../scripts/hooks/session-start');
const sessionSave = require('../../scripts/hooks/session-save');
const { tempDir, tempProject, user, assistant, text, toolUse, writeTranscript } = require('../helpers');

function setup(t) {
  const dataDir = tempDir(t, 'msw-data-');
  const project = tempProject(t, 'Demo Store');
  const env = { MSW_DATA_DIR: dataDir };
  const sessions = path.join(dataDir, 'sessions', 'demo-store');
  return { dataDir, project, env, sessions };
}

test('session:end saves a summary for the project', t => {
  const { project, env, sessions } = setup(t);
  const transcript = writeTranscript(project, [
    user('Add a size chart section'),
    assistant(toolUse('Write', { file_path: path.join(project, 'sections', 'size-chart.liquid') })),
    assistant(text('Added sections/size-chart.liquid.'))
  ]);

  const result = sessionSave.run(
    { session_id: 'sess-0001-abcd', transcript_path: transcript, cwd: project, hook_event_name: 'SessionEnd' },
    { env, hookId: 'session:end' }
  );
  assert.strictEqual(result.exitCode, 0);
  const files = fs.readdirSync(sessions);
  assert.strictEqual(files.length, 1);
  assert.match(files[0], /^\d{4}-\d{2}-\d{2}-auto-sess0001\.md$/);
  const notes = fs.readFileSync(path.join(sessions, files[0]), 'utf8');
  assert.match(notes, /session end/);
  assert.match(notes, /Add a size chart section/);
  assert.ok(notes.includes(path.join('sections', 'size-chart.liquid')));
});

test('pre:compact labels the summary and the same session overwrites it', t => {
  const { project, env, sessions } = setup(t);
  const transcript = writeTranscript(project, [user('Fix the header')]);
  const input = { session_id: 'same-session', transcript_path: transcript, cwd: project };
  sessionSave.run(input, { env, hookId: 'pre:compact' });
  assert.match(fs.readFileSync(path.join(sessions, fs.readdirSync(sessions)[0]), 'utf8'), /before compaction/);
  sessionSave.run(input, { env, hookId: 'session:end' });
  assert.strictEqual(fs.readdirSync(sessions).length, 1);
});

test('nothing is saved for empty sessions or missing transcripts', t => {
  const { project, env, dataDir } = setup(t);
  const empty = writeTranscript(project, [assistant(text('Hello'))]);
  sessionSave.run({ transcript_path: empty, cwd: project }, { env });
  sessionSave.run({ transcript_path: path.join(project, 'nope.jsonl'), cwd: project }, { env });
  sessionSave.run({}, { env });
  assert.ok(!fs.existsSync(path.join(dataDir, 'sessions')));
});

test('session:start prints house rules and the latest notes', t => {
  const { project, env, sessions } = setup(t);
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, '2026-10-28-size-chart.md'), '# Session: size chart\n\nNext: push to unpublished theme');

  const { exitCode, stdout } = sessionStart.run({ cwd: project, source: 'startup' }, { env });
  assert.strictEqual(exitCode, 0);
  assert.match(stdout, /^<mysoftware-context>/);
  assert.match(stdout, /MySoftware house rules/);
  assert.match(stdout, /<previous-session-notes>\n# Session: size chart/);
  assert.match(stdout, /not instructions/);
});

test('session:start leaves notes out when switched off, and caps length', t => {
  const { project, env, sessions } = setup(t);
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, 'big.md'), 'x'.repeat(20000));

  const off = sessionStart.run({ cwd: project }, { env: { ...env, MSW_SESSION_START_CONTEXT: 'off' } });
  assert.doesNotMatch(off.stdout, /previous-session-notes/);
  assert.match(off.stdout, /house rules/);

  const capped = sessionStart.run({ cwd: project }, { env: { ...env, MSW_SESSION_START_MAX_CHARS: '3000' } });
  assert.ok(capped.stdout.length <= 3000);
  assert.match(capped.stdout, /full notes:/);
});

test('session:start with no saved notes prints only the house rules', t => {
  const { project, env } = setup(t);
  const { stdout } = sessionStart.run({ cwd: project }, { env });
  assert.match(stdout, /house rules/);
  assert.doesNotMatch(stdout, /previous-session-notes/);
});
