#!/usr/bin/env bash
# Build + run the SACROSANCT 3.1 Appendix B s0 acceptance tests.
#
# WHY THIS IS NOT A cmake-js TARGET:
# The three laws under test (s0.4 cardinality, s0.5 opaque macros, s0.6 pattern
# occurrence tables) are all PARSE/SCHEMA/GRAPH laws. forge::ft::parse() is pure
# std C++ — it touches no kernel symbol. It just happens to live in the same TU
# as compile(), which does pull the whole OCCT-backed kernel.
#
# So: compile FeatureTreeCompiler.cpp normally (its headers need OCCT headers,
# which are header-only for this TU), and link the test executable with
#   -Wl,-undefined,dynamic_lookup -Wl,-no_fixup_chains
# so the compile()-half's kernel symbols stay unresolved. The test never calls
# compile(), so they are never referenced at run time. This keeps the source
# tree UNTOUCHED — no refactor of FeatureTreeCompiler.cpp, which has large
# uncommitted work in flight in the main checkout.
#
# Exit code is the test's: non-zero means an s0 law is not enforced.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KERNEL="$(cd "$HERE/../.." && pwd)"
OUT="${OUT:-$KERNEL/test/ft/.s0build}"
mkdir -p "$OUT"

OCCT_INC="${OCCT_INC:-/opt/homebrew/include/opencascade}"
if [ ! -d "$OCCT_INC" ]; then
  echo "OCCT headers not found at $OCCT_INC (set OCCT_INC=...)" >&2
  exit 2
fi

CXX="${CXX:-clang++}"
FLAGS=(-std=c++20 -O0 -g -Wall
       -I"$KERNEL/include" -I"$OCCT_INC"
       -I"$KERNEL/3rdParty/planegcs" -I"$KERNEL/3rdParty/planegcs_eigen_shim")

echo "[1/3] compile forge::ft TU (parser + compiler)"
"$CXX" "${FLAGS[@]}" -c "$KERNEL/src/ft/FeatureTreeCompiler.cpp" -o "$OUT/FeatureTreeCompiler.o" || exit 2

echo "[2/3] compile s0 acceptance test"
"$CXX" "${FLAGS[@]}" -c "$HERE/s0_acceptance_test.cpp" -o "$OUT/s0_acceptance_test.o" || exit 2

echo "[3/3] link (kernel symbols left unresolved; compile() is never called)"
"$CXX" -std=c++20 "$OUT/s0_acceptance_test.o" "$OUT/FeatureTreeCompiler.o" \
    -o "$OUT/s0_acceptance" \
    -Wl,-undefined,dynamic_lookup -Wl,-no_fixup_chains 2>/dev/null || \
"$CXX" -std=c++20 "$OUT/s0_acceptance_test.o" "$OUT/FeatureTreeCompiler.o" \
    -o "$OUT/s0_acceptance" \
    -Wl,-undefined,dynamic_lookup || exit 2

echo
"$OUT/s0_acceptance"
rc=$?
echo
echo "exit=$rc"
exit $rc
