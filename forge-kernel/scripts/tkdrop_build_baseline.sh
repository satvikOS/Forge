#!/usr/bin/env bash
# tkdrop_build_baseline.sh — build the kernel .node in THIS worktree so that
# occt_closure_count.sh has a binary to measure.
#
# The worktree has no node_modules of its own; the primary checkout's cmake-js is
# used read-only (a symlink is created by the caller). Parallelism is deliberately
# modest: the box carries other agents and the SR resource rule allows ONE heavy
# job at a time.
#
# usage: bash forge-kernel/scripts/tkdrop_build_baseline.sh [extra -D flags...]
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KDIR="$ROOT/forge-kernel"
PAR="${FORGE_BUILD_PAR:-6}"

# A git worktree has no node_modules of its own. Link the primary checkout's,
# read-only, so the tree stays clean (an untracked node_modules would make the
# worktree look dirty to the reaper). Safe to delete afterwards — this recreates it.
PRIMARY="${FORGE_PRIMARY_CHECKOUT:-$HOME/archdisc-Mech}"
if [ ! -e "$ROOT/node_modules" ] && [ -d "$PRIMARY/node_modules" ]; then
  echo "[tkdrop-build] linking $PRIMARY/node_modules -> $ROOT/node_modules"
  ln -sfn "$PRIMARY/node_modules" "$ROOT/node_modules"
fi

CMAKE_JS="$ROOT/node_modules/.bin/cmake-js"
[ -x "$CMAKE_JS" ] || { echo "FATAL: cmake-js not at $CMAKE_JS (set FORGE_PRIMARY_CHECKOUT=)" >&2; exit 2; }

echo "[tkdrop-build] root=$ROOT parallel=$PAR extra=$*"
cd "$KDIR" || exit 2
"$CMAKE_JS" build --parallel "$PAR" "$@"
RC=$?
echo "[tkdrop-build] cmake-js rc=$RC"
exit $RC
