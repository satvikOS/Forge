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
#   2. gates          — nine headless gates, none of which needs a GPU:
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
#   3. mutation proof — SR-3 requires showing each gate CAN fail. FIFTY-SIX
#                       defects (8 imgui_recovery + 8 document + 5 file_exchange +
#                       12 frame + 8 copilot + 7 update + 8 click) are
#                       injected in turn and each MUST make its gate exit non-zero;
#                       a mutation that stays green fails this script, because an
#                       unfalsifiable check is not a check.
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
echo "[desktop] built forge_desktop + forge_kernel_worker + 9 headless gates (-Wall -Wextra -Werror clean)"

BAD=0
TOTAL_MUTATIONS=0

# run_gate <binary-name> <mutation numbers...>
# Runs the gate, then every mutation, and requires each mutation to turn it RED.
run_gate() {
  name="$1"; shift
  bin="$APP_BUILD/$name"
  if [ ! -x "$bin" ]; then echo "[desktop] gate binary missing at $bin"; exit 1; fi
  if ! "$bin" > "$LOG/$name.log" 2>&1; then
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
# THE INTERFACE-ERROR GATE, early because it is the cheapest of the lot and
# because what it guards is the difference between a repaired frame and a lost
# model. It links no kernel and no OCCT. Its eight mutations each leave the
# interface configured the way the LIBRARY ships it -- an abort on a recoverable
# error, the library's own prose over the user's part -- or break the path that
# carries the message out in Forge's own words.
run_gate forge_desktop_imgui_recovery_gate 1 2 3 4 5 6 7 8
run_gate forge_desktop_document_gate 1 2 3 4 5 6 7 8
# FILE EXCHANGE: open and save real CAD files through the shipping command path,
# comparing a VECTOR of observables at the seam -- volume AND area AND centre of
# mass AND bounding box AND the per-kind face census. The five mutations break the
# WRITE on purpose and are chosen so that no single observable catches all of
# them: 4 (the right solid in the wrong place) leaves volume, area and the census
# bit-identical, and 5 (a cube of the same volume about the same centre) leaves
# volume and the centre of mass identical. A gate checking volume alone passes both.
run_gate forge_desktop_file_exchange_gate 1 2 3 4 5
run_gate forge_desktop_frame_gate 1 2 3 4 5 6 7 8 9 10 11 12
# The ARCHIE COPILOT gate: the agent panel, driven in real ImGui frames, with
# what it dispatched followed all the way into forge::ft::compile. Mutations 7
# and 8 are the op-constraint bypass -- a plan whose every op name is allowed and
# whose every parameter is declared and correctly typed, carrying a REFUSED op
# inside a `selector` VALUE. They must be refused before any dispatch is spent.
run_gate forge_desktop_copilot_gate 1 2 3 4 5 6 7 8
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
run_gate forge_desktop_click_gate 1 2 3 4 5 6 7 8

# The CRASH-ISOLATION gate, with NO mutation list here on purpose. Its proof
# needs six mutations injected into a COPY of the production sources and two
# rebuilds of the worker, which is a job for a script and not for a --mutate
# switch: forge-desktop/test/run_isolation_gate.sh owns that and runs in the
# `kernel` CI job. What this line buys is that the CMake-BUILT, properly linked
# binary is exercised too -- the one that ships beside the app -- rather than
# only the one run_isolation_gate.sh compiles for itself.
run_gate forge_desktop_isolation_gate

# ── 3. mutation verdict ──────────────────────────────────────────────────────
if [ "$BAD" -ne 0 ]; then
  echo "[desktop] $BAD mutation(s) did not turn their gate red"; exit 1
fi

echo "[desktop] ALL FORGE DESKTOP GATES PASS, and all $TOTAL_MUTATIONS mutations proved red-then-green"
