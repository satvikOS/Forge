#!/usr/bin/env bash
# forge-desktop/test/run_update_gate.sh
#
# Builds and runs the auto-update gate WITHOUT CMake, without the kernel, without
# OCCT, without SDL and without Vulkan. libforge_updater deliberately depends on
# nothing but libc++ and the base macOS command-line tools, so the whole gate is
# one compiler invocation -- which means "does the update path still hold" is a
# question anyone can answer in seconds instead of after a 40-minute OCCT build.
#
#   ./forge-desktop/test/run_update_gate.sh              run the gate
#   ./forge-desktop/test/run_update_gate.sh --mutations  ALSO prove it can fail:
#                                                        run every mutation and
#                                                        require each to go red
#
# The CMake target forge_desktop_update_gate builds the same sources and ctest
# runs the same binary; this script exists so the gate is reachable from a tree
# that has never built the kernel.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP="$(dirname "$HERE")"
OUT="${TMPDIR:-/tmp}/forge_desktop_update_gate.$$"

MUTATIONS=0
for a in "$@"; do
  case "$a" in
    --mutations) MUTATIONS=1 ;;
    *) echo "unknown argument: $a" >&2; exit 2 ;;
  esac
done

echo "compiling the update gate (no kernel, no OCCT, no GPU)"
c++ -std=c++20 -O1 -g -Wall -Wextra -Werror \
    -I "$DESKTOP/src" \
    -o "$OUT" \
    "$DESKTOP/src/update/Version.cpp" \
    "$DESKTOP/src/update/Sha256.cpp" \
    "$DESKTOP/src/update/Manifest.cpp" \
    "$DESKTOP/src/update/Updater.cpp" \
    "$HERE/update_gate.cpp"
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "COMPILE FAILED (exit $rc) -- a gate that cannot build cannot fail." >&2
  exit "$rc"
fi

fail=0

echo
echo "── the gate, unmutated ────────────────────────────────────────────────"
"$OUT"
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "GATE RED (exit $rc)"
  fail=1
else
  echo "gate green"
fi

if [ "$MUTATIONS" -eq 1 ]; then
  echo
  echo "── negative controls: every mutation must make the gate go red ────────"
  for n in 1 2 3 4 5 6 7 8; do
    echo
    # The gate uses the SAME exit convention as its three siblings: non-zero
    # means checks failed. A mutated run is therefore SUPPOSED to be red, and a
    # mutated run that exits ZERO is the real defect -- nothing detected the
    # injected error. Read the exit code in that direction, not the obvious one.
    out="$("$OUT" --mutate "$n" 2>&1)"
    mrc=$?
    echo "$out"
    if [ "$mrc" -eq 0 ]; then
      echo "MUTATION $n STAYED GREEN -- the check it targets is unfalsifiable."
      fail=1
    else
      echo "  (mutation $n turned the gate RED, as it must)"
    fi
  done
fi

rm -f "$OUT"
if [ "$fail" -ne 0 ]; then
  echo
  echo "RESULT: FAILED"
  exit 1
fi
echo
echo "RESULT: PASSED"
