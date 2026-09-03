#!/usr/bin/env bash
# forge-desktop/test/run_file_exchange_gate.sh
#
# Builds and runs the FILE-EXCHANGE gate with one compiler invocation, against the
# node-free kernel core. No ImGui, no SDL, no Vulkan, no window: the gate drives
# forge::ui's command registry and forge::io directly, so "can Forge still open
# and save a real CAD file" is a question answerable in seconds.
#
#   ./forge-desktop/test/run_file_exchange_gate.sh              run the gate
#   ./forge-desktop/test/run_file_exchange_gate.sh --mutations  ALSO break the
#                                                               write five ways and
#                                                               require each to be
#                                                               caught
#
# The kernel core must exist. Build it once with:
#   cmake -B forge-kernel/build-app -DFORGE_BUILD_NODE_ADDON=OFF \
#         -DFORGE_BUILD_DESKTOP_FOUNDATION=ON -S forge-kernel
#   cmake --build forge-kernel/build-app -j2 --target forge_kernel_core
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP="$(dirname "$HERE")"
ROOT="$(dirname "$DESKTOP")"
KBUILD="${FORGE_KERNEL_BUILD_DIR:-$ROOT/forge-kernel/build-app}"
# The same two prefixes every other script here probes, in the same order
# (forge-kernel/test/run_ab_native_offsetshape.sh): Apple silicon, then Intel.
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
OUT="${TMPDIR:-/tmp}/forge_file_exchange_gate.$$"

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

# The forge::ui sources are globbed, not listed: a source added to ui/src later
# would otherwise be silently absent from the link and the gate would fail with
# undefined symbols in a file nobody touched.
UI_SRCS=("$ROOT"/ui/src/*.cpp)

echo "compiling the file-exchange gate (${#UI_SRCS[@]} forge::ui sources + 3 desktop sources)"
c++ -std=c++20 -O1 -g -Wall -Wextra -Werror -DFORGE_NATIVE_BREP=1 \
    -I "$ROOT/ui/include" -I "$DESKTOP/src" -I "$ROOT/forge-kernel/include" \
    -I "$OCCT/include/opencascade" \
    -o "$OUT" \
    "${UI_SRCS[@]}" \
    "$DESKTOP/src/FileExchangeHost.cpp" \
    "$DESKTOP/src/KernelScene.cpp" \
    "$DESKTOP/src/PartFile.cpp" \
    "$HERE/file_exchange_gate.cpp" \
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
"$OUT"
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
  # 1 truncate  2 zero-body  3 empty  4 translate  5 same-volume cube
  for m in 1 2 3 4 5; do
    "$OUT" --mutate "$m" > "$OUT.m$m.log" 2>&1
    mrc=$?
    # A FATAL SIGNAL IS NOT A CAUGHT MUTATION. `grep -c` prints 0 and exits 1, so
    # the count is taken with a `|| true`; and rc >= 128 means the gate died
    # rather than reported, which is its own defect and must never read as a pass.
    reds="$(grep -c '^  FAIL' "$OUT.m$m.log" || true)"
    if [ "$mrc" -ge 128 ]; then
      echo "MUTATION $m KILLED THE GATE (signal $((mrc - 128))) -- a crash is not a"
      echo "  detection. See $OUT.m$m.log"
      tail -20 "$OUT.m$m.log"
      fail=1
    elif [ "$mrc" -ne 0 ]; then
      echo "MUTATION $m WAS NOT CAUGHT (the gate stayed green) -- see $OUT.m$m.log"
      tail -20 "$OUT.m$m.log"
      fail=1
    else
      echo "mutation $m caught: $reds checks went red"
    fi
  done
fi

if [ "$fail" -ne 0 ]; then
  echo
  echo "FILE-EXCHANGE GATE FAILED"
  exit 1
fi
echo
echo "FILE-EXCHANGE GATE PASSED"
exit 0
