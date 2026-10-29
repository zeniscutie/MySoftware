---
description: Fresh-context review of your uncommitted or branch changes - bugs, security, data-loss risks - with only findings that can be proven.
argument-hint: "[optional: branch, commit range or path]"
---

# Review changes

Scope: $ARGUMENTS

1. Work out what to review: the given scope, otherwise staged + unstaged changes
   (`git diff --staged`, `git diff`), otherwise the current branch against `main`
   (`git diff main...HEAD`).
2. Run the review with the `code-reviewer` agent so it starts from a clean context. If agents
   are not available, follow `agents/code-reviewer.md` inline.
3. If theme files changed, also run `liquid-reviewer`. If the change touches tokens,
   webhooks, auth, customer data or store writes, also run `shopify-security-reviewer`.
4. Combine the results into one table sorted by severity, remove duplicates, and give one
   verdict: APPROVE, APPROVE WITH NITS or REQUEST CHANGES.
5. Offer to fix CRITICAL and HIGH findings. Do not change code until the user says so.
