#!/usr/bin/env bash
# build_native_payload_access_gate.sh — build + run test/native_payload_access_gate.cpp,
# then prove the gate can fail, twice over:
#
#   * COMPILE-TIME: the same source built against the PREVIOUS revision of
#     forge/NativeShapeAccess.hpp (the one without nativeSolidOf/nativeMeshOf)
#     must FAIL to compile. A gate that would still build without the thing it
#     tests is testing nothing.
#   * RUN-TIME: three --mutate arms, each replacing one production read with a
#     defect, must each turn the run RED.
#
# ★ NO OCCT INCLUDE DIRECTORY IS PASSED, AND THAT IS THE POINT. -I is exactly
#   $KERNEL/include. If NativeShapeAccess.hpp (or Topology.hpp / Shape.hpp /
#   HalfEdgeMesh.hpp beneath it) ever grows an OCCT include, this build dies with
#   'TopoDS_Shape.hxx' file not found instead of quietly succeeding. This mirrors
#   what forge-kernel/CMakeLists.txt does for forge_shape_seam_gate; it is a
#   standalone script because wiring a new ctest target means editing
#   CMakeLists.txt, which is outside this change's write set. Wiring it into
#   ctest is ONE add_executable/add_test block and is left named, not done.
#
# The OCCT lib DIRECTORY is still on the LINK line: libforge_kernel_core.dylib
# itself is full of OCCT and has to resolve at load time. Linking against a
# library that uses OCCT is not the same thing as COMPILING against OCCT
# headers, and only the second one is what "OCCT-free caller" means.
#
# usage: bash forge-kernel/test/build_native_payload_access_gate.sh
# exit:  0 iff the clean run passes, all three mutations are caught, and the
#        compile-time arm did not FAIL. Note the asymmetry, deliberately: once
#        the accessors are on HEAD there is no pre-change header left to compare
#        against, so that arm reports INCONCLUSIVE and the verdict line says so
#        rather than claiming a check that did not run.
set -uo pipefail

KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

CXX="${CXX:-clang++}"
SRC="$KERNEL/test/native_payload_access_gate.cpp"
OUT="${OUT:-$KERNEL/test/.payload_seam}"
BUILD="${PAYLOAD_SEAM_BUILD:-$KERNEL/build}"
LIB="$BUILD/libforge_kernel_core.dylib"
[ -f "$LIB" ] || LIB="$BUILD/Release/libforge_kernel_core.dylib"

rm -rf "$OUT"; mkdir -p "$OUT" || exit 2

if [ ! -f "$LIB" ]; then
  echo "[payload-seam] FATAL: no libforge_kernel_core in $BUILD." >&2
  echo "  Build it first:  cmake --build $BUILD --target forge_kernel_core -j \"\$(forge-nproc)\"" >&2
  exit 2
fi
LIBDIR="$(dirname "$LIB")"

OCCT="${OCCT_ROOT:-}"
if [ -z "$OCCT" ]; then
  for _c in /opt/homebrew/opt/opencascade /usr/local/opt/opencascade /usr; do
    [ -e "$_c/lib" ] && [ -e "$_c/include/opencascade/Standard_Version.hxx" ] && { OCCT="$_c"; break; }
  done
fi

# THE INCLUDE PATH. One entry. No OCCT.
FLAGS=(-std=c++20 -O1 -g0 -Wall -Wextra -Werror -DFORGE_NATIVE_BREP=1 -I"$KERNEL/include")

echo "[1/5] compile the gate with NO OCCT include directory"
if ! "$CXX" "${FLAGS[@]}" -c "$SRC" -o "$OUT/gate.o" 2> "$OUT/compile.err"; then
  echo "[payload-seam] COMPILE FAILED — the OCCT-free boundary is broken, or the" >&2
  echo "               accessors are missing. The compiler's reason:" >&2
  sed 's/^/    /' "$OUT/compile.err" >&2
  exit 1
fi
echo "      ok — the TU built against \$KERNEL/include alone"

echo "[2/5] link + run clean"
LINK=(-std=c++20 "$OUT/gate.o" -o "$OUT/gate"
      -L "$LIBDIR" -lforge_kernel_core -Wl,-rpath,"$LIBDIR")
[ -n "$OCCT" ] && LINK+=(-L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib")
if ! "$CXX" "${LINK[@]}" 2> "$OUT/link.err"; then
  echo "[payload-seam] LINK FAILED:" >&2
  sed 's/^/    /' "$OUT/link.err" >&2
  exit 2
fi
"$OUT/gate" | sed 's/^/    /'
rc=${PIPESTATUS[0]}
if [ "$rc" -ne 0 ]; then
  echo "[payload-seam] RED — the clean run failed (exit $rc)."
  exit 1
fi

echo "[3/5] mutations — each must turn the run RED"
fails=0
for m in 1 2 3; do
  "$OUT/gate" --mutate "$m" > "$OUT/mut$m.log" 2>&1
  mrc=$?
  if [ "$mrc" -eq 0 ]; then
    echo "      ★ mutation $m stayed GREEN — the gate does not test the defect"
    sed 's/^/        /' "$OUT/mut$m.log"
    fails=$((fails+1))
  else
    echo "      mutation $m caught (exit $mrc): $(grep -m1 '\[FAIL\]' "$OUT/mut$m.log" | sed 's/^ *//')"
  fi
done

echo "[4/5] falsifiability at COMPILE time — the pre-change header must not build this"
# Tracked so [5/5] cannot claim an arm that did not run. Once the accessors are
# ON HEAD this arm has nothing to compare against, and a verdict line that says
# "cannot be built without the accessors" in that state would be asserting the
# result of a check that was skipped.
COMPILE_ARM="skipped"
# Stage the header exactly as it was before the accessors were added, in an
# include tree that is otherwise identical, and require a NON-ZERO exit.
PREV="$OUT/prev-include"
mkdir -p "$PREV/forge"
if git -C "$KERNEL" show "HEAD:forge-kernel/include/forge/NativeShapeAccess.hpp" \
     > "$PREV/forge/NativeShapeAccess.hpp" 2>"$OUT/git.err"; then
  if grep -q "nativeSolidOf" "$PREV/forge/NativeShapeAccess.hpp"; then
    COMPILE_ARM="inconclusive"
    echo "      (HEAD already carries the accessors, so there is no pre-change header to"
    echo "       compare against — this arm is INCONCLUSIVE, not passed. It is meaningful"
    echo "       on the commit that adds them, and against that commit's parent:"
    echo "         git stash-free check: PREV=\$(git show <parent>:forge-kernel/include/forge/NativeShapeAccess.hpp))"
  else
    # -I"$PREV" FIRST so its forge/NativeShapeAccess.hpp shadows the new one;
    # everything else still resolves out of the real include tree.
    PREVFLAGS=(-std=c++20 -O1 -g0 -Wall -Wextra -Werror -DFORGE_NATIVE_BREP=1
               -I"$PREV" -I"$KERNEL/include")
    if "$CXX" "${PREVFLAGS[@]}" -c "$SRC" -o "$OUT/prev.o" 2> "$OUT/prev.err"; then
      echo "      ★ the gate COMPILED against the header WITHOUT the accessors."
      echo "        It therefore does not test them. Reporting BROKEN, not green."
      COMPILE_ARM="FAILED"
      fails=$((fails+1))
    else
      COMPILE_ARM="passed"
      echo "      ok — without the accessors it does not compile:"
      grep -m2 "error:" "$OUT/prev.err" | sed 's/^/        /'
    fi
  fi
else
  echo "      (could not read the previous header from git; arm SKIPPED — not passed)"
  sed 's/^/        /' "$OUT/git.err"
fi

echo "[5/5] verdict"
if [ "$fails" -ne 0 ]; then
  echo "[payload-seam] RED — $fails falsifiability arm(s) failed."
  exit 1
fi
if [ "$COMPILE_ARM" = "passed" ]; then
  echo "[payload-seam] GREEN — clean run passes, all mutations caught, and the gate"
  echo "               cannot be built without the accessors it tests."
else
  echo "[payload-seam] GREEN — clean run passes and all mutations were caught."
  echo "               The compile-time arm was $COMPILE_ARM, so THIS run does not"
  echo "               show the gate needs the accessors; only a run against a tree"
  echo "               without them does."
fi
