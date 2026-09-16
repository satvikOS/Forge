#!/usr/bin/env bash
# occt_closure_count.sh — the OCCT-zero ledger number. Reports BOTH counts so the
# ledger can never again "improve" by hiding a dependency behind another library.
#
# WHY THIS EXISTS
# ---------------
# `otool -L | grep -c opencascade` counts LC_LOAD_DYLIB RECORDS — what the linker wrote
# into the binary's header. It does NOT count what actually loads into the process.
# A toolkit removed from OCCT_LIBS keeps loading if any still-linked toolkit DT_NEEDs it,
# and on macOS the .node is linked `-undefined dynamic_lookup`, so the kernel can CALL
# that toolkit's symbols with no link record at all. Both effects make the direct count
# fall while the process is unchanged. Measured 2026-07-31: direct 8, true closure 14.
#
# THREE NUMBERS, in increasing honesty:
#   OCCT_DIRECT   LC_LOAD_DYLIB / DT_NEEDED records naming a libTK*      (the old, gameable metric)
#   OCCT_CLOSURE  every libTK* that dyld/ld.so actually maps at runtime  (★ THE LEDGER NUMBER)
#   OCCT_PHANTOM  libs in the closure the binary calls symbols from but  (drops that are pure
#                 has NO direct record for — masked usage                 accounting, worth 0)
#
# OCCT_CLOSURE is the number the roadmap quotes. It is monotone: it cannot fall unless a
# library genuinely stops loading. The sacrosanct north star is OCCT_CLOSURE == 0.
#
# WHY A MISSING LIBRARY IS FATAL
# ------------------------------
# That monotonicity is only true while every libTK* in the load graph can actually be
# FOUND on disk. The closure is a BFS that expands a dependency only if it resolves to a
# real file, so a single unresolvable OCCT dependency truncates the search at the binary
# itself and OCCT_CLOSURE silently collapses onto OCCT_DIRECT — MEASURED here, 14 -> 8,
# with exit 0 and no warning. A Homebrew upgrade that changes the install-name, a
# relocated OCCT, or a host with no OCCT at all would each have "improved" the one number
# this programme measures progress by. resolve() therefore treats an unlocatable libTK*
# as a HARD ERROR (exit 2) and prints what it searched. Never a fallback.
#
# usage:
#   bash scripts/occt_closure_count.sh [BINARY] [--json] [--quiet]
#                                      [--assert-closure N] [--assert-direct N] [--assert-no-phantom]
#   BINARY defaults to build/Release/forge-kernel.node (or $FORGE_KERNEL).
#
# exit: 0 ok / 1 an --assert threshold was exceeded / 2 binary, toolchain, or an OCCT
#       library named in the load graph is missing (the closure would be fabricated).
#
# NB: no `set -e` — nm/grep return 1 on empty matches, which is a legitimate result here.
set -uo pipefail

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
KROOT="$(cd "$SELF_DIR/.." && pwd)"

BIN=""; JSON=0; QUIET=0; AS_CLOSURE=""; AS_DIRECT=""; AS_PHANTOM=0
DO_SYMBOLS=0; AS_SYMBOLS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --json)              JSON=1 ;;
    --quiet)             QUIET=1 ;;
    --symbols)           DO_SYMBOLS=1 ;;
    --assert-symbols)    AS_SYMBOLS="${2:?--assert-symbols needs N}"; DO_SYMBOLS=1; shift ;;
    --assert-closure)    AS_CLOSURE="${2:?--assert-closure needs N}"; shift ;;
    --assert-direct)     AS_DIRECT="${2:?--assert-direct needs N}";  shift ;;
    --assert-no-phantom) AS_PHANTOM=1 ;;
    -h|--help)           sed -n '2,30p' "$0"; exit 0 ;;
    -*)                  echo "unknown flag: $1" >&2; exit 2 ;;
    *)                   BIN="$1" ;;
  esac
  shift
done
# THE LEDGER MUST MEASURE AN ARTIFACT THAT EXISTS.
# This defaulted to build/Release/forge-kernel.node, which THIS TREE DOES NOT BUILD --
# build/Release/ holds only libforge_kernel_core.dylib. Every invocation without an
# explicit BINARY therefore died "FATAL: binary not found", and tkoffset_ledger_gate.sh
# calls this script, so the gate the programme quotes its OCCT numbers from had nothing
# to measure. Measured 2026-09-16: the dylib carries 546 OCCT symbols across 10 toolkits
# while the ledger reported on a file that is not in the tree. The header's own warning
# about "the stale-artifact trap" was about exactly this and it happened anyway.
# So: prefer an artifact that IS present, in build order, and if none is, name every
# path that was tried rather than the one that happened to be first.
if [ -z "$BIN" ] && [ -n "${FORGE_KERNEL:-}" ]; then BIN="$FORGE_KERNEL"; fi
if [ -z "$BIN" ]; then
  for cand in "$KROOT/build/Release/libforge_kernel_core.dylib" \
              "$KROOT/build/libforge_kernel_core.dylib" \
              "$KROOT/build-app/libforge_kernel_core.dylib" \
              "$KROOT/build/Release/libforge_kernel_core.so" \
              "$KROOT/build/Release/forge-kernel.node"; do
    [ -f "$cand" ] && { BIN="$cand"; break; }
  done
fi
if [ -z "$BIN" ] || [ ! -f "$BIN" ]; then
  {
    echo "FATAL: no kernel artifact to measure."
    [ -n "$BIN" ] && echo "  requested: $BIN"
    echo "  tried:"
    for cand in "$KROOT/build/Release/libforge_kernel_core.dylib" \
                "$KROOT/build/libforge_kernel_core.dylib" \
                "$KROOT/build-app/libforge_kernel_core.dylib" \
                "$KROOT/build/Release/libforge_kernel_core.so" \
                "$KROOT/build/Release/forge-kernel.node"; do
      printf '    %-58s %s\n' "$cand" "$([ -f "$cand" ] && echo present || echo absent)"
    done
    echo
    echo "  A ledger that measures a missing artifact reports no progress and no regression."
    echo "  Build the kernel, or pass the artifact explicitly / set FORGE_KERNEL."
  } >&2
  exit 2
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
UNAME="$(uname -s)"

# ── platform primitives ───────────────────────────────────────────────────────
# deps_of FILE  -> one raw dependency install-name / soname per line
# undef_of FILE -> undefined symbol names, leading '_' stripped (macOS mangling)
if [ "$UNAME" = "Darwin" ]; then
  command -v otool >/dev/null || { echo "FATAL: otool not found (need Xcode CLT)" >&2; exit 2; }
  deps_of() {
    # LC_LOAD_DYLIB / WEAK / REEXPORT / UPWARD all cause a load at run time.
    otool -l "$1" 2>/dev/null | awk '
      /cmd LC_(LOAD_DYLIB|LOAD_WEAK_DYLIB|REEXPORT_DYLIB|LOAD_UPWARD_DYLIB)$/ { want=1; next }
      want && $1=="name" { print $2; want=0 }'
  }
  undef_of() { nm -u "$1" 2>/dev/null | sed 's/^[[:space:]]*//; s/^_//' | grep -v '^$' | sort -u; }
  exports_of() { nm -gU "$1" 2>/dev/null | awk '$2=="T"||$2=="D"||$2=="S"||$2=="B"{print $3}' \
                 | sed 's/^_//' | grep -v '^$' | sort -u; }
else
  # Linux (the strict-link CI). objdump/readelf for records, ldd for the real closure.
  command -v objdump >/dev/null || command -v readelf >/dev/null \
    || { echo "FATAL: need objdump or readelf" >&2; exit 2; }
  deps_of() {
    if command -v objdump >/dev/null; then
      objdump -p "$1" 2>/dev/null | awk '$1=="NEEDED"{print $2}'
    else
      readelf -d "$1" 2>/dev/null | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p'
    fi
  }
  undef_of()   { nm -D --undefined-only "$1" 2>/dev/null | awk '{print $NF}' | grep -v '^$' | sort -u; }
  exports_of() { nm -D --defined-only   "$1" 2>/dev/null | awk '{print $NF}' | grep -v '^$' | sort -u; }
fi

# search path for resolving @rpath / bare sonames
SEARCH="$(dirname "$BIN")
$KROOT/build/Release
/opt/homebrew/opt/opencascade/lib
/opt/homebrew/lib
/usr/local/opt/opencascade/lib
/usr/local/lib
/usr/lib/x86_64-linux-gnu
/usr/lib"
[ -n "${OCCT_LIB_DIR:-}" ] && SEARCH="$OCCT_LIB_DIR
$SEARCH"

tkname() { # /path/libTKBRep.7.9.dylib -> TKBRep ; libTKBRep.so.7.9 -> TKBRep
  basename "$1" 2>/dev/null | sed -n 's/^lib\(TK[A-Za-z0-9]*\)[.-].*/\1/p'
}

# A libTK* that cannot be located is FATAL, never a fallback. See the "WHY A
# MISSING LIBRARY IS FATAL" note in the header: an unresolved OCCT dependency
# truncates the BFS below and makes OCCT_CLOSURE silently collapse onto
# OCCT_DIRECT (14 -> 8 on this machine), i.e. a fabricated drop in THE LEDGER
# NUMBER. resolve() runs inside command substitutions, so it cannot exit the
# script itself; it records the failure and die_if_unresolved() ends the run.
: > "$TMP/unresolved"

resolve() { # resolve RAW OWNER -> absolute path (RAW unchanged for non-OCCT misses)
  raw="$1"; owner="$2"; base=""; out=""
  case "$raw" in
    @rpath/*)           base="${raw#@rpath/}" ;;
    @loader_path/*)     out="$(dirname "$owner")/${raw#@loader_path/}" ;;
    @executable_path/*) out="$(dirname "$BIN")/${raw#@executable_path/}" ;;
    /*)                 out="$raw" ;;
    *)                  base="$raw" ;;      # bare soname (Linux)
  esac
  if [ -z "$out" ]; then
    while IFS= read -r d; do
      [ -n "$d" ] || continue
      if [ -f "$d/$base" ]; then out="$d/$base"; break; fi
    done <<EOF
$SEARCH
EOF
  fi
  if [ -n "$out" ] && [ -f "$out" ]; then echo "$out"; return 0; fi
  # Not found. An OCCT toolkit MUST resolve; anything else (libSystem, libc++,
  # a Homebrew leaf) is passed through unchanged as before — it cannot make a
  # libTK* disappear from the closure.
  if [ -n "$(tkname "$raw")" ]; then
    printf '%s\t%s\n' "$raw" "$owner" >> "$TMP/unresolved"
  fi
  echo "$raw"
}

die_if_unresolved() { # $1 = phase name
  [ -s "$TMP/unresolved" ] || return 0
  {
    echo "FATAL: OCCT toolkit librar(ies) named in the load graph could not be located ($1)."
    echo
    echo "  unresolved (dependency <- referenced by):"
    sort -u "$TMP/unresolved" | while IFS="$(printf '\t')" read -r r o; do
      printf '    %-44s <- %s\n' "$r" "$o"
    done
    echo
    echo "  searched:"
    echo "$SEARCH" | while IFS= read -r d; do [ -n "$d" ] && printf '    %s\n' "$d"; done
    echo
    echo "  OCCT_CLOSURE is only meaningful when every libTK* in the load graph resolves."
    echo "  With one missing, the BFS stops at the binary and the closure COLLAPSES onto the"
    echo "  direct count — reporting a drop in THE LEDGER NUMBER that no code change earned."
    echo "  Point the script at the real libraries with OCCT_LIB_DIR=/path/to/occt/lib."
  } >&2
  exit 2
}

# ── 1. DIRECT records ─────────────────────────────────────────────────────────
: > "$TMP/direct"
deps_of "$BIN" | while IFS= read -r raw; do
  [ -n "$raw" ] || continue
  t="$(tkname "$(resolve "$raw" "$BIN")")"
  [ -n "$t" ] && echo "$t"
done | sort -u > "$TMP/direct"
N_DIRECT=$(grep -c . < "$TMP/direct")
die_if_unresolved "direct records"

# ── 2. TRANSITIVE CLOSURE (BFS over the load graph) ───────────────────────────
# seen  = absolute paths already expanded ; edges = "CHILD<TAB>PARENT"
: > "$TMP/seen"; : > "$TMP/edges"; echo "$BIN" > "$TMP/queue"
while [ -s "$TMP/queue" ]; do
  cur="$(head -1 "$TMP/queue")"
  sed '1d' "$TMP/queue" > "$TMP/queue.n" && mv "$TMP/queue.n" "$TMP/queue"
  [ -f "$cur" ] || continue
  grep -qxF "$cur" "$TMP/seen" && continue
  echo "$cur" >> "$TMP/seen"
  deps_of "$cur" | while IFS= read -r raw; do
    [ -n "$raw" ] || continue
    dep="$(resolve "$raw" "$cur")"
    [ "$dep" = "$cur" ] && continue
    ct="$(tkname "$dep")"; pt="$(tkname "$cur")"
    [ -n "$ct" ] && printf '%s\t%s\n' "$ct" "${pt:-<root>}" >> "$TMP/edges"
    grep -qxF "$dep" "$TMP/seen" || echo "$dep" >> "$TMP/queue"
  done
done
die_if_unresolved "transitive closure"
cut -f1 "$TMP/edges" | sort -u > "$TMP/closure"
N_CLOSURE=$(grep -c . < "$TMP/closure")
comm -13 "$TMP/direct" "$TMP/closure" > "$TMP/hidden"
N_HIDDEN=$(grep -c . < "$TMP/hidden")

# ── 3. PHANTOM DIRECTS: closure libs the binary CALLS but does not record ─────
# (on macOS `-undefined dynamic_lookup` masks these; on Linux strict-link they'd fail)
undef_of "$BIN" > "$TMP/undef"
: > "$TMP/phantom"
while IFS= read -r t; do
  [ -n "$t" ] || continue
  lib="$(grep -m1 "/lib${t}[.-]" "$TMP/seen")"
  [ -f "$lib" ] || continue
  exports_of "$lib" > "$TMP/exp"
  n=$(comm -12 "$TMP/undef" "$TMP/exp" | grep -c .)
  [ "$n" -gt 0 ] && printf '%s\t%s\n' "$t" "$n" >> "$TMP/phantom"
done < "$TMP/hidden"
N_PHANTOM=$(grep -c . < "$TMP/phantom")

# ── 4. report ─────────────────────────────────────────────────────────────────
if [ "$JSON" = 1 ]; then
  printf '{"binary":"%s","direct":%d,"closure":%d,"hidden":%d,"phantom":%d,' \
         "$BIN" "$N_DIRECT" "$N_CLOSURE" "$N_HIDDEN" "$N_PHANTOM"
  printf '"direct_libs":[%s],'  "$(sed 's/.*/"&"/' "$TMP/direct"  | paste -sd, - | tr -d '\n')"
  printf '"closure_libs":[%s]}\n' "$(sed 's/.*/"&"/' "$TMP/closure" | paste -sd, - | tr -d '\n')"
elif [ "$QUIET" = 0 ]; then
  echo "== OCCT link accounting: $(basename "$BIN") =="
  echo
  echo "  OCCT_DIRECT  = $N_DIRECT   (LC_LOAD_DYLIB/DT_NEEDED records — gameable, NOT the ledger number)"
  echo "  OCCT_CLOSURE = $N_CLOSURE   ★ libraries that actually LOAD at run time — THE LEDGER NUMBER"
  echo "  OCCT_PHANTOM = $N_PHANTOM   (closure libs whose symbols the binary CALLS with no link record)"
  echo
  echo "  direct  ($N_DIRECT): $(paste -sd' ' - < "$TMP/direct")"
  echo "  closure ($N_CLOSURE): $(paste -sd' ' - < "$TMP/closure")"
  echo
  if [ "$N_HIDDEN" -gt 0 ]; then
    echo "  HIDDEN — in the closure, no direct record. Removing a DIRECT lib that is these"
    echo "  libs' only parent is the ONLY way any of them stops loading:"
    while IFS= read -r t; do
      [ -n "$t" ] || continue
      par=$(awk -F'\t' -v c="$t" '$1==c && $2!="<root>"{print $2}' "$TMP/edges" | sort -u | paste -sd' ' -)
      ph=$(awk -F'\t' -v c="$t" '$1==c{print $2}' "$TMP/phantom")
      note=""; [ -n "$ph" ] && note="  ← CALLED DIRECTLY by the binary ($ph symbols, masked)"
      printf '    %-14s pulled by: %s%s\n' "$t" "${par:-?}" "$note"
    done < "$TMP/hidden"
    echo
  fi
  if [ "$N_PHANTOM" -gt 0 ]; then
    echo "  ⚠ $N_PHANTOM phantom-direct librar(ies). A drop that only converts DIRECT → PHANTOM"
    echo "    leaves OCCT_CLOSURE unchanged and is worth ZERO. Rank drops by OCCT_CLOSURE."
    echo
  fi
fi

# ── 4b. SYMBOL CENSUS ─────────────────────────────────────────────────────────
# OCCT_CLOSURE counts LIBRARIES; this counts SYMBOLS, and they move independently.
# Measured 2026-09-16: closure 14 and direct 11 had been flat for weeks while the real
# surface was 546 symbols over 10 toolkits — and the ladder is so coarse that all nine
# offset families at parity would move closure only 14 -> 13. Worse, per-FILE symbol
# assertions go green on RELOCATION: move a BRepOffsetAPI_* call out of Features.cpp
# into an engine that still speaks OCCT and the file check passes while the dylib total
# is unchanged. Only a total on ONE artifact catches that, so this is the number to
# ratchet.
#
# Intersect against EVERY installed toolkit, not just the load graph: if a migration
# reaches for a toolkit the closure never named, a graph-scoped census would not see it.
symbol_census() {
  : > "$TMP/allexp"
  found=0
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    for f in "$d"/libTK*; do
      [ -f "$f" ] || continue
      case "$f" in *.dSYM*) continue ;; esac
      rp="$(readlink -f "$f" 2>/dev/null || echo "$f")"
      grep -qxF "$rp" "$TMP/seen" 2>/dev/null && continue
      echo "$rp" >> "$TMP/seen"; found=$((found+1))
      t="$(tkname "$rp")"; [ -n "$t" ] || continue
      exports_of "$rp" | sed "s|^|$t\t|" >> "$TMP/allexp"
    done
  done <<EOF
$SEARCH
EOF
  [ "$found" -gt 0 ] || { echo "FATAL: no libTK* found to census" >&2; return 2; }
  undef_of "$BIN" > "$TMP/undef"
  # symbol -> owning toolkit(s); a symbol exported by several toolkits counts ONCE in the
  # total (sort -u on the symbol) but is listed under each owner in the breakdown.
  sort -u "$TMP/allexp" > "$TMP/allexp.s"
  awk -F'\t' 'NR==FNR{u[$0]=1;next} ($2 in u){print $1"\t"$2}' "$TMP/undef" "$TMP/allexp.s" \
    | sort -u > "$TMP/census"
  N_SYM=$(cut -f2 "$TMP/census" | sort -u | wc -l | tr -d ' ')
  return 0
}
: > "$TMP/seen"
N_SYM=0
if [ "$DO_SYMBOLS" = 1 ]; then
  symbol_census || exit 2
  if [ "$JSON" = 1 ]; then
    printf '{"occt_symbols":%s,"by_toolkit":{' "$N_SYM"
    cut -f1 "$TMP/census" | sort | uniq -c | sort -rn \
      | awk '{printf "%s\"%s\":%s", (NR>1?",":""), $2, $1}'
    printf '}}\n'
  elif [ "$QUIET" != 1 ]; then
    echo "  OCCT_SYMBOLS = $N_SYM   ★ undefined symbols the binary takes from OCCT — ratchet THIS"
    echo
    cut -f1 "$TMP/census" | sort | uniq -c | sort -rn \
      | awk '{printf "    %-16s %4s\n", $2, $1}'
    echo
    echo "  A per-file assertion goes green when a symbol RELOCATES between files."
    echo "  This total does not. Baseline it and refuse any commit that raises it."
    echo
  fi
  if [ -n "$AS_SYMBOLS" ] && [ "$N_SYM" -gt "$AS_SYMBOLS" ]; then
    echo "FAIL: OCCT_SYMBOLS=$N_SYM exceeds --assert-symbols $AS_SYMBOLS" >&2
    exit 1
  fi
fi

# ── 5. assertions (for CI / the drop gate) ────────────────────────────────────
RC=0
if [ -n "$AS_CLOSURE" ] && [ "$N_CLOSURE" -gt "$AS_CLOSURE" ]; then
  echo "FAIL: OCCT_CLOSURE=$N_CLOSURE exceeds --assert-closure $AS_CLOSURE" >&2; RC=1
fi
if [ -n "$AS_DIRECT" ] && [ "$N_DIRECT" -gt "$AS_DIRECT" ]; then
  echo "FAIL: OCCT_DIRECT=$N_DIRECT exceeds --assert-direct $AS_DIRECT" >&2; RC=1
fi
if [ "$AS_PHANTOM" = 1 ] && [ "$N_PHANTOM" -gt 0 ]; then
  echo "FAIL: $N_PHANTOM phantom-direct OCCT librar(ies); every used lib must be named on the link line" >&2; RC=1
fi
exit $RC
