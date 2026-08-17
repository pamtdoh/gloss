---
name: gloss
description: Generate a files-first design review of a repository as small, decidable facts under .gloss/, for a human to review. Use when the user asks for a design review or architecture review of their codebase or any part of it.
---

# gloss

Gloss condenses a codebase's design into small facts — one Markdown file
each, reviewable without reading source — as plain files under `.gloss/`
in the target repo. Read and write them with your normal tools; no
command mediates state. A revision holds two kinds of files: fact `.md`
files are the agent's output, and sidecar files (`*.review.json`) are
the human's review state, which the review session creates.

## The prompt sets the scope and the altitude

Whatever the user asked to have reviewed *is* the scope — Gloss has no
scoping semantics of its own. If the prompt is ambiguous, ask, or state
the scope you inferred when you present the review.

The prompt also sets the altitude: the level of detail the facts
descend to. Read it for the level the user named. "Review the
overall design" asks for the decisions that shape the system, so
the facts stay at that level. "Review the page components and their
fields" names the detail itself, so the facts go there. "I want to
understand how X works" asks for teaching, so lean on the mechanism
genre and explain until a cold reader could follow the moving
parts.

When the prompt names no altitude, stay high. The reason: a review
costs the human one reading pass, and its purpose is to settle the
decisions that shape the design, so depth nobody asked for
multiplies facts without adding decisions. Detail below the
altitude is named, not elaborated: a fact at the bottom of the tree
states that a layer exists and what it is for, then says what it
leaves out, so the reviewer knows there is more and can pull it.
For example, an overview fact on a settings page may end with "Each
field also carries validation rules, below this review's level."
The session is the pull: answer a detail question in its thread,
and treat a comment asking for more as an altitude change for that
branch, to elaborate in the next revision.

The conversation before the invocation is context, not scope. A
detail you discussed at length with the user earns a fact only when
the requested altitude needs it, because the prompt decides what
they came to judge, and a tree that replays the conversation's
depth buries those decisions.

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
   design's shape. How to *write* each fact is the writing guide in
   [references/writing-facts.md](references/writing-facts.md),
   installed next to this file; read it before the first fact. Its
   core: **the reviewer never opens the code** — everything needed to
   judge a claim lives inside the fact. What governs the tree:

   - **Split within the altitude, not below it.** Dividing the design
     into facts does not send you past the level the prompt asked
     for: a claim below the altitude stays inside its parent as a
     named, unelaborated detail, because every extra file is another
     decision the reviewer must sit through.
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

5. **Verify on request, then hand it to the human.**

   When you present the review, tell the human they can ask for a
   verification pass. The trade is theirs: without the request you
   serve the revision directly and it arrives fast, and with the
   request the tree gets fresh-eyed checks before they read.

   Verification runs in subagents only, never as your own re-read,
   because the author fills gaps from memory that a fresh reader
   would have to notice. Three lenses run. Each has one scope, one
   question, and exactly the inputs its question needs:

   - **Mechanical lens** — words and sentences. Send one
     fresh-context agent `references/writing-facts.md` and the
     revision directory. It checks what a search can settle:
     semicolons, dash asides, and clause-sized parentheses appear
     only inside verbatim quotes, no quote fragment sits inside the
     author's own sentence, every title has a verb, a fact that
     quotes its source does so as one marked excerpt rather than
     many fragments, and every sentence passes the wording table
     (actorless passives fall to a search for forms of "to be"
     plus a past participle, and a sentence over ~25 words gets
     split). Its hits are pattern matches, so apply every one.
   - **Decide lens** — one fact at a time. Send a second
     fresh-context agent `references/writing-facts.md` and the
     revision directory. Its question: can the reviewer judge this
     fact — grounded, neutral, shaped by the guide? It checks that
     every count and every "only", "once", or "never" shows what
     settles it, that every claim carrying one of the guide's three
     grounding cues has its grounding (a real value walked through,
     the real artifact shown, or what settles it), that the body
     opens with the what in neutral terms, and that the questions a
     reviewer would plausibly ask of the fact are answered in its
     body, so no verdict waits on missing context. Ask for a list
     of gaps: the fact, the guidance it misses, and what would fill
     it.
   - **Follow lens** — the whole revision, read once in tree
     order. Send a third fresh-context agent the revision directory
     and the review's original prompt, and nothing else. Its
     question: did the cold read flow — every term defined by the
     time a reader meets it, everything an `_index.md` promises
     present as a child fact, no two facts contradicting each
     other, the depth the prompt asked for? Ask for the places it
     stumbled.

   Launch all of them together and make no edits while they run, because
   an edit mid-check splits the tree into two states, one per
   reader. When all return, merge the lists, then apply what's
   real and drop what's invented.

   If you cannot spawn subagents, fall back to walking the three
   lenses yourself in the same order: run the searches, hold each
   fact against `references/writing-facts.md`, then read the
   revision once through against the prompt, reading the actual
   guidance rather than a remembered summary, because your memory
   of the text is what the check exists to correct. Tell the human
   the check was your own re-read rather than a fresh reader's, so
   they can weigh it accordingly.

   Then show the tree of `.gloss/<review>/1/` and run the session
   (below).

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
3. In the new revision, resolve what was raised: rewrite, amend, split,
   deepen, or delete facts per the comments; answer or settle questions.
   A comment asking for more detail moves that branch's altitude down,
   so elaborate the named detail into full facts there. When you
   judge an item resolved, delete it from the sidecar; delete the sidecar
   file when nothing remains. Carry unresolved items forward untouched.
4. Offer verification for the new revision the same way as in
   generation step 5, because a rewritten revision is new text and
   can carry new gaps. Then run another session on it. Silence
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
