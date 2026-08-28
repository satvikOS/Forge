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
  # rpaths_of FILE -> the file's own LC_RPATH entries, @loader_path expanded.
  # dyld resolves an @rpath/ install name against the LOADING image's rpaths, so a
  # fixed SEARCH list alone is not the documented algorithm (dyld(1), "Run-path
  # dependent libraries"). Consulting them first is what lets this script resolve a
  # binary whose OCCT lives outside every hardcoded prefix.
  rpaths_of() {
    otool -l "$1" 2>/dev/null | awk '
      /cmd LC_RPATH$/ { want=1; next }
      want && $1=="path" { print $2; want=0 }' \
    | sed "s|@loader_path|$(dirname "$1")|g; s|@executable_path|$(dirname "$BIN")|g"
  }
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
  # ELF RUNPATH/RPATH, $ORIGIN expanded, ':' split — the ld.so(8) search order.
  rpaths_of() {
    if command -v objdump >/dev/null; then
      objdump -p "$1" 2>/dev/null | awk '$1=="RUNPATH"||$1=="RPATH"{print $2}'
    else
      readelf -d "$1" 2>/dev/null | sed -n 's/.*(R\(UN\)\?PATH).*\[\(.*\)\]/\2/p'
    fi | tr ':' '\n' | sed "s|\$ORIGIN|$(dirname "$1")|g; s|\${ORIGIN}|$(dirname "$1")|g"
  }
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

# ── UNRESOLVED DEPENDENCIES ARE A HARD ERROR ─────────────────────────────────
# THE DEFECT THIS FIXES (found 2026-08-28). resolve() used to return the RAW
# install name unchanged when it could not find the library on disk. The BFS below
# then hit `[ -f "$cur" ] || continue`, skipped it, and the load graph STOPPED AT
# THE ROOT — so OCCT_CLOSURE silently COLLAPSED ONTO OCCT_DIRECT. The ledger number
# APPEARED TO DROP, with no error printed and no library actually removed.
# REPRODUCED on this repo's own binary: with the OCCT prefix made unreachable the
# script printed CLOSURE 9 (== DIRECT) instead of 14, exit 0.
# A measurement that cannot fail cannot be trusted, so resolve() now returns 1 and
# prints nothing on failure, every failure is recorded, and the script EXITS 2.
#
# ONE EXEMPTION, and it is not a loophole. Since macOS 11 the OS's own libraries
# live only inside the dyld shared cache and have NO file on disk: `ls
# /usr/lib/libSystem.B.dylib` is ENOENT on a healthy machine. A non-existent path
# under /usr/lib or /System is therefore cache-resident, cannot be an OCCT toolkit
# (no libTK* ships there) and cannot pull one in. Those are skipped. On Linux the
# same paths DO exist, so the exemption never fires there. Everything else that
# fails to resolve stops the script.
os_cache_resident() {
  [ "$UNAME" = "Darwin" ] || return 1
  case "$1" in /usr/lib/*|/System/*) return 0 ;; *) return 1 ;; esac
}

resolve() { # resolve RAW OWNER -> EXISTING absolute path on stdout (rc 0), else rc 1
  raw="$1"; owner="$2"; base=""; cand=""
  case "$raw" in
    @rpath/*)           base="${raw#@rpath/}" ;;
    @loader_path/*)     cand="$(dirname "$owner")/${raw#@loader_path/}"
                        [ -f "$cand" ] && { printf '%s\n' "$cand"; return 0; }
                        return 1 ;;
    @executable_path/*) cand="$(dirname "$BIN")/${raw#@executable_path/}"
                        [ -f "$cand" ] && { printf '%s\n' "$cand"; return 0; }
                        return 1 ;;
    /*)                 [ -f "$raw" ] && { printf '%s\n' "$raw"; return 0; }
                        return 1 ;;
    *)                  base="$raw" ;;      # bare soname (Linux)
  esac
  # @rpath / bare soname: the OWNER's own rpaths first (that is what dyld/ld.so do),
  # then the fixed SEARCH list. A here-doc, not a pipe: a `return` inside a piped
  # `while` runs in a SUBSHELL and cannot return from the function — which is the
  # bug the old double-loop above was working around.
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    [ -f "$d/$base" ] && { printf '%s\n' "$d/$base"; return 0; }
  done <<RESOLVE_SEARCH
$(rpaths_of "$owner")
$SEARCH
RESOLVE_SEARCH
  return 1
}

note_unresolved() { # RAW OWNER -> record, unless dyld-shared-cache resident
  os_cache_resident "$1" && return 0
  printf '%s\tneeded by %s\n' "$1" "$2" >> "$TMP/unresolved"
}

die_if_unresolved() { # the gate: an unmeasurable dependency is never a smaller number
  [ -s "$TMP/unresolved" ] || return 0
  {
    echo "FATAL: $(sort -u "$TMP/unresolved" | grep -c .) dependenc(ies) could not be resolved."
    echo "       OCCT_CLOSURE cannot be computed without them and WOULD BE UNDER-REPORTED."
    echo "       This is a hard error on purpose: the old code returned the raw name here,"
    echo "       the BFS skipped it, and the ledger number silently fell to OCCT_DIRECT."
    echo
    sort -u "$TMP/unresolved" | sed 's/^/       /'
    echo
    echo "       searched (owner rpaths first, then):"
    printf '%s\n' "$SEARCH" | sed 's/^/         /'
    echo
    echo "       Fix: set OCCT_LIB_DIR=<dir holding libTK*> (or repair the binary's rpath)."
  } >&2
  exit 2
}

tkname() { # /path/libTKBRep.7.9.dylib -> TKBRep ; libTKBRep.so.7.9 -> TKBRep
  basename "$1" 2>/dev/null | sed -n 's/^lib\(TK[A-Za-z0-9]*\)[.-].*/\1/p'
}

# ── 1. DIRECT records ─────────────────────────────────────────────────────────
: > "$TMP/direct"; : > "$TMP/unresolved"
deps_of "$BIN" | while IFS= read -r raw; do
  [ -n "$raw" ] || continue
  if p="$(resolve "$raw" "$BIN")"; then t="$(tkname "$p")"
  else note_unresolved "$raw" "$BIN"; t="$(tkname "$raw")"; fi
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
    if ! dep="$(resolve "$raw" "$cur")"; then
      note_unresolved "$raw" "$cur"
      continue
    fi
    [ "$dep" = "$cur" ] && continue
    ct="$(tkname "$dep")"; pt="$(tkname "$cur")"
    [ -n "$ct" ] && printf '%s\t%s\n' "$ct" "${pt:-<root>}" >> "$TMP/edges"
    grep -qxF "$dep" "$TMP/seen" || echo "$dep" >> "$TMP/queue"
  done
done
# ★ THE GATE. Every number below is computed from the load graph; if any edge of
#   that graph is missing the graph is not the process's, and no count is emitted.
die_if_unresolved
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
