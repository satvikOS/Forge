#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_hlr_perf.sh — build + run the native-HLR occlusion PERF PROBE
# (test/native_hlr_perf.cpp). Pure native (NO OCCT): compiles every
# src/native/**.cpp once, links the probe against the whole set.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL"

CXX="${CXX:-clang++}"
INC="include"
FLAGS="-std=c++20 -O2 -DFORGE_NATIVE_BREP"
JOBS="${JOBS:-$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"
OBJDIR="$(mktemp -d /tmp/forge_hlr_perf.XXXXXX)"
trap 'rm -rf "$OBJDIR"' EXIT
FAIL="$OBJDIR/fail"; : > "$FAIL"

CAP=()
cap() { "$@" & CAP+=("$!"); if [ "${#CAP[@]}" -ge "$JOBS" ]; then wait "${CAP[0]}" 2>/dev/null||true; CAP=("${CAP[@]:1}"); fi; }
drain() { local p; for p in "${CAP[@]:-}"; do [ -n "$p" ] && wait "$p" 2>/dev/null||true; done; CAP=(); }

OBJS=()
compile() { if ! $CXX $FLAGS -I "$INC" -c "$1" -o "$2" 2>"$2.err"; then echo "SRC FAIL: $1"; tail -12 "$2.err"; echo x>>"$FAIL"; fi; }
for src in src/native/*.cpp src/native/*/*.cpp; do
  [ -e "$src" ] || continue
  obj="$OBJDIR/$(echo "$src" | tr '/.' '__').o"; OBJS+=("$obj"); cap compile "$src" "$obj"
done
drain
[ -s "$FAIL" ] && { echo "[hlr-perf] native source compile failed"; exit 1; }

BIN="$OBJDIR/native_hlr_perf"
# shellcheck disable=SC2086
if ! $CXX $FLAGS -I "$INC" test/native_hlr_perf.cpp "${OBJS[@]}" -o "$BIN" 2>"$BIN.err"; then
  echo "[hlr-perf] TEST LINK FAILED:"; tail -40 "$BIN.err"; exit 1
fi
"$BIN" "${1:-3}"; exit $?
