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
  The one exception is `gloss reply` (below): while a session is live,
  the viewer and the agent would otherwise write the same sidecar file,
  so that single append goes through the session server.
- **A served revision is immutable.** Once a session has shown a revision
  to the human, its fact files are never edited again — feedback anchors
  to the text as shown, and lands in the next revision. The mirror rule
  holds for review state: only the served revision accepts new comments,
  questions, or replies; every other revision is read-only in the viewer,
  and the server rejects writes to it.
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
Markdown: GFM tables, fenced code, Mermaid diagrams, and images. Every
figure lives in `images/` at the revision root and is referenced
relatively (`images/panel.png`, `../images/panel.png` from a
subdirectory), so figures survive revision copies and are never
scattered. Names starting with `.` are reserved for the tool — the one
in use is the per-review `.session` file, present only while a session
runs.

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
- `thread` entries append in order, labeled `who: human | agent`; all
  `text` may contain Markdown. During a live session the agent answers
  with `gloss reply <review> <fact-path> <question-id>` — the session
  server appends the turn to the file and dedupes retries, so the agent
  never writes a sidecar the viewer is concurrently writing. The command
  finds the server through the review's `.session` file and fails when
  no session is running. With no session live, the agent edits sidecars
  directly as ever (resolution during iteration is file deletion).
- The viewer PUTs its whole in-memory copy; the server merges on write
  instead of overwriting — the viewer owns the item set (creations,
  edits, deletions win), the agent owns its thread entries (an entry the
  incoming copy lacks is re-inserted), so a stale tab can never erase an
  answer, even if something does edit the file directly mid-session.
- Resolving an item deletes it from `items`; delete the sidecar when
  nothing remains. Revision-level notes may go in `_review.json` at the
  revision root, same schema minus anchors — a file convention only; the
  viewer does not surface it.

## The session

`gloss session <review>` binds an ephemeral loopback port, prints the
viewer URL, serves the viewer over the revision's files, and blocks
until the reviewer clicks Finish review (or approves). Stdout is
JSONL events — `session.started` (with the URL), `question.asked`,
`question.replied` (a human turn appended to an existing thread),
`session.finished` — followed by a final JSON summary line; the process
exiting is the completion signal, so one stdout monitor covers live Q&A
and completion. The agent runs the session under a supervisor that
streams stdout (Claude Code's Monitor, or an equivalent); harnesses
that cannot stream a background process are not supported. While the
session runs, `.gloss/<review>/.session` holds the server's pid and
address — how `gloss reply` finds it — and is removed on exit; a stale
copy from a killed process is detected by its dead pid. Plain loopback
sessions have no auth — anything local can already edit `.gloss/`
directly — just host and origin checks. With `--serve-host` (a private
proxy hostname, e.g. tailscale serve) the network boundary is real, so
the URL carries a one-time token that gates a port-scoped session
cookie. The agent-reply route works without the cookie and accepts only
requests with the loopback `Host` and no `Origin` header — a proxied
request carries the proxy's host and a browser always sends `Origin`,
so neither remote peers nor web pages can reach it.

The viewer can also compare any two revisions of the review — each
fact's changed Markdown blocks rendered as the reader sees them (a
source-level diff one toggle away), with the base revision's comments
and questions shown read-only. Comparing reads the same revision files
over the same API and writes nothing.

## Skills

- **gloss** generates revision `1` from the user's prompt, runs the
  session, answers questions live through `gloss reply`, iterates by
  copying the revision and resolving sidecar items, and promotes the
  accepted revision to `approved/`. During a live session it treats the
  served revision and the reviewed code as fixed — feedback lands in
  the next revision, code changes wait for approval.
- **gloss-apply** implements from `approved/` and refuses to start
  without it. It never modifies `.gloss/`.

Both are plain instruction files installed by `gloss skill install` —
into `.claude/skills/` by default, or `.agents/skills/` with `--agents`
for any other harness that can supervise a streaming background
process, identical content either way; the CLI stays small because
everything except the session is agents reading and writing files.
The gloss skill ships with one reference file,
`references/writing-facts.md` — the writing contract for fact files,
which SKILL.md tells the agent to read before writing facts.

## Deliberately not built

No integrity verification or schema validation; no CLI mediation for
state beyond the single `gloss reply` append; no approval ceremonies
beyond the `approved/` copy; no scoping semantics; no embedded agent
SDKs, MCP servers, or progress streams.
