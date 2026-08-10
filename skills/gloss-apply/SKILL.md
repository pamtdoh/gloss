---
name: gloss-apply
description: Implement the approved design facts of a Gloss review. Use when the user asks to implement a design that went through a Gloss review. Refuses to start unless the review has an approved/ snapshot.
---

# gloss-apply

Turn an approved Gloss design into code. The contract is the
`approved/` snapshot: plain Markdown facts under
`.gloss/<review>/approved/`, readable with no server running.

## Preconditions

1. Identify the review — from the user's prompt, or by listing
   `.gloss/` if there is only one candidate.
2. **Require `.gloss/<review>/approved/` to exist.** The directory is
   the approval; there is no other marker. If it does not exist, stop and
   tell the user the review has not been approved yet — offer to run or
   resume the review instead. Do not implement from a numbered snapshot.

## Implementing

1. Read every fact in `approved/` — including `_index.md` group facts —
   before writing code. Each file is one condensed, decided claim about
   the design; together they are what the human agreed to.
2. Implement the facts in the codebase with your normal tools and the
   project's conventions. Where a fact is silent, use your judgment; where
   code you're writing would contradict a fact, stop and raise it with the
   human rather than quietly diverging.
3. **Do not modify `.gloss/`.** The approved snapshot is the record of
   what was agreed, not a working document. If implementation reveals the
   design needs changing, say so — a new review iteration is the place for
   that, not an edit to `approved/`.
