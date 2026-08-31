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
#   2. gates          — four headless gates, none of which needs a GPU:
#                       * ir_pipeline — a UI-authored feature-IR program parses,
#                         compiles and measures as a real solid.
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
#   3. mutation proof — SR-3 requires showing each gate CAN fail. TWENTY-FOUR
#                       defects (8 document + 9 frame + 7 update) are injected in
#                       turn and each MUST make its gate exit non-zero; a mutation
#                       that stays green fails this script, because an
#                       unfalsifiable check is not a check.
#
# CI does not run this script directly: it runs ci_desktop_gate.sh, which runs
# this one and then JUDGES ITS OUTPUT — this script has no `set -e`, so its exit
# status is whatever ran last and a run that fell out of its own middle would
# exit 0. That wrapper also pins the mutation count at an EXACT 24, so adding or
# removing a --mutate case below means changing EXPECTED_MUTATIONS in
# ci_desktop_gate.sh in the SAME commit.
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
echo "[desktop] built forge_desktop + 4 headless gates (-Wall -Wextra -Werror clean)"

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
      echo "  $name mutation $m: RED (exit $rc, $fails checks failed) <- $first"
    fi
  done
}

# ── 2. the gates, cheapest and most fundamental first ────────────────────────
# ir_pipeline has no mutation switch: its subject is whether the kernel accepts
# what the UI emits at all, and there is nothing to inject that the compiler
# would not reject on its own.
run_gate forge_desktop_ir_pipeline_gate
run_gate forge_desktop_document_gate 1 2 3 4 5 6 7 8
run_gate forge_desktop_frame_gate 1 2 3 4 5 6 7 8 9
# The AUTO-UPDATE gate. It needs none of the build above -- libforge_updater
# links nothing but libc++ -- so it can also be run on its own in seconds with
# test/run_update_gate.sh --mutations, which is the form CI uses. It runs here
# too because "the desktop gates" should mean all of them, and because the path
# it covers is the one that decides whether a shipped copy of Forge can ever
# reach the next version.
run_gate forge_desktop_update_gate 1 2 3 4 5 6 7

# ── 3. mutation verdict ──────────────────────────────────────────────────────
if [ "$BAD" -ne 0 ]; then
  echo "[desktop] $BAD mutation(s) did not turn their gate red"; exit 1
fi

echo "[desktop] ALL FORGE DESKTOP GATES PASS, and all $TOTAL_MUTATIONS mutations proved red-then-green"
