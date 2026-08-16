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

   Finish with the checklist at the end of
   `references/writing-facts.md`, run over the whole tree by
   searching rather than rereading. It is part of writing, not a
   verification pass.

5. **Verify on request, then hand it to the human.**

   When you present the review, tell the human they can ask for a
   verification pass, and that they can say how thorough it should
   be. The trade is theirs: without the request the review arrives
   fast, and with it the tree gets fresh-eyed checks before they
   read. Without that request, serve the revision directly.

   Verification runs in subagents only, never as your own re-read,
   because the author fills gaps from memory that a fresh reader
   would have to notice:

   - **Mechanical check.** Send one fresh-context agent
     `references/writing-facts.md` and the revision directory, with
     one mandate: the wording table and the finishing checklist,
     nothing else. Its hits are pattern matches, so apply every
     one.
   - **Contract check.** Send a second fresh-context agent only
     `references/writing-facts.md` and the revision directory. Ask
     it for a defect list: fact, the rule it fails, what's missing.
   - **Tree check.** Send a third fresh-context agent this
     SKILL.md and the revision directory. Ask it for tree-level
     defects: two facts that contradict each other, a term used
     before the fact that introduces it, a load-bearing fact buried
     last, a tree rule from step 4 broken.

   Launch all of them together and make no edits while they run, because
   an edit mid-check splits the tree into two states, one per
   reader. When all return, merge the lists, then apply what's
   real and drop what's invented.

   If you cannot spawn subagents, fall back to checking the
   revision yourself: hold each fact against every rule in
   `references/writing-facts.md`, and the tree against the rules in
   step 4, reading the actual rules rather than a remembered
   summary, because your memory of the text is what the check
   exists to correct. Tell the human the check was your own re-read
   rather than a fresh reader's, so they can weigh it accordingly.

   Then show the tree of `.gloss/<review>/1/` and run the session
   (below). For terminal-only review, print the facts themselves
   and take decisions in conversation instead.

## Run the session under one supervisor

```
gloss session <review>
```

It serves the review's latest revision on loopback and blocks until
the human clicks **Finish review** or approves. Stdout is JSONL,
one event per line. The events are `session.started` (with the
one-time viewer `url` to share if the human's browser didn't open),
`question.asked`, `question.replied` (the human replied in an
existing thread), and `session.finished`. A final JSON summary
follows, with the comment count, open questions, and approval
status. The session also writes every line to
`.gloss/.local/<review>/session.jsonl`, so the event stream is
always readable as a file.

**The goal, in whatever way your harness supports it.** One
supervisor owns this process for its whole life, because two
watchers split the event stream and each answers half the
questions. You see every line it prints, in order, exactly once,
and you notice promptly when the process exits. Act on each
question as it arrives, because the human is sitting in front of
the viewer: an answer that lands while they are still reading
changes the review they are giving you, and the same answer after
they close the tab is a note for next time.

**How to get there.** Take the first of these your harness can
actually do.

If your harness can push each new line of a running command into
your context, use that and add nothing else. In Claude Code that is
the Monitor tool with `persistent: true`; each stdout line wakes
you and process exit is the completion signal.

Otherwise, use the drain loop. Start the session detached and
discard its stdout, because the log file already carries every
event (on POSIX shells):

```
nohup gloss session <review> >/dev/null 2>&1 &
```

Then run `gloss session <review> --drain` in a loop. Each call
prints the events that arrived since the previous call and exits
within `--timeout` (default 25s), so it fits under any harness's
tool timeout. Never cover the whole review with one open-ended
blocking call. Exit code 0 means the review is finished. Code 3
means it is still open: answer what arrived, then call again. Code
4 means the session process died without finishing; the sidecars
still hold every comment, so restart the session if the review
should continue.

If your harness cannot start a background process at all, ask the
human to run `gloss session <review>` in their own terminal and
tell you when it's up. You can still follow the review with the
same drain loop, and your answers travel through the sidecar files
on disk, so you do not need to own the process to take part.

**Knowing where you are without the stream.** The events are a
notification layer, not the record. The record is the sidecar
files. If you lose the stream or resume from a compaction, read
every `*.review.json` in the revision: any question whose thread
ends with a `"who": "human"` entry is waiting on you.

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
4. Offer verification for the new revision the same way as in
   generation step 5, because a rewritten revision is new text and
   can carry new defects. Then run another session on it. Silence
   is agreement: a revision with no sidecars is fully addressed.

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
