# Gloss

Review the *design* of a codebase — as small, condensed, decidable facts —
without reading source, then hand the reviewed design to a coding agent for
implementation. Everything is plain files under `.gloss/` in the target
repo: human-readable, agent-readable, git-committable. Agents read and write
those files directly; nothing validates, hashes, or mediates them.

[DESIGN.md](DESIGN.md) is the spec of record. All four v1 milestones are
built: review generation, the blocking viewer session, iteration +
approval + implement, and live mid-review Q&A.

## Getting started

Requires [Bun](https://bun.sh) to build; the CLI itself runs on Node.

```
bun install
bun run build        # → packages/cli/dist/gloss.js
```

## Install globally

Two separate things: the `gloss` command on your `PATH`, and the skills
your agent loads.

```
cd packages/cli && bun link          # or: npm i -g .
gloss skill install --agent claude --global
```

`bun link` puts `gloss` on `PATH` via bun's global bin directory; `npm i
-g .` uses the same `bin` entry. Both point at `dist/gloss.js`, which is
a self-contained bundle — but `dist/` is gitignored and there is no
prepack step, so run `bun run build` before linking and again after
pulling changes. A plain symlink works too and needs no package manager:

```
ln -s "$PWD/packages/cli/dist/gloss.js" ~/.local/bin/gloss
```

`skill install --global` writes the skills to `~/.claude/skills/` (or
`~/.agents/skills/` for `--agent codex`) instead of the current repo, so
they are available in every repo. Re-run it after changing the skills —
installing copies the files, it does not link them.

## CLI

```
gloss init                       # scaffold .gloss/ in this repo
gloss session <review> [--rev <n>] [--no-browser]
gloss skill install --agent claude|codex [--global]
```

`init` creates `.gloss/` (idempotent). `session` binds an ephemeral
loopback port, prints a one-time-token URL for the viewer, emits JSONL
events on stdout as the review happens (`session.started`,
`question.asked`, `session.finished`), blocks until the reviewer clicks
**Finish review** (or approves), then exits 0 and prints a JSON summary. `skill install` writes the two Gloss skills into
`.claude/skills/` or `.agents/skills/` of the current repo, or of `$HOME`
with `--global`. Command results are single-line JSON; the CLI is small
because everything else is agents reading and writing ordinary files.

## How a review works

The `gloss` skill (`skills/gloss/SKILL.md`) is the
entry point: from a conversation, the agent condenses the requested scope
into one fact per Markdown file under `.gloss/<review>/1/`, with
optional `_index.md` group facts — rich Markdown (GFM tables, code,
Mermaid diagrams, in-revision images) encouraged where it clarifies. The
human reviews in the viewer — a keyboard-driven review surface (press `?`
for the full map) with a nested fact tree, per-directory table view for
bulk quick comments, ⌘K search palette, seen-tracking with progress, and
changed/new badges against the previous revision. j/k to navigate, 1–3
for quick comments (one-tap whole-fact comments like "Not needed."), text
selections become anchored comments and questions — which writes
`<fact>.review.json` sidecars next to the facts. Items are comments and
questions — no decision field; a fact with no sidecar stands as
written. Questions are live: the
agent answers by appending to the sidecar's thread while the session runs,
and the viewer picks it up within seconds. A fact with no sidecar means
agreement; resolving an item deletes it; approval is the accepted revision
copied to `approved/`. To iterate, the agent copies the revision, resolves
what was raised, and runs another session. The `gloss-apply` skill
implements from `approved/` and refuses to start without it.

Reading the files in the terminal and replying in conversation — no browser
at all — is a fully supported review path; facts are ordinary Markdown.

## Development

```
bun test                 # unit tests
bunx playwright test     # drives a real session in chromium, incl. visual baselines
bun run e2e              # scripted M1 check on a disposable fixture repo
```
