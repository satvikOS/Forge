#!/bin/zsh
# test_forge_job_usr1.sh -- Guardian's COOPERATIVE shed must not kill the job.
#
# forge-guardian:260 documents SIGUSR1 as "checkpoint now and reduce your footprint" --
# the polite step before the coercive TERM. The default disposition of SIGUSR1 is
# TERMINATE, so a wrapper that does not trap it dies on the gentlest signal in the
# system and takes the job with it before it can checkpoint.
#
# Measured 2026-09-14 against the unpatched wrapper: rc=158 (128+30), wrapper dead,
# 7 of 12 ticks, no checkpoint. guardian.log recorded the same shape in production --
# "shed sig=USR1 -> job='knowing-v1-lora' pid=78851" at 17:31:57, with the trainer
# logging rc=158 in the same second, and 'measure-red' showing a USR1 at 17:21:22
# followed by a different pid under the same name.
#
# This is why "registered jobs" read 0 all session: jobs registered, were asked to
# checkpoint, and died. Do not let it regress.
set -u
HERE=${0:A:h}
PASS=0; FAIL=0
ok()  { print "  ok   $1"; PASS=$((PASS+1)) }
bad() { print "  FAIL $1"; FAIL=$((FAIL+1)) }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/usr1gate.XXXXXX") || exit 1
trap 'rm -rf "$WORK"' EXIT INT TERM
CHILD=$HERE/usr1_child.sh
[[ -x $CHILD ]] || { print "  FAIL harness child missing: $CHILD"; exit 1 }

# HERMETIC GUARDIAN. forge-job admits a job through "$STATE_DIR/bin/forge-gate"
# and exits 75 (EX_TEMPFAIL) if that refuses or is absent. The first version of
# this gate used the WORKSTATION's installed Guardian, so it passed here and failed
# on every CI runner, which has no ~/.forge-health -- and it reported that as "the
# wrapper DIED on SIGUSR1", because it never checked the job had started. That is a
# harness failure misreported as the defect, which is worse than no gate.
# forge-job honours FORGE_HEALTH_DIR, so give it a private state dir whose gate
# always admits. What is under test is signal forwarding, not admission.
HEALTH=$WORK/health
mkdir -p "$HEALTH/bin" "$HEALTH/jobs"
print '#!/bin/sh\nexit 0' > "$HEALTH/bin/forge-gate"
chmod +x "$HEALTH/bin/forge-gate"

MARK=$WORK/mark
FORGE_HEALTH_DIR=$HEALTH "$HERE/../forge-job" --name usr1-gate --peak-gb 1 --need orange -- "$CHILD" "$MARK" &
WP=$!
sleep 3

# PRECONDITION: the job must be RUNNING before the signal means anything. If it is
# not, this is a harness problem and must never be reported as the SIGUSR1 defect.
if ! grep -q '^tick' "$MARK" 2>/dev/null; then
  wait "$WP" 2>/dev/null; hrc=$?
  print "  HARNESS the job never started (wrapper rc=$hrc) -- NOT evidence about SIGUSR1"
  print "          (75 = forge-job's admission gate refused; check FORGE_HEALTH_DIR)"
  print "[forge-job-usr1] HARNESS FAILURE -- inconclusive, not a pass"
  exit 2
fi
ok "precondition: the job was running before the signal was sent"

kill -USR1 "$WP" 2>/dev/null
sleep 4

if kill -0 "$WP" 2>/dev/null; then ok "the wrapper SURVIVES Guardian's cooperative SIGUSR1"
else bad "the wrapper DIED on SIGUSR1 -- the cooperative shed is lethal again" ; fi

if grep -q GOT_USR1 "$MARK" 2>/dev/null; then ok "the signal REACHED the child, which handled it and continued"
else bad "the child never saw SIGUSR1 -- it is not being forwarded" ; fi

wait "$WP" 2>/dev/null; rc=$?
if [[ $rc == 0 ]]; then ok "the job runs to completion after being shed (rc=0)"
else bad "job exited rc=$rc after a cooperative shed (158 = 128+SIGUSR1 = the defect)" ; fi

if grep -q FINISHED_CLEANLY "$MARK" 2>/dev/null; then ok "the child finished its whole run, not a truncated one"
else bad "the child was cut short" ; fi

print ""
print "[forge-job-usr1] $PASS passed, $FAIL failed"
(( FAIL == 0 )) || exit 1
print "[forge-job-usr1] PASS -- the cooperative shed is cooperative"
