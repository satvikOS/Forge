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
# ArchieLink.cpp and the loopback stub are in it because the planner's WIRE is
# now exercised over a real 127.0.0.1 socket as well as through the fake
# transport: the fake alone passed while the client posted a path, a body and a
# tool list the sidecar did not read.
if ! $CXX -std=c++20 -O2 -Wall -Wextra -Werror -pthread \
      -I archie/include -I archie/test -I ui/include -I retrieval/include \
      -o "$BIN" archie/test/remote_planner_test.cpp archie/src/RemotePlanner.cpp \
      archie/src/ArchieLink.cpp \
      retrieval/src/Json.cpp retrieval/src/HttpTransport.cpp ui/src/*.cpp 2>&1; then
  echo "[archie] COMPILE FAILED -- a gate that cannot build cannot fail." >&2
  exit 2
fi
"$BIN" || exit 1

# The JSON number path, direct. RemotePlanner reads every sidecar reply through
# it, and it was rewritten off std::from_chars because that overload is deleted
# in the CI toolchain's libc++ -- so the contract it must still honour is
# asserted here rather than assumed from the planner's own cases.
NUMBIN="${TMPDIR:-/tmp}/json_number_gate.$$"
trap 'rm -f "$BIN" "$NUMBIN"' EXIT
echo "[archie] building the json number gate"
if ! $CXX -std=c++20 -O2 -Wall -Wextra -Werror -I retrieval/include \
      -o "$NUMBIN" retrieval/test/json_number_test.cpp retrieval/src/Json.cpp 2>&1; then
  echo "[archie] COMPILE FAILED -- a gate that cannot build cannot fail." >&2
  exit 2
fi
"$NUMBIN" || exit 1

echo "[archie] GREEN"
