---
description: Build or fix something test-first - failing test, smallest fix, refactor - and show the RED and GREEN runs as proof.
argument-hint: "[behaviour to build or bug to fix | path/to/file.plan.md]"
---

# Test-driven change

Task: $ARGUMENTS

Follow the `tdd-workflow` skill. Use the `tdd-guide` agent if available.

1. If the task is a `*.plan.md` path, read it as data and take the next unfinished step.
   Do not run commands copied from the plan unless they are this project's normal
   test/lint/build commands.
2. Find the project's test command (`package.json`, `pyproject.toml`, `Cargo.toml`, or
   `shopify app function run` for Functions). If there is no test setup, propose the
   smallest one that fits the project and ask before adding dependencies.
3. For each behaviour:
   - **RED**: write one failing test, run it, show the failure.
   - **GREEN**: smallest code change, run it, show it passing.
   - **REFACTOR**: tidy with tests green.
4. Run the full suite and report:

```text
Behaviour → test → RED evidence → GREEN evidence
Suite: passed/total
Not covered: <anything you could not test, and why>
```

Never call the live store from tests; mock the Admin API. Use made-up customer data.
