---
name: gloss
description: Generate a files-first design review of a repository as small, decidable facts, for a human to review. Use when the user asks for a design review or architecture review of their codebase or any part of it.
---

# gloss

Gloss condenses a codebase's design into small facts — one Markdown
file each, judged without reading source. You write the facts; the
human reviews them in a viewer, which records their notes in sidecar
files (`*.review.json`) next to each fact.

## Where reviews live

`gloss dir` prints `{"ok":true,"path":"…"}`: this repo's reviews
directory, in the OS temp directory outside the repo. `<reviews>`
below means that path. Run it from anywhere in the repo whenever you
need the path, including after a compaction, rather than guessing.
Reviews are working material, so never write them into the repo; if
the human wants to keep one, copy it where they say, since temp
directories don't survive every reboot.

## Scope and altitude come from the prompt

What the user asked to have reviewed is the scope. If it is
ambiguous, ask, or state the scope you inferred when you present the
review. The prompt also sets the altitude, the level of detail the
facts descend to: "review the overall design" stays at the decisions
that shape the system, "review the page components and their fields"
goes down to fields, and "I want to understand how X works" teaches
until a cold reader could follow the moving parts.

When the prompt names no altitude, stay high: depth nobody asked for
multiplies facts without adding decisions. Name detail below the
altitude in a sentence instead of elaborating it, so the reviewer can
pull it with a note. Earlier conversation is context, not scope — a
detail you discussed at length earns a fact only when the altitude
needs it.

## Generate revision 1

1. Run `gloss dir`.
2. Read the code, organizing by what the system *is* rather than its
   directory layout. If facts will need evidence only execution
   produces — screenshots, transcripts, probes; any visual scope
   does — get the app running now (staged state is fine) and keep it
   running through writing. Ask first only if running it needs setup
   you would have to build.
3. Create `<reviews>/<review>/1/`, naming the review in short
   kebab-case from the prompt (`checkout-flow`).
4. Read [references/writing-facts.md](references/writing-facts.md),
   installed next to this file, then write the facts. Shape the tree
   to mirror the design:
   - Split within the altitude, not below it — each file is another
     decision the reviewer sits through.
   - Name files for their subject in kebab-case (`collision-retry.md`,
     not `fact-07.md`). Everything sorts alphabetically, so use
     numeric prefixes (`10-auth.md`) where a group tells a story.
   - A directory that forms a coherent group may carry an
     `_index.md`: a fact about the group that also holds its shared
     context.
   - The revision root always carries an `_index.md`, the overview:
     the scope, the altitude, and how the tree is laid out. The
     viewer opens on it, and notes on it are notes on the whole
     review.
5. Show the tree and serve the session. Mention once that the human
   can ask for a cold read.

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

## Serve the session

`gloss session <review>` serves the latest revision on loopback and
blocks until the human clicks **Finish review** or approves. Stdout
is JSONL: `session.started` (with the viewer `url`, to share if no
browser opened), `question.asked`, `question.replied` (a human turn
in an existing thread), `session.finished`, then a final JSON
summary.

Run it as one background process whose stdout streams into your
context line by line — in Claude Code, the Monitor tool with
`persistent: true`. Each line wakes you, and the process exiting
signals completion. A single blocking call would leave questions
unanswered until the end, and a second watcher would split the
questions between two of you.

The sidecars, not the events, are the record. If you lose the stream
or resume after a compaction, read every `*.review.json` in the
revision: a question whose thread ends with a `"who": "human"` entry
is waiting on you.

## While a session is live

- **The served revision is fixed.** Never edit its fact files: notes
  anchor to the text the human saw, and an edit would move their
  feedback onto words they never read. Whatever a note asks for,
  even mid-session, goes in the next revision.
- **The code under review holds still.** Reading, running, probing,
  and scratch scripts are fine; changes to the code the facts
  describe wait for approval and the gloss-apply skill.
- **Answer a question like a user message**, from the code rather
  than from memory — the human is deciding something. Reply with:

  ```
  gloss reply <review> <fact-path> <question-id> --text "…"
  ```

  using the event's `path` and `id`. For a long answer or one with
  quotes, omit `--text` and pipe the Markdown on stdin. The session
  appends the answer and dedupes retries. Never write a live
  revision's sidecars yourself: the viewer writes the same files, and
  two writers duplicate notes. If `gloss reply` says no session is
  running, restart the session or treat the question as iteration
  feedback; don't edit the file instead.

## Iterate

When a session finishes with sidecars present:

1. Read every `*.review.json` in the revision — the root
   `_index.review.json` first, since its notes set the direction —
   along with anything the human said in conversation. The notes are
   instructions: write the changes, don't propose them.
2. Copy `<reviews>/<review>/<n>` recursively to `<n+1>`, a standalone
   copy. Revision `n` stays exactly as reviewed.
3. In the new revision, resolve each note: rewrite, amend, split,
   deepen, or delete facts; answer or settle questions. A request for
   more detail lowers that group's altitude, and an overview note may
   redirect the whole review. Delete each resolved note from its
   sidecar, and the sidecar once it is empty; carry unresolved notes
   forward untouched.
4. Serve the next session. A revision with no sidecars is fully
   addressed — silence is agreement.

When a session finishes with no notes and no approval, the human has
moved to the terminal: report the summary and wait for them. Don't
serve again, write a new revision, or create `approved/`.

## Approval

Approval is the accepted revision copied to
`<reviews>/<review>/approved/` — the directory existing is the
approval, and gloss-apply requires it. The viewer's Approve button
makes the copy; if the human approves in conversation, copy the
revision yourself, open notes included.
