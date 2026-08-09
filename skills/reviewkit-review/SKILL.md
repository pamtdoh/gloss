---
name: reviewkit-review
description: Generate a files-first design review of a repository as small, decidable facts under .reviewkit/, for a human to review. Use when the user asks for a design review of their codebase or any part of it.
---

# reviewkit-review

ReviewKit condenses the design of a codebase into small facts — one Markdown
file each — that a human can review without reading source. Everything is
plain files under `.reviewkit/` in the target repo. You read and write those
files directly with your normal tools; no command mediates state.

## The scope is the user's prompt

Whatever the user asked to have reviewed *is* the scope. ReviewKit has no
scoping semantics of its own — don't invent any. If the prompt is ambiguous,
ask, or state the scope you inferred when you present the review.

## Generate snapshot 1

1. **Ensure the repo is initialized.** Run `reviewkit init` at the repo
   root. It is idempotent and prints a JSON result.

2. **Read the code.** Inspect the repository with normal read tools until
   you understand the design within the requested scope. You are condensing
   design, not summarizing files — organize by what the system *is*, not by
   its directory layout.

3. **Create the review directory.** Pick a short kebab-case review name
   from the user's prompt (e.g. `checkout-flow`, `design-review`) and
   create `.reviewkit/<review>/1/`. Snapshot `1` is the fact tree you are
   about to write.

4. **Write the facts.** Shape the tree yourself — it should mirror the
   design's shape. Conventions (good practice, not rules):

   - **One condensed, decidable fact per `.md` file.** A fact is a claim
     about the design that the human can judge on its own: let it stand
     (silence is agreement) or annotate it (the viewer offers quick
     presets like "Not needed." and "Simplify."). If they'd have to say
     "well, parts of it…", split it.
   - **Small.** A `# Title` line stating the claim, then a few sentences.
     Reference file paths where they help.
   - **Rich where richness clarifies.** Use a GFM table for an
     enumeration, a fenced code block when the exact shape *is* the claim
     (a schema, a config, a wire format), a Mermaid diagram for a flow,
     and images saved inside the snapshot directory (referenced
     relatively, so they travel with copies). Never paste code the human
     would have to review line-by-line — that defeats the point.
   - **Kebab-case filenames** named for the subject
     (`collision-retry.md`, not `fact-07.md`).
   - **Number facts when the group tells a story.** Everything sorts
     alphabetically, so numeric prefixes (`10-auth.md`, `20-sessions.md`)
     make narrative order the reading order. Skip numbering where order
     doesn't matter.
   - **Group related facts in directories.** When a group forms a coherent
     whole, add an `_index.md` — a fact about the group itself, like a
     module definition whose summary claim is itself decidable. Skip it
     where it would be boilerplate.
   - **State the design; don't review it yourself.** Facts describe what
     the design does, including its sharp edges, in neutral terms. The
     verdict belongs to the human.
   - **Snapshot 1 is facts only.** Sidecar files (`*.review.json`) are the
     human's review state, written during review — never at generation.

5. **Hand it to the human.** Show the tree of `.reviewkit/<review>/1/`,
   then run the session (below) — or, for terminal-only review, print the
   facts themselves and take decisions in conversation.

## Run the session and wait

Run as a background task:

```
reviewkit session <review> --events
```

It serves the viewer on loopback, prints a one-time URL on stderr (share
it with the human if their browser didn't open), and blocks until the
human clicks **Finish review** or approves. The command exiting is your
notification; the last stdout line is a JSON summary (annotation and
comment counts, open questions, approval status). With `--events`,
stdout is JSONL: `session.started`, `question.asked`,
`session.finished`.

## Answer questions live, while the session runs

**Watch the session's output while it runs** — as a background task, poll
or monitor its stream; an agent that only wakes when the command exits
answers nothing live. When a `question.asked` event arrives, answer
without waiting for the review to finish:

1. Read the fact's `<fact>.review.json`, find the question item by `id`.
2. Append `{ "who": "agent", "text": "…" }` to its `thread` and write the
   file back. `text` may use Markdown.
3. The viewer picks the answer up within a few seconds; the human can
   reply in the same thread.

Never delete items while a session is live — deletion means *resolved*,
and resolution happens during iteration.

## Iterate

When the session finishes with sidecars present:

1. Read every `*.review.json` in the snapshot wholesale, then propose next
   steps to the human before rewriting anything they'd rather discuss.
2. Copy the snapshot: `cp -r .reviewkit/<review>/<n> .reviewkit/<review>/<n+1>`.
   Snapshots are standalone copies — no links, no shared state.
3. In the new snapshot, resolve what was raised: rewrite, amend, split, or
   delete facts per the annotations; answer or settle questions. When you
   judge an item resolved, delete it from the sidecar; delete the sidecar
   file when nothing remains. Carry unresolved items forward untouched.
4. Run another session on the new snapshot. A snapshot with no sidecars is
   one where everything the human raised has been addressed — silence is
   agreement.

## Approval

Approval is one act, at the end: the accepted snapshot copied to
`.reviewkit/<review>/approved/`. The viewer's Approve button does this
itself; if the human instead approves in conversation, copy it yourself:

```
cp -r .reviewkit/<review>/<n> .reviewkit/<review>/approved
```

The directory existing *is* the approval — no metadata, no ceremony. The
`reviewkit-implement` skill starts from `approved/` and refuses to run
without it.

## Terminal-only review

No browser is required at any step. The facts are ordinary Markdown: print
them, let the human give annotations and questions in conversation, and either write sidecars yourself to keep the same record —
you own the files as much as the viewer does — or skip sidecars and
iterate directly on what they said. Approval is the same `cp -r` either
way.
