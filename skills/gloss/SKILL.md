---
name: gloss
description: Turns a system, a feature, recent changes, a design doc, or a plan into a tree of small, decidable Markdown facts that a human reviews, comments on, and approves in a local viewer before anything is built. Use when the user asks for a design review, architecture review, or audit of a codebase or any part of it — including what an agent just built, the changes in this session, or a plan before implementation — or mentions Gloss.
compatibility: Requires the gloss CLI (npm install -g gloss-review), and a harness that can run a background process and stream its stdout into the conversation.
---

# gloss

Gloss condenses a codebase's design into small facts — one Markdown
file each, judged without reading source. You write the facts; the
human (who asked for the review and reviews it) reads them in a
viewer, which records their notes — comments and questions — in
sidecar files (`*.review.json`) next to each fact.

## Where reviews live

`gloss dir` prints `{"ok":true,"path":"…"}`: this repository's
reviews directory, under `~/.gloss/reviews`, outside the repo and
shared by all of its worktrees. `<reviews>` below means that path. Run
it from anywhere in the repo whenever you need the path, including
after a compaction, rather than guessing. Never write reviews into the
repo. Reviews are kept until the human removes one (`gloss rm`), and
`gloss open <review>` shows a past one in the browser.

## Scope and altitude come from the prompt

What the human asked to have reviewed is the scope. If it is
ambiguous, ask, or state the scope you inferred when you present the
review. The prompt also sets the altitude, the level of detail the
facts descend to: "review the overall design" stays at the decisions
that shape the system, "review the page components and their fields"
goes down to fields, and "I want to understand how X works" teaches
until a cold reader could follow the moving parts.

When the prompt names no altitude, stay high: depth nobody asked for
multiplies facts without adding decisions. Name detail below the
altitude in a sentence instead of elaborating it, so the human can
pull it with a note. Earlier conversation is context, not scope — a
detail you discussed at length earns a fact only when the altitude
needs it.

## Generate revision 1

1. Run `gloss dir`.
2. Read the code, organizing by what the system *is* rather than its
   directory layout. If facts will need evidence only execution
   produces — screenshots, transcripts, probes; any visual scope
   does — get the app running now (staged state is fine) and keep it
   running through writing. Keep probes, scratch scripts, and the
   app's data outside both the repo and the review. Ask first only
   if running it needs setup you would have to build.
3. Create `<reviews>/<review>/draft/`, naming the review in short
   kebab-case from the prompt (`checkout-flow`). Other worktrees share
   `<reviews>`, so pick a name `gloss list` doesn't already show. The draft is the only
   place you ever write facts: each round, gloss freezes it into a
   numbered revision (`1/`, `2/`, …) that is read-only from then on.
4. Read [references/writing-facts.md](references/writing-facts.md),
   installed next to this file, then write the facts. Shape the tree
   to mirror the design:
   - Split within the altitude, not below it — each file is another
     decision the human sits through.
   - Name files for their subject in kebab-case (`collision-retry.md`,
     not `fact-07.md`). Everything sorts alphabetically, so use
     numeric prefixes (`10-auth.md`) where a group tells a story.
   - A directory that forms a coherent group may carry an
     `_index.md`: a fact about the group that also holds its shared
     context.
   - The revision root always carries an `_index.md`, the overview:
     a fact whose title is a claim about the whole, stating the
     scope, the altitude, and how the tree is laid out. The viewer
     opens on it, and notes on it are notes on the whole review.
   - Context the reviewer needs to follow the scope gets a sentence
     in the fact that needs it, not a fact of its own.
   - Counts and cross-references ("the group's three facts", "see
     the redirect fact") go stale as the tree changes; check them
     against the finished tree.
5. Show the human the tree, and say once in that message that they
   can ask for a cold read. Then run the round.

## Cold reads, only when asked

A cold read gives a fresh-context subagent the revision, the review's
prompt, and the writing guide, and asks where a cold reader stumbles:
claims they cannot decide or check from the fact alone, terms used
before they are defined, promised detail that is missing, facts that
contradict each other. Fresh eyes matter because an author fills gaps
from memory. Apply what's real and drop what isn't; without
subagents, read it yourself and say so.

Run one only when the human asks for it, in a note or in
conversation, on the revision they name — not because a revision is
large, seems to need it, or you are running unattended.

## Run a round

`gloss session <review> --prompt "<the human's request, verbatim>"`
freezes the draft as the next revision when its
facts changed since the last one (otherwise the latest is served again),
publishes it to the review's server, starting the server if needed,
and blocks until the human clicks **Finish review** or approves. Stdout is JSONL:
`session.started` (with the viewer `url`, to share if no browser
opened), `question.asked`, `question.replied` (a human turn in an
existing thread), `session.finished`, then a final JSON summary. The
server keeps one address for the whole review, so a tab the human
already has open follows each new revision by itself.

Run it as one background process whose stdout streams into your
context line by line — in Claude Code, the Monitor tool with
`persistent: true`. Each line wakes you, and the process exiting
signals completion. A single blocking call would leave questions
unanswered until the end, and a second watcher would split the
questions between two of you.

The request is recorded with the review the first time, so it can be
found and understood later; later rounds can leave `--prompt` out. If
you lose the stream or resume after a compaction, run
`gloss session <review>` again: it re-attaches to the open round and
delivers every question still waiting on you.

## During a round

- **Leave the draft alone until the round ends.** The human's notes
  are being written into it as they review. Whatever a note asks for,
  even mid-round, goes in the next revision.
- **The code under review holds still.** Reading, running, probing,
  and scratch scripts are fine; changes to the code the facts
  describe wait for approval and the gloss-apply skill.
- **Answer a question like a user message**, from the code rather
  than from memory — the human is deciding something. Reply with:

  ```
  gloss reply <review> <fact-path> <question-id> --text "…"
  ```

  using the event's `path` and `id`. For a long answer or one with
  quotes, omit `--text` and pipe the Markdown on stdin. The server
  appends the answer and dedupes retries. Never write the sidecars of
  the revision under review yourself: the human is writing them through
  the server. If `gloss reply` says no round is open, treat the
  question as iteration feedback.

## Iterate

When a round finishes with sidecars present:

1. The round's notes are in the draft, next to the facts they are on.
   Read every `*.review.json` in `draft/` — the root
   `_index.review.json` first, since its notes set the direction —
   along with anything the human said in conversation. The notes are
   instructions: write the changes, don't propose them. The human's tab
   stays open on the review; `gloss status <review> "<what you're
   doing>"` shows them a line such as "writing revision 3".
2. In `draft/`, resolve each note: rewrite, amend, split, deepen, or
   delete facts; answer or settle questions. A request for more detail
   lowers that group's altitude, and an overview note may redirect the
   whole review. Delete each resolved note from its sidecar, and the
   sidecar once it is empty; carry unresolved notes forward untouched.
   The revision just reviewed stays exactly as it was.
3. Run the next round. A revision with no sidecars is fully addressed —
   silence is agreement.

When a round finishes with no notes and no approval, the human has
moved to the terminal: report the summary and wait for them. Don't
run another round, write a new revision, or approve.

## Approval

Approval is the accepted revision copied to
`<reviews>/<review>/approved/` — the directory existing is the
approval, and gloss-apply requires it. The viewer's Approve button
makes the copy and stops the review's server. If the human approves in
conversation, run `gloss approve <review>` (the revision on screen, or
`--rev <n>`); open notes are approved as written.
