#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_draft_defer_probe.sh — build test/draft_defer_probe.cpp.
#
# Assembly copied from build_corpus_ab_coverage.sh (same native sources, same
# OCCT include path, same archive rule, same OcctPrimBuilder support TU) so the
# probe measures the SAME engine the A/B measured. It links TKBO/TKBool too,
# which the A/B does not need, because the probe's NEGATIVE control fuses a
# cylinder onto a box to manufacture a non-planar face.
#
# ★ NOT A DROP BUILD. No FORGE_*_DROP_* macro is defined, exactly as in the A/B.
#
# A GATE THAT CANNOT BUILD CANNOT FAIL: the build runs the probe's own
# --selftest (a positive AND a negative control) and refuses to emit a binary
# path if either fails.
#
# Output: BIN=<path> on stdout. Exit 0 iff the binary built and self-tested.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

CXX="${CXX:-clang++}"
INC="include"
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
JOBS="${JOBS:-4}"
OBJDIR="${OBJDIR:-$KERNEL/.build-draft-probe}"
OUT="${OUT:-$OBJDIR/draft_defer_probe}"
[ "${FORCE:-0}" = "1" ] && rm -rf "$OBJDIR"
mkdir -p "$OBJDIR/obj" || exit 2

FAIL="$OBJDIR/fail"; : > "$FAIL"
BUILT="$OBJDIR/built"; : > "$BUILT"

CAP=()
cap() {
  "$@" &
  CAP+=("$!")
  if [ "${#CAP[@]}" -ge "$JOBS" ]; then wait "${CAP[0]}" 2>/dev/null || true; CAP=("${CAP[@]:1}"); fi
}
drain() { local p; for p in "${CAP[@]:-}"; do [ -n "$p" ] && wait "$p" 2>/dev/null || true; done; CAP=(); }

compile() {
  if [ -f "$2" ] && [ "$2" -nt "$1" ]; then return 0; fi
  echo "  CXX $1"
  echo x >> "$BUILT"
  if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" -c "$1" -o "$2" 2> "$2.err"; then
    echo "SRC FAIL: $1" >&2
    tail -20 "$2.err" >&2
    echo x >> "$FAIL"
    rm -f "$2"
  fi
}

OBJS=()
for src in src/native/*.cpp src/native/*/*.cpp src/OcctPrimBuilder.cpp; do
  [ -e "$src" ] || continue
  obj="$OBJDIR/obj/$(echo "$src" | tr '/.' '__').o"
  OBJS+=("$obj")
  cap compile "$src" "$obj"
done
drain
if [ -s "$FAIL" ]; then
  echo "[draft-probe] native source compile failed ($(wc -l < "$FAIL" | tr -d ' ') file(s))" >&2
  exit 1
fi

LIB="$OBJDIR/libforge_native_probe.a"
rm -f "$LIB"
if ! ar -crs "$LIB" "${OBJS[@]}" 2> "$OBJDIR/ar.err"; then
  echo "[draft-probe] ar FAILED:" >&2
  tail -20 "$OBJDIR/ar.err" >&2
  exit 1
fi

TU="$OBJDIR/obj/draft_defer_probe.o"
compile test/draft_defer_probe.cpp "$TU"
if [ -s "$FAIL" ]; then
  echo "[draft-probe] probe TU compile failed" >&2
  exit 1
fi

OCCT_LIBS="-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
           -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset \
           -lTKDESTEP -lTKXSBase"
# shellcheck disable=SC2086
if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" "$TU" "$LIB" \
     -L "$OCCT_LIB" -Wl,-rpath,"$OCCT_LIB" $OCCT_LIBS -o "$OUT" 2> "$OBJDIR/link.err"; then
  echo "[draft-probe] LINK FAILED:" >&2
  tail -40 "$OBJDIR/link.err" >&2
  exit 1
fi

# The controls, before any corpus number exists.
if ! "$OUT" --selftest > "$OBJDIR/selftest.log" 2>&1; then
  echo "[draft-probe] SELFTEST FAILED:" >&2
  cat "$OBJDIR/selftest.log" >&2
  exit 1
fi
cat "$OBJDIR/selftest.log" >&2

STAMP="$OBJDIR/build_stamp.json"
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

echo "[draft-probe] compiled $(wc -l < "$BUILT" | tr -d ' ') of $(( ${#OBJS[@]} + 1 )) TU(s); selftest PASS" >&2
echo "BIN=$OUT"
exit 0
