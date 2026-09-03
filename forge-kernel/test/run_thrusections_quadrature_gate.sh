#!/usr/bin/env bash
# run_thrusections_quadrature_gate.sh — build and run thrusections_quadrature_gate
# over the parts whose family-D sections are single circles.
#
# It reuses the corpus_ab object cache (.build-corpus-ab/libforge_native_ab.a), so
# the engine under test is the SAME archive the coverage A/B measures, not a
# separately compiled copy that could drift from it.
#
# usage: test/run_thrusections_quadrature_gate.sh [part ...]
#   with no arguments, sweeps the whole corpus ($CORPUS) and reports only the
#   parts that are not skipped.
# exit: 0 iff the self-test passed and no part came back NATIVE_WRONG.
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
OBJDIR="$KERNEL/.build-corpus-ab"
LIB="$OBJDIR/libforge_native_ab.a"
BIN="$OBJDIR/thrusections_quadrature_gate"
CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"

if [ ! -f "$LIB" ]; then
  echo "FATAL: $LIB missing — run test/build_corpus_ab_coverage.sh first" >&2; exit 2
fi
if ! clang++ -std=c++20 -O2 -DFORGE_NATIVE_BREP -I include -I "$OCCT/include/opencascade" \
     test/thrusections_quadrature_gate.cpp "$LIB" -o "$BIN" \
     -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" \
     -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo -lTKPrim \
     -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset \
     -lTKDESTEP -lTKXSBase 2> "$OBJDIR/quadgate.link.err"; then
  echo "LINK FAILED:" >&2; tail -30 "$OBJDIR/quadgate.link.err" >&2; exit 1
fi

# A gate that cannot fail is not a gate.
"$BIN" --selftest || { echo "SELFTEST FAILED" >&2; exit 1; }

parts=("$@")
if [ "${#parts[@]}" -eq 0 ]; then
  while IFS= read -r f; do parts+=("$(basename "$f" .step)"); done \
    < <(LC_ALL=C find "$CORPUS" -maxdepth 1 -name '*.step' | LC_ALL=C sort)
fi

bad=0; n=0
for p in "${parts[@]}"; do
  out="$("$BIN" "$CORPUS/$p.step" 2>/dev/null)"
  case "$out" in
    *'"skip"'*|'') continue ;;
  esac
  n=$((n + 1))
  echo "$out"
  case "$out" in *NATIVE_WRONG*) bad=$((bad + 1)) ;; esac
done
echo "[quadgate] $n non-skipped part(s), $bad NATIVE_WRONG"
[ "$bad" -eq 0 ]
