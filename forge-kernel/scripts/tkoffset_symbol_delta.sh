#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# tkoffset_symbol_delta.sh — the PER-CLASS TKOffset counter that
# reports/TKOFFSET_DECOMPOSITION.md §3.3 asks for, without a full kernel build.
#
# WHY THIS EXISTS. `otool -L` cannot see per-family progress: removing 37 of
# TKOffset's 38 remaining symbols leaves OCCT_DIRECT at 8 and OCCT_CLOSURE at 14.
# Only 38/38 moves the link record. So per-family work is measured in SYMBOLS, and
# the honest way to count them without relinking the whole 832-object addon is to
# compile ONLY the translation units that reference TKOffset and take the UNION of
# their undefined TKOffset symbols.
#
# WHY THE UNION IS EXACT, not an estimate. No first-party TU DEFINES a TKOffset
# symbol — they are all imported from libTKOffset. The .node's undefined set is
# therefore exactly the union of its TUs' undefined sets restricted to TKOffset,
# and a TU that references none contributes none. The script VALIDATES that claim
# on every run by diffing its baseline union against the symbol set of a built
# .node when one is available (--node PATH), so the method is never trusted on
# assertion alone.
#
# usage:
#   bash forge-kernel/scripts/tkoffset_symbol_delta.sh [--node PATH_TO_forge-kernel.node]
#
# exit: 0 if every configuration compiled and (when --node is given) the baseline
#       union matched the binary; 1 otherwise.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

NODE_BIN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --node) NODE_BIN="${2:?--node needs a path}"; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"
NODE_INC="${NODE_INC:-$HOME/.cmake-js/node-arm64/v26.0.0/include/node}"
# node-addon-api headers: a git worktree has no node_modules of its own, so fall
# back to the primary checkout's copy (headers only, read-only).
ADDON_INC="${ADDON_INC:-$ROOT/node_modules/node-addon-api}"
if [ ! -f "$ADDON_INC/napi.h" ] && [ -f "$HOME/archdisc-Mech/node_modules/node-addon-api/napi.h" ]; then
  ADDON_INC="$HOME/archdisc-Mech/node_modules/node-addon-api"
fi
[ -f "$ADDON_INC/napi.h" ] || { echo "FATAL: node-addon-api headers not found (set ADDON_INC=)" >&2; exit 2; }
CXX="${CXX:-clang++}"

[ -d "$OCCT_INC" ]  || { echo "FATAL: OCCT headers not at $OCCT_INC" >&2; exit 2; }
[ -d "$NODE_INC" ]  || { echo "FATAL: node headers not at $NODE_INC (set NODE_INC=)" >&2; exit 2; }

OUT="$(mktemp -d "${TMPDIR:-/tmp}/forge_tkoffset_delta.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT

# The TUs that reference TKOffset. Kept explicit rather than globbed so a new
# reference in a new file is a visible edit here, not a silent drift.
TUS=(
  src/Features.cpp          # families C, D, E, F, G, H, I (E = MakePipe, 3 sites)
  src/Airfoil.cpp           # family D
  src/Primitives.cpp        # family D
  src/LoftGuide.cpp         # family D
  src/ClassASurfacing.cpp   # family F
  src/Cam.cpp               # family A (already dropped by default)
  src/Healing.cpp           # family B
  src/DirectModeling.cpp    # dead include only
)

# The base defines the shipped kernel is built with (CMakeFiles/.../flags.make).
BASE_DEFS=(-DFORGE_NATIVE_BREP=1 -DFORGE_NATIVE_LAW=1 -DFORGE_NATIVE_NURBS_CONVERT=1
           -DFORGE_NATIVE_PROJECTION=1 -DFORGE_OFFSET_DROP_MAKEOFFSET=1
           -DFORGE_SHHEAL_DROP_NATIVE=1 -DNAPI_CPP_EXCEPTIONS -DNAPI_VERSION=8
           -DBUILDING_NODE_EXTENSION -DNDEBUG)

INCS=(-I"$NODE_INC" -I"$ADDON_INC" -I"$OCCT_INC"
      -I"$ROOT/forge-kernel/3rdParty/planegcs_eigen_shim" -I/opt/homebrew/include
      -I/opt/homebrew/opt/boost/include
      -I"$ROOT/forge-kernel/3rdParty/planegcs" -I"$ROOT/forge-kernel/include")

nm -gU "$OCCT_LIB"/libTKOffset.*.dylib 2>/dev/null \
  | awk 'NF>=3{print $3} NF==2{print $2}' | sort -u > "$OUT/tkoffset.exports"
[ -s "$OUT/tkoffset.exports" ] || { echo "FATAL: no libTKOffset found under $OCCT_LIB" >&2; exit 2; }

# census TAG EXTRA_DEFS... -> writes $OUT/$TAG.syms, prints the count
census() {
  local tag="$1"; shift
  local extra=(-DFORGE_TKOFFSET_CENSUS=1 "$@")   # a harmless define keeps the array non-empty under `set -u`
  : > "$OUT/$tag.raw"
  local tu
  for tu in "${TUS[@]}"; do
    local obj="$OUT/${tag}_$(basename "$tu" .cpp).o"
    if ! "$CXX" -std=gnu++20 -O1 -fPIC "${BASE_DEFS[@]}" "${extra[@]}" "${INCS[@]}" \
          -c "forge-kernel/$tu" -o "$obj" 2>"$OUT/${tag}_$(basename "$tu" .cpp).err"; then
      echo "  COMPILE FAIL [$tag] $tu"
      sed -n '1,25p' "$OUT/${tag}_$(basename "$tu" .cpp).err"
      return 1
    fi
    nm -u "$obj" | sed 's/^ *//' >> "$OUT/$tag.raw"
  done
  sort -u "$OUT/$tag.raw" > "$OUT/$tag.undef"
  comm -12 "$OUT/$tag.undef" "$OUT/tkoffset.exports" > "$OUT/$tag.syms"
  wc -l < "$OUT/$tag.syms" | tr -d ' '
}

RC=0
echo "== TKOffset per-class symbol census (union over the ${#TUS[@]} referencing TUs) =="
echo

N_BASE=$(census base) || exit 1
echo "  baseline                                   : $N_BASE symbols"

# ---- validate the method against a real binary, if one was named ----
if [ -n "$NODE_BIN" ]; then
  if [ -f "$NODE_BIN" ]; then
    nm -u "$NODE_BIN" | sed 's/^ *//' | sort -u > "$OUT/node.undef"
    comm -12 "$OUT/node.undef" "$OUT/tkoffset.exports" > "$OUT/node.syms"
    N_NODE=$(wc -l < "$OUT/node.syms" | tr -d ' ')
    echo "  built .node                                : $N_NODE symbols  ($NODE_BIN)"
    if diff -q "$OUT/base.syms" "$OUT/node.syms" >/dev/null; then
      echo "  ✓ METHOD VALIDATED — the TU union equals the binary's TKOffset set exactly"
    else
      echo "  ! TU union and binary DIFFER (the worktree source is not the source the"
      echo "    binary was built from — see implementation/sacrosanct/RECONCILIATION_OWED.md):"
      comm -23 "$OUT/base.syms" "$OUT/node.syms" | c++filt | sed 's/^/      only in TU union : /'
      comm -13 "$OUT/base.syms" "$OUT/node.syms" | c++filt | sed 's/^/      only in binary   : /'
    fi
  else
    echo "  (--node $NODE_BIN not found; method validation skipped)"
  fi
fi
echo

N_D=$(census dropD -DFORGE_THRUSECTIONS_DROP_NATIVE=1) || exit 1
echo "  + FORGE_THRUSECTIONS_DROP_NATIVE (fam D)   : $N_D symbols  (-$((N_BASE - N_D)))"
comm -23 "$OUT/base.syms" "$OUT/dropD.syms" | c++filt | sed 's/^/      gone: /'
echo

N_F=$(census dropF -DFORGE_PIPESHELL_DROP_NATIVE=1) || exit 1
echo "  + FORGE_PIPESHELL_DROP_NATIVE    (fam F)   : $N_F symbols  (-$((N_BASE - N_F)))"
comm -23 "$OUT/base.syms" "$OUT/dropF.syms" | c++filt | sed 's/^/      gone: /'
echo

N_DF=$(census dropDF -DFORGE_THRUSECTIONS_DROP_NATIVE=1 -DFORGE_PIPESHELL_DROP_NATIVE=1) || exit 1
echo "  + BOTH D and F                             : $N_DF symbols  (-$((N_BASE - N_DF)))"
echo

N_E=$(census dropE -DFORGE_PIPE_DROP_NATIVE=1) || exit 1
echo "  + FORGE_PIPE_DROP_NATIVE         (fam E)   : $N_E symbols  (-$((N_BASE - N_E)))"
comm -23 "$OUT/base.syms" "$OUT/dropE.syms" | c++filt | sed 's/^/      gone: /'
echo

N_C=$(census dropC -DFORGE_FILLING_DROP_NATIVE=1) || exit 1
echo "  + FORGE_FILLING_DROP_NATIVE      (fam C)   : $N_C symbols  (-$((N_BASE - N_C)))"
comm -23 "$OUT/base.syms" "$OUT/dropC.syms" | c++filt | sed 's/^/      gone: /'
echo

N_ALL=$(census dropAll -DFORGE_THRUSECTIONS_DROP_NATIVE=1 -DFORGE_PIPESHELL_DROP_NATIVE=1 \
                        -DFORGE_PIPE_DROP_NATIVE=1 -DFORGE_FILLING_DROP_NATIVE=1 \
                        -DFORGE_THICKSOLID_DROP_NATIVE=1 -DFORGE_OFFSETSHAPE_DROP_NATIVE=1) || exit 1
echo "  + C, D, E, F and G, H (every family with a drop) : $N_ALL symbols  (-$((N_BASE - N_ALL)))"
echo
echo "  WHAT STILL HOLDS TKOffset — the $N_ALL symbols with NO native engine and no drop:"
c++filt < "$OUT/dropAll.syms" | sed 's/^/      /'
echo
echo "  ★ OCCT_CLOSURE does NOT move until this list is EMPTY. Confirm with"
echo "    bash forge-kernel/scripts/occt_closure_count.sh <binary>"
exit $RC
