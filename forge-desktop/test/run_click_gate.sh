#!/usr/bin/env bash
# run_click_gate.sh -- build and run THE HEADLESS CLICK GATE, in CI, with no
# windowing stack installed.
#
# WHY THIS SCRIPT EXISTS AT ALL. Nothing in CI compiles forge-desktop/src. The
# kernel job's IR-pipeline step deliberately compiles only ui/src plus one gate
# TU, so it needs no SDL2, no Vulkan and no ImGui -- and the consequence is that
# TWO defects reached a shipped app on the same day without a single check going
# red: a call to a method that no longer existed (the app was unbuildable for
# hours) and a use-after-free that SIGSEGV'd on the first dock-tab click. A gate
# that cannot BUILD cannot FAIL, and looks exactly like silence.
#
# This script closes that hole on the cheapest possible terms. It compiles
# DIRECTLY with the compiler rather than through forge-desktop/CMakeLists.txt,
# because that file links the real application: SDL2, the Vulkan loader, glslang
# and MoltenVK, none of which the kernel runner has and none of which a headless
# frame needs. What it does compile is the real thing:
#
#   * the vendored Dear ImGui CORE (imgui/draw/tables/widgets) -- NOT
#     imgui_impl_vulkan.cpp, the only file in it that wants a Vulkan header;
#   * every forge::ui source;
#   * the four first-party desktop TUs the frame builder is made of, INCLUDING
#     ForgeFrame.cpp and KernelScene.cpp -- so a stale call site like
#     scene_.features() is a red build here, not a broken release;
#   * the click gate itself.
#
# ...and it compiles all of it under -fsanitize=address, because the defect this
# gate exists for is a use-after-free and reading freed memory is not reliably a
# crash.
#
# Requires a prebuilt libforge_kernel_core. Point at it with
# FORGE_KERNEL_BUILD_DIR, or build one with:
#   cmake -S forge-kernel -B forge-kernel/build-verify -DCMAKE_BUILD_TYPE=Release \
#         -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON
#   cmake --build forge-kernel/build-verify -j3 --target forge_kernel_core
#
# Exit codes
#   0  GREEN
#   1  RED  -- the gate's own assertions failed, or the sanitizer reported
#   3  RED  -- could not build, or the kernel core is missing. A check that could
#              not run is not a check that passed.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# A gate that could not even reach its own tree has not passed; exit 3 is this
# script's "could not run", which is never reported as green.
cd "$ROOT" || { echo "[click-gate] cannot cd to $ROOT. RED."; exit 3; }

KDIR="${FORGE_KERNEL_BUILD_DIR:-$ROOT/forge-kernel/build-verify}"
LIB=""
for cand in "$KDIR/libforge_kernel_core.dylib" "$KDIR/libforge_kernel_core.so" \
            "$KDIR/libforge_kernel_core.a"; do
  [ -f "$cand" ] && { LIB="$cand"; break; }
done
if [ -z "$LIB" ]; then
  echo "[click-gate] libforge_kernel_core not found under $KDIR."
  echo "             Set FORGE_KERNEL_BUILD_DIR or build it (see the header). RED."
  exit 3
fi
echo "[click-gate] kernel core: $LIB"

# AddressSanitizer's default is to ABORT on a report, and a SIGABRT makes bash
# print its own "Abort trap: 6" job notice into the transcript, one line adrift of
# the verdict it belongs to. Exiting instead keeps the verdict in one place; a
# report is still a non-zero status, which is all this script reads. Respects an
# ASAN_OPTIONS the caller already set.
export ASAN_OPTIONS="${ASAN_OPTIONS:-abort_on_error=0:exitcode=1}"

CXX="${CXX:-clang++}"
OCCT_PREFIX="${OCCT_PREFIX:-$( (brew --prefix opencascade 2>/dev/null) || echo /usr/local )}"
EIGEN_PREFIX="${EIGEN_PREFIX:-$( (brew --prefix eigen 2>/dev/null) || echo /usr/local )}"
IMGUI_DIR="$ROOT/forge-desktop/third_party/imgui"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/click_gate.XXXXXX")"
BIN="$WORK/click_gate"

# -Wall -Wextra -Werror on FIRST-PARTY code only, to match every other gate in
# this tree. Dear ImGui is vendored third-party and is compiled in a separate
# pass without -Werror: this project does not own its warnings, but it does need
# its objects sanitized, because ImGui owns the widget state a click walks.
ASAN=(-fsanitize=address -fno-omit-frame-pointer -g)

echo "[click-gate] compiling Dear ImGui core (no imgui_impl_vulkan: it is the only"
echo "             file in it that needs a Vulkan header, and a headless frame has no swapchain)"
IMGUI_OBJS=()
for f in imgui imgui_draw imgui_tables imgui_widgets; do
  "$CXX" -std=c++20 -O1 "${ASAN[@]}" -c "$IMGUI_DIR/$f.cpp" -I "$IMGUI_DIR" \
      -o "$WORK/$f.o" || { echo "[click-gate] ImGui did not BUILD. RED."; exit 3; }
  IMGUI_OBJS+=("$WORK/$f.o")
done

echo "[click-gate] compiling forge::ui + the desktop frame builder + the gate"
# shellcheck disable=SC2086
"$CXX" -std=c++20 -O1 -Wall -Wextra -Werror "${ASAN[@]}" \
  -DFORGE_NATIVE_BREP=1 \
  -I ui/include -I forge-kernel/include -I forge-desktop/src -I "$IMGUI_DIR" \
  -I "$OCCT_PREFIX/include/opencascade" -I "$EIGEN_PREFIX/include/eigen3" \
  ui/src/*.cpp \
  forge-desktop/src/KernelScene.cpp forge-desktop/src/PartFile.cpp \
  forge-desktop/src/Camera.cpp forge-desktop/src/ForgeFrame.cpp \
  forge-desktop/test/click_gate.cpp \
  "${IMGUI_OBJS[@]}" \
  "$LIB" -L "$OCCT_PREFIX/lib" \
  -Wl,-rpath,"$KDIR" -Wl,-rpath,"$OCCT_PREFIX/lib" \
  -o "$BIN"
rc=$?
if [ $rc -ne 0 ]; then
  echo "[click-gate] the gate did not BUILD (rc=$rc). RED."
  rm -rf "$WORK"
  exit 3
fi

"$BIN"
rc=$?

# SR-3: the gate must be shown to be able to fail, and this script is the only
# place the click gate runs in CI, so the proof travels with it. Each mutation
# MUST turn the gate red. Mutation 3 is the positive control for the SANITIZER
# itself: it performs the historical use-after-free on purpose, and if the
# process survives it, -fsanitize=address is not reaching the binary and this
# gate's memory-safety half is silent.
BAD=0
if [ $rc -eq 0 ]; then
  echo
  echo "[click-gate] mutation proof (each injected defect must turn the gate red):"
  # 1..9 -- EXACTLY the set click_gate.cpp defines, counted from the file rather
  # than inherited. Two things were wrong here before this merge and both are
  # fixed in the same change:
  #   * this sweep stopped at 7 while the gate already had 8 (the camera pull
  #     path), so one case was proved by run_desktop.sh and by nothing here;
  #   * app/core-interaction-surface's expander further-frame case and the base's
  #     command-sweep truncation had BOTH been numbered 6 and git merged them
  #     without a conflict, so `--mutate 6` fired two defects at once. The
  #     expander case is renumbered 9 -- see the legend at the top of
  #     click_gate.cpp -- and 9 is the count this loop and EXPECTED_MUTATIONS in
  #     ci_desktop_gate.sh must agree on.
  # A --mutate case added to click_gate.cpp must be added here in the SAME change.
  for m in 1 2 3 4 5 6 7 8 9; do
    "$BIN" --mutate "$m" > "$WORK/mut$m.log" 2>&1
    mrc=$?
    if [ "$mrc" -eq 0 ]; then
      echo "  mutation $m: STAYED GREEN -- the check it targets is unfalsifiable"
      BAD=$((BAD+1))
    else
      # grep -c PRINTS 0 and EXITS 1, so `|| true` is what keeps a zero-match
      # count from aborting this script under `set -o pipefail`.
      fails="$(grep -c '  FAIL' "$WORK/mut$m.log" || true)"
      first="$(grep -m1 '  FAIL' "$WORK/mut$m.log" | sed 's/^  FAIL  //')"
      if [ -z "$first" ]; then
        first="$(grep -m1 'SUMMARY: AddressSanitizer' "$WORK/mut$m.log" || true)"
      fi
      echo "  mutation $m: RED (exit $mrc, $fails checks failed) <- $first"
    fi
  done
fi

rm -rf "$WORK"

# A signal death that is NOT the sanitizer speaking is not "the assertions
# failed", and reporting it as such sends the reader looking for a logic bug that
# is not there. The sanitizer aborts (SIGABRT, 134) and prints its own report;
# anything else here is the environment.
if [ $rc -ge 128 ]; then
  echo
  echo "[click-gate] the gate died on signal $((rc - 128)) -- it did not complete, so this is"
  echo "             NOT an assertion failure. RED. If there is no AddressSanitizer report"
  echo "             above, check that forge-kernel/include and the linked"
  echo "             libforge_kernel_core come from the SAME commit."
  exit 1
fi
if [ "$BAD" -ne 0 ]; then
  echo "[click-gate] $BAD mutation(s) did not turn the gate red. RED."
  exit 1
fi
exit $rc
