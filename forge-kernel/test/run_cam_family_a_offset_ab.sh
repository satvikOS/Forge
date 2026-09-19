#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_cam_family_a_offset_ab.sh — build and run TKOffset family A's gate + A/B.
#
# The old two-binaries-separated-by-a-macro construction is gone with the macro:
# src/Cam.cpp no longer has an OCCT branch, so both arms now live in ONE binary
# (the shipped forge::cam::inwardOffset, and test/cam_family_a_occt_oracle.hpp
# holding the deleted OCCT block verbatim).
#
# ★ THE ARMS ARE PROVED TO DIFFER before any number is believed, in the only way
#   that is still meaningful here: the SHIPPED object (src/Cam.cpp compiled
#   alone, exactly as the kernel library compiles it) must have ZERO undefined
#   TKOffset symbols, while the harness binary must have the oracle's FOUR. A
#   shipped object that still had them would mean the deletion did not happen; a
#   harness that had none would mean the oracle was optimised away and the A/B is
#   comparing the native arm with itself.
#
# usage: test/run_cam_family_a_offset_ab.sh [OUTDIR]
#   env: CORPUS=<dir>  OCCT_ROOT=<prefix>  SELFTEST_ONLY=1  STRIDE=<n>
#        PART_TIMEOUT=<sec, default 30>
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

# Default OUTDIR lives INSIDE .build-corpus-ab because that path is the one the
# root .gitignore:128 already excludes. A new top-level .build-* directory would
# show up as an untracked write and trip the write-set gate.
OUTDIR="${1:-$KERNEL/.build-corpus-ab/cam-familyA}"
CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
STRIDE="${STRIDE:-1}"
PART_TIMEOUT="${PART_TIMEOUT:-30}"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
[ -e "$OCCT/include/opencascade/Standard_Version.hxx" ] || OCCT=/usr/local/opt/opencascade
if [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  echo "FATAL: OCCT not found (set OCCT_ROOT)" >&2; exit 2
fi
mkdir -p "$OUTDIR" || exit 2

CXX="${CXX:-clang++}"
INC="-I $KERNEL/include -I $OCCT/include/opencascade"
FLAGS="-std=c++20 -O2 -DFORGE_NATIVE_BREP"
LIBS="-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
      -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset \
      -lTKDESTEP -lTKXSBase"
SUPPORT="src/ShapeRegistry.cpp src/NativeOcctBridge.cpp"
LIBNAT="$KERNEL/.build-corpus-ab/libforge_native_ab.a"
if [ ! -f "$LIBNAT" ]; then
  echo "[familyA] building the native archive via test/build_corpus_ab_coverage.sh" >&2
  bash "$KERNEL/test/build_corpus_ab_coverage.sh" >/dev/null 2>&1
fi
[ -f "$LIBNAT" ] || { echo "FATAL: no $LIBNAT — a gate that cannot build cannot fail" >&2; exit 1; }

OBJ="$OUTDIR/obj"; mkdir -p "$OBJ"
objs=""
for src in $SUPPORT; do
  o="$OBJ/$(echo "$src" | tr '/.' '__').o"
  $CXX $FLAGS $INC -c "$KERNEL/$src" -o "$o" 2> "$o.err"
  rc=$?
  if [ "$rc" != "0" ]; then echo "COMPILE FAILED: $src" >&2; tail -20 "$o.err" >&2; exit 1; fi
  objs="$objs $o"
done

# ── the SHIPPED object: src/Cam.cpp compiled exactly as the library compiles it
$CXX $FLAGS $INC -c "$KERNEL/src/Cam.cpp" -o "$OBJ/shipped_cam.o" 2> "$OBJ/shipped_cam.err"
rc=$?
if [ "$rc" != "0" ]; then echo "COMPILE FAILED: src/Cam.cpp" >&2; tail -30 "$OBJ/shipped_cam.err" >&2; exit 1; fi

$CXX $FLAGS $INC -c "$KERNEL/test/cam_family_a_offset_ab.cpp" -o "$OBJ/main.o" 2> "$OBJ/main.err"
rc=$?
if [ "$rc" != "0" ]; then echo "COMPILE FAILED: harness" >&2; tail -40 "$OBJ/main.err" >&2; exit 1; fi

BIN="$OUTDIR/cam_family_a_offset_ab"
$CXX $FLAGS $INC "$OBJ/main.o" $objs "$LIBNAT" \
     -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" $LIBS -o "$BIN" 2> "$OBJ/link.err"
rc=$?
if [ "$rc" != "0" ]; then echo "LINK FAILED" >&2; tail -40 "$OBJ/link.err" >&2; exit 1; fi
[ -x "$BIN" ] || { echo "FATAL: no binary after a link that claimed to succeed" >&2; exit 1; }

# ── PROVE THE ARMS DIFFER ────────────────────────────────────────────────────
SHIPPED="$(nm -u "$OBJ/shipped_cam.o" 2>/dev/null | grep -c 'BRepOffsetAPI_MakeOffset')"
HARNESS="$(nm -u "$OBJ/main.o" 2>/dev/null | grep -c 'BRepOffsetAPI_MakeOffset')"
echo "[familyA] BRepOffsetAPI_MakeOffset undefined symbols: shipped src/Cam.cpp.o=$SHIPPED  harness(oracle)=$HARNESS"
if [ "$SHIPPED" != "0" ]; then
  echo "FATAL: src/Cam.cpp still references TKOffset. The deletion did not happen." >&2; exit 3
fi
if [ "$HARNESS" != "4" ]; then
  echo "FATAL: the oracle arm has $HARNESS of the 4 BRepOffsetAPI_MakeOffset symbols." >&2
  echo "       A/B against a missing oracle is the native arm compared with itself." >&2; exit 3
fi

echo "[familyA] === gate ==="
"$BIN" --selftest
GATE=$?
echo "[familyA] gate exit=$GATE"
if [ "${SELFTEST_ONLY:-0}" = "1" ]; then exit "$GATE"; fi
[ -d "$CORPUS" ] || { echo "FATAL: corpus not found: $CORPUS" >&2; exit 2; }

LC_ALL=C find "$CORPUS" -maxdepth 1 -name '*.step' | LC_ALL=C sort \
  | awk -v s="$STRIDE" 'NR % s == 1 || s == 1' > "$OUTDIR/corpus.list"
N="$(wc -l < "$OUTDIR/corpus.list" | tr -d ' ')"
echo "[familyA] $N parts (stride $STRIDE), per-part deadline ${PART_TIMEOUT}s"

# ── ONE PROCESS PER PART, with a real deadline ───────────────────────────────
# macOS ships no coreutils `timeout`, and the OCCT arm is known to run away on a
# handful of corpus parts (MAKEOFFSET_PARITY_2026-08-30.md §6 names 6 that OCCT
# cannot do inside 20 s). A single process over 600 parts would hang on the first
# of them and lose the whole run, so each part is its own process and is killed
# on the deadline. A killed part is recorded as a TIMEOUT row rather than being
# dropped: a part that vanishes from the denominator is how a coverage number
# gets flattered.
: > "$OUTDIR/ab.tsv"
: > "$OUTDIR/ab.err"
HEADER_DONE=0
NTIMEOUT=0
while IFS= read -r part; do
  base="$(basename "$part")"
  "$BIN" "$part" > "$OUTDIR/.one.tsv" 2>> "$OUTDIR/ab.err" &
  pid=$!
  waited=0
  reaped=0
  while [ "$waited" -lt "$((PART_TIMEOUT * 20))" ]; do
    if ! kill -0 "$pid" 2>/dev/null; then reaped=1; break; fi
    perl -e 'select(undef,undef,undef,0.05)'
    waited=$((waited + 1))
  done
  if [ "$reaped" = "0" ]; then
    kill -9 "$pid" 2>/dev/null
    NTIMEOUT=$((NTIMEOUT + 1))
    printf '%s\tTIMEOUT\tTIMEOUT\n' "$base" >> "$OUTDIR/ab.tsv"
    wait "$pid" 2>/dev/null
    continue
  fi
  wait "$pid" 2>/dev/null
  rc=$?
  if [ "$HEADER_DONE" = "0" ]; then
    grep '^# part' "$OUTDIR/.one.tsv" >> "$OUTDIR/ab.tsv"
    HEADER_DONE=1
  fi
  if [ "$rc" != "0" ]; then
    printf '%s\tCRASH\tCRASH\n' "$base" >> "$OUTDIR/ab.tsv"
    continue
  fi
  grep -v '^#' "$OUTDIR/.one.tsv" | grep -v '^TOTAL' >> "$OUTDIR/ab.tsv"
done < "$OUTDIR/corpus.list"

echo "[familyA] timeouts=$NTIMEOUT  rows=$(grep -c . "$OUTDIR/ab.tsv")"
echo "[familyA] TSV: $OUTDIR/ab.tsv"

# ── the PAIRED table (a rate without its discordant pairs is not a result) ───
awk -F'\t' '
  /^#/ { next }
  {
    n++
    nat  = ($2=="OK")
    occt = ($3=="OK")
    if ($2=="TIMEOUT") { to++; next }
    if ($2=="CRASH")   { cr++; next }
    if (nat) no++
    if (occt) oo++
    if (nat && occt) { both++
      if ($30+0 > hdtmax) hdtmax=$30+0
      if ($32+0 > natmsmax) natmsmax=$32+0
      if ($33+0 > occtmsmax) occtmsmax=$33+0
      natms += $32+0; occtms += $33+0
      if ($31+0 > hdcmax) hdcmax=$31+0
      if ($31+0 > 0.05) outside++
      # direction: signed enclosed area of each arm vs the source is not carried
      # here, but the two arms disagreeing in SIGN is visible directly.
      if (($12+0)*($13+0) < 0) signflip++
    }
    else if (occt) { occtonly++; ob = ob " " $1 }
    else if (nat)  { natonly++ }
    else { neither++ }
  }
  END {
    printf "\nparts %d  (timeouts %d, crashes %d)\n", n, to+0, cr+0
    printf "  OCCT oracle ok   %d = %.1f%%\n", oo, 100*oo/n
    printf "  native      ok   %d = %.1f%%\n", no, 100*no/n
    printf "  both %d   native-only %d   OCCT-only (THE DELETION BUCKET) %d   neither %d\n",
           both+0, natonly+0, occtonly+0, neither+0
    if (occtonly) printf "  deletion-bucket parts:%s\n", ob
    printf "  worst two-sided Hausdorff, tight budget    %.6g mm\n", hdtmax+0
    printf "  worst two-sided Hausdorff, consumer budget %.6g mm\n", hdcmax+0
    printf "  both-OK pairs outside the consumer 0.05 mm: %d of %d\n", outside+0, both+0
    printf "  both-OK pairs where the two arms enclose OPPOSITE-signed area: %d\n", signflip+0
    printf "  wall time over both-OK pairs: native %.1f ms total (max %.1f), oracle %.1f ms total (max %.1f)\n", natms+0, natmsmax+0, occtms+0, occtmsmax+0
    printf "  coverage clause: %s\n", (no>=oo ? "PASS (native >= oracle)" : "FAIL")
    printf "  Law 9 clause   : %s\n", (occtonly==0 ? "PASS (deletion bucket empty)" \
                                                   : "FAIL (capability lost on those parts)")
  }' "$OUTDIR/ab.tsv" | tee "$OUTDIR/summary.txt"
exit "$GATE"
