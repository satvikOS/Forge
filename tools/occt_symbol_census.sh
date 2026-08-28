#!/bin/bash
# occt_symbol_census.sh — exact per-toolkit undefined-symbol census for a built binary.
#
# For every OCCT toolkit in the load closure, prints how many of the binary's UNDEFINED
# symbols that toolkit (and only that toolkit) exports, and writes the demangled list.
# "needed" and "exclusive" are reported separately so a symbol available from two
# toolkits can never be double-counted as a blocker for both.
#
# usage: occt_symbol_census.sh [BINARY] [OUTDIR]
set -u

NODE=${1:?binary required}
OUT=${2:?outdir required}
LIBDIR=${OCCT_LIB_DIR:-/opt/homebrew/opt/opencascade/lib}

TOOLKITS="TKBRep TKernel TKFillet TKG3d TKMath TKOffset TKShHealing TKTopAlgo TKBO TKG2d TKBool TKPrim TKGeomAlgo TKGeomBase"

mkdir -p "$OUT"
nm -u "$NODE" | sed 's/^ *//' | sort -u > "$OUT/undef.txt"
echo "binary            : $NODE"
echo "undefined symbols : $(wc -l < "$OUT/undef.txt" | tr -d ' ')"
echo

# exports per toolkit
for tk in $TOOLKITS; do
    lib="$LIBDIR/lib${tk}.7.9.dylib"
    if [ ! -f "$lib" ]; then echo "MISSING $lib"; continue; fi
    nm -gU "$lib" 2>/dev/null | awk 'NF>=3 {print $3} NF==2 {print $2}' | sort -u > "$OUT/exp_$tk.txt"
    comm -12 "$OUT/undef.txt" "$OUT/exp_$tk.txt" > "$OUT/need_$tk.txt"
done

# exclusivity: a needed symbol is EXCLUSIVE to tk if no other toolkit exports it
for tk in $TOOLKITS; do
    [ -f "$OUT/need_$tk.txt" ] || continue
    : > "$OUT/others_$tk.txt"
    for o in $TOOLKITS; do
        [ "$o" = "$tk" ] && continue
        [ -f "$OUT/exp_$o.txt" ] && cat "$OUT/exp_$o.txt" >> "$OUT/others_$tk.txt"
    done
    sort -u -o "$OUT/others_$tk.txt" "$OUT/others_$tk.txt"
    comm -23 "$OUT/need_$tk.txt" "$OUT/others_$tk.txt" > "$OUT/excl_$tk.txt"
    c++filt < "$OUT/excl_$tk.txt" > "$OUT/excl_${tk}_demangled.txt"
    printf "%-12s needed=%-5s exclusive=%s\n" "$tk" \
        "$(wc -l < "$OUT/need_$tk.txt" | tr -d ' ')" \
        "$(wc -l < "$OUT/excl_$tk.txt" | tr -d ' ')"
done
