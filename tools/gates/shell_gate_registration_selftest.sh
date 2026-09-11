#!/usr/bin/env bash
# Proof that shell_gate_registration_ratchet.sh can FAIL.
#
# A ratchet that reports GREEN proves nothing on its own: this repository has
# already shipped a registration check that passed 13/13 because it could not
# fail -- it enumerated by prefix, counted comments as invocations, and a
# `sed | grep -q` under pipefail misread its own matches. The gate it hid,
# occt_lib_resolution_gate, is pinned in ALLOW today because of it.
#
# So: four cases, each driving the real script, not a re-implementation of it.
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
MUT=tools/gates/.ratchet_mutant.sh
PASS=0; FAIL=0
cleanup() { rm -f "$PHANTOM" "$CONSUMER" "$MUT"; }
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
printf '#!/usr/bin/env bash\necho phantom\n' > "$PHANTOM"
printf '#!/usr/bin/env bash\nbash tools/gates/shellgate_probe_gate.sh\n' > "$CONSUMER"
bash "$R" >/dev/null 2>&1; ck "a wired gate is accepted" 0 $?
rm -f "$PHANTOM" "$CONSUMER"

echo "[selftest] 3. a PINNED gate that becomes reachable must turn it RED"
# The ratchet must notice PROGRESS too, or ALLOW silently becomes permanent.
printf '#!/usr/bin/env bash\nbash forge-kernel/test/occt_lib_resolution_gate.sh\n' > "$CONSUMER"
out=$(bash "$R" 2>&1); rc=$?
ck "improvement refused until ALLOW is updated" 1 $rc
case "$out" in *"RED ON AN IMPROVEMENT"*) ck "and it says so" 0 0 ;;
                *) ck "and it says so" 0 1 ;; esac
rm -f "$CONSUMER"

echo "[selftest] 4. the self-exclusion is LOAD-BEARING, not decoration"
# Without it every pinned gate finds its own name in this ratchet's own ALLOW
# list and reports itself wired -- measured collapses and the ratchet becomes a
# permanent phantom GREEN. Delete the WHOLE line: blanking it would break the
# backslash continuation and leave a bare grep reading stdin (measured: hangs).
# Measure the shipped script FIRST. The mutant is a COPY, so it carries the same
# ALLOW list, and nothing excludes a file called .ratchet_mutant.sh -- with it on
# disk even the SHIPPED script sees all five pins named in it and reports
# measured=0. Measured: computing m_ship after writing the mutant gave 0 vs 0 and
# the case failed while the property it tests was perfectly true.
m_ship=$(bash "$R" 2>&1 | sed -n 's/.*measured=\([0-9]*\).*/\1/p')
sed '/--exclude="\$SELF"/d' "$R" > "$MUT"
m_mut=$(bash "$MUT" 2>&1 | sed -n 's/.*measured=\([0-9]*\).*/\1/p')
echo "    shipped measured=$m_ship   without self-exclusion measured=$m_mut"
if [ -n "$m_ship" ] && [ -n "$m_mut" ] && [ "$m_mut" -lt "$m_ship" ]; then
  ck "dropping it hides unwired gates" 0 0
else
  ck "dropping it hides unwired gates" 0 1
fi
rm -f "$MUT"

echo "[selftest] $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
echo "[selftest] GREEN -- the ratchet fails when it should, in both directions"
