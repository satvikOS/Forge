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

# The desktop sources this gate links. ui/src/*.cpp is a GLOB, so forge::ui picks
# up new files by itself; this list is EXPLICIT because a headless ASAN frame
# cannot link the platform-coupled translation units (SDL2, GL) and must not
# acquire a second main(). That asymmetry is a trap: FileDialog.cpp was added to
# the app and called from ForgeFrame.cpp, this list was not updated, and the gate
# failed with an undefined-symbol dump that named the symbol but not the cause.
# So the list is paired with an EXCLUSION list below, and every src/*.cpp must
# appear in exactly one of them.
DESKTOP_LINK=(
  forge-desktop/src/KernelScene.cpp
  forge-desktop/src/PartFile.cpp
  forge-desktop/src/Camera.cpp
  forge-desktop/src/ForgeFrame.cpp
  forge-desktop/src/FileDialog.cpp
  forge-desktop/src/ImGuiErrorPolicy.cpp
)
# Deliberately NOT linked, each for a reason a reader can check:
#   main.cpp, kernel_worker_main.cpp  -- each defines main(); click_gate.cpp owns it here
#   PlatformSDL2.cpp                  -- needs SDL2; this gate is headless
#   ViewportRenderer.cpp              -- needs a GL context; a headless frame has no swapchain
#   FileExchangeHost.cpp, UpdateService.cpp -- not reached by a click walk
DESKTOP_SKIP=(
  forge-desktop/src/main.cpp
  forge-desktop/src/kernel_worker_main.cpp
  forge-desktop/src/PlatformSDL2.cpp
  forge-desktop/src/ViewportRenderer.cpp
  forge-desktop/src/FileExchangeHost.cpp
  forge-desktop/src/UpdateService.cpp
)
# THE DRIFT GUARD. A new desktop source that nobody classifies is the exact
# failure above. Report it here, by name, instead of letting the linker say it
# in symbol-mangled form several hundred lines later.
unclassified=()
for src in forge-desktop/src/*.cpp; do
  known=0
  for k in "${DESKTOP_LINK[@]}" "${DESKTOP_SKIP[@]}"; do
    [ "$src" = "$k" ] && { known=1; break; }
  done
  [ "$known" -eq 0 ] && unclassified+=("$src")
done
if [ "${#unclassified[@]}" -ne 0 ]; then
  echo "[click-gate] these desktop sources are in neither DESKTOP_LINK nor DESKTOP_SKIP:"
  for u in "${unclassified[@]}"; do echo "             $u"; done
  echo "             Add each to DESKTOP_LINK (if the headless click walk reaches it)"
  echo "             or to DESKTOP_SKIP with the reason it cannot link here. RED."
  exit 3
fi

echo "[click-gate] compiling forge::ui + the desktop frame builder + the gate"
echo "[click-gate] desktop TUs linked: ${#DESKTOP_LINK[@]}, deliberately skipped: ${#DESKTOP_SKIP[@]}"
# shellcheck disable=SC2086
"$CXX" -std=c++20 -O1 -Wall -Wextra -Werror "${ASAN[@]}" \
  -DFORGE_NATIVE_BREP=1 \
  -I ui/include -I forge-kernel/include -I forge-desktop/src -I "$IMGUI_DIR" \
  -I "$OCCT_PREFIX/include/opencascade" -I "$EIGEN_PREFIX/include/eigen3" \
  ui/src/*.cpp \
  "${DESKTOP_LINK[@]}" \
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
  # 8 was RUN by run_desktop.sh and NOT by this script -- the one place the click
  # gate runs in CI -- so its proof travelled only through the expensive suite.
  # 9 to 12 are the viewport drag handles and the body pick. All twelve, no gap.
  for m in 1 2 3 4 5 6 7 8 9 10 11 12; do
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
