# Gloss

Design review for codebases, as plain files. An agent condenses a repo's
design into small, decidable facts — one Markdown file each — a human
reviews them without reading source, and the approved revision drives
implementation.

![The Gloss viewer](docs/viewer.png)

Everything lives under `.gloss/` in the target repo: human-readable,
agent-readable, git-committable. Nothing validates, hashes, or mediates
the files.

## Install

Requires [Bun](https://bun.sh) to build; the CLI itself runs on Node.

```sh
bun install && bun run build
bun link                                     # `gloss` on PATH
gloss skill install --agent claude --global  # agent skills (claude | codex)
```

Re-run `bun run build` after pulling changes; `skill install` copies the
skill files, so re-run it after changing them.

## Use

In any repo, ask your agent for a design review ("review the design of
the checkout flow"). The gloss skill writes facts to
`.gloss/<review>/1/` and runs the session:

```sh
gloss init                # scaffold .gloss/ (agents run this for you)
gloss session <review>    # serve the viewer, block until the review ends
```

The session prints a one-time URL for the viewer: j/k to move, keys 1–3
for one-tap quick comments, text selections become anchored comments and
questions — answered live by the agent while the session runs. A fact
you leave alone stands as written; silence is agreement. Review state is
`*.review.json` sidecars next to the facts, so reviewing from the
terminal with no browser works the same. Approving copies the revision
to `approved/`, and the gloss-apply skill implements from it — refusing
to start without it.

[ARCHITECTURE.md](ARCHITECTURE.md) documents the conventions: the file
layout, the sidecar schema, and the session protocol.

## Develop

```sh
bun test                # unit tests
bunx playwright test    # drives a real session in chromium, incl. visual baselines
bun run e2e             # scripted end-to-end on a disposable fixture repo
```
