#!/bin/bash
# occt_symbol_census.sh — exact per-toolkit undefined-symbol census for a built binary.
#
# For every OCCT toolkit in the load closure, prints how many of the binary's UNDEFINED
# symbols that toolkit (and only that toolkit) exports, and writes the demangled list.
# "needed" and "exclusive" are reported separately so a symbol available from two
# toolkits can never be double-counted as a blocker for both.
#
# ── DEFECT FIXED 2026-08-28: THE VERSION HARDCODE ────────────────────────────────
# This script used to resolve each toolkit as exactly "$LIBDIR/lib${tk}.7.9.dylib" and,
# when that file was absent, print "MISSING <path>" and CONTINUE. On any OCCT that is
# not 7.9 — 7.8, 8.x, a source build, a Linux .so, or the same 7.9 installed with a
# different soname layout — EVERY toolkit missed, every per-toolkit line vanished, and
# the script exited 0 having proved nothing. A census that reports "no blockers" because
# it could not open a single library is worse than no census: it is a green light
# manufactured from a path typo.
#
# Now: each toolkit is located by GLOB across the platform's naming conventions
# (lib<TK>.dylib / lib<TK>.<ver>.dylib / lib<TK>.so / lib<TK>.so.<ver> / lib<TK>.a), the
# OCCT version actually measured is printed for provenance, and a toolkit that cannot be
# located is a HARD ERROR (exit 2) naming it and the directory searched.
#
# usage: occt_symbol_census.sh BINARY OUTDIR
#   OCCT_LIB_DIR=<dir>   override the OCCT lib directory (else the usual prefixes)
#   TOOLKITS="TKa TKb"   override the toolkit list (default: the modelling set below)
# exit: 0 census printed / 2 binary, toolchain, lib dir or a toolkit could not be found.
set -u

NODE=${1:?binary required}
OUT=${2:?outdir required}
[ -f "$NODE" ] || { echo "FATAL: binary not found: $NODE" >&2; exit 2; }

# ── locate the OCCT lib directory ───────────────────────────────────────────────
# A directory only counts if it actually holds at least one libTK*, so a stale or
# empty prefix fails loudly here instead of surfacing as 14 MISSING lines later.
has_toolkits() {
    [ -d "$1" ] || return 1
    # One glob per call: `ls a* b*` exits NONZERO when EITHER pattern misses, which
    # would reject a perfectly good .dylib-only prefix for having no .so files.
    for pat in "libTK"*".dylib" "libTK"*".so" "libTK"*".so."* "libTK"*".a"; do
        for f in "$1"/$pat; do
            [ -f "$f" ] && return 0
        done
    done
    return 1
}
LIBDIR=""
for d in ${OCCT_LIB_DIR:-} \
         /opt/homebrew/opt/opencascade/lib \
         /usr/local/opt/opencascade/lib \
         /usr/lib/x86_64-linux-gnu /usr/local/lib /usr/lib; do
    [ -n "$d" ] || continue
    if has_toolkits "$d"; then LIBDIR="$d"; break; fi
done
if [ -z "$LIBDIR" ]; then
    echo "FATAL: no directory containing libTK* found." >&2
    echo "       Set OCCT_LIB_DIR=<dir> (searched: \$OCCT_LIB_DIR," >&2
    echo "       /opt/homebrew/opt/opencascade/lib, /usr/local/opt/opencascade/lib," >&2
    echo "       /usr/lib/x86_64-linux-gnu, /usr/local/lib, /usr/lib)." >&2
    exit 2
fi

# ── locate ONE toolkit, version-agnostically ────────────────────────────────────
# Preference order: the unversioned dev symlink, then the highest versioned name, then
# the ELF/static forms. Printing nothing + rc 1 is the only failure mode; the caller
# turns that into a hard error.
find_toolkit() {
    tk="$1"; c=""
    for pat in "lib${tk}.dylib" "lib${tk}."*".dylib" "lib${tk}.so" "lib${tk}.so."* "lib${tk}.a"; do
        for f in "$LIBDIR"/$pat; do
            [ -f "$f" ] && { c="$f"; break; }
        done
        [ -n "$c" ] && break
    done
    [ -n "$c" ] || return 1
    printf '%s\n' "$c"
}

# The OCCT modelling-data / modelling-algorithms set the kernel links against. Override
# with TOOLKITS= to census a different slice (e.g. after a toolkit is renamed upstream).
TOOLKITS=${TOOLKITS:-"TKBRep TKernel TKFillet TKG3d TKMath TKOffset TKShHealing TKTopAlgo TKBO TKG2d TKBool TKPrim TKGeomAlgo TKGeomBase"}

# ── resolve every toolkit BEFORE measuring; any miss is fatal ───────────────────
MISSING=""
for tk in $TOOLKITS; do
    if ! lib="$(find_toolkit "$tk")"; then MISSING="$MISSING $tk"; fi
done
if [ -n "$MISSING" ]; then
    echo "FATAL: toolkit(s) not found in $LIBDIR:$MISSING" >&2
    echo "       A census that skips a toolkit reports needed=0 for it and PROVES NOTHING." >&2
    echo "       Naming conventions tried per toolkit: lib<TK>.dylib, lib<TK>.<ver>.dylib," >&2
    echo "       lib<TK>.so, lib<TK>.so.<ver>, lib<TK>.a." >&2
    echo "       If this OCCT genuinely renamed or merged the toolkit, pass TOOLKITS=..." >&2
    exit 2
fi

# ── provenance: which OCCT was actually measured ────────────────────────────────
OCCT_VER="unknown"
for h in "$LIBDIR/../include/opencascade/Standard_Version.hxx" \
         "$LIBDIR/../../include/opencascade/Standard_Version.hxx"; do
    if [ -f "$h" ]; then
        OCCT_VER="$(sed -n 's/^#define OCC_VERSION_COMPLETE *"\(.*\)".*/\1/p' "$h" | head -1)"
        [ -n "$OCCT_VER" ] || OCCT_VER="unknown"
        break
    fi
done

# A REUSED OUTDIR MUST NOT LEND ITS ANSWERS TO THIS RUN. The old script's
# exclusivity pass guarded each toolkit with `[ -f need_$tk.txt ] || continue`, so
# when a toolkit was MISSING it silently reported the PREVIOUS run's numbers for it.
# Measured while proving this fix: a prefix with libTKOffset deleted still printed
# "TKOffset needed=42 exclusive=42", read from a stale file. Wipe first.
mkdir -p "$OUT"
rm -f "$OUT"/undef.txt "$OUT"/exp_*.txt "$OUT"/need_*.txt "$OUT"/others_*.txt \
      "$OUT"/excl_*.txt
nm -u "$NODE" 2>/dev/null | sed 's/^ *//' | grep -v '^$' | sort -u > "$OUT/undef.txt"
if [ ! -s "$OUT/undef.txt" ]; then
    echo "FATAL: nm -u reported no undefined symbols for $NODE — wrong file type, or nm failed." >&2
    exit 2
fi
echo "binary            : $NODE"
echo "occt lib dir      : $LIBDIR"
echo "occt version      : $OCCT_VER"
echo "undefined symbols : $(wc -l < "$OUT/undef.txt" | tr -d ' ')"
echo

# exports per toolkit
for tk in $TOOLKITS; do
    lib="$(find_toolkit "$tk")"
    nm -gU "$lib" 2>/dev/null | awk 'NF>=3 {print $3} NF==2 {print $2}' | sort -u > "$OUT/exp_$tk.txt"
    if [ ! -s "$OUT/exp_$tk.txt" ]; then
        echo "FATAL: $lib exported no symbols — unreadable or not a library." >&2
        exit 2
    fi
    comm -12 "$OUT/undef.txt" "$OUT/exp_$tk.txt" > "$OUT/need_$tk.txt"
done

# exclusivity: a needed symbol is EXCLUSIVE to tk if no other toolkit exports it
for tk in $TOOLKITS; do
    : > "$OUT/others_$tk.txt"
    for o in $TOOLKITS; do
        [ "$o" = "$tk" ] && continue
        cat "$OUT/exp_$o.txt" >> "$OUT/others_$tk.txt"
    done
    sort -u -o "$OUT/others_$tk.txt" "$OUT/others_$tk.txt"
    comm -23 "$OUT/need_$tk.txt" "$OUT/others_$tk.txt" > "$OUT/excl_$tk.txt"
    c++filt < "$OUT/excl_$tk.txt" > "$OUT/excl_${tk}_demangled.txt"
    printf "%-12s needed=%-5s exclusive=%s\n" "$tk" \
        "$(wc -l < "$OUT/need_$tk.txt" | tr -d ' ')" \
        "$(wc -l < "$OUT/excl_$tk.txt" | tr -d ' ')"
done
