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
     about the design that the human can judge on its own: keep it, drop
     it, simplify it, or defer it. If they'd have to say "well, parts of
     it…", split it.
   - **Small.** A `# Title` line stating the claim, then a few sentences.
     Reference file paths where they help; never paste code blocks a human
     would have to read.
   - **Kebab-case filenames** named for the subject
     (`collision-retry.md`, not `fact-07.md`).
   - **Group related facts in directories.** When a group forms a coherent
     whole, add an `_index.md` — a fact about the group itself, like a
     module definition whose summary claim is itself decidable. Skip it
     where it would be boilerplate.
   - **State the design; don't review it yourself.** Facts describe what
     the design does, including its sharp edges, in neutral terms. The
     verdict belongs to the human.
   - **Snapshot 1 is facts only.** Sidecar files (`*.review.json`) are the
     human's review state, written during review — never at generation.

5. **Hand it to the human in the terminal.** Print the tree of
   `.reviewkit/<review>/1/` and offer to print the facts themselves (they
   are ordinary Markdown, readable with `cat`). Reading the files and
   replying in conversation is a fully supported review path.

## After generation (later milestones)

The blocking viewer session (`reviewkit session`), sidecar-driven
iteration, and promotion to `approved/` arrive in milestones 2–3 and are
not available yet. Until then: the human reads the facts in the terminal
and tells you their decisions in conversation.
