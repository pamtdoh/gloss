---
name: gloss
description: Generate a files-first design review of a repository as small, decidable facts under .gloss/, for a human to review. Use when the user asks for a design review of their codebase or any part of it.
---

# gloss

Gloss condenses the design of a codebase into small facts — one Markdown
file each — that a human can review without reading source. Everything is
plain files under `.gloss/` in the target repo. You read and write those
files directly with your normal tools; no command mediates state.

## The scope is the user's prompt

Whatever the user asked to have reviewed *is* the scope. Gloss has no
scoping semantics of its own — don't invent any. If the prompt is ambiguous,
ask, or state the scope you inferred when you present the review.

## Generate revision 1

1. **Ensure the repo is initialized.** Run `gloss init` at the repo
   root. It is idempotent and prints a JSON result.

2. **Read the code.** Inspect the repository with normal read tools until
   you understand the design within the requested scope. You are condensing
   design, not summarizing files — organize by what the system *is*, not by
   its directory layout.

3. **Create the review directory.** Pick a short kebab-case review name
   from the user's prompt (e.g. `checkout-flow`, `design-review`) and
   create `.gloss/<review>/1/`. Revision `1` is the fact tree you are
   about to write.

4. **Write the facts.** Shape the tree yourself — it should mirror the
   design's shape. How to *write* each fact — the cold-reader rule,
   story shape, rationale callouts, tables and diagrams, screenshots —
   is the contract in
   [references/writing-facts.md](references/writing-facts.md),
   installed next to this file. Read it before the first fact; its core
   is that **the reviewer never opens the code**: everything needed to
   judge a claim lives inside the fact. What governs the tree:

   - **One condensed, decidable fact per `.md` file.** A fact is a claim
     about the design that the human can judge on its own: let it stand
     (silence is agreement) or comment on it (the viewer offers one-tap
     quick-comment presets like "Not needed." and "Simplify."). If they'd have to say
     "well, parts of it…", split it.
   - **Kebab-case filenames** named for the subject
     (`collision-retry.md`, not `fact-07.md`).
   - **Number facts when the group tells a story.** Everything sorts
     alphabetically, so numeric prefixes (`10-auth.md`, `20-sessions.md`)
     make narrative order the reading order. Skip numbering where order
     doesn't matter.
   - **Group related facts in directories.** When a group forms a coherent
     whole, add an `_index.md` — a fact about the group itself that also
     sets the scene for its children, so no child fact starts from zero.
     Skip it where it would be boilerplate.
   - **State the design; don't review it yourself.** Facts describe what
     the design does, including its sharp edges, in neutral terms. The
     verdict belongs to the human.
   - **Revision 1 is facts only.** Sidecar files (`*.review.json`) are the
     human's review state, written during review — never at generation.

5. **Re-read, then hand it to the human.** Re-read the whole revision
   in tree order, as the reviewer will (the contract lists what only
   shows at that altitude). Then show the tree of `.gloss/<review>/1/`
   and run the session (below) — or, for terminal-only review, print
   the facts themselves and take decisions in conversation.

## Run the session under one monitor

Start the session as a single background monitor whose event stream is
the command's stdout:

```
gloss session <review>
```

It serves the viewer on loopback and blocks until the human clicks
**Finish review** or approves. Stdout is JSONL, one event per line:
`session.started` (includes the one-time viewer `url` — share it if the
human's browser didn't open), `question.asked`, `session.finished`, then
a final JSON summary (comment count, open questions, approval status).

One listener covers everything — in Claude Code, run the command via the
Monitor tool with `persistent: true` (reviews outlast default timeouts).
Each stdout line wakes you; the process exiting is the completion
signal. Don't add a second watcher or a poll loop on top.

## Answer questions live, while the session runs

When a `question.asked` event arrives, answer without waiting for the
review to finish:

1. Read the fact's `<fact>.review.json`, find the question item by `id`.
2. Append `{ "who": "agent", "text": "…" }` to its `thread` and write the
   file back. `text` may use Markdown.
3. The viewer picks the answer up within a few seconds; the human can
   reply in the same thread.

Never delete items while a session is live — deletion means *resolved*,
and resolution happens during iteration.

## Iterate

When the session finishes with sidecars present:

1. Read every `*.review.json` in the revision wholesale, then propose next
   steps to the human before rewriting anything they'd rather discuss.
2. Copy the revision directory `.gloss/<review>/<n>` to
   `.gloss/<review>/<n+1>` recursively (`cp -r`, `Copy-Item -Recurse`,
   or your own file tools). Revisions are standalone copies — no links,
   no shared state.
3. In the new revision, resolve what was raised: rewrite, amend, split, or
   delete facts per the comments; answer or settle questions. When you
   judge an item resolved, delete it from the sidecar; delete the sidecar
   file when nothing remains. Carry unresolved items forward untouched.
4. Run another session on the new revision. A revision with no sidecars is
   one where everything the human raised has been addressed — silence is
   agreement.

## Approval

Approval is one act, at the end: the accepted revision copied to
`.gloss/<review>/approved/`. The viewer's Approve button does this
itself; if the human instead approves in conversation, copy
`.gloss/<review>/<n>` to `.gloss/<review>/approved` the same way.

The directory existing *is* the approval — no metadata, no ceremony. The
`gloss-apply` skill starts from `approved/` and refuses to run
without it.

## Terminal-only review

No browser is required at any step. The facts are ordinary Markdown: print
them, let the human give comments and questions in conversation, and either write sidecars yourself to keep the same record —
you own the files as much as the viewer does — or skip sidecars and
iterate directly on what they said. Approval is the same recursive copy
either way.
