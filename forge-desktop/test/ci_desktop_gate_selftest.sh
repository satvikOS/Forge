#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ci_desktop_gate_selftest.sh — prove ci_desktop_gate.sh can FAIL.
#
# ci_desktop_gate.sh is the thing standing between "forge-desktop's gates ran
# and were falsifiable" and a green check. Its own say-so is not evidence, so
# this drives every one of its documented red paths with a STUB run_desktop.sh
# and asserts the exit code each time — plus one green path, without which the
# suite would pass just as well against a script that always exits 1.
#
# Six cases:
#   A  the exact verdict, exit 0                     -> GREEN  (positive control)
#   B  mutation count FELL 17 -> 16, still exit 0    -> RED    (coverage shrank)
#   C  mutation count ROSE 17 -> 18, still exit 0    -> RED    (exact, not a floor)
#   D  a mutation STAYED GREEN, still exit 0         -> RED    (unfalsifiable check)
#   E  the script died, no verdict                   -> RED    (a real failure)
#   F  exit 0 and no verdict line at all             -> RED    (fell out mid-run)
#
# C is the case that matters most to read twice. A check written as ">= 17"
# would pass it, and would then never notice mutation coverage being replaced
# rather than added to. The count is an equality on purpose.
#
# Needs nothing: no OCCT, no SDL2, no compiler, no kernel build. Runs in about a
# second, which is why it goes FIRST in the CI job — a weakened verdict check
# should be red in seconds, not after a twenty-minute macOS build.
#
# Exit codes: 0 all six behaved as documented, 1 otherwise.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/ci_desktop_gate.sh"

if [ ! -f "$GATE" ]; then
  echo "[selftest] ci_desktop_gate.sh is missing at $GATE. RED."; exit 1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/ci_desktop_selftest.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/forge-desktop/test"

V17='[desktop] ALL FORGE DESKTOP GATES PASS, and all 17 mutations proved red-then-green'
V16='[desktop] ALL FORGE DESKTOP GATES PASS, and all 16 mutations proved red-then-green'
V18='[desktop] ALL FORGE DESKTOP GATES PASS, and all 18 mutations proved red-then-green'
STAYED='  forge_desktop_frame_gate mutation 4: STAYED GREEN - the check it targets is unfalsifiable'

BAD=0

# run_case <label> <wanted-exit> <stub-body>
run_case() {
  label="$1"; want="$2"; body="$3"
  {
    echo '#!/usr/bin/env bash'
    printf '%s\n' "$body"
  } > "$WORK/forge-desktop/test/run_desktop.sh"
  FORGE_DESKTOP_ROOT="$WORK" FORGE_DESKTOP_GATE_LOG="$WORK/gate.log" \
    bash "$GATE" > "$WORK/out.log" 2>&1
  rc=$?
  if [ "$rc" -eq "$want" ]; then
    printf '  PASS  %-44s exit %d (wanted %d)\n' "$label" "$rc" "$want"
  else
    printf '  FAIL  %-44s exit %d (wanted %d)\n' "$label" "$rc" "$want"
    sed 's/^/        /' "$WORK/out.log"
    BAD=$((BAD+1))
  fi
}

echo "[selftest] driving ci_desktop_gate.sh against stub run_desktop.sh scripts"

run_case "A exact verdict, exit 0 -> GREEN" 0 "echo \"$V17\"
exit 0"

run_case "B count FELL 17 -> 16, exit 0" 1 "echo \"$V16\"
exit 0"

run_case "C count ROSE 17 -> 18, exit 0" 1 "echo \"$V18\"
exit 0"

run_case "D a mutation STAYED GREEN, exit 0" 1 "echo \"$STAYED\"
echo \"$V17\"
exit 0"

run_case "E script failed, no verdict" 1 "echo '[desktop] app build FAILED'
exit 1"

run_case "F exit 0, no verdict line at all" 1 "echo '[desktop] built forge_desktop + 3 headless gates'
exit 0"

# G: the gate must not report GREEN when the script it judges is not there. A
# check that could not run is not a check that passed.
rm -f "$WORK/forge-desktop/test/run_desktop.sh"
FORGE_DESKTOP_ROOT="$WORK" FORGE_DESKTOP_GATE_LOG="$WORK/gate.log" \
  bash "$GATE" > "$WORK/out.log" 2>&1
rc=$?
if [ "$rc" -eq 1 ]; then
  printf '  PASS  %-44s exit %d (wanted %d)\n' "G run_desktop.sh absent" "$rc" 1
else
  printf '  FAIL  %-44s exit %d (wanted %d)\n' "G run_desktop.sh absent" "$rc" 1
  sed 's/^/        /' "$WORK/out.log"
  BAD=$((BAD+1))
fi

echo
if [ "$BAD" -ne 0 ]; then
  echo "[selftest] $BAD case(s) did not behave as documented. RED."
  exit 1
fi
echo "[selftest] all 7 cases behaved as documented — ci_desktop_gate.sh's green is falsifiable"
