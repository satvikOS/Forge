#!/bin/sh
# Build + run the thicken orientation gate — BOTH production branches, plus the
# negative controls, plus (with --mutations) two source mutations that prove the
# gate can go red.
#
# This gate needs the PRODUCTION path (forge::part::thickenSurface), not a replica of it,
# because the defect it exists to catch lives in what Features.cpp REGISTERS rather than in
# what BRepOffset returns. So it links libforge_kernel_core rather than compiling the
# engine standalone, and it builds that library first if it is absent -- a gate that cannot
# build cannot fail, and in this repo that has looked exactly like silence four times.
#
# ★ IT RUNS TWICE. forge::part::thickenSurface has TWO engines behind one option, and
#   which one answers is chosen at runtime by FORGE_THICKEN_NATIVE. A gate that
#   exercised only the default branch would have said nothing about the other, which is
#   precisely how the orientation post-condition came to live INSIDE
#   `#ifndef FORGE_THICKEN_DROP_NATIVE` -- i.e. to be deletable by a build flag --
#   without anything noticing. Pass 1 is the OCCT baseline branch; pass 2 sets
#   FORGE_THICKEN_NATIVE=1 and takes the native branch. BOTH must pass.
#
# ★ -DFORGE_NATIVE_BREP IS REQUIRED, not decorative: NativeThickenShell.hpp is entirely
#   inside `#ifdef FORGE_NATIVE_BREP`, so without it the NATIVE and AGREE checks compile
#   to nothing and the gate silently shrinks. The library defaults FORGE_NATIVE_BREP=ON
#   (CMakeLists.txt:51), so the symbol is there to link.
#
# usage: build_thicken_orientation_gate.sh [--mutations]
#   env: THICKEN_ORIENT_BUILD=<dir>   reuse an existing forge-kernel build tree
set -eu

MUTATE=0
[ "${1:-}" = "--mutations" ] && MUTATE=1

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
KERNEL="$ROOT/forge-kernel"
BUILD="${THICKEN_ORIENT_BUILD:-$KERNEL/build-app}"
case "$BUILD" in /*) ;; *) BUILD="$ROOT/$BUILD" ;; esac
LIB="$BUILD/libforge_kernel_core.dylib"
[ -f "$LIB" ] || LIB="$BUILD/libforge_kernel_core.so"

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
[ -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ] || OCCT_ROOT="/usr/local/opt/opencascade"
[ -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ] || OCCT_ROOT="/usr"
if [ ! -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ]; then
    echo "[thicken-orientation] OCCT not found — set OCCT_ROOT="; exit 2
fi

JOBS="${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)}"

build_lib() {
    cmake -S "$KERNEL" -B "$BUILD" -DCMAKE_BUILD_TYPE=Release \
          -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON >/dev/null
    cmake --build "$BUILD" --target forge_kernel_core -j"$JOBS" >/dev/null
}

if [ ! -f "$LIB" ]; then
    echo "[thicken-orientation] building libforge_kernel_core first"
    build_lib
    LIB="$BUILD/libforge_kernel_core.dylib"
    [ -f "$LIB" ] || LIB="$BUILD/libforge_kernel_core.so"
fi

OUT="${OUT:-$KERNEL/.build-thicken-orientation}"
mkdir -p "$OUT"
BIN="$OUT/thicken_orientation_gate"

build_gate() {
    "${CXX:-clang++}" -std=c++20 -O1 -Wall -Wextra -Wno-deprecated-declarations \
        -DFORGE_NATIVE_BREP \
        "$KERNEL/test/thicken_orientation_gate.cpp" \
        -I "$KERNEL/include" -I "$OCCT_ROOT/include/opencascade" \
        "$LIB" -Wl,-rpath,"$BUILD" \
        -L "$OCCT_ROOT/lib" -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKGeomAlgo \
        -lTKBRep -lTKTopAlgo -lTKShHealing -lTKPrim -lTKOffset -lTKBO -lTKBool \
        -o "$BIN"
}

build_gate

# ── the two passes ──────────────────────────────────────────────────────────
rc=0
echo "== pass 1/2: production takes the OCCT baseline branch =="
FORGE_THICKEN_NATIVE=0 "$BIN" || rc=1
echo
echo "== pass 2/2: production takes the NATIVE branch (FORGE_THICKEN_NATIVE=1) =="
FORGE_THICKEN_NATIVE=1 "$BIN" || rc=1
[ "$rc" = 0 ] || { echo "[thicken-orientation] a clean pass FAILED"; exit 1; }

[ "$MUTATE" = 1 ] || { echo "[thicken-orientation] CLEAN PASS (both branches)"; exit 0; }

# ═════════════════════════════════════════════════════════════════════════════
# MUTATIONS — prove the gate goes RED when the thing it guards is removed.
# ═════════════════════════════════════════════════════════════════════════════
# ★ RESTORE FROM A BACKUP COPY, NEVER `git checkout -- <file>`. On an unstaged
#   tree that reverts the WHOLE edit rather than just the mutant, and it has cost
#   a rewrite in this repository before. Every restore is verified with `cmp`.
HDR="$KERNEL/include/forge/OcctThickenBaseline.hpp"
FEAT="$KERNEL/src/Features.cpp"
HDR_BAK="$OUT/OcctThickenBaseline.hpp.orig"
FEAT_BAK="$OUT/Features.cpp.orig"
cp "$HDR" "$HDR_BAK"
cp "$FEAT" "$FEAT_BAK"

# ★ DELETING THE OBJECT IS WHAT FORCES A REBUILD -- `touch` IS NOT ENOUGH, AND
#   THAT IS MEASURED, NOT ARGUED. The comment below was right about the failure
#   mode and wrong about the remedy: touch sets the source mtime to NOW, and the
#   object was compiled by the previous round, also NOW. A build system recompiles
#   when the source is NEWER than the object -- EQUAL IS NOT NEWER -- so at
#   one-second granularity make judges the object current and leaves the MUTATED
#   object linked while the source holds the original.
#
#   POSITIVE CONTROL on this gate's own object (a green run cannot prove an
#   intermittent race fixed, so the two arms were shown to differ):
#     ARM A  touch -r "$OBJ" on header+source, then build
#            -> build rc=0 and Features.cpp.o is NOT recompiled (mtime unchanged)
#     ARM B  delete the object via its depfile, then build
#            -> the object comes back; the compiler ran
#
#   THE MUTATION HERE TOUCHES A HEADER, so deleting one object is not sufficient
#   in general: every TU that includes it is stale. The depfiles cmake already
#   writes name those TUs exactly, so they drive the deletion and this stays
#   correct if another TU starts including the header. Today it is Features.cpp
#   alone. `cmp` above proves the SOURCE came back; it cannot prove the OBJECT was
#   recompiled, which is the gap this closes.
#
#   Third gate in this repository to hit the shared-build-tree race, after #223
#   (build_native_gate_guard_gate.sh) and #236 (run_step_unit_decline_gate.sh).
invalidate_objs() {
    find "$BUILD" -name 'Features.cpp.o' -delete 2>/dev/null || true
    grep -rl 'OcctThickenBaseline.hpp' "$BUILD" --include='*.o.d' 2>/dev/null |
        while IFS= read -r d; do rm -f "${d%.d}" "$d"; done
    return 0
}

restore() {
    cp "$HDR_BAK" "$HDR";  cmp -s "$HDR_BAK" "$HDR"   || { echo "RESTORE FAILED: $HDR";  exit 2; }
    cp "$FEAT_BAK" "$FEAT"; cmp -s "$FEAT_BAK" "$FEAT" || { echo "RESTORE FAILED: $FEAT"; exit 2; }
    # An ABSENT object cannot be judged current; a re-dated one can. Both are done:
    # the delete is what makes the rebuild happen, the touch keeps the source
    # ordering sane for anything that reads mtimes later.
    invalidate_objs
    touch "$HDR" "$FEAT"
}
trap 'restore' EXIT INT TERM

bad=0
expect_red() {   # expect_red <label>
    if "$BIN" >"$OUT/mut.log" 2>&1; then
        echo "  MUTATION $1: gate PASSED — IT CANNOT FAIL, which makes it worthless"
        sed -n '1,40p' "$OUT/mut.log"
        bad=1
    else
        echo "  MUTATION $1: gate went RED as it must"
        grep -c '^  FAIL' "$OUT/mut.log" | sed 's/^/          failing checks: /' || true
    fi
}

echo
echo "== mutation 1/2: neuter orientedPositiveSolid (the normaliser becomes a no-op) =="
# Gate-local only: these two functions are INLINE in the header, so recompiling the
# gate is enough to test the BASELINE / AGREE / NEG checks. No library rebuild.
perl -0pi -e 's/    if \(vp\.Mass\(\) < 0\.0\) s\.Reverse\(\);/    \/* MUTANT *\/ (void)vp;/' "$HDR"
grep -q 'MUTANT' "$HDR" || { echo "  MUTATION 1 could not be APPLIED — re-point it, do not delete it"; bad=1; }
build_gate
expect_red 1
restore
build_gate

echo
echo "== mutation 2/2: put the ORIGINAL DEFECT back into the PRODUCTION path =="
# Library-level. The defect this gate exists for is "thickenSurface registers a
# REVERSED solid", so the mutation INJECTS exactly that at the registration point
# and both production passes must go red. That proves the PROD checks read what
# thickenSurface really hands the ShapeRegistry, and not a local replica of it.
#
# ★ WHAT THIS MUTATION HONESTLY DOES *NOT* PROVE, stated rather than implied.
#   It does not prove the hoisted orientedPositiveSolid call is individually
#   load-bearing, and NO single-site mutation on this fixture can: the fixture is
#   a single planar face, which the native engine answers on its coplanar path,
#   and that path comes back positive by THREE independent mechanisms
#   (OcctPrimBuilder's sew, the engine's own post-condition, and the hoist). The
#   hoist is defence in depth for the folded and cylindrical paths this fixture
#   does not reach, and it is the only thing standing between a caller and an
#   un-normalised result when FORGE_THICKEN_DROP_NATIVE deletes the other branch.
perl -0pi -e 's/return ShapeRegistry::instance\(\)\.add\(::forge::part::orientedPositiveSolid\(out\)\);/return ShapeRegistry::instance().add(out.Reversed()); \/* MUTANT *\//' "$FEAT"
grep -q 'MUTANT' "$FEAT" || { echo "  MUTATION 2 could not be APPLIED — re-point it, do not delete it"; bad=1; }
build_lib
build_gate
for b in 0 1; do
    if FORGE_THICKEN_NATIVE=$b "$BIN" >"$OUT/mut2-$b.log" 2>&1; then
        echo "  MUTATION 2 (FORGE_THICKEN_NATIVE=$b): gate PASSED — the PROD check is not reading production"
        bad=1
    else
        echo "  MUTATION 2 (FORGE_THICKEN_NATIVE=$b): gate went RED as it must"
    fi
done
restore
build_lib
build_gate

echo
if [ "$bad" = 0 ]; then
    echo "[thicken-orientation] CLEAN PASS (both branches) + BOTH MUTATIONS RED"
    exit 0
fi
echo "[thicken-orientation] a mutation did not fire — the gate is not evidence"
exit 1
