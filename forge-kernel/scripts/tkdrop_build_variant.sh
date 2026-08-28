#!/usr/bin/env bash
# tkdrop_build_variant.sh — reconfigure the ALREADY-configured cmake-js build tree
# with a set of -D options and rebuild, then copy the .node aside under a label.
#
# WHY NOT `cmake-js build --CDX=Y`: cmake-js applies --CD defines on CONFIGURE only.
# Passing them to `build` on an already-configured tree is silently ignored — measured
# 2026-08-28: a build with five --CDFORGE_*_DROP_*=ON flags produced a binary with the
# SAME 42 TKOffset symbols and the SAME 777 undefined symbols as the baseline, and the
# cache still read OFF for all five. So the cache is edited with `cmake -D` directly and
# the option state is RE-READ FROM THE CACHE after configure and printed, so a flag that
# did not take is visible instead of being reported as a drop.
#
# usage: bash forge-kernel/scripts/tkdrop_build_variant.sh LABEL -DOPT=ON [-DOPT2=ON ...]
# exit:  0 build OK and every requested option verified ON in the cache; 1 otherwise.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KDIR="$ROOT/forge-kernel"
BDIR="$KDIR/build"
OUTDIR="${TKDROP_OUTDIR:-/tmp/tkdrop}"
PAR="${FORGE_BUILD_PAR:-6}"

LABEL="${1:?LABEL required}"; shift
[ -f "$BDIR/CMakeCache.txt" ] || { echo "FATAL: no configured tree at $BDIR" >&2; exit 2; }
mkdir -p "$OUTDIR"

echo "[variant:$LABEL] reconfiguring with: $*"
cmake -S "$KDIR" -B "$BDIR" "$@" > "$OUTDIR/$LABEL.configure.log" 2>&1
CRC=$?
if [ $CRC -ne 0 ]; then
  echo "[variant:$LABEL] CONFIGURE FAILED rc=$CRC"; tail -30 "$OUTDIR/$LABEL.configure.log"; exit 1
fi

# VERIFY the cache actually holds what was asked for — never trust the flag.
BAD=0
for a in "$@"; do
  case "$a" in
    -D*=*) k="${a#-D}"; k="${k%%=*}"; want="${a#*=}"
           got=$(grep -m1 "^${k}:" "$BDIR/CMakeCache.txt" | cut -d= -f2)
           printf '  cache %-38s want=%-4s got=%s\n' "$k" "$want" "${got:-<absent>}"
           [ "$got" = "$want" ] || BAD=1 ;;
  esac
done
[ $BAD -eq 0 ] || { echo "[variant:$LABEL] FAIL — a requested option did not land in the cache"; exit 1; }

echo "[variant:$LABEL] building (parallel $PAR) ..."
cmake --build "$BDIR" --parallel "$PAR" > "$OUTDIR/$LABEL.build.log" 2>&1
BRC=$?
if [ $BRC -ne 0 ]; then
  echo "[variant:$LABEL] BUILD FAILED rc=$BRC"; tail -40 "$OUTDIR/$LABEL.build.log"; exit 1
fi
cp "$BDIR/Release/forge-kernel.node" "$OUTDIR/forge-kernel.$LABEL.node" || exit 1
echo "[variant:$LABEL] OK -> $OUTDIR/forge-kernel.$LABEL.node"
exit 0
