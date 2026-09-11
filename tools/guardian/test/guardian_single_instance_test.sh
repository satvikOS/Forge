#!/bin/zsh
# ============================================================================
# GUARDIAN SINGLE-INSTANCE GATE
#
# Proves that forge-guardian (a) refuses arguments instead of silently starting
# a daemon, and (b) refuses to become a SECOND governor -- without ever failing
# closed, because launchd respawns it every 10s and a wrongly-refused start
# leaves the machine with no governor at all.
#
# Runs entirely against a COPY in a temp root with FORGE_HEALTH_DIR and
# ARCHIE_HEALTH_DIR redirected: it must never touch the live governor's state,
# and never the Law-7 signal at /tmp/archie_health that the training fleet reads.
# ============================================================================
set -u
setopt NULL_GLOB 2>/dev/null || true
SRC=${1:-${0:A:h}/../forge-guardian}
[[ -f "$SRC" ]] || { print -u2 "no guardian at $SRC"; exit 1 }

PASS=0; FAIL=0
ck() { # ck <desc> <cond-exit>
  if (( $2 == 0 )); then (( PASS++ )); print "    ok   $1"
  else (( FAIL++ )); print "    FAIL $1"; fi
}

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/fg_single.XXXXXX")
trap 'kill -9 $WATCHDOG 2>/dev/null; reap; rm -rf "$ROOT"' EXIT

# Every guardian this test starts, so nothing survives the run.
#
# The registry is a FILE as well as an array, because the array alone cannot see
# every pid.  gexec is called as `out=$(gexec --help)` -- a command-substitution
# SUBSHELL -- so an append it makes to STARTED dies with that subshell and the
# parent's reap never learns the pid.  That is the same subshell trap that made the
# guardian's own self-detection count itself, three times over.  A file crosses the
# fork; an array does not.
STARTED=()
PIDFILE="$ROOT/started.pids"
: >"$PIDFILE"
note_pid() { STARTED+=($1); print $1 >>"$PIDFILE" }
reap() {
  local p
  for p in $STARTED; do kill -9 "$p" 2>/dev/null; done
  if [[ -r $PIDFILE ]]; then
    while read -r p; do [[ -n $p ]] && kill -9 "$p" 2>/dev/null; done <"$PIDFILE"
  fi
  return 0
}

# A wall-clock bound on the WHOLE gate.  gexec already bounds one invocation, and
# the EXIT trap already reaps -- but neither runs if the script itself wedges, and
# then every guardian it started stays alive.  That is not hypothetical: one hung
# run left a mutant `forge-guardian --help` daemon (mutation 1 deletes the argv
# check, so --help becomes a daemon) running on the workstation for 10h13m before
# it was found by hand.  The watchdog reads the pid FILE rather than a copy of the
# array taken when it forked, so it reaps pids registered after it started.
GATE_BUDGET=${GATE_BUDGET:-900}
{ sleep "$GATE_BUDGET"
  print -u2 "[single-instance] WALL-CLOCK EXCEEDED (${GATE_BUDGET}s) -- reaping and failing"
  if [[ -r $PIDFILE ]]; then
    while read -r wp; do [[ -n $wp ]] && kill -9 "$wp" 2>/dev/null; done <"$PIDFILE"
  fi
  kill -TERM $$ 2>/dev/null; sleep 2; kill -9 $$ 2>/dev/null
} &
WATCHDOG=$!

mkdir -p "$ROOT/bin"
G="$ROOT/bin/forge-guardian"          # basename must stay exact: self-identification
cp "$SRC" "$G"; chmod +x "$G"

HD="$ROOT/health"; AH="$ROOT/archie"
# A REFUSAL THAT DOES NOT HAPPEN IS A DAEMON THAT NEVER RETURNS. Every check
# below that expects an exit would otherwise hang the whole gate the moment a
# mutation removes the refusal -- and a hang is not a verdict, it is a lost run.
# macOS has no timeout(1), so bound it here: rc 99 means "still running".
GBUDGET=${GBUDGET:-15}
gexec() {
  local lg="$ROOT/ge.log" p i
  FORGE_HEALTH_DIR="$HD" ARCHIE_HEALTH_DIR="$AH" FORGE_GUARDIAN_POLL=1 zsh "$G" "$@" >"$lg" 2>&1 &
  p=$!; note_pid $p
  for i in {1..$(( GBUDGET * 4 ))}; do kill -0 $p 2>/dev/null || break; sleep 0.25; done
  if kill -0 $p 2>/dev/null; then
    kill -9 $p 2>/dev/null; wait $p 2>/dev/null
    cat "$lg"; return 99          # it started a daemon instead of exiting
  fi
  wait $p; local rc=$?
  cat "$lg"; return $rc
}
gspawn() { local lg=$1; shift
  FORGE_HEALTH_DIR="$HD" ARCHIE_HEALTH_DIR="$AH" FORGE_GUARDIAN_POLL=1 zsh "$G" "$@" >"$lg" 2>&1 &
  local q=$!; note_pid $q; print $q }

# how many live processes are running THIS temp copy (never the real one)
# NEEDLE GOES IN THE ENVIRONMENT, NOT IN ARGV: `awk -v g=<path>` puts the path
# in awk's own command line, so the probe counts itself and never returns 0.
ncopies() { ps -axo pid=,args= 2>/dev/null | G="$G" awk 'index($0,ENVIRON["G"])&&$3!="-c"{n++} END{print n+0}' }

run_gate() {  # -> 0 green, 1 red ; prints failures
  PASS=0; FAIL=0
  rm -rf "$HD" "$AH"; mkdir -p "$HD" "$AH"

  # -- C1/C2 argv is rejected and NO daemon is left behind --------------------
  local out rc
  out=$(gexec status); rc=$?
  ck "C1a  'status' exits 2 (got $rc)"                 $(( rc == 2 ? 0 : 1 ))
  ck "C1b  'status' names forge-guardian-ctl"          $(print -r -- "$out" | grep -q 'forge-guardian-ctl'; echo $?)
  sleep 1
  ck "C1c  'status' left no daemon running"            $(( $(ncopies) == 0 ? 0 : 1 ))
  out=$(gexec --help); rc=$?
  ck "C2   '--help' exits 2 (got $rc)"                 $(( rc == 2 ? 0 : 1 ))

  # -- C3 NEGATIVE CONTROL: a clean start must still work ---------------------
  local p1; p1=$(gspawn "$ROOT/d1.log")
  sleep 3
  ck "C3a  clean start stays alive"                    $(kill -0 "$p1" 2>/dev/null; echo $?)
  ck "C3b  clean start took the lock"                  $([[ -d "$HD/guardian.lock" ]]; echo $?)
  ck "C3c  lock records its own pid"                   $([[ "$(cat $HD/guardian.lock/pid 2>/dev/null)" == "$p1" ]]; echo $?)
  ck "C3d  it actually governs (state published)"      $([[ -s "$HD/state" ]]; echo $?)

  # -- C9 a guardian in ANOTHER domain must not block us ----------------------
  # The live launchd guardian is running throughout this test under a different
  # FORGE_HEALTH_DIR. C3 starting at all IS this property; assert it by name.
  ck "C9   another domain's guardian did not block us"  $(kill -0 "$p1" 2>/dev/null; echo $?)

  # -- C4 a second instance is refused ----------------------------------------
  out=$(gexec); rc=$?
  ck "C4a  second instance exits 3 (got $rc)"          $(( rc == 3 ? 0 : 1 ))
  ck "C4b  it says why, and names the domain"          $(print -r -- "$out" | grep -q 'already governing' && print -r -- "$out" | grep -qF "$HD"; echo $?)
  ck "C4c  still exactly one guardian alive"           $(( $(ncopies) == 1 ? 0 : 1 ))
  ck "C4d  the first one is unharmed"                  $(kill -0 "$p1" 2>/dev/null; echo $?)

  # -- C8 the UPGRADE window: running peer, no lock ---------------------------
  rm -rf "$HD/guardian.lock"
  out=$(gexec); rc=$?
  ck "C8a  live peer, no lock: refused (got $rc)"     $(( rc == 3 ? 0 : 1 ))
  ck "C8b  still exactly one guardian alive"            $(( $(ncopies) == 1 ? 0 : 1 ))

  # -- C7 the lock is released on TERM ----------------------------------------
  mkdir -p "$HD/guardian.lock"; print -r -- "$p1" > "$HD/guardian.lock/pid"
  kill -TERM "$p1" 2>/dev/null; sleep 2
  ck "C7a  TERM stopped it"                            $(kill -0 "$p1" 2>/dev/null && echo 1 || echo 0)
  ck "C7b  no guardian left"                           $(( $(ncopies) == 0 ? 0 : 1 ))
  ck "C7c  the lock was released on the way out"       $([[ ! -d "$HD/guardian.lock" ]]; echo $?)
  # An orderly stop must not leave the domain LOOKING governed -- otherwise the
  # replacement waits out the freshness window and every age-based consumer
  # believes a governor is up when none is.
  local pR; pR=$(gspawn "$ROOT/dR.log")           # immediately, no sleep first
  sleep 3
  ck "C7d  a replacement starts AT ONCE after a clean stop" $(kill -0 "$pR" 2>/dev/null; echo $?)
  kill -9 "$pR" 2>/dev/null; sleep 1; rm -rf "$HD/guardian.lock"

  # -- C10 the freshness signal alone, both directions ------------------------
  # Nothing is running here, so only $STATE_F's mtime is under test.
  rm -rf "$HD/guardian.lock"
  touch "$HD/state"                                      # someone is publishing
  out=$(gexec); rc=$?
  ck "C10a fresh state alone refuses (got $rc)"        $(( rc == 3 ? 0 : 1 ))
  touch -t 200001010101 "$HD/state"                      # nobody has for years
  local p0; p0=$(gspawn "$ROOT/d0.log")
  sleep 3
  ck "C10b stale state does NOT block (fail-open)"     $(kill -0 "$p0" 2>/dev/null; echo $?)
  kill -9 "$p0" 2>/dev/null; sleep 1; rm -rf "$HD/guardian.lock"

  # -- C5 FAIL-OPEN: a stale lock (dead pid) must NOT block -------------------
  rm -rf "$HD/guardian.lock"; mkdir -p "$HD/guardian.lock"
  print -r -- "$p1" > "$HD/guardian.lock/pid"          # that pid is now dead
  touch -t 200001010101 "$HD/state"                    # isolate: only the lock is under test
  local p2; p2=$(gspawn "$ROOT/d2.log")
  sleep 3
  ck "C5a  stale lock reclaimed, guardian runs"        $(kill -0 "$p2" 2>/dev/null; echo $?)
  ck "C5b  lock now records the new pid"               $([[ "$(cat $HD/guardian.lock/pid 2>/dev/null)" == "$p2" ]]; echo $?)
  kill -9 "$p2" 2>/dev/null; sleep 1; rm -rf "$HD/guardian.lock"

  # -- C6 FAIL-OPEN: lock held by a LIVE NON-guardian (pid reuse) -------------
  zsh -c 'exec sleep 30' & local sp=$!; note_pid $sp
  mkdir -p "$HD/guardian.lock"; print -r -- "$sp" > "$HD/guardian.lock/pid"
  touch -t 200001010101 "$HD/state"                    # isolate: only the lock is under test
  local p3; p3=$(gspawn "$ROOT/d3.log")
  sleep 3
  ck "C6   live non-guardian in lock is taken over"    $(kill -0 "$p3" 2>/dev/null; echo $?)
  kill -9 "$p3" "$sp" 2>/dev/null; sleep 1

  # -- C12 PID REUSE: a live guardian of ANOTHER domain inherits the number ---
  # Without a recorded start time this refuses for as long as that unrelated
  # process lives -- a permanent fail-closed on a machine with two domains.
  local HD2="$ROOT/health2"; rm -rf "$HD2"; mkdir -p "$HD2"
  FORGE_HEALTH_DIR="$HD2" ARCHIE_HEALTH_DIR="$AH" FORGE_GUARDIAN_POLL=1 zsh "$G" >"$ROOT/d5.log" 2>&1 &
  local p5=$!; note_pid $p5; sleep 2
  rm -rf "$HD/guardian.lock"; mkdir -p "$HD/guardian.lock"
  print -r -- "$p5" > "$HD/guardian.lock/pid"
  print -r -- "Thu Jan  1 00:00:00 1970" > "$HD/guardian.lock/started"   # not its real start
  touch -t 200001010101 "$HD/state"
  local p6; p6=$(gspawn "$ROOT/d6.log")
  sleep 3
  ck "C12  reused pid in the lock is reclaimed"        $(kill -0 "$p6" 2>/dev/null; echo $?)
  kill -9 "$p6" "$p5" 2>/dev/null; sleep 1; rm -rf "$HD/guardian.lock"

  # -- C11 a live peer that has STOPPED PUBLISHING: only the lock can refuse --
  rm -rf "$HD/guardian.lock"; rm -f "$HD/state"
  local p4; p4=$(gspawn "$ROOT/d4.log")
  sleep 2
  ck "C11a setup: it took the lock"                    $([[ "$(cat $HD/guardian.lock/pid 2>/dev/null)" == "$p4" ]]; echo $?)
  kill -STOP "$p4" 2>/dev/null                          # alive, holding the lock, mute
  sleep 5                                               # let $STATE_F age past 3*POLL
  ck "C11b setup: the domain no longer looks governed" $([[ -n "$(find "$HD/state" -mtime +0s 2>/dev/null)" ]] || [[ $(( $(date +%s) - $(stat -f %m "$HD/state") )) -ge 3 ]]; echo $?)
  out=$(gexec); rc=$?
  ck "C11c wedged peer still refused, by the lock alone (got $rc)" $(( rc == 3 ? 0 : 1 ))
  kill -CONT "$p4" 2>/dev/null; kill -9 "$p4" 2>/dev/null; sleep 1

  # -- C14 library mode: forge-guardian-actuator-test SOURCES this file -------
  # It fault-injects the SHIPPED daemon rather than a re-extracted copy, so the
  # acquire path must not run at source time -- it would exit 3 mid-suite,
  # because the real guardian is correctly governing already.
  rm -rf "$HD/guardian.lock"; touch "$HD/state"          # make the domain look governed
  local lrc li lp
  ( FORGE_HEALTH_DIR="$HD" ARCHIE_HEALTH_DIR="$AH" FORGE_GUARDIAN_LIB=1 zsh -c "source '$G'" ) >/dev/null 2>&1 &
  lp=$!; note_pid $lp
  for li in {1..40}; do kill -0 $lp 2>/dev/null || break; sleep 0.25; done
  if kill -0 $lp 2>/dev/null; then kill -9 $lp 2>/dev/null; lrc=99; else wait $lp; lrc=$?; fi
  ck "C14a library-mode source returns 0 (got $lrc)"   $(( lrc == 0 ? 0 : 1 ))
  ck "C14b library mode took no lock"                  $([[ ! -d "$HD/guardian.lock" ]]; echo $?)
  rm -f "$HD/state"

  # -- C15 AT THE SHIPPED POLL, not the test's -------------------------------
  # Every other check runs FORGE_GUARDIAN_POLL=1, which hides a trap deferred by
  # a foreground `sleep`. At the shipped default of 5 that deferral was MEASURED
  # at 4s, so C7c/C7d were proving a property the shipped configuration did not
  # have. Assert it here with no POLL override at all.
  rm -rf "$HD/guardian.lock"; rm -f "$HD/state"
  local pS w
  FORGE_HEALTH_DIR="$HD" ARCHIE_HEALTH_DIR="$AH" zsh "$G" >"$ROOT/dS.log" 2>&1 &
  pS=$!; note_pid $pS; sleep 3
  ck "C15a setup: running at the shipped default poll"  $(kill -0 "$pS" 2>/dev/null; echo $?)
  ck "C15b setup: it holds the lock"                    $([[ -d "$HD/guardian.lock" ]]; echo $?)
  kill -TERM "$pS" 2>/dev/null
  for w in {1..8}; do [[ -d "$HD/guardian.lock" ]] || break; sleep 0.25; done
  ck "C15c TERM honoured within 2s at the shipped poll" $([[ ! -d "$HD/guardian.lock" ]]; echo $?)
  kill -9 "$pS" 2>/dev/null; sleep 1

  (( FAIL == 0 ))
}

print "[single-instance] clean run"
if run_gate; then print "[single-instance] clean GREEN ($PASS checks)"
else print "[single-instance] clean RED ($FAIL failures) -- gate cannot be trusted"; exit 1; fi
CLEAN_PASS=$PASS

# ============================================================================
# MUTATION PROOF. A mutant only counts if it APPLIED and PARSES.
# A hand-counted heredoc anchor has silently failed to apply twice before, so
# the harness proves the file changed AND still parses before any verdict.
# ============================================================================
apply_mutation() {  # apply_mutation <n> -> edits $G in place, nonzero if it did not apply
  local n=$1
  cp "$SRC" "$G"
  case $n in
    1) python3 - "$G" <<'PY'
import sys; p=sys.argv[1]; s=o=open(p).read()
s = s.replace('if [[ -z "${FORGE_GUARDIAN_LIB:-}" ]] && (( $# > 0 )); then', "if (( 0 )); then", 1)
assert s != o; open(p,"w").write(s)
PY
    ;;
    2) python3 - "$G" <<'PY'
import sys; p=sys.argv[1]; s=o=open(p).read()
s = s.replace('  if is_live_guardian "${holder:-}"; then refuse_duplicate "pid $holder"; fi', "  :", 1)
assert s != o; open(p,"w").write(s)
PY
    ;;
    3) python3 - "$G" <<'PY'
import sys; p=sys.argv[1]; s=o=open(p).read()
s = s.replace('  rm -rf "$LOCK_D" 2>/dev/null\ndone', '  refuse_duplicate "${holder:-stale}"\ndone', 1)
assert s != o; open(p,"w").write(s)
PY
    ;;
    4) python3 - "$G" <<'PY'
import sys; p=sys.argv[1]; s=o=open(p).read()
s = s.replace("if domain_is_governed; then\n  release_lock", "if false; then\n  release_lock", 1)
assert s != o; open(p,"w").write(s)
PY
    ;;
    5) python3 - "$G" <<'PY'
import sys; p=sys.argv[1]; s=o=open(p).read()
s = s.replace("trap 'release_lock' EXIT", "trap - EXIT", 1)
s = s.replace("trap 'release_lock; exit 143' TERM", "trap - TERM", 1)
assert s != o; open(p,"w").write(s)
PY
    ;;
    6) python3 - "$G" <<'PY'
import sys; p=sys.argv[1]; s=o=open(p).read()
s = s.replace("# ---- single instance ---", "# ---- single instance (control) ---", 1)
assert s != o; open(p,"w").write(s)
PY
    ;;
    7) python3 - "$G" <<'PY'
import sys; p=sys.argv[1]; s=o=open(p).read()
s = s.replace("  (( $(date +%s) - mt <= lim ))", "  return 0", 1)
assert s != o; open(p,"w").write(s)
PY
    ;;
    8) python3 - "$G" <<'PY'
import sys; p=sys.argv[1]; s=o=open(p).read()
s = s.replace('  if [[ -n "$held_start" && "$held_start" != "$now_start" ]]; then', "  if false; then", 1)
assert s != o; open(p,"w").write(s)
PY
    ;;
    9) python3 - "$G" <<'PY'
import sys; p=sys.argv[1]; s=o=open(p).read()
s = s.replace('  [[ -f "$STATE_F" ]] && touch -t 197001020000 "$STATE_F" 2>/dev/null', "  :", 1)
assert s != o; open(p,"w").write(s)
PY
    ;;
   10) python3 - "$G" <<'PY'
import sys; p=sys.argv[1]; s=o=open(p).read()
s = s.replace('if [[ -n "${FORGE_GUARDIAN_LIB:-}" ]]; then return 0 2>/dev/null || exit 0; fi', ":", 1)
assert s != o; open(p,"w").write(s)
PY
    ;;
   11) python3 - "$G" <<'PY'
import sys; p=sys.argv[1]; s=o=open(p).read()
s = s.replace('  sleep "$POLL" & wait $!', '  sleep "$POLL"', 1)
assert s != o; open(p,"w").write(s)
PY
    ;;
  esac
}

MDESC=(
  "argv check deleted -> any argument starts a daemon again"
  "a live peer in the lock no longer refuses"
  "stale lock REFUSES instead of reclaiming (fail-closed: machine left ungoverned)"
  "freshness check removed -> the upgrade window lets a second one in"
  "exit traps removed -> the lock outlives the daemon"
  "CONTROL: a comment edit must stay GREEN"
  "FAIL-CLOSED: domain always looks governed -> NOTHING can ever start"
  "pid-reuse check removed -> a recycled pid holds the lock for ever"
  "clean shutdown no longer de-publishes -> the replacement waits it out"
  "library-mode guard removed -> sourcing the daemon exits the actuator suite"
  "foreground sleep restored -> TERM waits out the poll at the SHIPPED setting"
)
MWANT=(RED RED RED RED RED GREEN RED RED RED RED RED)

MFAIL=0
for n in 1 2 3 4 5 6 7 8 9 10 11; do
  desc=$MDESC[$n]; want=$MWANT[$n]
  if ! apply_mutation $n; then
    print "  mutation $n: DID NOT APPLY -- verdict void"; (( MFAIL++ )); continue
  fi
  if cmp -s "$SRC" "$G"; then
    print "  mutation $n: file unchanged -- verdict void"; (( MFAIL++ )); continue
  fi
  if ! zsh -n "$G" 2>/dev/null; then
    print "  mutation $n: does not parse -- verdict void"; (( MFAIL++ )); continue
  fi
  reap; STARTED=(); : >"$PIDFILE"
  if run_gate; then
    if [[ "$want" == GREEN ]]; then print "  mutation $n: GREEN (as required) -- $desc"
    else print "  mutation $n: GREEN but should be RED -- $desc"; (( MFAIL++ )); fi
  else
    if [[ "$want" == RED ]]; then print "  mutation $n: RED (as required, $FAIL failures) -- $desc"
    else print "  mutation $n: RED but should be GREEN -- $desc"; (( MFAIL++ )); fi
  fi
done

cp "$SRC" "$G"
print
if (( MFAIL == 0 )); then
  print "[single-instance] GREEN -- clean run passes ($CLEAN_PASS checks), 10 mutations red, control green"
  exit 0
else
  print "[single-instance] RED -- $MFAIL mutation(s) behaved wrongly"
  exit 1
fi
