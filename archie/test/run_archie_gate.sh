#!/bin/bash
# Builds and runs the Archie remote-planner gate.
#
# Mirrors retrieval/'s arrangement deliberately: its own tree, its own gate, and
# NOT part of ui/src/*.cpp -- ui/test/run_ui.sh globs that directory with only
# `-I ui/include`, so a file there including forge/retrieval/* fails to compile
# and takes every ui gate with it. Measured before this was moved.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
CXX="${CXX:-clang++}"
BIN="${TMPDIR:-/tmp}/archie_remote_planner_gate.$$"
trap 'rm -f "$BIN"' EXIT

echo "[archie] building the remote-planner gate"
if ! $CXX -std=c++20 -O2 -Wall -Wextra -Werror \
      -I archie/include -I ui/include -I retrieval/include \
      -o "$BIN" archie/test/remote_planner_test.cpp archie/src/RemotePlanner.cpp \
      retrieval/src/Json.cpp retrieval/src/HttpTransport.cpp ui/src/*.cpp 2>&1; then
  echo "[archie] COMPILE FAILED -- a gate that cannot build cannot fail." >&2
  exit 2
fi
"$BIN" || exit 1
echo "[archie] GREEN"
