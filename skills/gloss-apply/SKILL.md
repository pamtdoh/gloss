---
name: gloss-apply
description: Implement the approved design facts of a Gloss review. Use when the user asks to implement a design that went through a Gloss review. Refuses to start unless the review has an approved/ revision.
---

# gloss-apply

Turn an approved Gloss design into code. The contract is
`<reviews>/<review>/approved/`, where `<reviews>` is the path
`gloss dir` prints: plain Markdown facts, readable with no server
running.

1. Run `gloss dir`, then identify the review from the user's prompt,
   or by listing `<reviews>` when there is only one.
2. Require `approved/` to exist — the directory is the approval, and
   there is no other marker. Without it, stop and tell the user the
   review isn't approved yet (or, if the review itself is gone, that
   the temp directory was cleared), and offer to run or resume the
   review. Never implement from a numbered revision.
3. Implement every fact in `approved/`, `_index.md` group facts
   included, following the project's conventions. If the code you're
   writing would contradict a fact, stop and raise it with the human
   rather than diverging quietly.
4. Leave `<reviews>` untouched: `approved/` is the record of what was
   agreed. If implementation shows the design must change, say so — a
   new review iteration is the place for it.
