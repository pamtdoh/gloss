#!/usr/bin/env bash
# Point this machine's `gloss` and its globally installed skills at this
# working tree, so a change can be tested without publishing to npm.
#
#   scripts/dev-install.sh            build, link the binary, install skills
#   scripts/dev-install.sh --restore  put the published npm release back
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if [ "${1:-}" = "--restore" ]; then
  sudo npm uninstall -g gloss-review
  sudo npm install -g gloss-review
  gloss skill install --agent claude --global
  gloss skill install --agent codex --global
  echo "restored: $(command -v gloss) -> $(readlink -f "$(command -v gloss)")"
  exit 0
fi

bun run build

# A symlinked global install, not a copy: after this runs once, every later
# `bun run build` is live immediately with no reinstall step.
sudo npm link

# Skill text is embedded in the binary at build time, so a fresh build is
# what makes these write the working tree's SKILL.md files. Both agents,
# because the two installs are separate directories.
gloss skill install --agent claude --global
gloss skill install --agent codex --global

echo "linked: $(command -v gloss) -> $(readlink -f "$(command -v gloss)")"
