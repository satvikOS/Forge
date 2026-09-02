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

# Search the usual prefixes instead of assuming one. Hardcoding the Homebrew path made this
# suite unrunnable on Linux, which is where CI runs — it failed with a macOS path in the message.
# Order: explicit override, Apple Silicon brew, Intel brew, Debian/Ubuntu, /usr/local.
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
  echo "OCCT headers not found. Searched the standard prefixes; set OCCT_INC=/path/to/include/opencascade" >&2
  exit 2
fi

CXX="${CXX:-clang++}"
FLAGS=(-std=c++20 -O0 -g -Wall
       -I"$KERNEL/include" -I"$OCCT_INC"
       -I"$KERNEL/3rdParty/planegcs" -I"$KERNEL/3rdParty/planegcs_eigen_shim")

# ---- ONE OCCT LIBRARY, AND ONLY BECAUSE IT IS A *DATA* SYMBOL ---------------
# FeatureTreeCompiler.cpp now catches Standard_Failure (an OCCT raise is not a
# std::exception, and letting one escape is what aborted forge_verify seven times
# during a 600-row run on 2026-09-01). A catch clause references `typeinfo for
# Standard_Failure`, and THAT is the difference that matters here: the ~20
# forge::* symbols this harness leaves unresolved are FUNCTIONS, which
# -undefined dynamic_lookup never has to resolve because they are never called.
# A typeinfo is a data symbol bound EAGERLY at load, so the binary aborted before
# main with `dyld: symbol not found in flat namespace '__ZTI16Standard_Failure'`
# -- exit 134, no test output at all. The two kinds of undefined symbol are not
# interchangeable, and the linker flag only covers one of them.
#
# So link the ONE OCCT library that defines it. TKernel is OCCT's foundation
# (Standard_Failure, Standard_Transient) and pulls in no modelling code; the
# gate's premise -- that the forge::* kernel half stays unlinked and uncalled --
# is untouched.
if [ -z "${OCCT_LIB:-}" ]; then
  for _l in "$(dirname "$OCCT_INC")/../lib" \
            /opt/homebrew/lib /opt/homebrew/opt/opencascade/lib \
            /usr/local/opt/opencascade/lib /usr/lib/x86_64-linux-gnu \
            /usr/local/lib /usr/lib ; do
    for _e in dylib so ; do
      [ -e "$_l/libTKernel.$_e" ] && { OCCT_LIB="$(cd "$_l" && pwd)"; break 2; }
    done
  done
fi
if [ -z "${OCCT_LIB:-}" ]; then
  # Refuse rather than fall back to a link that dies at load with no output. A
  # check that could not run is not a check that passed.
  echo "libTKernel not found next to $OCCT_INC or in the standard prefixes." >&2
  echo "It defines typeinfo for Standard_Failure, which this TU now needs at LOAD" >&2
  echo "time. Set OCCT_LIB=/path/to/lib (the directory holding libTKernel)." >&2
  exit 2
fi

echo "[1/5] compile forge::ft TU (parser + compiler)"
"$CXX" "${FLAGS[@]}" -c "$KERNEL/src/ft/FeatureTreeCompiler.cpp" -o "$OUT/FeatureTreeCompiler.o" || exit 2

# The chunk/hash chain (SACROSANCT s0.11, Appendix B CHUNK-CORRUPTION) is pure
# std C++ and pulls no kernel symbol at all — it compiles with -Wextra clean.
echo "[2/5] compile forge::ft chunk chain (s0.11)"
"$CXX" "${FLAGS[@]}" -Wextra -c "$KERNEL/src/ft/ChunkChain.cpp" -o "$OUT/ChunkChain.o" || exit 2

# SHA-256 (FIPS 180-4) now lives in forge::native::util so the storage governor
# can hash its plan receipts without a second copy of the algorithm.
# forge::ft::sha256Hex delegates to it, so the NIST vectors below still test it.
echo "[2b/5] compile forge::native::util SHA-256"
"$CXX" "${FLAGS[@]}" -Wextra -c "$KERNEL/src/native/util/Sha256.cpp" -o "$OUT/Sha256.o" || exit 2

echo "[3/5] compile forge::ft graph-quality gate (s0.4)"
"$CXX" "${FLAGS[@]}" -Wextra -c "$KERNEL/src/ft/GraphAudit.cpp" -o "$OUT/GraphAudit.o" || exit 2

echo "[4/5] compile s0 acceptance test"
"$CXX" "${FLAGS[@]}" -c "$HERE/s0_acceptance_test.cpp" -o "$OUT/s0_acceptance_test.o" || exit 2

echo "[5/5] link (kernel symbols left unresolved; compile() is never called)"
# ---------------------------------------------------------------------------------------------
# Undefined-symbol policy, per platform.
#
# The suite exercises parse() and the graph audit only; it never calls compile(), so
# FeatureTreeCompiler.o legitimately references ~20 forge::* kernel symbols (massProperties,
# tessellate, makeCylinder, faceInventory, ...) that this harness does not link. Apple's ld
# tolerates that with -undefined dynamic_lookup. GNU ld does NOT — it treats every unresolved
# reference as a hard error — so the identical source linked on macOS and failed on Linux with
# 20+ "undefined reference to `forge::...'" lines. That is why this gate was red in CI while
# green locally.
#
# Each linker gets its equivalent flag. The better long-term fix is to split parse() into its own
# translation unit so the link is honest and complete; that refactor is deliberately deferred
# because forge-kernel/src/ft/FeatureTreeCompiler.cpp carries large uncommitted work in the main
# checkout (see implementation/sacrosanct/RECONCILIATION_OWED.md) and the edit would conflict.
case "$(uname -s)" in
  Darwin) UNDEF_FLAGS="-Wl,-undefined,dynamic_lookup" ; UNDEF_EXTRA="-Wl,-no_fixup_chains" ;;
  *)      UNDEF_FLAGS="-Wl,--unresolved-symbols=ignore-all" ; UNDEF_EXTRA="" ;;
esac

"$CXX" -std=c++20 "$OUT/s0_acceptance_test.o" "$OUT/FeatureTreeCompiler.o" "$OUT/ChunkChain.o" "$OUT/GraphAudit.o" "$OUT/Sha256.o" \
    -o "$OUT/s0_acceptance" \
    -L"$OCCT_LIB" -lTKernel \
    $UNDEF_FLAGS $UNDEF_EXTRA 2>/dev/null || \
"$CXX" -std=c++20 "$OUT/s0_acceptance_test.o" "$OUT/FeatureTreeCompiler.o" "$OUT/ChunkChain.o" "$OUT/GraphAudit.o" "$OUT/Sha256.o" \
    -o "$OUT/s0_acceptance" \
    -L"$OCCT_LIB" -lTKernel \
    $UNDEF_FLAGS || exit 2

echo
"$OUT/s0_acceptance"
rc=$?
echo
echo "exit=$rc"
exit $rc
