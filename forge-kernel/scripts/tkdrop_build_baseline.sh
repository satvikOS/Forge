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
CMAKE_JS="$ROOT/node_modules/.bin/cmake-js"
PAR="${FORGE_BUILD_PAR:-6}"

[ -x "$CMAKE_JS" ] || { echo "FATAL: cmake-js not at $CMAKE_JS" >&2; exit 2; }

echo "[tkdrop-build] root=$ROOT parallel=$PAR extra=$*"
cd "$KDIR" || exit 2
"$CMAKE_JS" build --parallel "$PAR" "$@"
RC=$?
echo "[tkdrop-build] cmake-js rc=$RC"
exit $RC
