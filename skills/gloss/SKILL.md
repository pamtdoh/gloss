---
name: gloss
description: Generate a files-first design review of a repository as small, decidable facts under .gloss/, for a human to review. Use when the user asks for a design review or architecture review of their codebase or any part of it.
---

# gloss

Gloss condenses a codebase's design into small facts — one Markdown file
each, reviewable without reading source — as plain files under `.gloss/`
in the target repo. Read and write them with your normal tools; no
command mediates state.

## The scope is the user's prompt

Whatever the user asked to have reviewed *is* the scope — Gloss has no
scoping semantics of its own. If the prompt is ambiguous, ask, or state
the scope you inferred when you present the review.

## Generate revision 1

1. **Ensure the repo is initialized.** Run `gloss init` at the repo
   root. It is idempotent and prints a JSON result.

2. **Read the code — and run it when facts will need evidence.**
   Inspect the repository with normal read tools until you understand
   the design within the requested scope. You are condensing design,
   not summarizing files — organize by what the system *is*, not by
   its directory layout. Whenever facts will need evidence only
   execution can produce — screenshots, transcripts, probes; any
   visual scope qualifies — get the app runnable (staged state is
   fine) now and keep it so through writing, capturing each piece as
   a fact needs it. Ask the user first only when getting it running
   would need setup you'd have to build (no launch path, no browser
   tooling available).

3. **Create the review directory.** Pick a short kebab-case review name
   from the user's prompt (e.g. `checkout-flow`, `design-review`) and
   create `.gloss/<review>/1/`. Revision `1` is the fact tree you are
   about to write.

4. **Write the facts.** Shape the tree yourself — it should mirror the
   design's shape. How to *write* each fact is the contract in
   [references/writing-facts.md](references/writing-facts.md),
   installed next to this file; read it before the first fact. Its
   core: **the reviewer never opens the code** — everything needed to
   judge a claim lives inside the fact. What governs the tree:

   - **One condensed, decidable fact per `.md` file.** A fact is a claim
     about the design that the human can judge on its own: let it stand
     or comment on it. If they'd have to say "well, parts of it…",
     split it.
   - **Kebab-case filenames** named for the subject
     (`collision-retry.md`, not `fact-07.md`).
   - **Number facts when the group tells a story.** Everything sorts
     alphabetically, so numeric prefixes (`10-auth.md`, `20-sessions.md`)
     make narrative order the reading order. Skip numbering where order
     doesn't matter.
   - **Group related facts in directories.** When a group forms a coherent
     whole, add an `_index.md` — a fact about the group itself that also
     carries the group's shared context, so no child fact needs a
     preamble. Skip it where it would be boilerplate.
   - **State the design; don't review it yourself.** Facts describe what
     the design does, including its sharp edges, in neutral terms. The
     verdict belongs to the human.
   - **Revision 1 is facts only.** Sidecar files (`*.review.json`) are the
     human's review state, written during review — never at generation.

5. **Re-read, then hand it to the human.**

   - **Cold reader (if you can spawn subagents).** Send one
     fresh-context agent only `references/writing-facts.md` and the
     revision directory, and ask it for a defect list — fact, the
     contract duty or rule it fails, what's missing. Launch it first
     and do the altitude pass while it works; when it returns, apply
     what's real, drop what's invented.
   - **Altitude pass.** Re-read the whole revision in tree order, as
     the reviewer will, and fix what only shows at that altitude: two
     facts that contradict each other, a term used before the fact
     that introduces it, a load-bearing fact buried last.
   - **Contract pass — only if no subagents.** With no cold reader,
     hold each fact against the writing contract yourself — every
     rule in `references/writing-facts.md`, not a remembered summary.

   Then show the tree of `.gloss/<review>/1/` and run the
   session (below) — or, for terminal-only review, print the facts
   themselves and take decisions in conversation.

## Run the session under one monitor

Start the session as a single background monitor whose event stream is
the command's stdout:

```
gloss session <review>
```

It serves the review's latest revision on loopback and blocks until the human clicks
**Finish review** or approves. Stdout is JSONL, one event per line:
`session.started` (includes the one-time viewer `url` — share it if the
human's browser didn't open), `question.asked`, `question.replied` (the
human replied in an existing thread), `session.finished`, then a final
JSON summary (comment count, open questions, approval status).

One listener covers everything — in Claude Code, run the command via the
Monitor tool with `persistent: true`. Each stdout line wakes you; the
process exiting is the completion signal. Don't add a second watcher or
a poll loop on top.

## Answer questions live, while the session runs

When a `question.asked` or `question.replied` event arrives, answer
without waiting for the review to finish:

1. Read the sidecar of the fact named in the event's `path` — the fact's
   filename with `.md` replaced by `.review.json` (`collision-retry.md`
   → `collision-retry.review.json`) — and find the question item by `id`.
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
   `.gloss/<review>/<n+1>` recursively. Revisions are standalone copies —
   no links, no shared state.
3. In the new revision, resolve what was raised: rewrite, amend, split, or
   delete facts per the comments; answer or settle questions. When you
   judge an item resolved, delete it from the sidecar; delete the sidecar
   file when nothing remains. Carry unresolved items forward untouched.
4. Run another session on the new revision. Silence is agreement: a
   revision with no sidecars is fully addressed.

When the session finishes with no sidecars and no approval, ask the
human how to proceed — a comment-free finish is not approval, and you
never create `approved/` on your own.

## Approval

Approval is one act, at the end: the accepted revision copied to
`.gloss/<review>/approved/`. The viewer's Approve button does this
itself; if the human instead approves in conversation, copy
`.gloss/<review>/<n>` to `.gloss/<review>/approved` the same way. Copy
the revision as it stands, remaining sidecars included — approval
accepts the revision with whatever notes are still open.

The directory existing *is* the approval — no metadata. The
`gloss-apply` skill requires it.

## Terminal-only review

No browser is required at any step. The facts are ordinary Markdown:
print them, take comments and questions in conversation, and either
write sidecars yourself to keep the same record or iterate directly on
what was said. Approval is the same recursive copy either way.
