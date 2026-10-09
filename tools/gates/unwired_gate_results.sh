#!/usr/bin/env bash
# unwired_gate_results.sh — every REGISTERED gate that no CI job executes, as a
# forge.gate_result/v1 NOT_RUN record.
#
#   FORGE_GATE_RESULTS=<file.jsonl> bash tools/gates/unwired_gate_results.sh
#
# WHY (T-185). The two registration ratchets already KNOW which gates never run:
# MEASURED on b609b41d, forge-kernel/test/gate_registration_ratchet.sh pins 51
# (8 *_gate.sh + 8 *_gate.cpp + 35 add_test targets) and the tree-wide shell
# ratchet pins 4 more (5 after T-185 taught it that a comment is not wiring).
# But they say so only in a log line that ends "GREEN". A pinned gate is a gate
# whose verdict is NOT_RUN, and directive §5A asks for NOT_RUN to be a
# machine-readable answer. This turns each pinned entry into exactly that, so a
# consumer that greps the records for a gate finds "NOT_RUN: no CI job executes
# it" instead of finding nothing, which reads like "never heard of it".
#
# It judges nothing itself: the ratchets run as their own CI steps and their
# exit codes stay theirs. This exits 0 when it wrote one valid record per
# unwired gate the ratchets listed, 1 when the count it parsed disagrees with
# the ratchets' own measured= totals (a parsing defect must not shrink the
# list silently), 2 on usage errors.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
GR=tools/gates/gate_result.sh
OUT="${FORGE_GATE_RESULTS:?FORGE_GATE_RESULTS must name the output file}"
KR=forge-kernel/test/gate_registration_ratchet.sh
SR=tools/gates/shell_gate_registration_ratchet.sh
mkdir -p "$(dirname "$OUT")"

KOUT="$(bash "$KR" 2>&1)"; KRC=$?
SOUT="$(bash "$SR" 2>&1)"; SRC=$?

# list <ratchet output> <header text> <header text 2> -> the 4-space-indented
# names under the line containing BOTH fixed strings (no regex: awk -v would eat
# the backslashes, and a header that stops matching must yield a MISMATCH below,
# never a quietly shorter list).
list() {
  printf '%s\n' "$1" | H1="$2" H2="$3" awk '
    index($0, ENVIRON["H1"]) && index($0, ENVIRON["H2"]) { on = 1; next }
    on && /^    / { sub(/^ +/, ""); print; next }
    on            { on = 0 }'
}
sanitize() { printf '%s' "$1" | tr 'A-Z/' 'a-z.' | tr -c 'a-z0-9_.:-' '_'; }

n=0; bad=0
emit_all() {  # emit_all <id prefix> <ratchet path> <ratchet rc> <names...>
  local pre="$1" src="$2" src_rc="$3"; shift 3
  local name
  for name in "$@"; do
    [ -n "$name" ] || continue
    bash "$GR" emit --gate "$pre.$(sanitize "$name")" --kind hard --status NOT_RUN \
      --input "$src" --out "$OUT" \
      --reason "registered gate '$name' is executed by NO CI job ($src lists it; ratchet rc=$src_rc). Pinned there with a reason, or new and unwired." \
      2>/dev/null || bad=$((bad + 1))
    n=$((n + 1))
  done
}

# shellcheck disable=SC2046
IFS=$'\n'
emit_all registered.kernel.sh    "$KR" "$KRC" $(list "$KOUT" 'shell gates (*_gate.sh)'      'not reachable')
emit_all registered.kernel.cpp   "$KR" "$KRC" $(list "$KOUT" 'C++ gates (*_gate.cpp)'       'not reachable')
emit_all registered.kernel.ctest "$KR" "$KRC" $(list "$KOUT" 'CMake-registered (add_test)'  'not reachable')
emit_all registered.sh           "$SR" "$SRC" $(list "$SOUT" 'of those, not executed by'    'anything:')
unset IFS

# The ratchets' own totals. The parsed list must account for every one of them.
want=0
for m in $(printf '%s\n%s\n' "$KOUT" "$SOUT" | sed -n 's/.*measured=\([0-9][0-9]*\).*/\1/p'); do
  want=$((want + m))
done
echo "[unwired-gate-results] kernel ratchet rc=$KRC, shell ratchet rc=$SRC"
echo "[unwired-gate-results] $n NOT_RUN record(s) written to $OUT; the ratchets measured $want unwired"
rc=0
if [ "$n" -ne "$want" ] || [ "$bad" -ne 0 ]; then
  echo "[unwired-gate-results] MISMATCH: parsed $n, ratchets measured $want, $bad emit failure(s) -- the list would shrink silently. RED."
  rc=1
fi
if [ "$n" -gt 0 ]; then
  bash "$GR" validate "$OUT" >/dev/null || { echo "[unwired-gate-results] the records are INVALID"; bash "$GR" validate "$OUT"; rc=1; }
fi
exit "$rc"
