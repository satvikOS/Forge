#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_surface_round_trip.sh — the SURFACE value kind, proved ACROSS the seam.
#
# forge::ui prints `%N = OP(...)`; forge::ft::parse() reads it. Each half has its
# own gate and each half's gate compares it against its own transcription of the
# grammar — which is exactly the arrangement in which both can be green while the
# two disagree with each other. This links the REAL kernel parser against the REAL
# UI printer and makes them exchange every surface statement.
#
# Same link trick as build_s0_acceptance.sh, and for the same reason: parse() is
# pure std C++ but shares a translation unit with compile(), which pulls the whole
# OCCT-backed kernel. The test never calls compile(), so those symbols are left
# unresolved rather than the source being refactored around this gate.
#
# Exit 0 iff every statement the UI can print parses in the kernel to the op the
# UI thinks it is.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 2
KERNEL="$(cd "$HERE/../.." && pwd)" || exit 2
REPO="$(cd "$KERNEL/.." && pwd)" || exit 2
[ -n "$REPO" ] || { echo "[surface-rt] repo root resolved to the empty string"; exit 2; }
OUT="${OUT:-$KERNEL/test/ft/.surfacebuild}"
mkdir -p "$OUT" || exit 2

# Search the usual prefixes rather than assuming one (a hardcoded Homebrew path
# made a sibling suite unrunnable on the Linux box CI actually runs on).
if [ -z "${OCCT_INC:-}" ]; then
  for _c in /opt/homebrew/include/opencascade \
            /opt/homebrew/opt/opencascade/include/opencascade \
            /usr/local/opt/opencascade/include/opencascade \
            /usr/include/opencascade \
            /usr/local/include/opencascade ; do
    [ -d "$_c" ] && { OCCT_INC="$_c"; break; }
  done
fi
OCCT_INC="${OCCT_INC:-}"
if [ -z "$OCCT_INC" ] || [ ! -d "$OCCT_INC" ]; then
  echo "OCCT headers not found. Set OCCT_INC=/path/to/include/opencascade" >&2
  exit 2
fi

CXX="${CXX:-clang++}"
FLAGS=(-std=c++20 -O0 -g -Wall
       -I"$KERNEL/include" -I"$REPO/ui/include" -I"$OCCT_INC"
       -I"$KERNEL/3rdParty/planegcs" -I"$KERNEL/3rdParty/planegcs_eigen_shim")

echo "[1/4] compile forge::ft TU (parser + compiler)"
"$CXX" "${FLAGS[@]}" -c "$KERNEL/src/ft/FeatureTreeCompiler.cpp" -o "$OUT/FeatureTreeCompiler.o" || exit 2

echo "[2/4] compile forge::ft graph audit"
"$CXX" "${FLAGS[@]}" -Wextra -c "$KERNEL/src/ft/GraphAudit.cpp" -o "$OUT/GraphAudit.o" || exit 2

echo "[3/4] compile forge::ui feature-IR printer"
"$CXX" "${FLAGS[@]}" -Wextra -c "$REPO/ui/src/FeatureIr.cpp" -o "$OUT/FeatureIr.o" || exit 2

echo "[4/4] compile + link the round-trip gate"
"$CXX" "${FLAGS[@]}" -c "$HERE/surface_round_trip_test.cpp" -o "$OUT/surface_round_trip_test.o" || exit 2

case "$(uname -s)" in
  Darwin) UNDEF_FLAGS="-Wl,-undefined,dynamic_lookup" ; UNDEF_EXTRA="-Wl,-no_fixup_chains" ;;
  *)      UNDEF_FLAGS="-Wl,--unresolved-symbols=ignore-all" ; UNDEF_EXTRA="" ;;
esac

"$CXX" -std=c++20 "$OUT/surface_round_trip_test.o" "$OUT/FeatureTreeCompiler.o" \
    "$OUT/GraphAudit.o" "$OUT/FeatureIr.o" -o "$OUT/surface_round_trip" \
    $UNDEF_FLAGS $UNDEF_EXTRA 2>/dev/null || \
"$CXX" -std=c++20 "$OUT/surface_round_trip_test.o" "$OUT/FeatureTreeCompiler.o" \
    "$OUT/GraphAudit.o" "$OUT/FeatureIr.o" -o "$OUT/surface_round_trip" \
    $UNDEF_FLAGS || exit 2

echo
"$OUT/surface_round_trip"
rc=$?
echo
echo "exit=$rc"
exit $rc
