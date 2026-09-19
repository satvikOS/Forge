#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# tkoffset_family_a_delta.sh — what family A's deletion takes out of the SHIPPED
# TKOffset symbol set, measured rather than argued.
#
# WHY A SECOND SCRIPT AND NOT scripts/tkoffset_symbol_delta.sh. That script's
# BASE_DEFS carry -DFORGE_OFFSET_DROP_MAKEOFFSET=1, so its baseline is a build in
# which family A is ALREADY dropped and it reports 38. The number the programme
# ships is 42, from /Applications/Forge.app, where the flag is OFF
# (forge-kernel/CMakeLists.txt:973 only defines it when the option is ON, and
# CMakeLists.txt:975 warns it must not ship). Measuring family A against a
# baseline that already excludes family A reports a delta of zero. This script
# uses the SHIPPED configuration — the same BASE_DEFS with that one define
# removed — so the before number is the 42 the bundle actually carries.
#
# METHOD, identical to the other script's and exact for the same reason: no
# first-party TU DEFINES a TKOffset symbol, so a binary's undefined TKOffset set
# is exactly the union of its TUs' undefined TKOffset sets. Compile every TU that
# references TKOffset, take the union, intersect with libTKOffset's exports.
#
# WHAT IT COMPARES. The 8 referencing TUs at HEAD, against the SAME 8 with
# src/Cam.cpp taken from a baseline revision (default origin/archdisc). Only
# Cam.cpp differs between the two, so the difference in the union is exactly what
# family A contributed.
#
# usage: bash forge-kernel/scripts/tkoffset_family_a_delta.sh [BASE_REF]
# exit:  0 if every configuration compiled and the delta was computed; 1 otherwise
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2
BASE_REF="${1:-origin/archdisc}"

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"
NODE_INC="${NODE_INC:-$HOME/.cmake-js/node-arm64/v26.0.0/include/node}"
ADDON_INC="${ADDON_INC:-$ROOT/node_modules/node-addon-api}"
if [ ! -f "$ADDON_INC/napi.h" ] && [ -f "$HOME/archdisc-Mech/node_modules/node-addon-api/napi.h" ]; then
  ADDON_INC="$HOME/archdisc-Mech/node_modules/node-addon-api"
fi
[ -f "$ADDON_INC/napi.h" ] || { echo "FATAL: node-addon-api headers not found (set ADDON_INC=)" >&2; exit 2; }
[ -d "$OCCT_INC" ] || { echo "FATAL: OCCT headers not at $OCCT_INC" >&2; exit 2; }
[ -d "$NODE_INC" ] || { echo "FATAL: node headers not at $NODE_INC (set NODE_INC=)" >&2; exit 2; }
CXX="${CXX:-clang++}"

OUT="$(mktemp -d "${TMPDIR:-/tmp}/forge_fam_a_delta.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT

TUS=(
  src/Features.cpp
  src/Airfoil.cpp
  src/Primitives.cpp
  src/LoftGuide.cpp
  src/ClassASurfacing.cpp
  src/Cam.cpp
  src/Healing.cpp
  src/DirectModeling.cpp
)

# The SHIPPED defines: forge-kernel/CMakeLists.txt with every FORGE_*_DROP_*
# option at its default. FORGE_OFFSET_DROP_MAKEOFFSET is NOT among them — that is
# the whole point of this script.
BASE_DEFS=(-DFORGE_NATIVE_BREP=1 -DFORGE_NATIVE_LAW=1 -DFORGE_NATIVE_NURBS_CONVERT=1
           -DFORGE_NATIVE_PROJECTION=1 -DFORGE_SHHEAL_DROP_NATIVE=1
           -DNAPI_CPP_EXCEPTIONS -DNAPI_VERSION=8 -DBUILDING_NODE_EXTENSION -DNDEBUG)
INCS=(-I"$NODE_INC" -I"$ADDON_INC" -I"$OCCT_INC"
      -I"$ROOT/forge-kernel/3rdParty/planegcs_eigen_shim" -I/opt/homebrew/include
      -I/opt/homebrew/opt/boost/include
      -I"$ROOT/forge-kernel/3rdParty/planegcs" -I"$ROOT/forge-kernel/include")

nm -gU "$OCCT_LIB"/libTKOffset.*.dylib 2>/dev/null \
  | awk 'NF>=3{print $3} NF==2{print $2}' | sort -u > "$OUT/tkoffset.exports"
[ -s "$OUT/tkoffset.exports" ] || { echo "FATAL: no libTKOffset under $OCCT_LIB" >&2; exit 2; }
echo "libTKOffset exports: $(wc -l < "$OUT/tkoffset.exports" | tr -d ' ')"

compile_tu() {   # $1 = source path, $2 = object path
  "$CXX" -std=gnu++20 -O1 -fPIC "${BASE_DEFS[@]}" "${INCS[@]}" -c "$1" -o "$2" 2> "$2.err"
  local rc=$?
  if [ "$rc" != "0" ]; then
    echo "COMPILE FAIL: $1" >&2
    sed -n '1,25p' "$2.err" >&2
    return 1
  fi
  [ -s "$2" ] || { echo "FATAL: no object after a compile that returned 0: $1" >&2; return 1; }
  return 0
}

# ── HEAD: every TU as it stands ──────────────────────────────────────────────
: > "$OUT/head.raw"
for tu in "${TUS[@]}"; do
  obj="$OUT/head_$(basename "$tu" .cpp).o"
  compile_tu "forge-kernel/$tu" "$obj" || exit 1
  nm -u "$obj" | sed 's/^ *//' >> "$OUT/head.raw"
done
sort -u "$OUT/head.raw" > "$OUT/head.undef"
comm -12 "$OUT/head.undef" "$OUT/tkoffset.exports" > "$OUT/head.syms"

# ── the same union with src/Cam.cpp taken from BASE_REF ──────────────────────
git show "$BASE_REF:forge-kernel/src/Cam.cpp" > "$OUT/Cam_base.cpp"
rc=$?
if [ "$rc" != "0" ] || [ ! -s "$OUT/Cam_base.cpp" ]; then
  echo "FATAL: could not read forge-kernel/src/Cam.cpp from $BASE_REF" >&2; exit 2
fi
# It is compiled IN PLACE so its relative #includes ("forge/...") resolve exactly
# as the real file's do.
cp "$OUT/Cam_base.cpp" "forge-kernel/src/.Cam_base_tmp.cpp"
compile_tu "forge-kernel/src/.Cam_base_tmp.cpp" "$OUT/base_Cam.o"
rc=$?
rm -f "forge-kernel/src/.Cam_base_tmp.cpp"
[ "$rc" = "0" ] || exit 1

: > "$OUT/base.raw"
for tu in "${TUS[@]}"; do
  if [ "$tu" = "src/Cam.cpp" ]; then
    nm -u "$OUT/base_Cam.o" | sed 's/^ *//' >> "$OUT/base.raw"
  else
    nm -u "$OUT/head_$(basename "$tu" .cpp).o" | sed 's/^ *//' >> "$OUT/base.raw"
  fi
done
sort -u "$OUT/base.raw" > "$OUT/base.undef"
comm -12 "$OUT/base.undef" "$OUT/tkoffset.exports" > "$OUT/base.syms"

NB="$(wc -l < "$OUT/base.syms" | tr -d ' ')"
NH="$(wc -l < "$OUT/head.syms" | tr -d ' ')"
echo
echo "== TKOffset union over the ${#TUS[@]} referencing TUs, SHIPPED configuration =="
echo "  BEFORE (src/Cam.cpp at $BASE_REF) : $NB symbols"
echo "  AFTER  (src/Cam.cpp at HEAD)      : $NH symbols   (-$((NB - NH)))"
echo
echo "  REMOVED by family A:"
comm -23 "$OUT/base.syms" "$OUT/head.syms" | c++filt | sed 's/^/      /'
ADDED="$(comm -13 "$OUT/base.syms" "$OUT/head.syms" | wc -l | tr -d ' ')"
if [ "$ADDED" != "0" ]; then
  echo "  ★ ADDED (a drop that adds a symbol is a regression):"
  comm -13 "$OUT/base.syms" "$OUT/head.syms" | c++filt | sed 's/^/      /'
fi
echo
echo "  STILL HOLDING TKOffset after family A ($NH symbols):"
c++filt < "$OUT/head.syms" | sed 's/^/      /'
echo
echo "  ★ OCCT_CLOSURE does NOT move until that list is EMPTY (all nine families)."
echo "    Confirm on a built binary with scripts/occt_closure_count.sh."
[ "$ADDED" = "0" ] || exit 1
exit 0
