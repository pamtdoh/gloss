# ReviewKit

Review the *design* of a codebase — as small, condensed, decidable facts —
without reading source, then hand the reviewed design to a coding agent for
implementation. Everything is plain files under `.reviewkit/` in the target
repo: human-readable, agent-readable, git-committable. Agents read and write
those files directly; nothing validates, hashes, or mediates them.

[DESIGN.md](DESIGN.md) is the spec of record. All four v1 milestones are
built: review generation, the blocking viewer session, iteration +
approval + implement, and live mid-review Q&A.

## Getting started

Requires [Bun](https://bun.sh) to build; the CLI itself runs on Node.

```
bun install
bun run build        # → packages/cli/dist/reviewkit.js
```

## CLI

```
reviewkit init                       # scaffold .reviewkit/ in this repo
reviewkit session <review> [--snapshot <n>] [--events] [--no-browser]
reviewkit skill install --agent claude|codex
```

`init` creates `.reviewkit/` (idempotent). `session` binds an ephemeral
loopback port, prints a one-time-token URL for the viewer, blocks until the
reviewer clicks **Finish review** (or approves), then exits 0 and prints a
JSON summary. `--events` additionally emits JSONL events on stdout
(`session.started`, `decision.changed`, `question.asked`,
`session.finished`). `skill install` writes the two ReviewKit skills into
`.claude/skills/` or `.agents/skills/` of the current repo. Command results
are single-line JSON; the CLI is small because everything else is agents
reading and writing ordinary files.

## How a review works

The `reviewkit-review` skill (`skills/reviewkit-review/SKILL.md`) is the
entry point: from a conversation, the agent condenses the requested scope
into one fact per Markdown file under `.reviewkit/<review>/1/`, with
optional `_index.md` group facts — rich Markdown (GFM tables, code,
Mermaid diagrams, in-snapshot images) encouraged where it clarifies. The
human reviews in the viewer — a keyboard-driven review surface (press `?`
for the full map) with a nested fact tree, per-directory table view for
bulk quick-notes, ⌘K search palette, seen-tracking with progress, and
changed/new badges against the previous snapshot. j/k to navigate, 1–3
for quick-note presets (whole-fact annotations like "Not needed."), text
selections become anchored annotations and questions — which writes
`<fact>.review.json` sidecars next to the facts. There is no decision
field: everything raised is an item, and a fact with no sidecar stands
as written. Questions are live: the
agent answers by appending to the sidecar's thread while the session runs,
and the viewer picks it up within seconds. A fact with no sidecar means
agreement; resolving an item deletes it; approval is the accepted snapshot
copied to `approved/`. To iterate, the agent copies the snapshot, resolves
what was raised, and runs another session. The `reviewkit-implement` skill
implements from `approved/` and refuses to start without it.

Reading the files in the terminal and replying in conversation — no browser
at all — is a fully supported review path; facts are ordinary Markdown.

## Development

```
bun test                 # unit tests
bunx playwright test     # drives a real session in chromium, incl. visual baselines
bun run e2e              # scripted M1 check on a disposable fixture repo
```
