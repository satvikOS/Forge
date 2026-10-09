#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_op_record_gate.sh — T-132: the op RECORD (provenance, dependencies,
# semantic refs, pre/postconditions, invariants, confidence, units), proved
# kernel-free.
#
# Links the REAL forge::ft parser/compiler TU and leaves every forge::* kernel
# symbol unresolved — the same arrangement build_s0_acceptance.sh and
# build_surface_round_trip.sh use. That is not only a convenience here, it is
# part of the proof: section C calls compile() on trees whose records must be
# REFUSED, and in this binary any refusal that reached a kernel call would die
# on an unresolved symbol instead of returning RECORD_REFUSED.
#
# Exit 0 iff: every program the repo ships is untouched and round-trips; every
# record field round-trips; every op missing a required field — and every other
# refused record — is refused unbuilt; every malformed record is a parse error;
# and the comparisons are shown able to fail.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 2
KERNEL="$(cd "$HERE/../.." && pwd)" || exit 2
REPO="$(cd "$KERNEL/.." && pwd)" || exit 2
[ -n "$REPO" ] || { echo "[op-record] repo root resolved to the empty string"; exit 2; }
OUT="${OUT:-$KERNEL/test/ft/build-oprecord}"   # build-*/ is gitignored
mkdir -p "$OUT" || exit 2

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
# typeinfo for Standard_Failure is a DATA symbol bound at load; see
# build_surface_round_trip.sh for why libTKernel must still be linked.
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
  echo "libTKernel not found; set OCCT_LIB=/path/to/lib" >&2
  exit 2
fi

CXX="${CXX:-clang++}"
FLAGS=(-std=c++20 -O0 -g -Wall -Wextra -Werror
       -I"$KERNEL/include" -I"$OCCT_INC"
       -I"$KERNEL/3rdParty/planegcs" -I"$KERNEL/3rdParty/planegcs_eigen_shim")

echo "[1/2] compile forge::ft TU (parser + emitter + record checks + compiler), -Werror"
"$CXX" "${FLAGS[@]}" -c "$KERNEL/src/ft/FeatureTreeCompiler.cpp" -o "$OUT/FeatureTreeCompiler.o" || exit 2
"$CXX" "${FLAGS[@]}" -c "$KERNEL/src/ft/GraphAudit.cpp" -o "$OUT/GraphAudit.o" || exit 2

echo "[2/2] compile + link the op-record gate"
"$CXX" "${FLAGS[@]}" -DFORGE_REPO_ROOT="\"$REPO\"" -c "$HERE/op_record_gate.cpp" \
    -o "$OUT/op_record_gate.o" || exit 2

case "$(uname -s)" in
  Darwin) UNDEF_FLAGS="-Wl,-undefined,dynamic_lookup" ; UNDEF_EXTRA="-Wl,-no_fixup_chains" ;;
  *)      UNDEF_FLAGS="-Wl,--unresolved-symbols=ignore-all" ; UNDEF_EXTRA="" ;;
esac
"$CXX" -std=c++20 "$OUT/op_record_gate.o" "$OUT/FeatureTreeCompiler.o" "$OUT/GraphAudit.o" \
    -o "$OUT/op_record_gate" -L"$OCCT_LIB" -lTKernel $UNDEF_FLAGS $UNDEF_EXTRA 2>/dev/null || \
"$CXX" -std=c++20 "$OUT/op_record_gate.o" "$OUT/FeatureTreeCompiler.o" "$OUT/GraphAudit.o" \
    -o "$OUT/op_record_gate" -L"$OCCT_LIB" -lTKernel $UNDEF_FLAGS || exit 2

# Every tracked *.ir program in the repository is part of section A's corpus.
IR_FILES="$(git -C "$REPO" ls-files '*.ir' 2>/dev/null | tr '\n' ' ')"
if [ -z "$IR_FILES" ]; then
  IR_FILES="$(cd "$REPO" && find forge-kernel -name '*.ir' -not -path '*/build*' | tr '\n' ' ')"
fi

echo
OP_RECORD_IR_FILES="$IR_FILES" "$OUT/op_record_gate"
rc=$?
echo
echo "exit=$rc"
exit $rc
