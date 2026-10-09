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
# Exit 0 iff every file command's request is accepted by AppKit -- every command
# forge::desktop::fileDialogCommandIds() names, walked, not listed.
#
# ── 2026-09-13: IT DID NOT LINK, AND HAD NOT FOR SOME TIME ───────────────────
# "Undefined symbols: forge::ui::machineProgramExtensions()". FileDialog.cpp
# started calling it when file.export_gcode joined the policy table, and
# ui/src/MachineProgram.cpp was never added to the compile list below -- so the
# repository's ONLY AppKit instrument was dead while its own header went on
# claiming a green run. Found while closing T-122, whose honest caveat ("nothing
# here can measure the replace sheet") rests on what this probe can and cannot
# say; an instrument that cannot start says nothing at all.
#
# NOT wired into CI (see above), which is exactly how it died. It is one line to
# run on a Mac and that is what this note is for. With the TU restored it is
# GREEN again -- 27 checks -- and the check that matters to T-122 is "AppKit kept
# the file name we seeded" on a SAVE panel: a real NSSavePanel really does open
# on whatever the application points it at, which is why pointing it at another
# document's file destroyed that file. This probe measures AppKit and
# FileDialog.cpp, NOT ForgeFrame's seed producer, so it confirms the mechanism
# and not the fix; forge_desktop_save_target_gate measures the fix, on bytes.
# ── 2026-10-09 (T-230): IT DID NOT COMPILE, THEN DID NOT LINK -- AGAIN ─────
# panel_probe.mm still called fileDialogRequestFor(id, seed, out) after 2b5e61d3
# (2026-09-13) made the SeedContext argument required, so the probe had not
# compiled since that commit, the same day as the note above. Fixed, it then
# stopped at the linker: FileDialog.cpp now reaches forge::ui::pathIsOccupied and
# pathNamesSameFile, which live in ForgeShell.cpp, and ForgeShell.cpp reaches
# most of forge::ui. MEASURED after this change: GREEN, 48 checks, 10 of 10 file
# commands (file.export_drawing among them). That is the second time this
# hand-kept TU list fell behind FileDialog.cpp's needs, so it is no longer a
# list: the probe links ALL of ui/src, the same set run_ui.sh compiles. Slower
# to build (it is run by hand); impossible to fall behind.
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
    "$ROOT"/ui/src/*.cpp \
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
