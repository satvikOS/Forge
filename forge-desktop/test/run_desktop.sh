#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_desktop.sh — build and gate the FORGE DESKTOP APPLICATION.
#
# Three phases, in the order that makes a failure legible:
#
#   0. include hygiene — the kernel's own missing-#include preflight over every
#      first-party desktop source, so a header that only compiles because some
#      other file included <vector> first fails HERE and not in someone's IDE.
#   1. build          — the node-free kernel core, then the app and the gates.
#                       First-party code compiles -Wall -Wextra -Werror (SR-3).
#   2. gates          — the headless FRAME gate (real ImGui frames over the real
#                       forge::ui services and a real tessellated kernel body,
#                       with no window, no swapchain and no MoltenVK) and the
#                       headless ARCHIE COPILOT gate (the same frames, driving the
#                       CoPilot panel's request/apply path all the way through
#                       forge::ft::compile to a solid, with no socket).
#   3. mutation proof — SR-3 requires showing each gate CAN fail. THIRTEEN defects
#                       are injected in turn — seven into the frame gate, six into
#                       the CoPilot gate — and each MUST make its gate exit
#                       non-zero; a mutation that stays green fails this script,
#                       because an unfalsifiable check is not a check.
#
# EXPECTED_MUTATIONS: there is no ci_desktop_gate.sh on this branch to pin the
# count in, so the pin is the two arrays below and the verdict line they print.
# If you add a --mutate case to either gate, the array it belongs to moves in the
# SAME change, or the verdict is reporting a number nothing produced.
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
echo "[desktop] built forge_desktop + forge_desktop_frame_gate + forge_desktop_copilot_gate"
echo "[desktop] (-Wall -Wextra -Werror clean on all first-party code)"

GATE="$APP_BUILD/forge_desktop_frame_gate"
COPILOT_GATE="$APP_BUILD/forge_desktop_copilot_gate"
for bin in "$GATE" "$COPILOT_GATE"; do
  if [ ! -x "$bin" ]; then echo "[desktop] gate binary missing at $bin"; exit 1; fi
done

# ── 2. the gates ─────────────────────────────────────────────────────────────
if ! "$GATE" > "$LOG/gate.log" 2>&1; then
  cat "$LOG/gate.log"; echo "[desktop] FRAME GATE FAILED"; exit 1
fi
cat "$LOG/gate.log"

if ! "$COPILOT_GATE" > "$LOG/copilot.log" 2>&1; then
  cat "$LOG/copilot.log"; echo "[desktop] ARCHIE COPILOT GATE FAILED"; exit 1
fi
cat "$LOG/copilot.log"

# ── 3. mutation proof: every one of these MUST turn its gate red ─────────────
# Two EXACT pins. A --mutate case added to a gate without moving its array here
# is a defect nobody proves is caught.
FRAME_MUTATIONS=(1 2 3 4 5 6 7)
COPILOT_MUTATIONS=(1 2 3 4 5 6)
BAD=0

prove() {  # prove <label> <binary> <mutation...>
  local label="$1"; shift
  local bin="$1"; shift
  local m
  for m in "$@"; do
    "$bin" --mutate "$m" > "$LOG/${label}_mut$m.log" 2>&1
    local rc=$?
    # grep -c PRINTS 0 and EXITS 1 when it matches nothing, so `|| true` keeps
    # the count a single line instead of "0\n0".
    local fails
    fails="$(grep -c '  FAIL' "$LOG/${label}_mut$m.log" || true)"
    if [ "$rc" -eq 0 ]; then
      echo "  $label mutation $m: STAYED GREEN — the check it targets is unfalsifiable"
      BAD=$((BAD+1))
    else
      local first
      first="$(grep -m1 '  FAIL' "$LOG/${label}_mut$m.log" | sed 's/^  FAIL  //')"
      echo "  $label mutation $m: RED (exit $rc, $fails checks failed) <- $first"
    fi
  done
}

echo "[desktop] mutation proof (each injected defect must FAIL its gate):"
prove frame   "$GATE"          "${FRAME_MUTATIONS[@]}"
prove copilot "$COPILOT_GATE"  "${COPILOT_MUTATIONS[@]}"

if [ "$BAD" -ne 0 ]; then
  echo "[desktop] $BAD mutation(s) did not turn their gate red"; exit 1
fi

TOTAL_MUTATIONS=$(( ${#FRAME_MUTATIONS[@]} + ${#COPILOT_MUTATIONS[@]} ))
echo "[desktop] ALL FORGE DESKTOP GATES PASS, and all $TOTAL_MUTATIONS mutations proved red-then-green"
