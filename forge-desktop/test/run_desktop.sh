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
#   2. gate           — the headless frame gate: real ImGui frames over the real
#                       forge::ui services and a real tessellated kernel body,
#                       with no window, no swapchain and no MoltenVK.
#   3. mutation proof — SR-3 requires showing each gate CAN fail. Seven defects
#                       are injected in turn and each MUST make the gate exit
#                       non-zero; a mutation that stays green fails this script,
#                       because an unfalsifiable check is not a check.
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
echo "[desktop] built forge_desktop + forge_desktop_frame_gate (-Wall -Wextra -Werror clean)"

GATE="$APP_BUILD/forge_desktop_frame_gate"
if [ ! -x "$GATE" ]; then echo "[desktop] gate binary missing at $GATE"; exit 1; fi

# ── 2. the gate ──────────────────────────────────────────────────────────────
if ! "$GATE" > "$LOG/gate.log" 2>&1; then
  cat "$LOG/gate.log"; echo "[desktop] FRAME GATE FAILED"; exit 1
fi
cat "$LOG/gate.log"

# ── 3. mutation proof: every one of these MUST turn the gate red ─────────────
echo "[desktop] mutation proof (each injected defect must FAIL the gate):"
BAD=0
MUTATIONS=(1 2 3 4 5 6 7)
for m in "${MUTATIONS[@]}"; do
  "$GATE" --mutate "$m" > "$LOG/mut$m.log" 2>&1
  rc=$?
  fails="$(grep -c '  FAIL' "$LOG/mut$m.log" || true)"
  if [ "$rc" -eq 0 ]; then
    echo "  mutation $m: STAYED GREEN — the check it targets is unfalsifiable"
    BAD=$((BAD+1))
  else
    first="$(grep -m1 '  FAIL' "$LOG/mut$m.log" | sed 's/^  FAIL  //')"
    echo "  mutation $m: RED (exit $rc, $fails checks failed) <- $first"
  fi
done
if [ "$BAD" -ne 0 ]; then
  echo "[desktop] $BAD mutation(s) did not turn the gate red"; exit 1
fi

echo "[desktop] ALL FORGE DESKTOP GATES PASS, and all ${#MUTATIONS[@]} mutations proved red-then-green"
