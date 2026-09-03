#!/usr/bin/env bash
# forge-desktop/test/run_panel_probe.sh
#
# Builds and runs panel_probe.mm — the ONE check in this repository that touches
# a real NSOpenPanel / NSSavePanel. Read that file's header for what it covers
# and, more importantly, for what it deliberately does not: it stops short of
# -[NSSavePanel runModal], because runModal blocks until a human answers.
#
# NOT wired into CI, on purpose and with the reason written down beside it. Run
# it on a Mac when the file-dialog policy or the Cocoa code changes:
#
#     bash forge-desktop/test/run_panel_probe.sh
#
# Exit 0 iff every one of the six commands' requests is accepted by AppKit.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP="$(dirname "$HERE")"
ROOT="$(dirname "$DESKTOP")"

if [ "$(uname -s 2>/dev/null || echo unknown)" != "Darwin" ]; then
  echo "[panel-probe] this probe is macOS only: AppKit is what it measures." >&2
  echo "[panel-probe] An absent instrument is not a result; refusing to report a pass." >&2
  exit 3
fi

OUT="${TMPDIR:-/tmp}/forge_panel_probe.$$"
c++ -std=c++20 -O1 -Wall -Wextra -Werror \
    -I "$DESKTOP/src" -I "$ROOT/ui/include" \
    -o "$OUT" \
    "$HERE/panel_probe.mm" \
    "$DESKTOP/src/FileDialog.cpp" \
    "$ROOT/ui/src/FileExchange.cpp" \
    -framework AppKit -framework Foundation -framework UniformTypeIdentifiers
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "[panel-probe] COMPILE FAILED (exit $rc) -- a probe that cannot build cannot fail." >&2
  exit "$rc"
fi

"$OUT"
rc=$?
rm -f "$OUT"
exit "$rc"
