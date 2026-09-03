#!/usr/bin/env bash
# forge-desktop/test/run_file_dialog_gate.sh
#
# Builds and runs the FILE-DIALOG gate with one compiler invocation.
#
# The gate OF RECORD is the CMake target forge_desktop_file_dialog_gate, driven
# by run_desktop.sh and pinned in ci_desktop_gate.sh's mutation count. This
# script is the cheap way in: it needs the kernel core and nothing else -- no
# SDL, no Vulkan, no glslang, no MoltenVK, and no AppKit, because the native
# panel is scripted rather than shown.
#
#   ./forge-desktop/test/run_file_dialog_gate.sh              run the gate
#   ./forge-desktop/test/run_file_dialog_gate.sh --mutations  ALSO break it three
#                                                             ways and require
#                                                             each to be caught
#
# The kernel core must exist. Build it once with:
#   cmake -B forge-kernel/build-app -DFORGE_BUILD_NODE_ADDON=OFF \
#         -DFORGE_BUILD_DESKTOP_FOUNDATION=ON -S forge-kernel
#   cmake --build forge-kernel/build-app -j8 --target forge_kernel_core
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP="$(dirname "$HERE")"
ROOT="$(dirname "$DESKTOP")"
KBUILD="${FORGE_KERNEL_BUILD_DIR:-$ROOT/forge-kernel/build-app}"
IMGUI="$DESKTOP/third_party/imgui"

OCCT="${OCCT_PREFIX:-}"
if [ -z "$OCCT" ]; then
  for c in /opt/homebrew/opt/opencascade /usr/local/opt/opencascade; do
    [ -d "$c/include/opencascade" ] && OCCT="$c" && break
  done
fi
if [ ! -d "$OCCT/include/opencascade" ]; then
  echo "OCCT headers not found (set OCCT_PREFIX). An absent instrument is not a result." >&2
  exit 3
fi

MUTATIONS=0
for a in "$@"; do
  case "$a" in
    --mutations) MUTATIONS=1 ;;
    *) echo "unknown argument: $a" >&2; exit 2 ;;
  esac
done

LIB="$KBUILD/libforge_kernel_core.dylib"
if [ ! -f "$LIB" ]; then LIB="$KBUILD/libforge_kernel_core.so"; fi
if [ ! -f "$LIB" ]; then
  echo "libforge_kernel_core not found in $KBUILD." >&2
  echo "An absent instrument is not a result: refusing to report a pass." >&2
  exit 3
fi

OUT="${TMPDIR:-/tmp}/forge_file_dialog_gate.$$"
DIR="${TMPDIR:-/tmp}/forge_file_dialog_gate_files.$$"
mkdir -p "$DIR" || { echo "cannot make $DIR" >&2; exit 3; }
cleanup() { rm -rf "$DIR"; }
trap cleanup EXIT

# Globbed, not listed, for the reason run_file_exchange_gate.sh gives: a source
# added to ui/src later would otherwise be silently absent from the link.
UI_SRCS=("$ROOT"/ui/src/*.cpp)

# Dear ImGui core only. imgui_impl_vulkan.cpp is NOT here: the gate builds real
# frames with a null renderer backend, exactly as frame_gate.cpp does, so it
# needs no Vulkan header at all.
IMGUI_SRCS=("$IMGUI/imgui.cpp" "$IMGUI/imgui_draw.cpp" "$IMGUI/imgui_tables.cpp"
            "$IMGUI/imgui_widgets.cpp")

# -Wall -Wextra -Werror is deliberately NOT passed here, and saying so matters:
# Dear ImGui is vendored third-party code and is not warning-clean under -Werror,
# and this script compiles it in the same invocation as the first-party sources.
# The warning contract on the first-party half is enforced where it can be
# enforced per-target: forge-desktop/CMakeLists.txt gives every first-party
# target -Wall -Wextra -Werror, and run_syntax_gate.sh type-checks
# src/FileDialog.cpp, src/ForgeFrame.cpp and test/file_dialog_gate.cpp under
# exactly those flags in 0.5 s with no SDK at all.
echo "compiling the file-dialog gate (${#UI_SRCS[@]} forge::ui sources + ${#IMGUI_SRCS[@]} ImGui + 5 desktop sources)"
c++ -std=c++20 -O1 -g -DFORGE_NATIVE_BREP=1 \
    -I "$ROOT/ui/include" -I "$DESKTOP/src" -I "$ROOT/forge-kernel/include" \
    -I "$IMGUI" -I "$OCCT/include/opencascade" \
    -o "$OUT" \
    "${UI_SRCS[@]}" \
    "${IMGUI_SRCS[@]}" \
    "$DESKTOP/src/FileDialog.cpp" \
    "$DESKTOP/src/FileExchangeHost.cpp" \
    "$DESKTOP/src/KernelScene.cpp" \
    "$DESKTOP/src/PartFile.cpp" \
    "$DESKTOP/src/Camera.cpp" \
    "$DESKTOP/src/ForgeFrame.cpp" \
    "$HERE/file_dialog_gate.cpp" \
    "$LIB" \
    -Wl,-rpath,"$KBUILD" -Wl,-rpath,"$OCCT/lib"
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "COMPILE FAILED (exit $rc) -- a gate that cannot build cannot fail." >&2
  exit "$rc"
fi

fail=0

echo
echo "-- the gate, unmutated ------------------------------------------------"
"$OUT" --dir "$DIR"
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "GATE RED (exit $rc)"
  fail=1
else
  echo "gate green"
fi

if [ "$MUTATIONS" -eq 1 ]; then
  echo
  echo "-- the mutations: each MUST be caught ---------------------------------"
  # 1 no dialog installed  2 the panel answers a different path  3 cancel leaks
  #                                                                the last one
  for m in 1 2 3; do
    "$OUT" --mutate "$m" --dir "$DIR" > "$OUT.m$m.log" 2>&1
    mrc=$?
    # `grep -c` prints 0 and EXITS 1, so the count needs the `|| true`.
    reds="$(grep -c '^  FAIL' "$OUT.m$m.log" || true)"
    if [ "$mrc" -eq 0 ]; then
      echo "MUTATION $m WAS NOT CAUGHT (the gate stayed green) -- see $OUT.m$m.log"
      tail -20 "$OUT.m$m.log"
      fail=1
    elif [ "$mrc" -ge 128 ]; then
      echo "MUTATION $m KILLED THE GATE (signal $((mrc - 128))) -- a crash is not a"
      echo "  detection. See $OUT.m$m.log"
      tail -20 "$OUT.m$m.log"
      fail=1
    else
      echo "mutation $m caught: $reds checks went red (exit $mrc)"
    fi
  done
fi

if [ "$fail" -ne 0 ]; then
  echo
  echo "FILE-DIALOG GATE FAILED"
  exit 1
fi
echo
echo "FILE-DIALOG GATE PASSED"
exit 0
