---
description: Save what this session did, what worked, what failed and what is next, so a later session on this computer can pick up where you left off.
argument-hint: "[optional short title]"
---

# Save session

Title: $ARGUMENTS

Follow the `session-memory` skill.

1. **Find the folder**: `~/.claude/mysoftware/sessions/<project>/` (use `$MSW_DATA_DIR` in
   place of `~/.claude/mysoftware` if that variable is set). `<project>` is the name of the
   project's root folder (the one with `.git`), lowercased, with every run of characters other
   than `a-z` and `0-9` replaced by a single `-` (for example `My Store Theme` → `my-store-theme`).
   Create it if missing.
2. **Name the file** `YYYY-MM-DD-<short-title>.md` using today's date and a 2-5 word
   lowercase-hyphen title (from the argument, or from the work).
3. **Write these sections**, honestly; write "None" rather than skipping one:

```markdown
# Session: <title> (<date>)

Project: <folder>   Branch: <git branch>

## Goal
<what we are building or fixing, and why — enough for someone with no memory of this session>

## Done (with evidence)
- <thing> — confirmed by <test run / preview link / command output>

## Tried and failed (and why)
- <approach> — failed because <exact reason or error>

## Decisions
- <decision> — because <reason>

## Open questions / blockers
- <question>

## Next steps
1. <first thing to do next session>

## Files touched
- <path> — <what changed>
```

4. Do not include secrets, tokens or customer personal data.
5. Show the user the saved path and the contents, and ask if anything should be corrected.
