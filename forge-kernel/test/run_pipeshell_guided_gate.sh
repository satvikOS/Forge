#!/usr/bin/env bash
# run_pipeshell_guided_gate.sh — build and run test/pipeshell_guided_gate.cpp,
# the GUIDED half of TKOffset family F (BRepOffsetAPI_MakePipeShell).
#
# The corpus A/B measures family F's UNGUIDED sweep. All three production call
# sites exist to serve GUIDED sweeps. This gate measures the guided half against
# live OCCT in one process, with a positive control (a guide that is the spine
# translated must be ACCEPTED and must reduce to the unguided answer) and a
# negative control (a guide that is not a translate must still DEFER, by name).
#
# usage: bash forge-kernel/test/run_pipeshell_guided_gate.sh
# exit:  0 iff every check passes.
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT="/usr/local/opt/opencascade"
  else
    echo "FATAL: OCCT not found (brew install opencascade or set OCCT_ROOT)" >&2; exit 2
  fi
fi
OBJDIR="${OBJDIR:-$KERNEL/.build-pipeshell-guided}"
mkdir -p "$OBJDIR" || exit 2
CXX="${CXX:-clang++}"
FLAGS="-std=c++20 -O2 -DFORGE_NATIVE_BREP"

# ── The engine under test, plus the sew/solid tail it calls. Compiled HERE
# rather than reused from another build tree so the gate cannot silently measure
# a stale object. FORGE_NATIVE_BREP is passed explicitly: NativeLoftPipe.cpp is
# ENTIRELY inside `#ifdef FORGE_NATIVE_BREP`, so without it the file compiles to
# an EMPTY translation unit with rc=0 and the gate would link against nothing and
# report a vacuous pass. MEASURED: 336 bytes with the guard off, 215288 with it on.
# NativeLoftPipe needs occtheal::solidFromShell (NativeShapeHeal.cpp) and
# occtPrism / occtCylinderSolid (OcctPrimBuilder.cpp). They are linked EXPLICITLY
# and the link runs WITHOUT -undefined dynamic_lookup on purpose: with it, a
# missing definition resolves to a null address and the gate SEGFAULTS at run
# time instead of failing at link time. That happened while this gate was being
# written, and it is exactly how the .node hides TKPrim/TKBO usage from the
# ledger (scripts/tkoffset_ledger_gate.sh). A gate must not inherit that.
SRCS=(
  src/native/brep/NativeLoftPipe.cpp
  src/native/brep/NativeShapeHeal.cpp
  src/OcctPrimBuilder.cpp
)
OBJS=()
for s in "${SRCS[@]}"; do
  o="$OBJDIR/$(echo "$s" | tr '/.' '__').o"
  if ! $CXX $FLAGS -I include -I "$OCCT/include/opencascade" -c "$s" -o "$o" 2> "$o.err"; then
    echo "COMPILE FAILED: $s" >&2; tail -20 "$o.err" >&2; exit 1
  fi
  # A guard that produced an empty TU would leave a tiny object. Refuse it.
  sz=$(wc -c < "$o" | tr -d ' ')
  if [ "$sz" -lt 4096 ]; then
    echo "FATAL: $o is $sz bytes — the translation unit is EMPTY." >&2
    echo "       FORGE_NATIVE_BREP is not reaching the compiler and this gate" >&2
    echo "       would report a vacuous pass. Refusing to run." >&2
    exit 1
  fi
  OBJS+=("$o")
done

# ★ LINK ONLY THE TOOLKITS THIS GATE NEEDS, NEVER $OCCT/lib/libTK*.dylib.
# MEASURED while writing this gate: linking all 201 OCCT dylibs makes a `return 1`
# from main() be reported as EXIT CODE 0 — the gate printed "7 passed, 3 failed"
# and exited 0, which would have made it INERT in any CI that reads the status.
# A two-line probe (main returning 1, linked against TKernel/TKMath/TKBRep only)
# exits 1 as it should, so the swallowing comes from something in the full set.
# The explicit list below is also the drop-hygiene statement: TKOffset appears
# because THIS GATE calls BRepOffsetAPI_MakePipeShell as the incumbent arm, not
# because the engine under test needs it.
TKLIBS=(
  -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep
  -lTKTopAlgo -lTKGeomAlgo -lTKPrim -lTKBO -lTKBool -lTKShHealing
  -lTKOffset
)

BIN="$OBJDIR/pipeshell_guided_gate"
if ! $CXX $FLAGS -I include -I "$OCCT/include/opencascade" \
      test/pipeshell_guided_gate.cpp "${OBJS[@]}" \
      -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" "${TKLIBS[@]}" \
      -o "$BIN" 2> "$OBJDIR/link.err"; then
  echo "LINK FAILED" >&2; tail -30 "$OBJDIR/link.err" >&2; exit 1
fi

"$BIN"
