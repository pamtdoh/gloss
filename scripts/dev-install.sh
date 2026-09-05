#!/usr/bin/env bash
# Point this machine's `gloss` and its globally installed skills at this
# working tree, so a change can be tested without publishing to npm.
#
#   scripts/dev-install.sh            build, link the binary, install skills
#   scripts/dev-install.sh --restore  put the published npm release back
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# Root only when the global prefix isn't already ours. Homebrew's prefix is
# user-owned, so an unconditional `sudo npm` would prompt for a password the
# install doesn't need, block non-interactive runs, and leave root-owned files
# in a tree Homebrew expects to own. A prefix under /usr/local or a system node
# still needs the escalation, so ask rather than assume either way.
npm_root="$(npm root -g)"
npm_bin="$(npm prefix -g)/bin"
npm_global() {
  if [ -w "$npm_root" ] && [ -w "$npm_bin" ]; then
    npm "$@"
  else
    sudo npm "$@"
  fi
}

# `readlink -f` is GNU; BSD readlink only grew it in macOS 12.3, and because
# this runs last under `set -e`, its absence would fail the script after all
# the real work succeeded. Every component has to resolve, not just the last:
# `npm link` leaves bin/gloss -> lib/node_modules/gloss-review/dist/gloss.js,
# where the link to this tree is the *directory* gloss-review. Stopping early
# would print the published path and hide whether the link took. node is a
# prerequisite of the thing being installed, so realpath is free to reach for.
resolve() {
  node -p 'require("fs").realpathSync(process.argv[1])' "$1" 2>/dev/null ||
    printf '%s\n' "$1"
}

if [ "${1:-}" = "--restore" ]; then
  npm_global uninstall -g gloss-review
  npm_global install -g gloss-review
  gloss skill install --global
  gloss skill install --agents --global
  echo "restored: $(command -v gloss) -> $(resolve "$(command -v gloss)")"
  exit 0
fi

bun run build

# A symlinked global install, not a copy: after this runs once, every later
# `bun run build` is live immediately with no reinstall step.
npm_global link

# Skill text is embedded in the binary at build time, so a fresh build is
# what makes these write the working tree's SKILL.md files. Both agents,
# because the two installs are separate directories.
gloss skill install --global
gloss skill install --agents --global

echo "linked: $(command -v gloss) -> $(resolve "$(command -v gloss)")"
