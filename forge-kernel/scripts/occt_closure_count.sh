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
# usage:
#   bash scripts/occt_closure_count.sh [BINARY] [--json] [--quiet]
#                                      [--assert-closure N] [--assert-direct N] [--assert-no-phantom]
#   BINARY defaults to build/Release/forge-kernel.node (or $FORGE_KERNEL).
#
# exit: 0 ok / 1 an --assert threshold was exceeded / 2 binary or toolchain missing.
#
# NB: no `set -e` — nm/grep return 1 on empty matches, which is a legitimate result here.
set -uo pipefail

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
KROOT="$(cd "$SELF_DIR/.." && pwd)"

BIN=""; JSON=0; QUIET=0; AS_CLOSURE=""; AS_DIRECT=""; AS_PHANTOM=0
while [ $# -gt 0 ]; do
  case "$1" in
    --json)              JSON=1 ;;
    --quiet)             QUIET=1 ;;
    --assert-closure)    AS_CLOSURE="${2:?--assert-closure needs N}"; shift ;;
    --assert-direct)     AS_DIRECT="${2:?--assert-direct needs N}";  shift ;;
    --assert-no-phantom) AS_PHANTOM=1 ;;
    -h|--help)           sed -n '2,30p' "$0"; exit 0 ;;
    -*)                  echo "unknown flag: $1" >&2; exit 2 ;;
    *)                   BIN="$1" ;;
  esac
  shift
done
[ -n "$BIN" ] || BIN="${FORGE_KERNEL:-$KROOT/build/Release/forge-kernel.node}"
[ -f "$BIN" ] || { echo "FATAL: binary not found: $BIN" >&2; exit 2; }

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

resolve() { # resolve RAW OWNER -> absolute path (or RAW unchanged if not found)
  raw="$1"; owner="$2"; base=""
  case "$raw" in
    @rpath/*)           base="${raw#@rpath/}" ;;
    @loader_path/*)     echo "$(dirname "$owner")/${raw#@loader_path/}"; return ;;
    @executable_path/*) echo "$(dirname "$BIN")/${raw#@executable_path/}"; return ;;
    /*)                 echo "$raw"; return ;;
    *)                  base="$raw" ;;      # bare soname (Linux)
  esac
  echo "$SEARCH" | while IFS= read -r d; do
    [ -n "$d" ] && [ -f "$d/$base" ] && { echo "$d/$base"; return; }
  done | head -1 | grep -q . && {
    echo "$SEARCH" | while IFS= read -r d; do
      [ -n "$d" ] && [ -f "$d/$base" ] && { echo "$d/$base"; return; }
    done | head -1
    return
  }
  echo "$raw"
}

tkname() { # /path/libTKBRep.7.9.dylib -> TKBRep ; libTKBRep.so.7.9 -> TKBRep
  basename "$1" 2>/dev/null | sed -n 's/^lib\(TK[A-Za-z0-9]*\)[.-].*/\1/p'
}

# ── 1. DIRECT records ─────────────────────────────────────────────────────────
: > "$TMP/direct"
deps_of "$BIN" | while IFS= read -r raw; do
  [ -n "$raw" ] || continue
  t="$(tkname "$(resolve "$raw" "$BIN")")"
  [ -n "$t" ] && echo "$t"
done | sort -u > "$TMP/direct"
N_DIRECT=$(grep -c . < "$TMP/direct")

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
