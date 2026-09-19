#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# sparse_ordering_mutation_proof.sh — T-163.
#
# A gate that has never been seen RED is not a gate; it is a green light whose
# wiring nobody checked. This script MUTATES the ordering the sparse solvers use
# and shows that kernel.sparse_ordering (forge_sparse_ordering_bench) turns RED
# for each mutation and GREEN again when the source is restored byte-for-byte.
#
# Two mutations, each aimed at a different way the change could silently rot:
#   A. the DEFAULT ordering quietly reverts to RCM — i.e. somebody undoes the
#      landed decision. The gate must notice.
#   B. AMD is degraded to the identity permutation — i.e. the new ordering is
#      still called but no longer orders anything. The gate must notice that too,
#      because a gate that only watches the DEFAULT would stay green while the
#      thing the default depends on was hollowed out.
#
# It edits src/native/linalg/LinAlg.cpp in place, rebuilds, runs, and restores
# from a backup it takes first (and then verifies the restore with cmp). Run it
# from a clean tree; it is a proof, not part of CI.
#
# Usage:   bash forge-kernel/test/sparse_ordering_mutation_proof.sh
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
K="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$K/src/native/linalg/LinAlg.cpp"
BAK="$(mktemp /tmp/LinAlg.cpp.orig.XXXXXX)"
OCCT_INC="${OCCT_INC:-/opt/homebrew/opt/opencascade/include/opencascade}"
OCCT_LIB="${OCCT_LIB:-/opt/homebrew/opt/opencascade/lib}"
cd "$K"
cp "$SRC" "$BAK"
trap 'cp "$BAK" "$SRC"; rm -f "$BAK"' EXIT

run_gate() {   # $1 = label
  if ! cmake --build build -j "$(forge-nproc)" --target forge_kernel_core \
        > /tmp/t163_mut_build.log 2>&1; then
    echo "=== $1: BUILD FAILED"; tail -20 /tmp/t163_mut_build.log; return 2
  fi
  clang++ -std=c++20 -O2 -I include -I "$OCCT_INC" \
    test/sparse_ordering_bench.cpp -L build -lforge_kernel_core \
    -Wl,-rpath,"$K/build" -Wl,-rpath,"$OCCT_LIB" \
    -o /tmp/t163_mut_bench 2>/dev/null
  /tmp/t163_mut_bench > /tmp/t163_mut.out 2> /tmp/t163_mut.err
  local rc=$?
  echo "=== $1"
  echo "    exit code : $rc  ($([ $rc -eq 0 ] && echo GREEN || echo RED))"
  echo "    [FAIL] lines: $(grep -c '\[FAIL\]' /tmp/t163_mut.err)"
  grep '\[FAIL\]' /tmp/t163_mut.err | head -4 | sed 's/^/    /'
  grep -E 'default/RCM|default beaten by|RCM worse than' /tmp/t163_mut.out | sed 's/^/    /'
  return $rc
}

echo "############ CONTROL (unmutated tree) ############"
run_gate "CONTROL — the tree as it will land"

echo
echo "############ MUTATION A — the default reverts to RCM (what the kernel shipped) ############"
python3 - "$SRC" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = "    if (ord != SparseOrdering::Auto) return evaluate(ord);"
assert s.count(old) == 1, "mutation A anchor not found"
s = s.replace(old, "    if (ord == SparseOrdering::Auto) ord = SparseOrdering::RCM;  // MUTATION A\n" + old)
open(p, 'w').write(s)
print("mutation A applied")
PY
run_gate "MUTATION A — kDefaultSparseOrdering behaves as RCM"
cp "$BAK" "$SRC"

echo
echo "############ MUTATION B — AMD degraded to the identity permutation ############"
python3 - "$SRC" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = "    if (ord == SparseOrdering::AMD) return approximateMinimumDegree(adj);"
assert s.count(old) == 1, "mutation B anchor not found"
s = s.replace(old, "    if (ord == SparseOrdering::AMD) { std::vector<std::size_t> q(n); "
                   "for (std::size_t i = 0; i < n; ++i) q[i] = i; return q; }  // MUTATION B")
open(p, 'w').write(s)
print("mutation B applied")
PY
run_gate "MUTATION B — AMD returns the identity"
cp "$BAK" "$SRC"

echo
echo "############ RESTORED ############"
run_gate "RESTORED — byte-identical to the control"
echo
echo "restored file identical to backup: $(cmp -s "$SRC" "$BAK" && echo YES || echo NO)"
