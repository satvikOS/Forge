#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_cone_loft_mutation_gate.sh — PROVE the coaxial-circle (cone-frustum) half
# of family D is actually gated, by making it fail on purpose.
#
# WHAT IT GUARDS. src/native/brep/NativeLoftPipe.cpp gained a third ruled-loft
# engine, thruSectionsCoaxialCircles: two coaxial full circles of unequal radius
# lofted as the exact right-circular frustum. test/ab_native_loftpipe_occt.cpp
# compares it against LIVE OCCT (ts-cone-frustum / ts-cone-open / ts-cone-arbaxis
# / ts-cone-smooth-2sec) and asserts three neighbouring inputs are DECLINED
# (centres off the axis, axes not parallel, wire origins at different polar
# angles). A gate never seen to fail is not evidence, so every one of those
# assertions is driven RED here by a mutant of the ENGINE — never of the test.
#
#   M1  the coaxial-circle path never answers (the pre-change engine)
#         -> the four comparisons must fail at "produced a shape (no defer)"
#   M2  the SEAM-ALIGNMENT guard removed
#         -> the seam-offset decline must fail: the engine would emit a 3-face
#            cone where OCCT splits the lateral into 4 faces / 6 edges / 4 verts
#   M3  the COAXIAL guard removed (centres need not lie on the common axis)
#         -> the oblique-cone decline must fail
#   M4  the AXES-PARALLEL guard removed
#         -> the tilted-pair decline must fail
#   M5  the frustum is built 2% TOO TALL, oracles left in
#         -> the closed-form volume/centroid oracles must catch it and the engine
#            must DECLINE, i.e. fail at "produced a shape (no defer)"
#   M6  the same 2% error with the volume oracle disabled
#         -> now the WRONG SHAPE escapes, and the failure must move to the
#            volume/bbox comparison instead. M5 vs M6 is the two-sided proof that
#            the closed-form oracle is what converts a wrong build into an honest
#            defer rather than a plausible wrong answer.
#
# NOBUILD is never accepted as a kill — a mutant that does not compile proves
# nothing about what the assertions can see. The mutation is made on a COPY of
# the engine in a temp dir; the tree is never written to, so an interrupted run
# cannot leave a mutated source behind (and no `touch`-vs-rebuild trap exists,
# because every build here is a fresh compile of an explicitly named file).
#
# exit 0 iff the STOCK harness is green and every mutant is red in the way its
# entry above says it must be.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT_ROOT="/usr/local/opt/opencascade"
  else
    echo "[cone-mut] OCCT not found at $OCCT_ROOT - 'brew install opencascade' or set OCCT_ROOT" >&2
    exit 2
  fi
fi
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"
CXX="${CXX:-clang++}"
INC="forge-kernel/include"
ENGINE="forge-kernel/src/native/brep/NativeLoftPipe.cpp"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/forge_cone_mut.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# mutate SRC DST OLD NEW — exact and UNIQUE, else abort. A stale anchor is loud
# rather than a silently skipped mutant.
mutate() {
  python3 - "$1" "$2" "$3" "$4" <<'PY'
import io, sys
src, dst, old, new = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
s = io.open(src, encoding="utf-8").read()
if s.count(old) != 1:
    sys.stderr.write("MUTATION ANCHOR NOT UNIQUE (%d occurrences): %r\n" % (s.count(old), old[:90]))
    sys.exit(2)
io.open(dst, "w", encoding="utf-8").write(s.replace(old, new))
PY
}

# build_and_run ENGINE_SRC LOGFILE -> the A/B harness's exit code, or 2 if it
# did not build. TKOffset is linked because the harness's OCCT half calls
# BRepOffsetAPI_ThruSections on purpose; the engine references none of it.
build_and_run() {
  local engine="$1" log="$2" bin="$WORK/bin.$$"
  if ! $CXX -std=c++20 -O1 -DFORGE_NATIVE_BREP=1 \
       -I "$INC" -I "$OCCT_INC" \
       forge-kernel/test/ab_native_loftpipe_occt.cpp \
       "$engine" \
       forge-kernel/src/native/brep/NativeShapeHeal.cpp \
       forge-kernel/src/OcctPrimBuilder.cpp \
       -o "$bin" \
       -L "$OCCT_LIB" \
       -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKGeomAlgo \
       -lTKBRep -lTKTopAlgo -lTKShHealing -lTKPrim -lTKOffset -lTKBO -lTKBool \
       2> "$log.builderr"; then
    echo "[cone-mut] BUILD FAILED for $engine:" >&2
    tail -30 "$log.builderr" >&2
    return 2
  fi
  DYLD_LIBRARY_PATH="$OCCT_LIB" "$bin" > "$log" 2>&1
  return $?
}

bad=0

# ── STOCK ───────────────────────────────────────────────────────────────────
echo "[cone-mut] STOCK engine"
build_and_run "$ENGINE" "$WORK/stock.log"; rc=$?
if [ "$rc" -eq 2 ]; then echo "  STOCK DID NOT BUILD - nothing below proves anything"; exit 2; fi
if [ "$rc" -ne 0 ]; then
  echo "  STOCK harness is RED (exit $rc) - fix that before reading any mutant"
  grep -m10 '\[FAIL\]' "$WORK/stock.log" | sed 's/^/    /'
  exit 1
fi
echo "  stock: $(grep -c '\[PASS\]' "$WORK/stock.log" | tr -d ' ') assertions passed, 0 failed"

# kill NAME ENGINE_SRC MUST_MATCH  — the mutant must be RED, and its first
# failure must be the one the mutant is supposed to expose.
kill_check() {
  local name="$1" engine="$2" must="$3" log="$WORK/$1.log" rc
  build_and_run "$engine" "$log"; rc=$?
  if [ "$rc" -eq 2 ]; then
    echo "  $name NOBUILD - proves nothing, rewrite the mutant"; bad=1; return
  fi
  if [ "$rc" -eq 0 ]; then
    echo "  $name PASSED the harness - THE GATE CANNOT FAIL"; bad=1; return
  fi
  if ! grep -q "\[FAIL\].*$must" "$log"; then
    echo "  $name turned the harness RED (exit $rc) but NOT on \"$must\" - the kill is"
    echo "       an accident somewhere else, which is not the proof this mutant is for:"
    grep -m5 '\[FAIL\]' "$log" | sed 's/^/         /'
    bad=1; return
  fi
  echo "  $name RED (exit $rc) on \"$must\" - that assertion is load-bearing"
}

# ── M1: the coaxial-circle path never answers ───────────────────────────────
mutate "$ENGINE" "$WORK/m1.cpp" \
  '    if (sections.size() != 2) FK_DEFER("cone_not_two_sections");' \
  '    if (true) FK_DEFER("cone_not_two_sections");' || exit 2
echo "[cone-mut] M1: the coaxial-circle path never answers (the pre-change engine)"
kill_check M1 "$WORK/m1.cpp" "ts-cone-frustum native thruSections produced a shape"

# ── M2: the seam-alignment guard removed ────────────────────────────────────
mutate "$ENGINE" "$WORK/m2.cpp" \
  '    if (gp_Vec(u0).Subtracted(gp_Vec(u1)).Magnitude() * std::max(r0, r1) > xt)
        FK_DEFER("cone_seam_not_aligned");' \
  '    (void)u1;' || exit 2
echo "[cone-mut] M2: the SEAM-ALIGNMENT guard removed"
kill_check M2 "$WORK/m2.cpp" "coaxial circles whose wire ORIGINS sit at different polar"

# ── M3: the coaxial guard removed ───────────────────────────────────────────
mutate "$ENGINE" "$WORK/m3.cpp" \
  '    if (!A.IsParallel(a0, 1.0e-9)) FK_DEFER("cone_centres_off_axis");' \
  '    ;' || exit 2
echo "[cone-mut] M3: the COAXIAL guard removed"
kill_check M3 "$WORK/m3.cpp" "circles with centres OFF the common axis"

# ── M4: the axes-parallel guard removed ─────────────────────────────────────
mutate "$ENGINE" "$WORK/m4.cpp" \
  '    if (!a0.IsParallel(k1.Axis().Direction(), 1.0e-9)) FK_DEFER("cone_axes_not_parallel");' \
  '    ;' || exit 2
echo "[cone-mut] M4: the AXES-PARALLEL guard removed"
kill_check M4 "$WORK/m4.cpp" "circles whose AXES are not parallel"

# ── M5 / M6: the closed-form oracle, both sides ─────────────────────────────
# M5 builds the frustum 2% too tall and leaves the oracles in: the engine must
# refuse its own answer. M6 makes the same error with the volume oracle disabled:
# the wrong solid escapes and the failure MOVES to the A/B comparison. The pair
# is the proof that the oracle is what turns a wrong build into an honest defer.
mutate "$ENGINE" "$WORK/m5.cpp" \
  '        try { out = forge::occtConeSolid(ax, r0, r1, h); }' \
  '        try { out = forge::occtConeSolid(ax, r0, r1, h * 1.02); }' || exit 2
echo "[cone-mut] M5: frustum built 2% TOO TALL, closed-form oracles left in"
kill_check M5 "$WORK/m5.cpp" "ts-cone-frustum native thruSections produced a shape"

mutate "$WORK/m5.cpp" "$WORK/m6.cpp" \
  '        if (std::fabs(std::fabs(vp.Mass()) - cf) > 1.0e-9 * cf)
            FK_DEFER("cone_volume_not_closed_form");' \
  '        if (false)
            FK_DEFER("cone_volume_not_closed_form");' || exit 2
mutate "$WORK/m6.cpp" "$WORK/m6b.cpp" \
  '        if (vp.CentreOfMass().Distance(p0.Translated(gp_Vec(A) * zc)) >
            std::max(1.0e-7, 1.0e-9 * sz))
            FK_DEFER("cone_centroid_not_closed_form");' \
  '        if (false)
            FK_DEFER("cone_centroid_not_closed_form");' || exit 2
echo "[cone-mut] M6: the same 2% error with BOTH closed-form oracles disabled"
kill_check M6 "$WORK/m6b.cpp" "ts-cone-frustum volume native==OCCT"

if [ "$bad" = "0" ]; then
  echo "PASS: the stock harness is green and all six mutants are killed, each on its own assertion"
else
  echo "FAIL: a control is inert"
fi
exit "$bad"
