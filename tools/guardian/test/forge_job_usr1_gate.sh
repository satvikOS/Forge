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

MARK=$WORK/mark
"$HERE/../forge-job" --name usr1-gate --peak-gb 1 --need orange -- "$CHILD" "$MARK" &
WP=$!
sleep 3
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
