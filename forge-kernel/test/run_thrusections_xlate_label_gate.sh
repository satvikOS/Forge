#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_thrusections_xlate_label_gate.sh — build and run the two-direction control
# for the translated-section defer label (test/thrusections_xlate_label_gate.cpp).
#
# Compiles the gate together with the three translation units it needs —
# src/native/brep/NativeLoftPipe.cpp (the engine under test),
# src/native/brep/NativeShapeHeal.cpp (occtheal::solidFromShell, which the engine
# orients through) and src/OcctPrimBuilder.cpp (occtPrism / occtCylinderSolid) —
# the same three test/run_ab_native_loftpipe.sh links, so the gate exercises the
# SHIPPED engine source and not a copy of it.
#
# ★ --selftest-mutation PROVES THE GATE CAN FAIL. A gate never seen to fail is
#   not evidence. Two mutants are built and each must turn the gate RED:
#
#     M1  the length discriminator fires UNCONDITIONALLY  (the "always the new
#         label" failure the SPLIT control exists to catch)
#     M2  the length discriminator NEVER fires            (the pre-change engine:
#         the DIFFERENT control must catch this one)
#
#   NOBUILD is never accepted as a kill — a mutant that does not compile proves
#   nothing about what the assertions can see (the discipline
#   test/run_ab_tkoffset_mutations.sh already applies). The mutation is made on a
#   COPY of the engine in a temp dir; the tree is never written to, so an
#   interrupted run cannot leave a mutated source behind.
#
# exit 0 iff the stock gate is green (and, under --selftest-mutation, iff both
# mutants are red).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT_ROOT="/usr/local/opt/opencascade"
  else
    echo "[xlate-label] OCCT not found at $OCCT_ROOT - 'brew install opencascade' or set OCCT_ROOT" >&2
    exit 2
  fi
fi
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"
CXX="${CXX:-clang++}"
INC="forge-kernel/include"
ENGINE="forge-kernel/src/native/brep/NativeLoftPipe.cpp"

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

# build_and_run ENGINE_SRC -> prints the gate output, returns the gate's exit
# code, or 2 if it did not build.
build_and_run() {
  local engine="$1" out rc
  out="$(mktemp -d "${TMPDIR:-/tmp}/forge_xlate_label.XXXXXX")"
  if ! $CXX -std=c++20 -O2 -DFORGE_NATIVE_BREP \
       -I "$INC" -I "$OCCT_INC" \
       forge-kernel/test/thrusections_xlate_label_gate.cpp \
       "$engine" \
       forge-kernel/src/native/brep/NativeShapeHeal.cpp \
       forge-kernel/src/OcctPrimBuilder.cpp \
       -o "$out/gate" \
       -L "$OCCT_LIB" \
       -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKBRep -lTKTopAlgo -lTKGeomBase \
       -lTKGeomAlgo -lTKPrim -lTKBO -lTKBool -lTKShHealing 2> "$out/err"; then
    echo "[xlate-label] BUILD FAILED:" >&2
    tail -40 "$out/err" >&2
    rm -rf "$out"
    return 2
  fi
  "$out/gate"
  rc=$?
  rm -rf "$out"
  return $rc
}

# The anchor: the whole length-discriminator condition, quoted verbatim.
ANCHOR='            if (std::fabs(L0 - L1) > lt) FK_DEFER("xlate_not_a_translate_length");'

if [ "${1:-}" = "--selftest-mutation" ]; then
  MDIR="$(mktemp -d "${TMPDIR:-/tmp}/forge_xlate_mut.XXXXXX")"
  trap 'rm -rf "$MDIR"' EXIT
  bad=0

  echo "[xlate-label] M1: the length discriminator fires UNCONDITIONALLY"
  if ! mutate "$ENGINE" "$MDIR/m1.cpp" "$ANCHOR" \
       '            if (lt >= 0.0) FK_DEFER("xlate_not_a_translate_length");'; then
    echo "  ANCHOR MISSING - the mutation could not be applied"; exit 1
  fi
  build_and_run "$MDIR/m1.cpp" > "$MDIR/m1.log" 2>&1; rc=$?
  if   [ "$rc" = "2" ]; then echo "  NOBUILD - proves nothing, rewrite the mutant"; bad=1
  elif [ "$rc" = "0" ]; then echo "  M1 PASSED the gate - THE GATE CANNOT FAIL"; bad=1
  else echo "  M1 turned the gate RED (exit $rc) - the SPLIT control is load-bearing"; fi

  echo "[xlate-label] M2: the length discriminator NEVER fires (the pre-change engine)"
  if ! mutate "$ENGINE" "$MDIR/m2.cpp" "$ANCHOR" \
       '            if (lt < 0.0) FK_DEFER("xlate_not_a_translate_length");'; then
    echo "  ANCHOR MISSING - the mutation could not be applied"; exit 1
  fi
  build_and_run "$MDIR/m2.cpp" > "$MDIR/m2.log" 2>&1; rc=$?
  if   [ "$rc" = "2" ]; then echo "  NOBUILD - proves nothing, rewrite the mutant"; bad=1
  elif [ "$rc" = "0" ]; then echo "  M2 PASSED the gate - THE GATE CANNOT FAIL"; bad=1
  else echo "  M2 turned the gate RED (exit $rc) - the DIFFERENT control is load-bearing"; fi

  [ "$bad" = "0" ] && echo "PASS: both mutants are killed" || echo "FAIL: a control is inert"
  exit "$bad"
fi

echo "[xlate-label] stock engine"
build_and_run "$ENGINE"
exit $?
