#!/usr/bin/env bash
# Proof that shell_gate_registration_ratchet.sh can FAIL.
#
# A ratchet that reports GREEN proves nothing on its own: this repository has
# already shipped a registration check that passed 13/13 because it could not
# fail -- it enumerated by prefix, counted comments as invocations, and a
# `sed | grep -q` under pipefail misread its own matches. The gate it hid,
# occt_lib_resolution_gate, is now WIRED and no longer pinned -- which is why
# case 3 below reads its fixture out of ALLOW instead of naming one.
#
# So: every case drives the real script, not a re-implementation of it.
#
# ROUND 2 (T-185) adds the NEGATIVE CONTROLS the first version lacked. MEASURED on
# b609b41d: a phantom gate plus ONE comment line naming it -- in a workflow, or
# in any .sh -- turned this ratchet GREEN (rc 0). Cases 5-9 pin that shut.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
R=tools/gates/shell_gate_registration_ratchet.sh
# The phantom's name must collide with NOTHING. forge-kernel's own proof creates
# a phantom of its own and requires ITS ratchet to go red; when this file used
# that same phantom name (deliberately not repeated here), the mere MENTION here made the kernel ratchet
# read that phantom as reachable and its proof case stayed GREEN -- this file
# turned the NEIGHBOURING check unfalsifiable. Measured: "mutation 1 stayed
# GREEN -- the ratchet does not detect a new unwired gate", in CI, on green
# local runs. A file that names a gate is indistinguishable from one that runs it.
PHANTOM=tools/gates/shellgate_probe_gate.sh
CONSUMER=tools/gates/phantom_consumer.sh
MIDDLE=tools/gates/phantom_middle.sh
PHWF=.github/workflows/zz_shellgate_selftest_phantom.yml
MUT=tools/gates/.ratchet_mutant.sh
PASS=0; FAIL=0
cleanup() { rm -f "$PHANTOM" "$CONSUMER" "$MIDDLE" "$PHWF" "$MUT"; }
trap cleanup EXIT

ck() { # ck <label> <expected rc> <actual rc>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "    ok   $1"
  else FAIL=$((FAIL+1)); echo "    FAIL $1 (wanted rc $2, got $3)"; fi
}

echo "[selftest] 0. the tree as committed must be GREEN"
bash "$R" >/dev/null 2>&1; ck "clean tree passes" 0 $?

echo "[selftest] 1. a NEW unwired gate must turn it RED"
printf '#!/usr/bin/env bash\necho phantom\n' > "$PHANTOM"
out=$(bash "$R" 2>&1); rc=$?
ck "unwired gate refused" 1 $rc
case "$out" in *shellgate_probe_gate*) ck "and it NAMES the gate" 0 0 ;;
                *) ck "and it NAMES the gate" 0 1 ;; esac
rm -f "$PHANTOM"

echo "[selftest] 2. wiring the phantom up must make it GREEN again"
# Wired means: a workflow runs a script that runs the gate. A consumer script
# that NOTHING runs is case 7, and must stay red.
printf '#!/usr/bin/env bash\necho phantom\n' > "$PHANTOM"
printf '#!/usr/bin/env bash\nbash tools/gates/shellgate_probe_gate.sh\n' > "$CONSUMER"
printf 'name: phantom\non: workflow_dispatch\njobs:\n  p:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bash tools/gates/phantom_consumer.sh\n' > "$PHWF"
bash "$R" >/dev/null 2>&1; ck "a wired gate is accepted (workflow -> script -> gate)" 0 $?
rm -f "$PHANTOM" "$CONSUMER" "$PHWF"

echo "[selftest] 3. a PINNED gate that becomes reachable must turn it RED"
# The ratchet must notice PROGRESS too, or ALLOW silently becomes permanent.
#
# The pinned gate is READ OUT OF THE RATCHET, not named here. This case used to
# hardcode occt_lib_resolution_gate, and when that gate was genuinely wired and
# removed from ALLOW the case stopped testing anything: wiring an UNpinned gate
# is a no-op, so it returned 0 and the selftest failed with "wanted rc 1, got 0".
# A proof that names its own fixture goes stale the moment the fixture is fixed.
PINNED=$(sed -n '/^ALLOW="/,/"$/p' "$R" | sed 's/^ALLOW="//; s/"$//' | grep -v '^$' | head -1)
if [ -z "$PINNED" ]; then
  ck "ALLOW is non-empty so this case can run" 0 1
else
printf 'name: phantom\non: workflow_dispatch\njobs:\n  p:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bash %s\n' "$PINNED" > "$PHWF"
out=$(bash "$R" 2>&1); rc=$?
ck "improvement refused until ALLOW is updated" 1 $rc
case "$out" in *"RED ON AN IMPROVEMENT"*) ck "and it says so" 0 0 ;;
                *) ck "and it says so" 0 1 ;; esac
fi
rm -f "$CONSUMER" "$PHWF"

echo "[selftest] 4. the self-exclusion is LOAD-BEARING, not decoration"
# gate-registration.yml RUNS this ratchet, so without the exclusion the closure
# admits it, and every pinned gate finds its own name in the ALLOW list that
# pins it and reports itself wired. The mutant is a copy beside the original;
# nothing invokes .ratchet_mutant.sh, so its presence cannot mark anything wired.
m_ship=$(bash "$R" 2>&1 | sed -n 's/.*measured=\([0-9]*\).*/\1/p')
sed 's#^EXCLUDED="\$SELF$#EXCLUDED="/excluded-nothing#' "$R" > "$MUT"
if cmp -s "$R" "$MUT"; then
  ck "the self-exclusion mutant changed something" 0 1
else
  m_mut=$(bash "$MUT" 2>&1 | sed -n 's/.*measured=\([0-9]*\).*/\1/p')
  echo "    shipped measured=$m_ship   without self-exclusion measured=$m_mut"
  if [ -n "$m_ship" ] && [ -n "$m_mut" ] && [ "$m_mut" -lt "$m_ship" ]; then
    ck "dropping it hides unwired gates" 0 0
  else
    ck "dropping it hides unwired gates" 0 1
  fi
fi
rm -f "$MUT"

echo "[selftest] 5. ★ NEGATIVE CONTROL: a COMMENT in a workflow is not wiring"
# The measured defect: this exact shape returned rc 0 before T-185.
printf '#!/usr/bin/env bash\necho phantom\n' > "$PHANTOM"
printf '# shellgate_probe_gate is NOT wired yet -- tools/gates/shellgate_probe_gate.sh\nname: phantom\non: workflow_dispatch\njobs:\n  p:\n    runs-on: ubuntu-latest\n    steps:\n      # - run: bash tools/gates/shellgate_probe_gate.sh\n      - run: echo nothing   # shellgate_probe_gate\n' > "$PHWF"
out=$(bash "$R" 2>&1); rc=$?
ck "comment-only mention in a workflow stays RED" 1 $rc
case "$out" in *shellgate_probe_gate*) ck "and it NAMES the gate" 0 0 ;; *) ck "and it NAMES the gate" 0 1 ;; esac
rm -f "$PHWF"

echo "[selftest] 6. ★ NEGATIVE CONTROL: a COMMENT in a script CI runs is not wiring"
printf '#!/usr/bin/env bash\n# TODO: run shellgate_probe_gate one day (bash tools/gates/shellgate_probe_gate.sh)\necho consumer\n' > "$CONSUMER"
printf 'name: phantom\non: workflow_dispatch\njobs:\n  p:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bash tools/gates/phantom_consumer.sh\n' > "$PHWF"
bash "$R" >/dev/null 2>&1; ck "comment-only mention in a CI-run script stays RED" 1 $?
rm -f "$CONSUMER" "$PHWF"

echo "[selftest] 7. a script that NOTHING runs cannot wire a gate (transitive, not one-hop)"
printf '#!/usr/bin/env bash\nbash tools/gates/shellgate_probe_gate.sh\n' > "$CONSUMER"
bash "$R" >/dev/null 2>&1; ck "gate invoked only by an unreachable script stays RED" 1 $?

echo "[selftest] 8. two hops from a workflow IS wiring (the closure is followed)"
printf '#!/usr/bin/env bash\nbash tools/gates/phantom_consumer.sh\n' > "$MIDDLE"
printf 'name: phantom\non: workflow_dispatch\njobs:\n  p:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bash tools/gates/phantom_middle.sh\n' > "$PHWF"
bash "$R" >/dev/null 2>&1; ck "workflow -> middle -> consumer -> gate is accepted" 0 $?
rm -f "$MIDDLE" "$PHWF" "$CONSUMER"

echo "[selftest] 9. comment STRIPPING is load-bearing (mutant: strip() becomes cat)"
printf '#!/usr/bin/env bash\necho phantom\n' > "$PHANTOM"
printf 'name: phantom\non: workflow_dispatch\njobs:\n  p:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo nothing   # shellgate_probe_gate\n' > "$PHWF"
perl -0pe 's/\nstrip\(\) \{\n/\nstrip() { cat "\$1"; return; \n/' "$R" > "$MUT"
if cmp -s "$R" "$MUT"; then
  ck "the stripping mutant changed something" 0 1
else
  # Judge by whether the PHANTOM is listed unwired, not by rc: without stripping,
  # the mutant also reads every comment in the tree, and a pinned gate named in a
  # comment (run_file_dialog_gate.sh, in a kernel-tests.yml comment) then reads as
  # wired and turns it RED for a DIFFERENT reason -- an rc check would pass for it.
  s_out=$(bash "$R" 2>&1); s_rc=$?
  m_out=$(bash "$MUT" 2>&1); m_rc=$?
  s_list=$(printf '%s\n' "$s_out" | grep -c '^    tools/gates/shellgate_probe_gate.sh$')
  m_list=$(printf '%s\n' "$m_out" | grep -c '^    tools/gates/shellgate_probe_gate.sh$')
  echo "    shipped rc=$s_rc lists the phantom unwired: $s_list   without stripping rc=$m_rc lists it: $m_list"
  ck "shipped stays RED on a comment-only mention" 1 $s_rc
  ck "shipped lists the phantom as unwired" 0 $([ "$s_list" -ge 1 ]; echo $?)
  ck "the mutant reads the comment as wiring (so stripping is what holds the line)" 0 $([ "$m_list" -eq 0 ]; echo $?)
fi
rm -f "$MUT" "$PHANTOM" "$PHWF"

echo "[selftest] 10. ★ NEGATIVE CONTROL: a workflow STEP NAME is not wiring"
# MEASURED after the comment fix: this shape still returned rc 0.
printf '#!/usr/bin/env bash\necho phantom\n' > "$PHANTOM"
printf 'name: phantom\non: workflow_dispatch\njobs:\n  p:\n    name: shellgate_probe_gate job\n    runs-on: ubuntu-latest\n    steps:\n      - name: shellgate_probe_gate (to be wired)\n        run: echo nothing\n' > "$PHWF"
bash "$R" >/dev/null 2>&1; ck "a step/job name naming the gate stays RED" 1 $?
rm -f "$PHWF"

echo "[selftest] 11. ★ NEGATIVE CONTROL: an ECHO / PRINTF of the path is not wiring"
printf 'name: phantom\non: workflow_dispatch\njobs:\n  p:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "TODO wire tools/gates/shellgate_probe_gate.sh"\n      - run: |\n          printf "bash tools/gates/shellgate_probe_gate.sh\\n" > /dev/null\n' > "$PHWF"
bash "$R" >/dev/null 2>&1; ck "echo/printf of the gate path stays RED" 1 $?
# ...and the control: an INDIRECT invocation (assign, then run the variable) is
# real wiring and must stay GREEN, or the stripping above went too far.
printf 'name: phantom\non: workflow_dispatch\njobs:\n  p:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          G=tools/gates/shellgate_probe_gate.sh\n          bash "$G"\n' > "$PHWF"
bash "$R" >/dev/null 2>&1; ck "(control) G=<gate>; bash \"\$G\" is accepted" 0 $?
rm -f "$PHANTOM" "$PHWF"

echo "[selftest] $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
echo "[selftest] GREEN -- the ratchet fails when it should, in both directions"
