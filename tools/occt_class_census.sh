#!/bin/bash
# occt_class_census.sh — collapse a toolkit's exclusive undefined symbols to OCCT CLASSES,
# with a count per class. Reads excl_<TK>_demangled.txt produced by occt_symbol_census.sh.
set -u
OUT=${1:?censusdir}
shift
for tk in "$@"; do
    f="$OUT/excl_${tk}_demangled.txt"
    [ -f "$f" ] || continue
    echo "=== $tk ($(wc -l < "$f" | tr -d ' ') exclusive symbols) ==="
    sed -e 's/^vtable for //' -e 's/^typeinfo for //' -e 's/^typeinfo name for //' \
        -e 's/^non-virtual thunk to //' "$f" \
      | sed -E 's/^([A-Za-z0-9_]+)::.*/\1/; s/^([A-Za-z0-9_]+)\(.*/\1/; s/^([A-Za-z0-9_]+)$/\1/' \
      | sort | uniq -c | sort -rn
    echo
done
