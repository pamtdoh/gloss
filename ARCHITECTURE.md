# Architecture

Gloss is a files-first design-review tool: an agent writes review facts as
Markdown files, a human reviews them in a local viewer, and the approved
revision is the handoff to implementation. This file is the working
convention the skills and the viewer share. Nothing validates or enforces
it — agents follow it by instruction.

## Principles

- **Files are the single source of truth.** Facts, comments, questions,
  answers, approval — all plain files under `.gloss/` in the target repo.
  Git history is the audit trail.
- **Agents read and write the files directly.** No hashing, no validation,
  no CLI mediation for state. The agent's judgment is the interface.
- **Meaning lives in structure.** Approval is a directory existing,
  resolution is a file being deleted, agreement is the absence of a
  sidecar. No metadata files where structure can carry the semantics.
- **Scope comes from the user's prompt**, not the tool. No built-in scope
  kinds or workflow gates.
- **The viewer is for humans only**, and terminal-only review (reading the
  files, conversing with the agent) always works.

## File layout

```
.gloss/
  checkout-flow/              # one review
    1/                        # first revision: the fact tree
    2/                        # a copy of 1/, then iterated
    approved/                 # a copy of the accepted revision = the approval
```

Revisions are standalone copies — no shared data, no lineage metadata.
Inside a revision the agent shapes the tree: one condensed, decidable fact
per `.md` file; a directory that forms a coherent group may carry an
`_index.md` (a fact about the group as a whole). Everything sorts
alphabetically, so numeric filename prefixes (`10-auth.md`) make narrative
order the reading order where a group tells a story. Facts are rich
Markdown: GFM tables, fenced code, Mermaid diagrams, and images stored
inside the revision and referenced relatively. Top-level names starting
with `.` are reserved for the tool (e.g. `.local/` for session state).

## Review state: sidecars

All review state for a fact lives in a sidecar next to it —
`checkout.md` → `checkout.review.json`:

```json
{
  "items": [
    {
      "id": "c1",
      "type": "comment",
      "anchor": { "quote": "re-enters payment authorization on every retry" },
      "text": "Collapse the retry into a single idempotent call."
    },
    {
      "id": "q1",
      "type": "question",
      "thread": [
        { "who": "human", "text": "Do we need guest checkout?" },
        { "who": "agent", "text": "Nothing depends on it; dropping it removes two facts." }
      ]
    }
  ]
}
```

- Item types are `comment` and `question`. No decision field: the viewer's
  quick-comment presets are just comments with canned text. An absent
  sidecar means the fact stands as written — silence is agreement.
- `anchor.quote` is the verbatim selected text; optional `prefix`/`suffix`
  (W3C TextQuoteSelector) disambiguate. No anchor means the whole fact.
  The viewer fuzzy-re-anchors drifted quotes and shows broken ones as
  detached, never dropped.
- `thread` entries append in order, labeled `who: human | agent`; the
  agent answers questions live during a session by appending and writing
  the file back. All `text` may contain Markdown.
- Resolving an item deletes it from `items`; delete the sidecar when
  nothing remains. Revision-level notes go in `_review.json` at the
  revision root, same schema minus anchors.

## The session

`gloss session <review>` binds an ephemeral loopback port, prints the
viewer URL, serves the viewer over the revision's files, and blocks
until the reviewer clicks Finish review (or approves). Stdout is
JSONL events — `session.started` (with the URL), `question.asked`,
`question.replied` (a human turn appended to an existing thread),
`session.finished` — followed by a final JSON summary line; the process
exiting is the completion signal, so one stdout monitor covers live Q&A
and completion. Plain loopback sessions have no auth — anything local
can already edit `.gloss/` directly — just host and origin checks.
With `--serve-host` (a private proxy hostname, e.g. tailscale serve)
the network boundary is real, so the URL carries a one-time token that
gates a port-scoped session cookie.

## Skills

- **gloss** generates revision `1` from the user's prompt, runs the
  session, answers questions live, iterates by copying the revision and
  resolving sidecar items, and promotes the accepted revision to
  `approved/`.
- **gloss-apply** implements from `approved/` and refuses to start
  without it. It never modifies `.gloss/`.

Both are plain instruction files installed by `gloss skill install`
(identically for claude and codex); the CLI stays small because
everything except the session is agents reading and writing files.
The gloss skill ships with one reference file,
`references/writing-facts.md` — the writing contract for fact files,
which SKILL.md tells the agent to read before writing facts.

## Deliberately not built

No integrity verification, schema validation, or CLI-mediated writes; no
approval ceremonies beyond the `approved/` copy; no agent access to the
viewer's HTTP API; no scoping semantics; no embedded agent SDKs, MCP
servers, or progress streams.
