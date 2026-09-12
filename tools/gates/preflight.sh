#!/usr/bin/env bash
# preflight.sh — every CHEAP gate CI runs, in one command, before integrating.
#
# WHY THIS EXISTS. The op-vocabulary drift gate has now caught me TWICE with the
# same mistake: forge-desktop/src/ForgeFrame.cpp is provenance sources[0] of
# gen_archie_op_vocabulary.py, so editing it staleds the recorded sha and CI goes
# red on a commit whose actual change was fine. Both times my local verification was
# run_desktop.sh, which does not run the vocabulary check -- and no amount of
# remembering has fixed that, because the gates live in four different trees and
# nothing listed them in one place.
#
# These are the gates that cost SECONDS. The expensive ones (run_desktop.sh,
# run_ui.sh, the kernel suites) still have to run; this exists so the cheap ones
# cannot be the reason a push goes red.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2

FAIL=0
run() {  # run <label> <command...>
  local label="$1"; shift
  if "$@" >/tmp/preflight.$$ 2>&1; then
    printf '  ok   %s\n' "$label"
  else
    FAIL=$((FAIL + 1))
    printf '  FAIL %s\n' "$label"
    sed 's/^/         /' /tmp/preflight.$$ | tail -4
  fi
  rm -f /tmp/preflight.$$
}

echo "[preflight] the cheap gates CI runs"
run "op vocabulary matches its sources" \
    python3 implementation/sacrosanct/tools/gen_archie_op_vocabulary.py --check
run "op constraint table matches the vocabulary" \
    python3 implementation/sacrosanct/tools/gen_op_constraint_table.py --check
run "OCCT removal tracker matches the code" \
    python3 tools/kernel/occt_dependency_graph.py --check
run "every shell gate is wired into CI" \
    bash tools/gates/shell_gate_registration_ratchet.sh
run "every forge-kernel gate is wired into CI" \
    bash forge-kernel/test/gate_registration_ratchet.sh
run "every forge-desktop gate is built AND run" \
    bash forge-desktop/test/gate_registration_check.sh
run "Vec3 is one type, module epsilon guards intact" \
    python3 tools/kernel/vec3_unification_gate.py
run "no conflict markers are committed" \
    sh -c '! git grep -nE "^(<<<<<<< |>>>>>>> )" -- . >/dev/null 2>&1'

if [ "$FAIL" -ne 0 ]; then
  echo "[preflight] RED — $FAIL cheap gate(s) would fail in CI. Fix before integrating."
  exit 1
fi
echo "[preflight] GREEN — the cheap gates pass; the expensive suites still have to run"
