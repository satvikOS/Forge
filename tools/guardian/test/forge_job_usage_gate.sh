#!/bin/zsh
# forge_job_usage_gate.sh -- asking forge-job what it does must cost milliseconds.
#
# forge-job's argument loop ended in `*) break`, so ANY unrecognised flag fell through
# and was treated as the COMMAND TO RUN. `forge-job --help` therefore reached
#   "$STATE_DIR/bin/forge-gate" --need "$NEED" --wait 900 --why "$NAME"
# and blocked for up to FIFTEEN MINUTES before failing to exec a file called "--help".
#
# Measured 2026-09-16 on the unpatched wrapper: six such processes alive at once
# (`forge-job --help` x4, `forge-job --list`), the oldest at 13m21s, each one an agent
# sitting on a gate slot waiting for a usage string. Two real builds were queued behind
# them. The cost of a typo was a quarter of an hour of wall clock per agent.
#
# HERMETIC: runs against a private FORGE_HEALTH_DIR whose forge-gate is a stub that
# BLOCKS FOREVER. That is the point -- if any usage path reaches the gate, this gate
# hangs and then fails on its own deadline rather than passing by luck on a green box.
set -u
HERE=${0:A:h}
JOB=$HERE/../forge-job
PASS=0; FAIL=0
ok()  { print "  ok   $1"; PASS=$((PASS+1)) }
bad() { print "  FAIL $1"; FAIL=$((FAIL+1)) }

[[ -x $JOB ]] || { print "  FAIL wrapper missing: $JOB"; exit 1 }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/usagegate.XXXXXX") || exit 1
trap 'rm -rf "$WORK"' EXIT INT TERM

# A gate that never returns. Reaching it is the defect this gate exists to catch.
mkdir -p "$WORK/bin" "$WORK/jobs"
cat > "$WORK/bin/forge-gate" <<'STUB'
#!/bin/zsh
print -u2 "STUB-GATE REACHED"
sleep 600
STUB
chmod +x "$WORK/bin/forge-gate"

# Run $JOB with the stubbed health dir, killed after `deadline` seconds.
# Prints "TIMEOUT" as the rc when it had to be killed -- zsh has no timeout(1) on macOS.
run_bounded() {
  local deadline=$1; shift
  local out=$WORK/out.$$
  ( FORGE_HEALTH_DIR=$WORK "$JOB" "$@" >"$out" 2>&1 ) &
  local wp=$!
  local waited=0
  while (( waited < deadline )); do
    kill -0 "$wp" 2>/dev/null || break
    sleep 1; waited=$((waited+1))
  done
  if kill -0 "$wp" 2>/dev/null; then
    kill -TERM "$wp" 2>/dev/null; sleep 1; kill -KILL "$wp" 2>/dev/null
    RC=TIMEOUT
  else
    wait "$wp"; RC=$?
  fi
  OUT=$(<"$out")
}

print "== forge-job usage paths must never reach the gate =="

for flag in --help -h help; do
  run_bounded 5 "$flag"
  if [[ $RC == TIMEOUT ]]; then
    bad "'$flag' BLOCKED (it reached the 900s gate -- the measured defect)"
  elif [[ $RC == 0 ]]; then
    ok "'$flag' returns rc=0 promptly"
  else
    bad "'$flag' returned rc=$RC (expected 0)"
  fi
  case "$OUT" in
    *"STUB-GATE REACHED"*) bad "'$flag' called forge-gate; usage must short-circuit before it" ;;
    *usage*|*"forge-job"*) ok "'$flag' printed usage" ;;
    *) bad "'$flag' printed no usage: ${OUT:0:60}" ;;
  esac
done

# An unknown flag is a usage error, NOT a command. Previously it became argv[0].
run_bounded 5 --no-such-flag -- /bin/true
if [[ $RC == TIMEOUT ]]; then
  bad "an unknown flag BLOCKED at the gate instead of failing fast"
elif [[ $RC == 2 ]]; then
  ok "an unknown flag exits 2 without touching the gate"
else
  bad "an unknown flag returned rc=$RC (expected 2)"
fi
case "$OUT" in
  *"STUB-GATE REACHED"*) bad "an unknown flag reached forge-gate" ;;
  *"unknown option"*)    ok "the unknown flag is NAMED in the error" ;;
  *)                     bad "the error does not name the offending flag: ${OUT:0:60}" ;;
esac

# No command at all is also a usage error and must not gate.
run_bounded 5 --name x --peak-gb 1
if [[ $RC == 2 ]]; then ok "no command exits 2"
elif [[ $RC == TIMEOUT ]]; then bad "no command BLOCKED at the gate"
else bad "no command returned rc=$RC (expected 2)"; fi

# THE OTHER SIDE. A real invocation MUST still consult the gate -- a wrapper that
# skips it would pass every check above while destroying the thing forge-job is for.
run_bounded 6 --name real --peak-gb 1 -- /bin/true
case "$OUT" in
  *"STUB-GATE REACHED"*) ok "a REAL job still consults the gate (the fix did not bypass it)" ;;
  *) bad "a real job did NOT reach the gate -- registration/gating has been bypassed" ;;
esac

print ""
print "RESULT: $PASS passed, $FAIL failed"
(( FAIL == 0 ))
