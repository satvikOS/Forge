#!/usr/bin/env bash
# build_sketch_solver_gate.sh — the sketch solver library, its boundary, and the
# behaviours Forge relies on it for.
#
#   bash forge-kernel/test/build_sketch_solver_gate.sh
#
# FIVE PARTS, each a separate verdict:
#
#   1. libforge_gcs builds, as a SHARED library, from third_party/freecad-derived
#      with its own script (the same six sources its CMake target compiles).
#   2. The library's C interface, exercised IN C (C11, -pedantic -Werror) by
#      its own ABI test: every bad input refused with a sentence, a pinned
#      rectangle at 0 DOF, conflict groups naming the pair. 3 mutations.
#   3. THE BOUNDARY, measured on the objects and binaries, not on the build
#      files: Forge's adapter (Sketcher.o) DEFINES no symbol of the library and
#      no planegcs class, it IMPORTS the C interface, and the gate binary carries
#      a load command for @rpath/libforge_gcs.dylib. Then the LGPL gate in binary
#      mode over the same pair.
#   4. The behaviours FreeCAD's own Sketcher tests check (box, square, circle,
#      slot, clearConstraints), restated through forge::Sketcher, plus the
#      conflict groups and the transaction judge (judgeSketchChange). 3 mutations.
#   5. Every mutation must turn its binary red; a mutation that stays green fails
#      the gate.
#
# HERMETIC: clang, Eigen and Boost headers (brew install eigen boost), OCCT
# headers + the handful of TK libraries the adapter's header-inlined OCCT code
# names (brew install opencascade) -- the same the kernel job already installs.
# Kernel geometry symbols the behaviour test never calls are left to
# -undefined dynamic_lookup exactly as build_sketch_solve.sh leaves them; the
# solver library is NOT one of them: it is linked by name.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KERNEL="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$KERNEL/.." && pwd)"
GCS_DIR="$ROOT/third_party/freecad-derived/sketch-solver"
OUT="${OUT:-$KERNEL/test/.sketch_solver_gate}"
mkdir -p "$OUT" || exit 2
CXX="${CXX:-clang++}"
CC="${CC:-clang}"
FAIL=0
say()  { printf '[sketch-solver] %s\n' "$*"; }
bad()  { printf '[sketch-solver]   FAIL  %s\n' "$*"; FAIL=$((FAIL + 1)); }
good() { printf '[sketch-solver]   ok    %s\n' "$*"; }

if [ -z "${OCCT_INC:-}" ]; then
  for _c in /opt/homebrew/opt/opencascade/include/opencascade /opt/homebrew/include/opencascade \
            /usr/local/opt/opencascade/include/opencascade /usr/include/opencascade; do
    [ -d "$_c" ] && { OCCT_INC="$_c"; break; }
  done
fi
[ -d "${OCCT_INC:-}" ] || { echo "OCCT headers not found (set OCCT_INC)" >&2; exit 2; }
OCCT_LIB="${OCCT_LIB:-$(cd "$OCCT_INC/../.." && pwd)/lib}"

# ── 1. the library ──────────────────────────────────────────────────────────
say "1/5 libforge_gcs, as a shared library"
GCS_LIB="$(bash "$GCS_DIR/build_forge_gcs.sh" "$OUT/gcs" | tail -1)"
if [ ! -f "$GCS_LIB" ]; then echo "libforge_gcs did not build" >&2; exit 2; fi
GCS_LIBDIR="$(dirname "$GCS_LIB")"
case "$(uname -s)" in
  Darwin)
    if otool -D "$GCS_LIB" | grep -q '@rpath/libforge_gcs.dylib'; then good "install name is @rpath/libforge_gcs.dylib"
    else bad "libforge_gcs install name is not @rpath/libforge_gcs.dylib: $(otool -D "$GCS_LIB" | tail -1)"; fi
    EXPORTS="$(nm -gU "$GCS_LIB" | awk '{print $NF}')"
    if printf '%s\n' "$EXPORTS" | grep -qv '^_forge_gcs_'; then
      bad "the library exports more than its C interface: $(printf '%s\n' "$EXPORTS" | grep -v '^_forge_gcs_' | head -3 | tr '\n' ' ')"
    else
      good "the library exports ONLY its C interface ($(printf '%s\n' "$EXPORTS" | wc -l | tr -d ' ') symbols)"
    fi
    ;;
esac

# ── 2. the C interface, in C ─────────────────────────────────────────────────
say "2/5 the C interface, exercised in C"
"$CC" -std=c11 -Wall -Wextra -Werror -pedantic -I"$GCS_DIR/include" \
  "$GCS_DIR/test/forge_gcs_abi_test.c" -o "$OUT/forge_gcs_abi_test" \
  -L"$GCS_LIBDIR" -lforge_gcs -Wl,-rpath,"$GCS_LIBDIR" -lm || { echo "the ABI test did not compile" >&2; exit 2; }
if "$OUT/forge_gcs_abi_test"; then good "the ABI test passes"; else bad "the ABI test failed"; fi
for m in 1 2 3; do
  if "$OUT/forge_gcs_abi_test" --mutate "$m" >"$OUT/abi_mut_$m.log" 2>&1; then
    bad "ABI mutation $m stayed GREEN -- that check cannot fail"
  else
    good "ABI mutation $m turns the test red"
  fi
done

# ── 3. Forge's side, compiled against the C header ONLY ─────────────────────
say "3/5 Forge's adapter and the boundary"
FLAGS=(-std=c++20 -O1 -g -Wall -DFORGE_NATIVE_BREP=1 -I"$KERNEL/include" -I"$OCCT_INC" -I"$GCS_DIR/include")
for tu in Sketcher ft/FeatureTreeCompiler ft/SketchInspect ft/SketchAdmission ft/GraphAudit; do
  obj="$OUT/$(basename "$tu").o"
  "$CXX" "${FLAGS[@]}" -c "$KERNEL/src/$tu.cpp" -o "$obj" || { echo "$tu.cpp did not compile" >&2; exit 2; }
done
"$CXX" "${FLAGS[@]}" -c "$HERE/ft/sketch_solver_behaviour_test.cpp" -o "$OUT/sketch_solver_behaviour_test.o" \
  || { echo "the behaviour test did not compile" >&2; exit 2; }
case "$(uname -s)" in
  Darwin) UNDEF=(-Wl,-undefined,dynamic_lookup -Wl,-no_fixup_chains) ;;
  *)      UNDEF=(-Wl,--unresolved-symbols=ignore-all) ;;
esac
LIBS=()
[ -d "$OCCT_LIB" ] && LIBS=(-L"$OCCT_LIB" -Wl,-rpath,"$OCCT_LIB" -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo -lTKGeomAlgo)
BIN="$OUT/sketch_solver_behaviour"
"$CXX" -std=c++20 "$OUT/sketch_solver_behaviour_test.o" "$OUT/FeatureTreeCompiler.o" "$OUT/Sketcher.o" \
  "$OUT/SketchInspect.o" "$OUT/SketchAdmission.o" "$OUT/GraphAudit.o" -o "$BIN" \
  "${LIBS[@]}" -L"$GCS_LIBDIR" -lforge_gcs -Wl,-rpath,"$GCS_LIBDIR" "${UNDEF[@]}" \
  || { echo "the behaviour test did not link" >&2; exit 2; }

if [ "$(uname -s)" = Darwin ]; then
  if nm -gU "$OUT/Sketcher.o" | awk '{print $NF}' | grep -Eq '^_forge_gcs_|^__ZN3GCS'; then
    bad "Sketcher.o DEFINES solver symbols -- solver code is compiled into Forge"
  else
    good "Sketcher.o defines no symbol of the library and no planegcs class"
  fi
  if nm -u "$OUT/Sketcher.o" | grep -q '^_forge_gcs_create$'; then good "Sketcher.o imports the C interface"
  else bad "Sketcher.o does not import forge_gcs_create -- the adapter is not using the library"; fi
  if otool -L "$BIN" | grep -q '@rpath/libforge_gcs.dylib'; then good "the gate binary loads @rpath/libforge_gcs.dylib"
  else bad "the gate binary has no load command for libforge_gcs"; fi
  if bash "$ROOT/tools/gates/freecad_derived_lgpl_gate.sh" --binary "$BIN" --binary "$OUT/Sketcher.o" \
       --library "$GCS_LIB" >"$OUT/lgpl_binary.log" 2>&1; then
    good "the LGPL gate, binary mode: no static copy in the adapter or the gate binary"
  else
    bad "the LGPL gate, binary mode, is red:"; sed 's/^/      /' "$OUT/lgpl_binary.log" | tail -8
  fi
fi

# ── 4. the behaviours ───────────────────────────────────────────────────────
say "4/5 FreeCAD's solver behaviours, the conflict groups and the judge"
if "$BIN"; then good "the behaviour test passes"; else bad "the behaviour test failed"; fi

# ── 5. and it can fail ──────────────────────────────────────────────────────
say "5/5 mutations"
for m in 1 2 3; do
  if "$BIN" --mutate "$m" >"$OUT/behaviour_mut_$m.log" 2>&1; then
    bad "behaviour mutation $m stayed GREEN -- that check cannot fail"
  else
    good "behaviour mutation $m turns the test red"
  fi
done

if [ "$FAIL" -ne 0 ]; then say "RED -- $FAIL failure(s)"; exit 1; fi
say "GREEN -- library, interface, boundary, behaviours and 6 mutations"
exit 0
