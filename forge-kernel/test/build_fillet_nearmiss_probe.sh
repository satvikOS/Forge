#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_fillet_nearmiss_probe.sh — build test/fillet_nearmiss_probe.cpp.
#
# Assembly is build_corpus_ab_coverage.sh's, deliberately: the probe must link
# the SAME native engine and the SAME OCCT the A/B links, or it would be
# measuring a different pair of arms than the population it is explaining.
# It shares that script's object cache (.build-corpus-ab/obj) for exactly that
# reason — a second cache could go stale independently and quietly answer for a
# different tree.
#
# ★ A GATE THAT CANNOT BUILD CANNOT FAIL: the four controls in --selftest are run
#   here, before the binary is emitted, and a red control refuses the binary.
#
# Output: BIN=<path> on stdout. Exit 0 iff the binary built AND the controls pass.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

CXX="${CXX:-clang++}"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT="/usr/local/opt/opencascade"
  else
    echo "FATAL: OCCT not found (brew install opencascade or set OCCT_ROOT)" >&2
    exit 2
  fi
fi
OCCT_INC="$OCCT/include/opencascade"
OCCT_LIB="$OCCT/lib"
FLAGS="-std=c++20 -O2 -DFORGE_NATIVE_BREP"
OBJDIR="${OBJDIR:-$KERNEL/.build-corpus-ab}"
OUT="${OUT:-$OBJDIR/fillet_nearmiss_probe}"
LIB="$OBJDIR/libforge_native_ab.a"

# The engine archive is the A/B's. Build it through the A/B's own script rather
# than re-deriving the source list here, so the two binaries cannot drift apart.
if [ ! -f "$LIB" ]; then
  bash "$KERNEL/test/build_corpus_ab_coverage.sh" >/dev/null 2>&1 || {
    echo "FATAL: could not build the shared native archive" >&2; exit 1; }
fi
[ -f "$LIB" ] || { echo "FATAL: $LIB absent after build" >&2; exit 1; }

mkdir -p "$OBJDIR/obj" || exit 2
TU="$OBJDIR/obj/fillet_nearmiss_probe.o"
if [ ! -f "$TU" ] || [ ! "$TU" -nt test/fillet_nearmiss_probe.cpp ]; then
  echo "  CXX test/fillet_nearmiss_probe.cpp" >&2
  # shellcheck disable=SC2086
  $CXX $FLAGS -I include -I "$OCCT_INC" -c test/fillet_nearmiss_probe.cpp -o "$TU" \
    2> "$OBJDIR/probe.cxx.err" || { tail -30 "$OBJDIR/probe.cxx.err" >&2; exit 1; }
fi

OCCT_LIBS="-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
           -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset \
           -lTKDESTEP -lTKXSBase"
# shellcheck disable=SC2086
if ! $CXX $FLAGS -I include -I "$OCCT_INC" "$TU" "$LIB" \
     -L "$OCCT_LIB" -Wl,-rpath,"$OCCT_LIB" $OCCT_LIBS -o "$OUT" 2> "$OBJDIR/probe.link.err"; then
  echo "[probe] LINK FAILED:" >&2; tail -40 "$OBJDIR/probe.link.err" >&2; exit 1
fi

if ! "$OUT" --selftest > "$OBJDIR/probe.selftest.log" 2>&1; then
  echo "[probe] CONTROLS FAILED — refusing the binary:" >&2
  cat "$OBJDIR/probe.selftest.log" >&2
  exit 1
fi
cat "$OBJDIR/probe.selftest.log" >&2

STAMP="$OBJDIR/probe_build_stamp.json"
cat > "$STAMP" <<STAMPJSON
{
  "built_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "git_head": "$(git -C "$KERNEL" rev-parse HEAD 2>/dev/null || echo unknown)",
  "dirty_files_in_src_include_test": $(git -C "$KERNEL" status --porcelain -- "$KERNEL/src" "$KERNEL/include" "$KERNEL/test" 2>/dev/null | wc -l | tr -d ' '),
  "flags": "$FLAGS",
  "occt_root": "$OCCT",
  "binary": "$OUT"
}
STAMPJSON
echo "BIN=$OUT"
exit 0
