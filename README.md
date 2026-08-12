# Gloss

Design review for codebases, as plain files — an agent skill for Claude
Code and Codex. The agent condenses a repo's design into small,
decidable facts — one Markdown file each — a human reviews them without
reading source, and the approved revision drives implementation.

![The Gloss viewer](docs/viewer.png)

Everything lives under `.gloss/` in the target repo: human-readable,
agent-readable, git-committable. Nothing validates, hashes, or mediates
the files.

## Install

```sh
npm install -g gloss-review                  # `gloss` on PATH (Node 18+)
gloss skill install --agent claude --global  # or --agent codex
```

That's the CLI's whole job. Reviews are run by the **gloss** skill,
through your agent — you never invoke `gloss` yourself.

## Use

Invoke the skill with whatever you want reviewed — your prompt is the
scope:

```
/gloss all the pages, components, and fields — i want to know what info we display to users
/gloss the recent changes in this session
/gloss the v2 design
```

Plain words work too: "review the design of the checkout flow" triggers
the skill the same way.

The agent reads the code (and runs the app when facts need evidence),
writes the review to `.gloss/<review>/1/`, and opens the viewer: j/k to
move, keys 1–3 for one-tap quick comments, text selections become
anchored comments and questions — answered live by the agent while the
session runs. A fact you leave alone stands as written; silence is
agreement. Review state is `*.review.json` sidecars next to the facts,
so reviewing from the terminal with no browser works the same.

Your comments drive the next revision. Approving copies the accepted
revision to `approved/`; then ask your agent to *implement the approved
design* — the **gloss-apply** skill builds from those facts, and refuses
to start without them.

[ARCHITECTURE.md](ARCHITECTURE.md) documents the conventions: the file
layout, the sidecar schema, and the session protocol.

## Develop

Building from source requires [Bun](https://bun.sh):

```sh
bun install && bun run build     # → dist/gloss.js (self-contained)
bun link                         # use your working copy as `gloss`
bun test                         # unit tests
bunx playwright test             # drives a real session in chromium, incl. visual baselines
bun run e2e                      # scripted end-to-end on a disposable fixture repo
```

MIT licensed.
