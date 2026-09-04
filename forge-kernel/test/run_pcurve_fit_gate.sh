#!/bin/bash
# run_pcurve_fit_gate.sh — the gate BSplineBasis.hpp names, plus the two checks that
# a gate over THIS code specifically needs.
#
# Five parts:
#   1. GUARD PROOF. NativePCurveFit.{hpp,cpp} are entirely inside #ifdef
#      FORGE_NATIVE_BREP. A compile without that define builds an EMPTY translation
#      unit and returns 0 for ever. This measured me twice before I noticed, so the
#      gate asserts on a PREPROCESSED SYMBOL COUNT, not an exit status.
#   2. THE NUMERICS GATE. test/pcurve_fit_gate.cpp — partition of unity, support and
#      non-negativity, findSpan bracketing, exact reproduction of a straight line,
#      Cholesky round-trip, and Cholesky REFUSING a non-SPD matrix. Kernel-free.
#   3. THE DIFFERENTIAL. BSplineBasis.hpp is a transcription of the private copy in
#      src/native/geom/NativeNurbsConvert.cpp. The header warns that a silent second
#      copy is how two engines start disagreeing, so the two are compared directly
#      and a drift is a failure.
#   3b. cylinderPCurve ON REAL GEOMETRY — test/pcurve_geometry_gate.cpp, the only
#      check in the tree over cylinderPCurve itself. It existed and NOTHING ran
#      it: no script, no CMake target, no workflow named the file.
#   4. NEGATIVE CONTROLS (--mutations). Five ways to break the numerics, each of
#      which MUST turn this red. A gate that cannot fail is not a gate.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
fails=0
say() { echo "[pcurve-gate] $*"; }
bad() { echo "[pcurve-gate] FAIL: $*" >&2; fails=$((fails + 1)); }
CXX="${CXX:-clang++}"

# ── 1. the guard is ON ───────────────────────────────────────────────────────
OCCT="$(brew --prefix opencascade 2>/dev/null || echo /usr/local)"
INC="-I$ROOT/include -I$ROOT/src -I$OCCT/include/opencascade"
count_sym() {  # $1 = extra flags
  # shellcheck disable=SC2086
  $CXX -std=c++20 -E $1 $INC "$ROOT/src/native/geom/NativePCurveFit.cpp" 2>/dev/null \
    | grep -c 'cylinderPCurve'
}
OFF=$(count_sym "")
ON=$(count_sym "-DFORGE_NATIVE_BREP")
if [ "${OFF:-0}" -ne 0 ]; then
  bad "the guard proof is broken: the TU is non-empty WITHOUT -DFORGE_NATIVE_BREP"
elif [ "${ON:-0}" -lt 1 ]; then
  bad "with -DFORGE_NATIVE_BREP the TU still contains no cylinderPCurve — nothing is being compiled"
else
  say "guard proof: cylinderPCurve occurrences OFF=$OFF ON=$ON (a bare compile would build NOTHING)"
fi

# ── 1b. the guarded TU actually COMPILES ─────────────────────────────────────
# Nothing in forge-kernel/CMakeLists.txt references NativePCurveFit.cpp, so without
# this step it is a file NOTHING COMPILES -- and a file nothing compiles cannot break.
# This repository has already shipped a dangling std::string size byte for exactly
# that reason. Syntax-only, guard ON, the compiler's own status.
if [ -d "$OCCT/include/opencascade" ]; then
  # shellcheck disable=SC2086
  if $CXX -std=c++20 -fsyntax-only -DFORGE_NATIVE_BREP $INC \
        "$ROOT/src/native/geom/NativePCurveFit.cpp" > "$WORK/tu.log" 2>&1; then
    say "translation unit compiles with the guard ON (0 errors)"
  else
    bad "NativePCurveFit.cpp does not compile with -DFORGE_NATIVE_BREP"
    head -20 "$WORK/tu.log" >&2
  fi
else
  say "SKIP: OCCT headers not found at $OCCT/include/opencascade — the TU compile did NOT run"
fi

# ── 2. the numerics gate ─────────────────────────────────────────────────────
build_and_run() {  # $1 = include root, $2 = label -> 0 pass / 1 fail
  local inc="$1" bin="$WORK/gate_$2"
  if ! $CXX -std=c++20 -O1 -I"$inc" "$ROOT/test/pcurve_fit_gate.cpp" -o "$bin" \
        > "$WORK/build_$2.log" 2>&1; then
    return 1   # a mutation that will not compile is still a caught mutation
  fi
  "$bin" > "$WORK/run_$2.log" 2>&1
}
if build_and_run "$ROOT/include" main; then
  say "numerics: $(grep -o '[0-9]* checks, [0-9]* failed' "$WORK/run_main.log" | tail -1)"
else
  bad "the numerics gate did not pass on the shipped header"
  cat "$WORK/run_main.log" 2>/dev/null >&2
fi

# ── 3. the differential against the copy it was transcribed from ─────────────
SRC="$ROOT/src/native/geom/NativeNurbsConvert.cpp"
HDR="$ROOT/include/forge/native/geom/BSplineBasis.hpp"
if [ ! -f "$SRC" ]; then
  bad "NativeNurbsConvert.cpp not found — the differential cannot run"
else
  python3 - "$SRC" "$HDR" > "$WORK/diff.txt" 2>&1 <<'PY'
import re, sys
def body(src, name):
    i = src.find(name + '(')
    if i < 0: return None
    j = src.find('{', i); d = 0; k = j
    while k < len(src):
        if src[k] == '{': d += 1
        elif src[k] == '}':
            d -= 1
            if d == 0: return src[j:k+1]
        k += 1
    return None
def norm(s): return re.sub(r'\s+', ' ', s).strip() if s else None
a = open(sys.argv[1]).read(); b = open(sys.argv[2]).read()
bad = 0
for fn in ('findSpan', 'basisFuns', 'choleskyFactor', 'choleskySolve'):
    x, y = body(a, fn), body(b, fn)
    if x is None or y is None:
        print(f"MISSING {fn}: origin={x is not None} header={y is not None}"); bad += 1
    elif norm(x) != norm(y):
        print(f"DRIFT {fn}: the header's copy no longer matches NativeNurbsConvert.cpp"); bad += 1
sys.exit(1 if bad else 0)
PY
  if [ $? -eq 0 ]; then
    say "differential: findSpan / basisFuns / choleskyFactor / choleskySolve identical to NativeNurbsConvert.cpp"
  else
    bad "the transcribed copy has DRIFTED from its origin"; cat "$WORK/diff.txt" >&2
  fi
fi

# ── 3b. cylinderPCurve ON REAL GEOMETRY ──────────────────────────────────────
# ★ THIS GATE EXISTED AND RAN NOWHERE. test/pcurve_geometry_gate.cpp is the only
# check in the tree over cylinderPCurve itself — part 2 above says in its own
# header that it does NOT touch it — and no script, no CMake target and no
# workflow referenced the file. It compiles clean under -Werror and passes 62 of
# 62 checks, so nothing was broken; it was simply unreachable, which is the same
# state as not existing. A FILE NOTHING COMPILES CANNOT BREAK, and this
# repository has already shipped a defect for exactly that reason. Wired here,
# beside the numerics underneath it.
if [ -d "$OCCT/include/opencascade" ]; then
  # shellcheck disable=SC2086
  if $CXX -std=c++20 -O1 -Wall -Wextra -Werror -DFORGE_NATIVE_BREP $INC \
        "$ROOT/test/pcurve_geometry_gate.cpp" "$ROOT/src/native/geom/NativePCurveFit.cpp" \
        -L"$OCCT/lib" -Wl,-rpath,"$OCCT/lib" -lTKernel -lTKMath -lTKG2d -lTKG3d \
        -o "$WORK/pgeom" > "$WORK/pgeom_build.log" 2>&1; then
    if "$WORK/pgeom" > "$WORK/pgeom.log" 2>&1; then
      say "geometry: $(grep -o '[0-9]* checks, [0-9]* failed' "$WORK/pgeom.log" | tail -1)"
    else
      bad "pcurve_geometry_gate FAILED"; cat "$WORK/pgeom.log" >&2
    fi
  else
    bad "pcurve_geometry_gate does not BUILD — its checks did not run at all"
    head -25 "$WORK/pgeom_build.log" >&2
  fi
else
  say "SKIP: OCCT not found — the geometry gate did NOT run"
fi

# ── 4. negative controls ─────────────────────────────────────────────────────
if [ "${1:-}" = "--mutations" ]; then
  say "--- negative controls ---"
  n=0; caught=0
  mutate() {  # $1 = name, $2 = sed expression on BSplineBasis.hpp
    n=$((n + 1))
    local dir="$WORK/m$n/forge/native/geom"
    mkdir -p "$dir"
    sed "$2" "$HDR" > "$dir/BSplineBasis.hpp"
    if cmp -s "$dir/BSplineBasis.hpp" "$HDR"; then
      bad "mutation '$1' changed NOTHING — it cannot prove anything"; return
    fi
    if build_and_run "$WORK/m$n" "m$n"; then
      bad "mutation '$1' was NOT caught"
    else
      say "  caught: $1"; caught=$((caught + 1))
    fi
  }
  mutate "basisFuns drops the saved term"        's|N\[r\]  = saved + right\[r + 1\] \* temp;|N[r]  = right[r + 1] * temp;|'
  mutate "basisFuns swaps left and right"        's|left\[j\]  = u - U\[i + 1 - j\];|left[j]  = U[i + j] - u;|'
  mutate "findSpan returns the low bound"        's|    return mid;|    return low;|'
  mutate "cholesky accepts a non-positive pivot" 's|if (s <= 1e-14) return false;|if (s <= -1e300) return false;|'
  mutate "choleskySolve skips back-substitution" 's|for (int k = i + 1; k < m; ++k) s -= L\[k \* m + i\] \* b\[k\];|;|'
  # AND ONE FOR THE GEOMETRY GATE JUST WIRED IN. The five above mutate
  # BSplineBasis.hpp and are caught by the kernel-free numerics gate; none of
  # them can prove the NEW step can fail, because that step compiles a different
  # source against a different TU. This one mutates the ellipse itself — the
  # section's semi-major axis is r/|c| and the mutant makes it r, which is the
  # CIRCLE — so `the section lies on both surfaces` must go red. A gate wired in
  # green and never shown to fail is a gate nobody has tested.
  if [ -d "$OCCT/include/opencascade" ]; then
    n=$((n + 1))
    mkdir -p "$WORK/geo"
    sed 's|const double A = radius / std::fabs(c);|const double A = radius;|' \
      "$ROOT/src/native/geom/NativePCurveFit.cpp" > "$WORK/geo/NativePCurveFit.cpp"
    if cmp -s "$WORK/geo/NativePCurveFit.cpp" "$ROOT/src/native/geom/NativePCurveFit.cpp"; then
      bad "the geometry mutation changed NOTHING — stale anchor, it cannot prove anything"
    # shellcheck disable=SC2086
    elif ! $CXX -std=c++20 -O1 -DFORGE_NATIVE_BREP $INC \
            "$ROOT/test/pcurve_geometry_gate.cpp" "$WORK/geo/NativePCurveFit.cpp" \
            -L"$OCCT/lib" -Wl,-rpath,"$OCCT/lib" -lTKernel -lTKMath -lTKG2d -lTKG3d \
            -o "$WORK/pgeom_mut" > "$WORK/pgeom_mut_build.log" 2>&1; then
      say "  caught: plane/cylinder section semi-major r/|c| -> r (did not compile)"
      caught=$((caught + 1))
    elif "$WORK/pgeom_mut" > "$WORK/pgeom_mut.log" 2>&1; then
      bad "mutation 'section semi-major r/|c| -> r' was NOT caught by the geometry gate"
    else
      say "  caught: plane/cylinder section semi-major r/|c| -> r"
      caught=$((caught + 1))
    fi
  fi

  say "negative controls: $caught of $n caught"
  [ "$caught" -eq "$n" ] || fails=$((fails + 1))
fi

if [ "$fails" -eq 0 ]; then say "PASS"; exit 0; fi
echo "[pcurve-gate] $fails check(s) failed" >&2
exit 1
