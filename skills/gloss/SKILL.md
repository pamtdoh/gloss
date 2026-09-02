---
name: gloss
description: Generate a files-first design review of a repository as small, decidable facts under .gloss/, for a human to review. Use when the user asks for a design review or architecture review of their codebase or any part of it.
---

# gloss

Gloss condenses a codebase's design into small facts — one Markdown
file each, reviewable without reading source — as plain files under
`.gloss/` in the target repo. Read and write them with your normal
tools. A revision holds two kinds of files: fact `.md` files are your
output, and sidecars (`*.review.json`) are the human's review state,
which the review session creates.

## The prompt sets the scope and the altitude

Whatever the user asked to have reviewed *is* the scope — Gloss has no
scoping semantics of its own. If the prompt is ambiguous, ask, or
state the scope you inferred when you present the review.

The prompt also sets the altitude: the level of detail the facts
descend to. "Review the overall design" asks for the decisions that
shape the system, so the facts stay at that level. "Review the page
components and their fields" names the detail itself, so the facts go
there. "I want to understand how X works" asks for teaching, so
explain until a cold reader could follow the moving parts.

When the prompt names no altitude, stay high: a review costs the
human one reading pass, and depth nobody asked for multiplies facts
without adding decisions. Detail below the altitude is named, not
elaborated — a fact states that a layer exists and what it leaves
out, so the reviewer can pull it with a question or a comment. The
conversation before the invocation is context, not scope: a detail
you discussed at length earns a fact only when the requested altitude
needs it.

## Generate revision 1

1. **Run `gloss init`** at the repo root (idempotent).

2. **Read the code — and run it when facts will need evidence.**
   Organize by what the system *is*, not by its directory layout.
   Whenever facts will need evidence only execution can produce
   (screenshots, transcripts, probes — any visual scope qualifies),
   get the app runnable now, staged state is fine, and keep it so
   through writing. Captured figures go in `images/` at the
   revision root (the writing guide's Figures section governs
   them). Ask the user first only when getting it running would
   need setup you'd have to build.

3. **Create `.gloss/<review>/1/`**, naming the review in short
   kebab-case from the prompt (e.g. `checkout-flow`).

4. **Write the facts.** How to write each fact is the writing guide
   in [references/writing-facts.md](references/writing-facts.md),
   installed next to this file; read it before the first fact. Its
   core: the reviewer never opens the code — everything needed to
   judge a claim lives inside the fact. Shape the tree yourself, to
   mirror the design's shape:

   - Split within the altitude, not below it — every extra file is
     another decision the reviewer must sit through.
   - Kebab-case filenames named for the subject
     (`collision-retry.md`, not `fact-07.md`); numeric prefixes
     (`10-auth.md`) where the group tells a story, since everything
     sorts alphabetically.
   - A directory that forms a coherent group may carry an
     `_index.md` — a fact about the group as a whole that also holds
     the group's shared context.
   - The revision root carries an `_index.md` too: the overview, one
     fact stating the scope, the altitude, and how the tree is laid
     out. The viewer opens on it, so it is the first thing the
     reviewer reads, and notes left on it are notes on the review as
     a whole.
   - State the design, don't review it: facts describe what the
     design does, sharp edges included, in neutral terms. The
     verdict belongs to the human.

5. **Offer verification, then hand it over.** Tell the human they
   can ask for a verification pass before reading. If they do, send
   a fresh-context subagent the revision directory, the review's
   prompt, and the writing guide, and ask where a cold reader
   stumbles: claims they cannot decide or check from the fact alone,
   terms met before they are defined, promised detail that is
   missing, facts that contradict each other. Fresh eyes, not your
   own re-read — the author fills gaps from memory. Apply what's
   real, drop what's invented. If you cannot spawn subagents, do the
   cold read yourself against the actual guide and tell the human it
   was the author's re-read, so they can weigh it.

   Then show the tree of `.gloss/<review>/1/` and run the session.

## Run the session under one supervisor

```
gloss session <review>
```

serves the latest revision on loopback and blocks until the human
clicks **Finish review** or approves. Stdout is JSONL events —
`session.started` (with the viewer `url` to share if the browser
didn't open), `question.asked`, `question.replied` (the human
replied in an existing thread), `session.finished` — then a final
JSON summary.

One supervisor owns this process for its whole life: run it as a
background process whose stdout streams into your context as lines
arrive. In Claude Code that is the Monitor tool with
`persistent: true`; each stdout line wakes you, and the process
exiting is the completion signal. Never cover the review with one
open-ended blocking call, and never split the stream across two
watchers — each would answer half the questions.

The events are a notification layer; the record is the sidecar
files. If you lose the stream or resume from a compaction, read
every `*.review.json` in the revision — any question whose thread
ends with a `"who": "human"` entry is waiting on you.

## Conduct during a live session

**The revision on screen is fixed.** Once a session has served a
revision, never edit its fact files again: every comment and
question anchors to the text as the human saw it, and an edit
underneath them re-anchors their feedback to words they never read.
Whatever a comment or question asks for — even directly, even
mid-session — lands in the next revision, not in this one.

**Don't change the code under review.** The session exists to reach
agreement on the design; the code must hold still while it is being
judged. Reading, running the app, probing, and scratch scripts to
gather data are all fine. Edits to the code the facts describe wait
until the design is approved — implementing it is the gloss-apply
skill's job.

**A question is a prompt, not an interrupt.** It arrives as an
event, but treat it exactly like a user message: check the code
before answering, verify what you assert, take the time a correct
answer needs. The human asked because they are deciding something —
a fast wrong answer costs more than a slow right one.

**Feedback on the review as a whole comes two ways, and they mean the
same thing.** In the viewer it lands on the root `_index.md`, the
overview; in the terminal it is the human talking to you while the
session runs. Either way, when it asks for a change — the altitude
was wrong, a branch deserves more or less, start over — treat it as a
comment: acknowledge it, hold it for the next revision, and keep the
session open. The human is still reading, Finish is theirs to click,
and a revision started under a live session would split their
attention between two trees. When it asks for an answer, treat it as
a question, and "read this revision cold" is a fair one: a cold read
only reads, so run it now, exactly as in generation step 5, and reply
with what the reader found. What carries into the next revision is
the human's call.

**Answer through `gloss reply`.**

```
gloss reply <review> <fact-path> <question-id> --text "…"
```

The event's `path` and `id` name the fact and the question. Omit
`--text` and pipe the answer on stdin when it is long or contains
quotes; Markdown works. The live session appends your answer to the
thread and dedupes retries. Never edit a live revision's sidecars by
hand: the viewer is writing the same files, and a second writer is
how questions and replies get duplicated. If `gloss reply` says no
session is running, don't fall back to editing the file — the review
isn't live, so restart the session or treat the question as
iteration feedback. Deleting a sidecar item means *resolved*, which
is an iteration act, never a live-session one.

## Iterate

When the session finishes with sidecars present:

1. Read every `*.review.json` in the revision wholesale — the root
   `_index.review.json` first, since notes there set the direction
   for everything below — together with whatever the human told you
   in conversation during the session, then propose next steps to
   the human before rewriting anything they'd rather discuss.
2. Copy `.gloss/<review>/<n>` to `.gloss/<review>/<n+1>`
   recursively. Revisions are standalone copies — no links, no
   shared state — and revision `n` stays exactly as reviewed.
3. In the new revision, resolve what was raised: rewrite, amend,
   split, deepen, or delete facts per the comments; answer or settle
   questions. A comment asking for more detail moves that branch's
   altitude down. When you judge an item resolved, delete it from
   the sidecar; delete the sidecar when nothing remains. Carry
   unresolved items forward untouched.
4. Offer verification as in generation step 5 — rewritten text can
   carry new gaps — then run another session. Silence is agreement:
   a revision with no sidecars is fully addressed.

When a session finishes with no sidecars and no approval, ask the
human how to proceed — a comment-free finish is not approval, and
you never create `approved/` on your own.

## Approval

Approval is one act, at the end: the accepted revision copied to
`.gloss/<review>/approved/`. The viewer's Approve button does this
itself; if the human approves in conversation instead, copy the
revision the same way, remaining sidecars included — approval
accepts the revision with whatever notes are still open. The
directory existing *is* the approval; the gloss-apply skill
requires it.
