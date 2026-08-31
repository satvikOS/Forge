#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_kernel_correctness_gate.sh — build + run test/kernel_correctness_gate.cpp
# against the REAL node-free kernel library, then cross-check the same numbers
# through the native verifier binary.
#
# Three parts, all value-against-reference:
#   1. the C++ gate (G1..G4)                       — see kernel_correctness_gate.cpp
#   2. forge_verify on a reference NDJSON job      — genus / shellCount / bores,
#      the SECOND opinion the IR's VERIFY counter has to agree with
#   3. a structural check that the weld-betti genus has exactly ONE definition
#      (src/TopologySignature.cpp) and that forge_verify no longer carries a copy
#
# The library is built through CMake with the desktop-foundation target, which is
# the linkage that has no `-undefined dynamic_lookup` — every symbol must resolve.
#
# env: BUILD_DIR (default $TMPDIR/forge_kernel_gate_build)  JOBS (default: cores/2)
# exit 0 iff every assertion holds.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KERNEL="$(cd "$HERE/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-${TMPDIR:-/tmp}/forge_kernel_gate_build}"
NCPU="$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )"
JOBS="${JOBS:-$(( NCPU / 2 > 0 ? NCPU / 2 : 1 ))}"
CXX="${CXX:-clang++}"

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ]; then
  for c in /usr/local/opt/opencascade /usr /usr/local ; do
    [ -e "$c/include/opencascade/Standard_Version.hxx" ] && { OCCT_ROOT="$c"; break; }
  done
fi
[ -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ] \
  || { echo "FATAL: OCCT headers not found (set OCCT_ROOT)"; exit 2; }

echo "[1/5] configure ($BUILD_DIR)"
if [ ! -f "$BUILD_DIR/CMakeCache.txt" ]; then
  cmake -S "$KERNEL" -B "$BUILD_DIR" \
        -DCMAKE_BUILD_TYPE=Release \
        -DFORGE_BUILD_NODE_ADDON=OFF \
        -DFORGE_BUILD_DESKTOP_FOUNDATION=ON >"$BUILD_DIR.configure.log" 2>&1 \
    || { echo "FATAL: configure failed"; tail -20 "$BUILD_DIR.configure.log"; exit 2; }
fi

echo "[2/5] build forge_kernel_core + forge_verify (-j$JOBS)"
cmake --build "$BUILD_DIR" --target forge_verify -j "$JOBS" >"$BUILD_DIR.build.log" 2>&1
if [ $? -ne 0 ]; then echo "FATAL: build failed"; tail -30 "$BUILD_DIR.build.log"; exit 2; fi
LIB="$(ls "$BUILD_DIR"/libforge_kernel_core.* 2>/dev/null | head -1)"
[ -n "$LIB" ] || { echo "FATAL: libforge_kernel_core not built"; exit 2; }

echo "[3/5] compile + link the gate (-Wall -Wextra -Werror, SR-3)"
"$CXX" -std=c++20 -O1 -g -Wall -Wextra -Werror -DFORGE_NATIVE_BREP=1 \
    -I "$KERNEL/include" -I "$OCCT_ROOT/include/opencascade" \
    "$HERE/kernel_correctness_gate.cpp" \
    -o "$BUILD_DIR/kernel_correctness_gate" \
    -L "$BUILD_DIR" -lforge_kernel_core \
    -Wl,-rpath,"$BUILD_DIR" -Wl,-rpath,"$OCCT_ROOT/lib" \
  || { echo "FATAL: gate did not compile/link"; exit 2; }

echo "[4/5] run the gate"
echo
"$BUILD_DIR/kernel_correctness_gate"; GATE_RC=$?
echo

echo "[5/5] cross-checks"
FAIL=0
# --- forge_verify, the second opinion on the same two parts -------------------
JOBS_JSON="$BUILD_DIR/gate_jobs.ndjson"
{
  printf '%s\n' '{"id":"twobore","ir":"%1 = BOX(60, 60, 20)\n%2 = HOLE(%1, 10, -15, 0, 0)\n%3 = HOLE(%2, 10, 15, 0, 0)\nRESULT(%3)\n"}'
  printf '%s\n' '{"id":"crossdrill","ir":"%1 = BOX(60, 60, 20)\n%2 = CYL(5, 40, 0, 0, -10)\n%3 = CUT(%1, %2)\n%4 = CYL(5, 40, 0, 0, 10, 1, 0, 0)\n%5 = CUT(%3, %4)\nRESULT(%5)\n"}'
} > "$JOBS_JSON"
"$BUILD_DIR/forge_verify" < "$JOBS_JSON" > "$BUILD_DIR/gate_verify.out" 2>"$BUILD_DIR/gate_verify.err"
vrc=$?
if [ "$vrc" -ne 0 ]; then
  echo "  FAIL  forge_verify exited $vrc"; FAIL=$((FAIL+1))
else
  # REFERENCE values, measured on this kernel and unchanged by the genus
  # unification: both parts are genus 2 / one shell, and the cross-drilled part
  # has TWO bores on two different axes.
  for row in 'twobore:"genus":2:2' 'crossdrill:"genus":2:2' ; do
    id="${row%%:*}"; rest="${row#*:}"; key="${rest%%:*}"; rest="${rest#*:}"
    want="${rest%%:*}"; nbores="${rest##*:}"
    line="$(grep "\"id\":\"$id\"" "$BUILD_DIR/gate_verify.out")"
    g="$(printf '%s' "$line" | sed -n 's/.*'"$key"':\([-0-9]*\).*/\1/p')"
    b="$(printf '%s' "$line" | grep -o '"axis":' | grep -c .)"
    if [ "$g" = "$want" ] && [ "$b" = "$nbores" ]; then
      echo "  PASS  forge_verify $id: genus=$g (ref $want), bores=$b (ref $nbores)"
    else
      echo "  FAIL  forge_verify $id: genus=${g:-?} (ref $want), bores=${b:-?} (ref $nbores)"
      FAIL=$((FAIL+1))
    fi
  done
fi
# --- one definition of the weld-betti genus ----------------------------------
ndef="$(grep -c 'genus = std::max' "$KERNEL/src/TopologySignature.cpp" 2>/dev/null)"; ndef="${ndef:-0}"
ncopy=0
for f in "$KERNEL/src/tools/forge_verify.cpp" "$KERNEL/src/ft/FeatureTreeCompiler.cpp"; do
  n="$(grep -c 'genus = std::max\|weldBetti' "$f" 2>/dev/null)"; ncopy=$((ncopy + ${n:-0}))
done
if [ "$ndef" -eq 1 ] && [ "$ncopy" -eq 0 ]; then
  echo "  PASS  weld-betti genus has exactly ONE definition (TopologySignature.cpp)"
else
  echo "  FAIL  weld-betti genus definitions: TopologySignature.cpp=$ndef, copies elsewhere=$ncopy"
  FAIL=$((FAIL+1))
fi

echo
if [ "$GATE_RC" -eq 0 ] && [ "$FAIL" -eq 0 ]; then
  echo "GATE PASS"; exit 0
fi
echo "GATE FAIL (gate rc=$GATE_RC, cross-check failures=$FAIL)"
exit 1
