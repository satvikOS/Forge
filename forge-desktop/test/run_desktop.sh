#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_desktop.sh — build and gate the FORGE DESKTOP APPLICATION.
#
# Three phases, in the order that makes a failure legible:
#
#   0. include hygiene — the kernel's own missing-#include preflight over every
#      first-party desktop source, so a header that only compiles because some
#      other file included <vector> first fails HERE and not in someone's IDE.
#   1. build          — the node-free kernel core, then the app and the gate.
#                       First-party code compiles -Wall -Wextra -Werror (SR-3).
#   2. gates          — headless gates. All but ONE need no GPU; the exception
#                       is the render gate, and it is the exception on purpose:
#                       "no gate needs a GPU" is exactly why the viewport had no
#                       instrument on it for the whole life of this file.
#                       * ir_pipeline — a UI-authored feature-IR program parses,
#                         compiles and measures as a real solid.
#                       * imgui_recovery — what a RECOVERABLE interface error
#                         costs the user. The library ships an assert on one
#                         (fatal wherever assert() is live) and a tooltip in its
#                         own words on the user's model where it is not; this
#                         asserts the configuration is set the other way, that a
#                         real unbalanced frame is REPAIRED and still draws the
#                         model, and that what the user reads is one plain
#                         sentence with none of the library's vocabulary in it.
#                       * document    — the user-launchable slice: the ONE
#                         registry -> PartDocument -> forge::ft -> the viewport's
#                         vertices -> a .fpart file on disk -> back again.
#                       * frame       — real ImGui frames over the real forge::ui
#                         services and a real tessellated kernel body, with no
#                         window, no swapchain and no MoltenVK.
#                       * update      — the auto-update path: appcast parsing,
#                         SemVer ordering, sha256 verification, ditto staging,
#                         the ad-hoc signature check and the atomic bundle swap,
#                         against real files and WITHOUT opening a socket.
#                       * copilot     — the Archie CoPilot panel: an intent typed
#                         into a real ImGui frame becomes a plan, the plan goes
#                         through the op-constraint gate, and what survives is
#                         followed through the ONE registry into a compiled
#                         solid. A plan hiding a forbidden op inside an argument
#                         VALUE must never reach a dispatch.
#                       * click       — the same nothing, but it INTERACTS: it
#                         drives io.AddMousePosEvent / io.AddMouseButtonEvent to
#                         click every dock tab and drag every splitter in every
#                         workspace, steps a FURTHER frame after each gesture,
#                         and asserts the app is alive and the dock tree intact.
#                         Built with -fsanitize=address, because the defect it
#                         exists for was a use-after-free that made the SHIPPED
#                         app SIGSEGV on the first tab click while the frame and
#                         document gates both stayed green -- neither clicks.
#                       * isolation   — the out-of-process kernel worker: an OCCT
#                         segfault must kill the WORKER and leave the app alive,
#                         surfacing as a failed op and not a dead application.
#                         Its mutation proof is NOT driven from here — see
#                         run_isolation_gate.sh below.
#   3. mutation proof — SR-3 requires showing each gate CAN fail. Every defect
#                       named by a `run_gate` line below is injected in turn and
#                       each MUST make its gate exit non-zero; a mutation that
#                       stays green fails this script, because an unfalsifiable
#                       check is not a check. The TOTAL is deliberately not
#                       written here: it is a figure this comment cannot keep,
#                       and it said EIGHTY-THREE for long enough that the real
#                       count reached 113 underneath it. It is pinned where it
#                       decides the build — EXPECTED_MUTATIONS in
#                       ci_desktop_gate.sh — and derived, on the tree being
#                       committed, by
#                         awk '/^run_gate /{t+=NF-2} END{print t}' \
#                           forge-desktop/test/run_desktop.sh
#
# CI does not run this script directly: it runs ci_desktop_gate.sh, which runs
# this one and then JUDGES ITS OUTPUT — this script has no `set -e`, so its exit
# status is whatever ran last and a run that fell out of its own middle would
# exit 0. That wrapper pins the mutation count EXACTLY, so adding or removing a
# --mutate case below means changing EXPECTED_MUTATIONS in ci_desktop_gate.sh in
# the SAME commit. The number itself is deliberately NOT repeated here as a
# figure this comment can go stale on -- it lives where it decides the build.
#
# The windowed application is NOT launched here: it needs a display server, and
# a gate that cannot run in CI is not a gate. Launch it yourself with
#   forge-desktop/build/run_forge.sh
# and add --screenshot <path> to have it write a PNG of its own live swapchain.
#
# What that paragraph USED to mean in practice was that nothing ran the renderer
# at all. A display server and a GPU are different requirements, and conflating
# them left ViewportRenderer.cpp -- the object the whole product is a frame
# around -- linked into no gate and executed by nothing. forge_desktop_render_gate
# below needs the second and not the first.
#
# AND IT IS THE ONLY THING HERE THAT NEEDS EITHER. That is a new dependency in a
# script everyone runs, so what happens on a machine without a Vulkan device is
# decided rather than discovered: the render gate exits 77, this script reports
# it as SKIPPED in a DIFFERENT verdict line naming the gate and the mutations
# that did not run, and exits 0. An absent instrument is not a defect in the
# renderer, and failing the whole suite for one would break this script for
# everyone on any runner whose image stops shipping a working ICD.
#
# Three things stop that allowance from rotting into a gate nobody notices is
# dead: the skip changes the verdict LINE (so ci_desktop_gate.sh has to decide
# about it explicitly and warns in CI), the skipped mutations are counted and
# must still add up to EXPECTED_MUTATIONS, and FORGE_REQUIRE_GPU=1 turns the
# skip into a hard failure on any machine that is supposed to have a device.
# The skip path itself is PROVED on every run, GPU or not, by the
# --simulate-no-device control just above the run_gate line.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

KERNEL_BUILD="${KERNEL_BUILD:-$ROOT/forge-kernel/build-app}"
APP_BUILD="${APP_BUILD:-$ROOT/forge-desktop/build}"
JOBS="${JOBS:-$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"
LOG="$(mktemp -d /tmp/forge_desktop_gate.XXXXXX)"
trap 'rm -rf "$LOG"' EXIT

# The click gate is sanitized, and AddressSanitizer's default is to ABORT on a
# report. A SIGABRT makes bash print its own "Abort trap: 6" job notice into the
# transcript, one line adrift of the verdict it belongs to. Exiting instead keeps
# the verdict in one place; a report is still a non-zero status, which is all
# run_gate reads. Respects an ASAN_OPTIONS the caller already set.
export ASAN_OPTIONS="${ASAN_OPTIONS:-abort_on_error=0:exitcode=1}"

echo "[desktop] ROOT=$ROOT JOBS=$JOBS"

# ── 0. include hygiene ───────────────────────────────────────────────────────
DESKTOP_SRC=(forge-desktop/src/*.cpp forge-desktop/src/*.hpp forge-desktop/test/*.cpp)
if ! bash forge-kernel/test/native/check_includes.sh "${DESKTOP_SRC[@]}" > "$LOG/incl.log" 2>&1; then
  cat "$LOG/incl.log"
  echo "[desktop] missing-include preflight FAILED"; exit 1
fi
sed -n '$p' "$LOG/incl.log"

# ── 1. build ─────────────────────────────────────────────────────────────────
if [ ! -f "$KERNEL_BUILD/libforge_kernel_core.dylib" ]; then
  echo "[desktop] configuring the node-free kernel core in $KERNEL_BUILD"
  if ! cmake -S forge-kernel -B "$KERNEL_BUILD" -DCMAKE_BUILD_TYPE=Release \
        -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON \
        > "$LOG/kcfg.log" 2>&1; then
    tail -30 "$LOG/kcfg.log"; echo "[desktop] kernel configure FAILED"; exit 1
  fi
fi
echo "[desktop] building forge_kernel_core"
if ! cmake --build "$KERNEL_BUILD" -j "$JOBS" --target forge_kernel_core \
      > "$LOG/kbuild.log" 2>&1; then
  tail -40 "$LOG/kbuild.log"; echo "[desktop] kernel core build FAILED"; exit 1
fi

echo "[desktop] configuring + building the application"
if ! cmake -S forge-desktop -B "$APP_BUILD" -DCMAKE_BUILD_TYPE=Release \
      -DFORGE_KERNEL_BUILD_DIR="$KERNEL_BUILD" > "$LOG/acfg.log" 2>&1; then
  tail -30 "$LOG/acfg.log"; echo "[desktop] app configure FAILED"; exit 1
fi
if ! cmake --build "$APP_BUILD" -j "$JOBS" > "$LOG/abuild.log" 2>&1; then
  grep -E "error:|Error" "$LOG/abuild.log" | head -30
  echo "[desktop] app build FAILED"; exit 1
fi
# COUNTED, not written down. This said "9 headless gates" while the build produced
# considerably more, because a number in prose does not move when the thing it
# describes does -- and a stale count in a green log is how a missing gate hides.
_gates=("$APP_BUILD"/forge_desktop_*_gate)
# An unmatched glob is left as the LITERAL pattern in bash, which counts as one
# element -- so "no gates built" would report 1. Test that the first entry exists.
if [ ! -e "${_gates[0]}" ]; then _ngates=0; else _ngates=${#_gates[@]}; fi
echo "[desktop] built forge_desktop + forge_kernel_worker + ${_ngates} headless gates (-Wall -Wextra -Werror clean)"

BAD=0
TOTAL_MUTATIONS=0
# ── SKIPPED gates, and why this bookkeeping exists ───────────────────────────
# Exactly one gate here can fail for a reason that is not about this project's
# code: forge_desktop_render_gate needs a Vulkan device, and a runner without an
# ICD has no instrument rather than a broken renderer. That gate exits 77 when
# there is no device (see the banner it prints), and 77 is handled HERE and
# nowhere else.
#
# A skip is allowed to be green, and it is NOT allowed to be quiet. Three things
# keep it from becoming a permanent no-op:
#   1. SKIPPED_NAMES goes into the FINAL VERDICT LINE, which is the exact line
#      ci_desktop_gate.sh matches -- so a skipped run cannot print the same
#      verdict as a complete one, and CI reads a different string.
#   2. the mutations a skipped gate did not run are counted in SKIPPED_MUTATIONS
#      and reported, so the coverage ratchet still sees the whole number.
#   3. FORGE_REQUIRE_GPU=1 turns the skip into a hard failure. Set it on any
#      machine that is supposed to have a device.
SKIPPED_NAMES=""
SKIPPED_GATES=0
SKIPPED_MUTATIONS=0

# run_gate <binary-name> <mutation numbers...>
# Runs the gate, then every mutation, and requires each mutation to turn it RED.
run_gate() {
  name="$1"; shift
  bin="$APP_BUILD/$name"
  if [ ! -x "$bin" ]; then echo "[desktop] gate binary missing at $bin"; exit 1; fi
  "$bin" > "$LOG/$name.log" 2>&1
  gate_rc=$?
  if [ "$gate_rc" -eq 77 ]; then
    # 77 means the gate could not run at all, not that it passed. Print its own
    # banner (which names the machine and the fix), record it, and DO NOT run its
    # mutations -- every one of them would skip identically and counting them as
    # red-then-green would be a lie.
    cat "$LOG/$name.log"
    echo "[desktop] ★ $name SKIPPED (exit 77) — it needs a GPU and this machine has none."
    echo "[desktop] ★ Nothing it asserts was checked. $# mutation(s) were NOT run."
    echo "[desktop] ★ Set FORGE_REQUIRE_GPU=1 to make this a RED build instead."
    SKIPPED_GATES=$((SKIPPED_GATES+1))
    SKIPPED_MUTATIONS=$((SKIPPED_MUTATIONS+$#))
    SKIPPED_NAMES="${SKIPPED_NAMES:+$SKIPPED_NAMES }$name"
    return 0
  fi
  if [ "$gate_rc" -ne 0 ]; then
    cat "$LOG/$name.log"; echo "[desktop] $name FAILED"; exit 1
  fi
  cat "$LOG/$name.log"
  if [ "$#" -eq 0 ]; then return 0; fi
  echo "[desktop] $name mutation proof (each injected defect must turn it red):"
  for m in "$@"; do
    TOTAL_MUTATIONS=$((TOTAL_MUTATIONS+1))
    "$bin" --mutate "$m" > "$LOG/$name.mut$m.log" 2>&1
    rc=$?
    # grep -c PRINTS 0 and EXITS 1, so the `|| true` is what keeps a
    # zero-match count from aborting the script under `set -o pipefail`.
    fails="$(grep -c '  FAIL' "$LOG/$name.mut$m.log" || true)"
    if [ "$rc" -eq 0 ]; then
      echo "  $name mutation $m: STAYED GREEN — the check it targets is unfalsifiable"
      BAD=$((BAD+1))
    else
      first="$(grep -m1 '  FAIL' "$LOG/$name.mut$m.log" | sed 's/^  FAIL  //')"
      # A sanitized gate can die on the defect before it can print a FAIL line.
      # Its verdict is then the sanitizer's own SUMMARY, which is the more
      # specific answer, not a less specific one.
      if [ -z "$first" ]; then
        first="$(grep -m1 'SUMMARY: AddressSanitizer' "$LOG/$name.mut$m.log" || true)"
      fi
      echo "  $name mutation $m: RED (exit $rc, $fails checks failed) <- $first"
    fi
  done
}

# ── 2. the gates, cheapest and most fundamental first ────────────────────────
# ir_pipeline has no mutation switch: its subject is whether the kernel accepts
# what the UI emits at all, and there is nothing to inject that the compiler
# would not reject on its own.
run_gate forge_desktop_ir_pipeline_gate

# THE ATOMIC-SAVE gate. No external mutations: it carries its own positive control
# INSIDE the binary -- the same fault injection is run against the OLD
# truncate-in-place algorithm and that arm is REQUIRED to leave a partial file, so
# a green run cannot mean the kill simply never landed.
run_gate forge_desktop_atomic_save_gate

# THE COPILOT INPUT gate. No external mutations: it carries its own before/after
# inside the fixture -- the 254/255 cases pass under the old code and the 256/257/
# 1024 cases do not, so the boundary itself is the control.
run_gate forge_desktop_copilot_input_gate
# THE INTERFACE-ERROR GATE, early because it is the cheapest of the lot and
# because what it guards is the difference between a repaired frame and a lost
# model. It links no kernel and no OCCT. Its eight mutations each leave the
# interface configured the way the LIBRARY ships it -- an abort on a recoverable
# error, the library's own prose over the user's part -- or break the path that
# carries the message out in Forge's own words.
run_gate forge_desktop_imgui_recovery_gate 1 2 3 4 5 6 7 8
run_gate forge_desktop_document_gate 1 2 3 4 5 6 7 8
# IMPORT, SAVE, REOPEN: the workflow every CAD session begins with, across a REAL
# process boundary -- the gate re-executes itself to do the opening, because the
# bindings the defect is about live in memory a restart destroys. MEASURED before
# it existed: the .fpart recorded `OP INPUT` and no path, nothing re-bound an
# input file on open, and the reopened part answered "INPUT() used but no input
# STEP was supplied to the compiler" while both the Save and the Open reported
# success.
#
# It also holds every failure the FIRST TWO versions of that fix produced, each
# measured before it was fixed. From the first: a version-3 .fpart -- every file
# the shipped app ever wrote for an imported part -- was refused outright; the
# remedy the refusal prescribed (import it again) EMPTIES the document; the
# recorded path went through the format's free-text writer, so a source whose
# name held a TAB was written under a name no file has; a relative import was
# recorded relative; renaming a job folder broke the part while its .step sat
# beside it; and a source that was present but unusable (junk, empty, a folder)
# reproduced the original silent empty viewport through the guard meant to
# prevent it. That is SIX, and this comment said "five" while listing them.
#
# From the second: the look beside the document was skipped entirely for a BARE
# RELATIVE document name, which is how main.cpp dispatches a command-line path;
# an open that bound nothing did not clear a previous import, so a legacy part
# naming no source silently BUILT the last part's solid; a file present but
# unreadable was reported as absent; the sibling warning said "is not there now"
# about a file that was there and junk; and the save that warning prescribes was
# `disabled` at the moment it was prescribed.
#
# Fifteen mutations, counted where they are written: EIGHT are defects (1 2 3 4 6
# 9 11 15) -- the path is not written; the scene is not re-bound; the exchange is
# not re-bound; the path is re-bound to a DIFFERENT file; the recorded path is
# sanitised the way a free-text value is; the previous import is re-bound after
# File > New; the previous part's source is re-bound after an open that binds
# nothing; and the file found beside a bare-name document is the DECOY solid.
# SEVEN are controls on the gate's own expectations (5 7 8 10 12 13 14) -- the
# source is not moved; the file beside the renamed folder is deleted; the four
# unusable sources are left intact; the file beside the BARE-NAME folder is
# deleted; the permission fixture is left readable; the recorded source is
# deleted instead of junked; and a good copy is left at the recorded path.
#
# The production lines these do NOT reach are proved by breaking the SOURCE, one
# line at a time -- see the mutation sweep in this gate's commit message.
run_gate forge_desktop_import_reopen_gate 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15

# THE QUIT GATE: the document gate proves a part can be written and read back;
# this one proves the application does not throw it away on the way out. It
# drives ForgeFrame::requestQuit() -- the call Window > Quit and the window's
# close box both make -- with a dirty document, and asserts the work is still
# there afterwards BOTH through the unsaved-changes prompt and through the
# forge::ui::RecoveryService autosave, which a SECOND session reads back into a
# live document and compares statement for statement against the program that
# was about to be lost. Its seven mutations each break one link in that chain;
# mutation 1 is the application exactly as it shipped -- the recovery engine
# written, gated, and constructed zero times. Mutations 8-13 came out of the
# adversarial review of the first version of this very change, which found that
# the guard DESTROYED DATA the bug it fixed had only failed to save: the autosave
# carried neither the drawing nor the material, and recovery then pointed the
# document at the user's own .fpart, so one Ctrl+S wrote those losses into it.
# 8 and 9 are that seam; 10 is the question outliving the save that answered it;
# 11 is Save As with an empty name silently doing Save; 12 is Save and Close on a
# document that has never been saved, where the close must WAIT for a file panel
# and must not happen at all if it is cancelled; 13 is what File > New leaves
# behind when it replaces a dirty document without asking; 14 is the fifteen-
# second cadence asked to keep an edit that touches only the drawing.
run_gate forge_desktop_quit_guard_gate 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17
# FILE EXCHANGE: open and save real CAD files through the shipping command path,
# comparing a VECTOR of observables at the seam -- volume AND area AND centre of
# mass AND bounding box AND the per-kind face census. The five mutations break the
# WRITE on purpose and are chosen so that no single observable catches all of
# them: 4 (the right solid in the wrong place) leaves volume, area and the census
# bit-identical, and 5 (a cube of the same volume about the same centre) leaves
# volume and the centre of mass identical. A gate checking volume alone passes both.
run_gate forge_desktop_file_exchange_gate 1 2 3 4 5 6
run_gate forge_desktop_file_dialog_gate 1 2 3 4
run_gate forge_desktop_frame_gate 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25
run_gate forge_desktop_drawing_gate 1 2 3 4 5 6
# The SKETCH PANELS gate: the four sketching tabs against a real solved sketch.
run_gate forge_desktop_sketch_panels_gate 1 2 3 4 5 6
# THE TRUST PANELS: Interference, Verification, Continuity, Draft and Zebra,
# with every number asserted against the model's own definition -- 500 mm3 of
# overlap centred at (7.5, 5, 5) between two 10 mm cubes 5 mm apart, a genus of 1
# for the plate's bore, fillets that meet their walls with no crease and corners
# that meet at a right angle. It also runs the whole check a SECOND time in the
# isolated worker and compares the two answers field by field, because the
# worker is the configuration a user actually runs. The seven mutations each
# break one link between a kernel query and a panel row.
run_gate forge_desktop_quality_gate 1 2 3 4 5 6 7
# The ARCHIE COPILOT gate: the agent panel, driven in real ImGui frames, with
# what it dispatched followed all the way into forge::ft::compile. Mutations 7
# and 8 are the op-constraint bypass -- a plan whose every op name is allowed and
# whose every parameter is declared and correctly typed, carrying a REFUSED op
# inside a `selector` VALUE. They must be refused before any dispatch is spent.
run_gate forge_desktop_copilot_gate 1 2 3 4 5 6 7 8
# The SIMULATION gate: the Restraints and Loads panels, over a real solve of a
# real cantilever, checked against the Euler-Bernoulli tip deflection for it. The
# six mutations break the SET-UP the production code is fed -- the restraint
# moved onto the loaded side, the beam built a thousand times larger with the
# formula left alone, the material swapped, the force turned along the beam
# instead of across it, the study never run, the part never edited -- so each one
# names a different link in the chain from a panel control to a solved matrix,
# and none of them can be caught by a check that only asks whether a number came
# out.
run_gate forge_desktop_study_gate 1 2 3 4 5 6
# The MANUFACTURING PANELS gate: Tool Library, Post Output, Stock and Materials,
# driven as real ImGui frames over a real kernel body. Every value the four tabs
# hold is compared against a SECOND call into forge::camx / forge::cam made by the
# gate itself, so a table typed into the panel fails even when it looks right.
# The seven mutations break one query each: the tool catalogue, the section
# height, the density, the stock extent, the posted program, the shared-weight
# scan and the removal arithmetic.
run_gate forge_desktop_cam_panels_gate 1 2 3 4 5 6 7 8 9 10
# The AUTO-UPDATE gate. It needs none of the build above -- libforge_updater
# links nothing but libc++ -- so it can also be run on its own in seconds with
# test/run_update_gate.sh --mutations, which is the form CI uses. It runs here
# too because "the desktop gates" should mean all of them, and because the path
# it covers is the one that decides whether a shipped copy of Forge can ever
# reach the next version.
run_gate forge_desktop_update_gate 1 2 3 4 5 6 7

# The click gate goes LAST: it is the only one that needs the sanitized copy of
# the stack, so a plain compile error in the app surfaces on a cheaper gate
# first. Mutation 3 is its positive control for the sanitizer itself -- if that
# one STAYS GREEN, -fsanitize=address is not reaching the binary and this gate's
# memory-safety half is silent.
run_gate forge_desktop_click_gate 1 2 3 4 5 6 7 8 9 10 11 12

# THE ASSEMBLY GATE. The four assembly panels -- Components, Mates, Contacts and
# BOM -- against real multi-body models, with every reference computed from the
# models' own dimensions rather than copied from a previous run. It also builds
# one model BOTH WAYS, in process and through the CMake-built forge_kernel_worker
# it finds beside itself, because the shipped app always runs the kernel out of
# process: an inventory that does not cross that boundary is one no user sees.
# It REFUSES to run without that worker rather than skipping the comparison.
run_gate forge_desktop_assembly_gate 1 2 3 4

# The CRASH-ISOLATION gate, with NO mutation list here on purpose. Its proof
# needs six mutations injected into a COPY of the production sources and two
# rebuilds of the worker, which is a job for a script and not for a --mutate
# switch: forge-desktop/test/run_isolation_gate.sh owns that and runs in the
# `kernel` CI job. What this line buys is that the CMake-BUILT, properly linked
# binary is exercised too -- the one that ships beside the app -- rather than
# only the one run_isolation_gate.sh compiles for itself.
run_gate forge_desktop_isolation_gate
run_gate forge_desktop_frame_capture_gate 1 2 3
run_gate forge_desktop_transaction_gate 4

# ★ THE RENDER GATE — the only gate here that runs the RENDERER, and therefore
# the only one that needs a GPU. Everything above is device-free, and that is
# precisely how the viewport came to be the one part of this application with no
# instrument on it: ViewportRenderer.cpp compiled into forge_desktop alone, this
# script declines to launch the windowed app, and a broken picture was
# indistinguishable from a correct one in a fully green suite.
#
# It opens no window and no swapchain: a headless VkDevice, the application's own
# ViewportRenderer rendering the default bracket into its offscreen target, the
# colour attachment copied back to host memory, and assertions ON THE PIXELS --
# per edge segment, so a DASHED rim fails where a count of dark pixels would not.
#
# The seven mutations each break a different link: 1 the edges never reach the
# vertex buffer, 2 only a handful survive the upload, 3 they sink 1 mm behind the
# surface and mostly go dark, 4 the solid never rasterizes, 5 every edge floats
# in front of the material -- which is what "just switch the depth test off"
# looks like and must not pass -- and 7 sinks them only 0.15 mm, which is the
# STITCHING shape of the real defect: the edges still mostly win the depth test
# and come out DASHED rather than hidden, so it is the injected input that turns
# the two INK-CONTINUITY observables red. 6 is the positive control for the
# body-hiding section: it hides no body at all, so a check that would pass
# whether or not the hide happened is caught being unfalsifiable rather than
# counted as a pass.
#
# ★ FIRST, THE SKIP PATH ITSELF. This gate is the one thing in this script that
# can fail for a reason that is not about this project's code, so it is allowed
# to exit 77 and be reported as SKIPPED on a machine with no Vulkan device. A
# skip branch nobody has executed is a branch nobody has read, and the first
# GPU-less runner is a bad place to discover it prints nothing or returns the
# wrong code. --simulate-no-device forces that branch HERE, on every machine
# including the ones that do have a device, and this control requires both the
# exit code and the banner. Without it, "SKIPPED" could silently become "did
# nothing and said nothing".
echo "[desktop] proving the render gate's no-GPU SKIP path before trusting it:"
if [ ! -x "$APP_BUILD/forge_desktop_render_gate" ]; then
  echo "[desktop] gate binary missing at $APP_BUILD/forge_desktop_render_gate"; exit 1
fi
"$APP_BUILD/forge_desktop_render_gate" --simulate-no-device > "$LOG/render_skip.log" 2>&1
skip_rc=$?
if [ "$skip_rc" -ne 77 ]; then
  cat "$LOG/render_skip.log"
  echo "[desktop] the render gate's --simulate-no-device path exited $skip_rc, not 77;"
  echo "[desktop] the skip contract is broken, so a GPU-less runner would not be"
  echo "[desktop] reported honestly. FAILED"; exit 1
fi
if ! grep -q 'RENDER GATE SKIPPED' "$LOG/render_skip.log"; then
  cat "$LOG/render_skip.log"
  echo "[desktop] the render gate exited 77 without printing its skip banner;"
  echo "[desktop] a silent skip is the no-op gate this control exists to prevent. FAILED"
  exit 1
fi
# ...and that FORGE_REQUIRE_GPU turns the same absent device into a RED build,
# which is the escape hatch a runner that is SUPPOSED to have a GPU uses. A
# safety valve nobody has opened is not a safety valve.
FORGE_REQUIRE_GPU=1 "$APP_BUILD/forge_desktop_render_gate" --simulate-no-device \
  > "$LOG/render_require.log" 2>&1
require_rc=$?
if [ "$require_rc" -ne 1 ]; then
  cat "$LOG/render_require.log"
  echo "[desktop] FORGE_REQUIRE_GPU=1 did not turn an absent device RED (exit"
  echo "[desktop] $require_rc, expected 1), so the escape hatch does not work. FAILED"
  exit 1
fi
echo "[desktop]   ok — exit 77 + banner when skipping, exit 1 under FORGE_REQUIRE_GPU=1"
run_gate forge_desktop_render_gate 1 2 3 4 5 6 7

# THE CAMERA gate. EVERY REBUILD RESET THE CAMERA -- main.cpp's frame loop hung
# "re-frame the camera" off geometryDirty, the flag that means "re-upload the
# vertex buffer", so changing one dimension threw away the user's pan and zoom
# and so did a rebuild the kernel REFUSED, where nothing on screen had moved.
# The gate RUNS the host's own reaction rather than reading main.cpp for it, and
# it asserts camera stability on the far side of a document event as well as at
# startup -- because the startup state has no framing request outstanding, and a
# check made only there passes whether the request is ever consumed or not. It
# reaches the latch from BOTH sides: File > New and a window that opens on a
# kernel failure arm it, and deleting either arm used to leave this gate green.
# SEVEN mutations, listed here in the order the numbers run: 1 and 2 put the
# removed host rule back (on every re-upload, then after the failed rebuild
# only), 3 stops dispatching view.fit, 4 reaches a new document without opening
# it, 5 refills a document without emptying it first, and 6 re-opens the already
# open file without saying a document event happened. The over-corrections and
# the original defect alike.
#
# ★ 7 IS THE ONE A REVIEWER FOUND, and it is here because it is the same defect
#   through a door the counters cannot see. Mutations 1 and 2 move Camera
#   directly; 7 makes the host ask the APPLICATION to re-frame -- `view.fit`, a
#   command a user may legitimately run -- which lands through fitCount and
#   applyPendingFit() and moves the camera WITHOUT touching cameraRefits_. Every
#   "did a document event re-frame the camera" check in the gate reads
#   cameraRefits_, so the counter sits at 1 while the camera is thrown from the
#   user's view back onto the part. MEASURED on the merged tree: it turns the
#   gate RED with four failures, at the reviewer's own coordinates -- target
#   (-1.4570, -3.3971, 12.1058) d=108.8658 becomes (0,0,10) d=197.6292 -- so the
#   CamState comparisons, and not the counters, are what catch it. It is a
#   mutation rather than a note in a commit so that stays true.
run_gate forge_desktop_camera_stability_gate 1 2 3 4 5 6 7

# ── 3. mutation verdict ──────────────────────────────────────────────────────
if [ "$BAD" -ne 0 ]; then
  echo "[desktop] $BAD mutation(s) did not turn their gate red"; exit 1
fi

# ── 4. the verdict, which says what was NOT run ──────────────────────────────
# Two different lines, on purpose. ci_desktop_gate.sh matches the complete one
# EXACTLY, so a run that skipped a gate cannot present itself as a run that did
# not -- the skipped form names the gate and the mutations that never executed,
# and CI has to decide about it explicitly rather than inherit a green string.
if [ "$SKIPPED_GATES" -ne 0 ]; then
  echo "[desktop] FORGE DESKTOP GATES PASS WITH $SKIPPED_GATES GATE(S) SKIPPED ($SKIPPED_NAMES): $TOTAL_MUTATIONS mutations proved red-then-green, $SKIPPED_MUTATIONS NOT RUN"
  exit 0
fi
echo "[desktop] ALL FORGE DESKTOP GATES PASS, and all $TOTAL_MUTATIONS mutations proved red-then-green"
