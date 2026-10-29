'use strict';

/**
 * pre:compact and session:end — saves a short summary of the session
 * (prompts, files changed, last reply) to
 * ~/.claude/mysoftware/sessions/<project>/<date>-auto-<session>.md.
 * Everything stays on this computer.
 */

const fs = require('fs');
const { findProjectRoot, sessionsDir } = require('../lib/paths');
const { summarizeTranscript, isEmpty, formatSummary, saveSummary } = require('../lib/session-summary');

function run(input, context = {}) {
  const env = context.env || process.env;
  const transcriptPath = input && input.transcript_path;
  if (typeof transcriptPath !== 'string' || !fs.existsSync(transcriptPath)) return { exitCode: 0 };

  const cwd = input.cwd || env.CLAUDE_PROJECT_DIR || process.cwd();
  const summary = summarizeTranscript(transcriptPath);
  if (isEmpty(summary)) return { exitCode: 0 };

  const kind = context.hookId === 'pre:compact' ? 'before compaction' : 'session end';
  const markdown = formatSummary(summary, { kind, projectRoot: findProjectRoot(cwd) });
  saveSummary(sessionsDir(cwd, env), markdown, { sessionId: input.session_id });
  return { exitCode: 0 };
}

module.exports = { run };
