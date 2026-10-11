# Architecture

Gloss is a files-first design-review tool: an agent writes review facts as
Markdown files, a human reviews them in a local viewer, and the approved
revision is the handoff to implementation. This file is the working
convention the skills and the viewer share. Nothing validates or enforces
it — agents follow it by instruction.

## Principles

- **Files are the single source of truth.** Facts, comments, questions,
  answers, approval — all plain files in the repo's reviews directory.
  The revisions themselves are the audit trail.
- **Agents read and write the files directly.** No hashing, no validation,
  no CLI mediation for state. The agent's judgment is the interface.
  The one exception is the revision under review while its round is
  open: the human is writing its sidecars through the review server, so
  the agent's answers go through the server too (`gloss reply`), and
  one writer owns every live write.
- **A published revision is immutable.** Once a revision has been shown
  to the human, its fact files are never edited again — feedback anchors
  to the text as shown, and lands in the next revision. The mirror rule
  holds for review state: only the revision under review, while its
  round is open, accepts new comments, questions, or replies; every
  other revision is read-only in the viewer, and the server rejects
  writes to it.
- **Meaning lives in structure.** Approval is a directory existing,
  resolution is a file being deleted, agreement is the absence of a
  sidecar. No metadata files where structure can carry the semantics.
- **Scope comes from the user's prompt**, not the tool. No built-in scope
  kinds or workflow gates.
- **The viewer is for humans only**, and terminal-only review (reading the
  files, conversing with the agent) always works.

## File layout

Reviews are working material, mostly never committed, so they live
outside the repo: in the OS temp directory, one directory per repo.
The CLI owns the location and `gloss dir` prints it (creating it), so
every harness asks the same command rather than knowing a path; the
skills run it before touching a review. The path is
`<tmpdir>/gloss-<uid>/<repo-name>-<hash>/` — the repo is the nearest
ancestor of the working directory holding `.git` (else the working
directory itself), so any subdirectory resolves to the same reviews,
and the hash of its real path keeps two checkouts of the same name
apart. The per-user directory is created private, and the CLI refuses
one it doesn't own or that others can reach, since `/tmp` is shared
on Linux. Nothing is scaffolded in the working tree. The cost is the
temp directory's lifetime: a reboot or the OS's cleaner may take a
review, so one worth keeping is copied out on purpose.

```
<reviews>/                    # what `gloss dir` prints
  checkout-flow/              # one review
    draft/                    # the live review: facts in progress, and every open note
    1/                        # round 1: its facts frozen when published, its notes when the round ended
    2/                        # ...and round 2
    approved/                 # a copy of the accepted revision = the approval
```

The agent writes facts only in `draft/`, at the same paths round after
round, and never copies a revision: `gloss session` freezes the draft's
facts and figures into the next numbered revision when they changed.
Notes are state about a revision, not its content: the human's notes
are written into the draft as they come, and a revision gets its copy
of them when its round ends (Finish, or approval) — the record of what
was raised on it. Numbered revisions are history; nothing is ever
copied from them back to the draft. A frozen revision is
built aside and renamed into place, and its facts and figures are made
read-only, so "a published revision is never edited" holds by
construction. Revisions are standalone copies — no shared data, no
lineage metadata — so every revision stays plain files, readable by any
tool, and comparing two is comparing two directories. A review is tens
of kilobytes; the copies cost nothing that matters.

Inside the draft the agent shapes the tree: one condensed, decidable fact
per `.md` file; a directory that forms a coherent group may carry an
`_index.md` (a fact about the group as a whole), and the revision root
carries one as the overview — the fact the viewer opens on, whose
sidecar holds notes on the review as a whole. Everything sorts
alphabetically, so numeric filename prefixes (`10-auth.md`) make narrative
order the reading order where a group tells a story. Facts are rich
Markdown: GFM tables, fenced code, Mermaid diagrams, and images. Every
figure lives in `images/` at the revision root and is referenced
relatively (`images/panel.png`, `../images/panel.png` from a
subdirectory), so figures survive revision copies and are never
scattered. Names starting with `.` are reserved for the tool: the review
server's files, next to the revisions —

| File | Holds |
|---|---|
| `.server.json` | the server's port, pid (while it runs), the agent's key, and the `--serve-host` cookie secret — readable only by the user |
| `.server.lock` | the running server's pid: one server per review |
| `.events.jsonl` | the numbered event log; a restarted server rebuilds its state from it |
| `.server.log` | the server's own output |

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

- A note is a `comment` or a `question`, both typed by the human; no
  decision field. An absent sidecar means the fact stands as written —
  silence is agreement.
- `anchor.quote` is the verbatim selected text; optional `prefix`/`suffix`
  (W3C TextQuoteSelector) disambiguate. No anchor means the whole fact.
  The viewer fuzzy-re-anchors drifted quotes and shows broken ones as
  detached, never dropped.
- `thread` entries append in order, labeled `who: human | agent`; all
  `text` may contain Markdown. While a round is open the agent answers
  with `gloss reply <review> <fact-path> <question-id>`: the server
  appends the turn and dedupes retries, so the agent never writes a file
  the human is writing. Between rounds the agent edits the sidecars in
  the draft directly (resolution is deletion).
- The viewer never sends a whole sidecar. Every change is one operation
  — create, edit, delete, reply, re-anchor, restore — that the server
  applies to the file as it is on disk, assigning new ids itself — never
  one the fact's earlier revisions recorded, so a resolved note's id is
  not reused for a new one. Operations are validated on arrival. A tab
  that missed someone else's change can only touch the notes it names,
  so a stale tab erases nothing it never saw. Each operation carries an
  id, so a retry is answered, not applied twice.
- A picture pasted into a note is a file: the review server stores it
  at `images/notes/<hash>.<ext>` in the draft, with the notes, and the
  note's `text` references it as a Markdown image relative to the fact,
  exactly like a figure — no field for it. The server deletes files
  there that no note references, when a round starts and when it ends;
  the revision's snapshot takes the ones that remain.
- Resolving a note deletes it from `items`; delete the sidecar when
  nothing remains.

## The review server and its rounds

Each review has one long-running server process. It owns every write to
the review's files while it runs, numbers each change as an event in
`.events.jsonl`, and pushes every event to the open browser tabs (over
SSE) and to the agent's `gloss session` (as JSONL). It binds loopback
only, and it keeps its port: a restart reuses the port in `.server.json`,
so the address the human opened first stays the address of the review.

A **round** is one revision under review. `gloss session <review>`
starts the server if none runs, freezes the draft as the next revision
when its facts differ from the latest (otherwise the latest is served
again), prints `session.started` with the viewer URL, and streams what
the agent must act on — `question.asked`, `question.replied` — until the
human clicks Finish review or approves; then `session.finished` and a
final JSON summary line, and the process exits. Exiting is the
completion signal, so one stdout monitor covers live Q&A and completion,
and any harness that can stream a background process (Claude Code's
Monitor, or an equivalent) can drive a review. Running `gloss session`
again for the open round re-attaches, and questions still waiting on the
agent are delivered again — the way back after a lost stream or a
compaction.

When the human finishes, the round's notes — its sidecars and the
pictures they show — are copied into the revision as its record, and
stay in the draft, where the agent resolves them in place. Notes the
agent leaves there are the open notes of the next round. Only the
latest revision can be under review, since the draft's notes are on
it; resolving notes without changing a fact serves the same revision
again.

Publishing a revision moves every open tab on the previous one to it,
straight into a comparison with what it replaced. The agent can put a
status line in the tabs while it works (`gloss status`). A finished
round leaves the tabs open and readable, saying the agent is at work.
`gloss approve` approves from the conversation, always through the
server (started for it if needed), so it is the same act as the
viewer's button and the tabs see it. Approval ends the review: an open
round ends with it and its notes are snapshotted, whichever revision is
approved, and an approved review takes no more rounds.

The server stops on approval, on `gloss stop`, or after half an hour
with no tab and no agent connected. If it dies mid-round, the next
command that needs it starts it again, and it rebuilds the round's state
from the event log. A `gloss session` in progress does this by itself and
keeps streaming; a deliberate stop instead ends the session with an
error. A server of another version, or started with other options, is
replaced.

The agent's routes require a key from `.server.json`, which only the
user can read, plus the loopback `Host` and no `Origin` — so neither web
pages nor other accounts on the machine can drive the review. Plain
loopback viewing has no auth beyond host and origin checks. With
`--serve-host` (a private proxy hostname, e.g. tailscale serve) each
published URL carries a one-time token that sets a cookie; the cookie's
secret persists across restarts, so a login lasts the review.

### The viewer

The viewer is event-driven: it loads a snapshot, follows the event
stream, and sends its own changes as operations from an outbox. The
outbox shows each change at once and keeps it — across a dropped
connection or a reload — until the server confirms or refuses it.
A service worker keeps a copy of everything the tab has read (every
revision is prefetched), so a review stays readable after its server
stops, reload included; the page says it is reading a saved copy, and
nothing can be posted or finished from it. Because the port is stable,
that copy, the seen marks, and the drafts belong to the review.

Text being typed — a note in the composer, a reply in a thread — is
not review state until it is posted, so it never touches the files. It
is not lost before then either: the viewer keeps every unsent box's
text in the browser (localStorage, per review and revision), and the
box comes back with it wherever it was left — after a stray back
button, a tree click, a reload, or a thread opened over it. Only
posting, Cancel, or Escape forgets a draft. The finish sheet counts
what is still unsent, since only posted notes reach the agent.

The viewer can also compare any two revisions of the review — each
fact's changed Markdown blocks rendered as the reader sees them (a
source-level diff one toggle away), the overview included, with the
base revision's comments and questions shown read-only and their
anchors lit in the rendered diff where the quoted words stand. One key
flips between the diff and the revision itself, and the flip is
lossless: the base last chosen and the scope on each side come back.
Comparing reads the same revision files over the same API and writes
nothing.

## Skills

- **gloss** generates revision `1` from the user's prompt, runs a round,
  answers questions live through `gloss reply`, iterates by copying the
  revision and resolving its notes, and approves with `gloss approve`
  when the human approves in conversation. During a round it treats the
  revision under review and the reviewed code as fixed — feedback lands
  in the next revision whether it arrives in the viewer or in
  conversation, and code changes wait for approval.
- **gloss-apply** implements from `approved/` and refuses to start
  without it. It never modifies the reviews directory.

Both are plain instruction files installed by `gloss skill install` —
into `.claude/skills/` by default, or `.agents/skills/` with `--agents`
for any other harness that can supervise a streaming background
process, identical content either way; the CLI stays small because
everything except the live round is agents reading and writing files.
The gloss skill ships with one reference file,
`references/writing-facts.md` — the writing contract for fact files,
which SKILL.md tells the agent to read before writing facts.

## Deliberately not built

No integrity verification or schema validation; no CLI mediation for
state beyond the live round; no approval ceremonies beyond the
`approved/` copy; no scoping semantics; no embedded agent SDKs or MCP
servers. The viewer shows only what the agent publishes and its one
status line — it never drives navigation.
