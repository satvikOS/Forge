#!/bin/zsh
# ============================================================================
# GUARDIAN RED-SURVIVAL GATE (T-172)
#
# Three properties of the REAL daemon, each one measured failing in production:
#
#  1. RED stage 3 must not kill the governor. forge-guardian:474 read
#     ${TERMED_AT[$_jpid]} on a key that did not exist yet, under the file's own
#     `set -u`, so the daemon died the first time it tried to evict anything.
#     ~/.forge-health/log/guardian.err holds 16 copies of
#       forge-guardian:474: TERMED_AT[$_jpid]: parameter not set
#     from 2026-09-15 17:34-17:36, a disk-11GiB RED episode in which launchd
#     respawned it every ~17s and it evicted nothing.
#  2. A (re)start must not publish GREEN before it has evidence. Every one of those
#     16 respawns first published GREEN "armed", so forge-gate admitted heavy work
#     for ~10s at a time in the middle of the crisis.
#  3. A stop must not publish GREEN. The TERM trap wrote GREEN "guardian stopped"
#     into state.json AND the Law-7 status.json with a fresh ts, so the training
#     fleet read a fresh GREEN from a governor that had just exited.
#
# Hermetic: a private FORGE_HEALTH_DIR and ARCHIE_HEALTH_DIR, and the observation
# commands (sysctl, memory_pressure, vm_stat, df, pmset) shadowed on PATH by stubs
# that read $ROOT/obs. The live governor, its registry and /tmp/archie_health are
# never touched. Usage: guardian_red_survival_gate.sh [path/to/forge-guardian]
# ============================================================================
set -u
setopt NULL_GLOB 2>/dev/null || true
SRC=${1:-${0:A:h}/../forge-guardian}
[[ -f "$SRC" ]] || { print -u2 "no guardian at $SRC"; exit 1 }
SRC=${SRC:A}

PASS=0; FAIL=0
ck() { # ck <desc> <0=ok> [detail]
  if (( $2 == 0 )); then (( PASS++ )); print "    ok   $1${3:+  ($3)}"
  else (( FAIL++ )); print "    FAIL $1${3:+  ($3)}"; fi
}

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/fg_redsurv.XXXXXX")
GP=""; VP=""
cleanup() {
  [[ -n "$GP" ]] && kill -9 "$GP" 2>/dev/null
  [[ -n "$VP" ]] && kill -9 "$VP" 2>/dev/null
  rm -rf "$ROOT"
}
trap cleanup EXIT
# A wall-clock bound on the whole gate, so a wedged run cannot leave a daemon alive.
{ sleep 180; print -u2 "[red-survival] WALL-CLOCK EXCEEDED"; kill -9 $$ } &!
WD=$!

mkdir -p "$ROOT/stub" "$ROOT/ah" "$ROOT/jobs" "$ROOT/log"
OBS="$ROOT/obs"
set_obs() { # set_obs VMP DISK
  print -r -- "OBS_VMP=$1
OBS_FREE=60
OBS_SWU=100
OBS_SWT=2048
OBS_PAGEOUTS=0
OBS_DISK=$2
OBS_THERM=100" > "$OBS.tmp" && mv -f "$OBS.tmp" "$OBS"
}
set_obs 1 200
cat > "$ROOT/stub/sysctl" <<EOF
#!/bin/zsh
source "$OBS"
case "\$*" in
  *kern.memorystatus_vm_pressure_level*) print "\$OBS_VMP" ;;
  *kern.memorystatus_level*) print "\$OBS_FREE" ;;
  *vm.swapusage*) print "total = \${OBS_SWT}.00M  used = \${OBS_SWU}.00M  free = 1000.00M  (encrypted)" ;;
  *vm.loadavg*) print "{ 1.00 1.00 1.00 }" ;;
  *) /usr/sbin/sysctl "\$@" ;;
esac
EOF
cat > "$ROOT/stub/memory_pressure" <<EOF
#!/bin/zsh
source "$OBS"
print "System-wide memory free percentage: \${OBS_FREE}%"
EOF
cat > "$ROOT/stub/vm_stat" <<EOF
#!/bin/zsh
source "$OBS"
print "Mach Virtual Memory Statistics: (page size of 16384 bytes)"
print "Pageouts:                          \${OBS_PAGEOUTS}."
EOF
cat > "$ROOT/stub/df" <<EOF
#!/bin/zsh
source "$OBS"
print "Filesystem 1G-blocks Used Avail Capacity Mounted on"
print "/dev/disk3s5      1000  500 \${OBS_DISK}     50%  /"
EOF
cat > "$ROOT/stub/pmset" <<EOF
#!/bin/zsh
source "$OBS"
print "CPU_Scheduler_Limit \t= 100"
print "CPU_Speed_Limit \t= \${OBS_THERM}"
EOF
chmod +x "$ROOT"/stub/*

# A victim that SURVIVES TERM and records every signal, like a job mid-checkpoint.
cat > "$ROOT/victim.sh" <<'EOF'
#!/bin/zsh
trap 'print "USR1 $(date +%s)" >> "$1"' USR1
trap 'print "TERM $(date +%s)" >> "$1"' TERM
while true; do sleep 0.2 & wait $!; done
EOF
chmod +x "$ROOT/victim.sh"

export FORGE_HEALTH_DIR="$ROOT" ARCHIE_HEALTH_DIR="$ROOT/ah"
export FORGE_GUARDIAN_POLL=1 FORGE_GUARDIAN_TERM_GRACE=30
export PATH="$ROOT/stub:$PATH"
# The gate must not depend on a native sensor being present in the private domain:
# with none installed beside $SRC the daemon samples through the stubs above.
export FORGE_GUARDIAN_SENSOR=0

jstate() { sed -n 's/.*"state": *"\([A-Z]*\)".*/\1/p' "$1" 2>/dev/null | head -1 }

print "== 1. a (re)start publishes no GREEN before it has sustained evidence =="
zsh "$SRC" > "$ROOT/guardian.out" 2>&1 &
GP=$!
first="" first_ah=""
for i in {1..200}; do
  if [[ -z "$first" && -s "$ROOT/state.json" ]]; then first=$(jstate "$ROOT/state.json"); fi
  if [[ -z "$first_ah" && -s "$ROOT/ah/status.json" ]]; then first_ah=$(jstate "$ROOT/ah/status.json"); fi
  [[ -n "$first" && -n "$first_ah" ]] && break
  sleep 0.05
done
ck "first published state.json is not GREEN" $([[ -n "$first" && "$first" != GREEN ]]; print $?) "first=$first"
ck "first published Law-7 status.json is not GREEN" $([[ -n "$first_ah" && "$first_ah" != GREEN ]]; print $?) "first=$first_ah"
reached=""
for i in {1..30}; do
  [[ "$(cat "$ROOT/state" 2>/dev/null)" == GREEN ]] && { reached=$i; break }
  sleep 1
done
ck "a healthy box still REACHES GREEN (the fix is not 'never green')" $([[ -n "$reached" ]]; print $?) "after ~${reached:-never}s"

print "== 2. RED stage 3 eviction does not kill the governor =="
"$ROOT/victim.sh" "$ROOT/victim.log" &
VP=$!
sleep 0.3
# Started 1000s ago: well past the settling grace, so stage 3 MUST try to evict it.
{ print "pid=$VP"; print "name=red-probe"; print "priority=9"; print "can_restart=1"
  print "peak_gb=1"; print "gpu=0"; print "started=$(( $(date +%s) - 1000 ))"; print "cmd=victim"
} > "$ROOT/jobs/$VP.job"
set_obs 4 200
sleep 14
alive=$(kill -0 "$GP" 2>/dev/null && print 1 || print 0)
ck "governor ALIVE 14s into RED (it used to die at stage 3)" $(( alive == 1 ? 0 : 1 )) "alive=$alive"
st=$(cat "$ROOT/state" 2>/dev/null); age=$(( $(date +%s) - $(stat -f %m "$ROOT/state" 2>/dev/null || print 0) ))
ck "state is RED and fresh" $([[ "$st" == RED ]] && (( age <= 3 )); print $?) "state=$st age=${age}s"
terms=$(grep -c '^TERM' "$ROOT/victim.log" 2>/dev/null); terms=${terms:-0}
ck "exactly ONE TERM inside the 30s grace (one eviction decision, one signal)" $(( terms == 1 ? 0 : 1 )) "TERMs=$terms"
usr1=$(grep -c '^USR1' "$ROOT/victim.log" 2>/dev/null); usr1=${usr1:-0}
ck "cooperative USR1 came before the TERM" $(( usr1 >= 1 ? 0 : 1 )) "USR1s=$usr1"
crash=$(grep -c 'parameter not set' "$ROOT/guardian.out" 2>/dev/null); crash=${crash:-0}
ck "no nounset crash in the daemon's stderr" $(( crash == 0 ? 0 : 1 )) "$(grep -m1 'parameter not set' "$ROOT/guardian.out" 2>/dev/null)"

print "== 3. a stop publishes no GREEN =="
# Independent of section 2: a governor that died there would make "stop" vacuous
# (nothing left to stop, the last published value stays RED and this section would
# pass on the very tree it exists to reject). Start a FRESH healthy one, wait until
# it has earned GREEN, and only then stop it.
[[ -n "$GP" ]] && { kill -9 "$GP" 2>/dev/null; GP="" }
[[ -n "$VP" ]] && { kill -9 "$VP" 2>/dev/null; VP="" }
rm -f "$ROOT"/jobs/*.job "$ROOT/state" "$ROOT/state.json" "$ROOT/ah/status.json"
rm -rf "$ROOT/guardian.lock"
set_obs 1 200
zsh "$SRC" > "$ROOT/guardian3.out" 2>&1 &
GP=$!
green3=""
for i in {1..30}; do
  [[ "$(cat "$ROOT/state" 2>/dev/null)" == GREEN ]] && { green3=1; break }
  sleep 1
done
ck "setup: a fresh governor reached GREEN before the stop" $([[ -n "$green3" ]]; print $?)
kill -TERM "$GP" 2>/dev/null
for i in {1..40}; do kill -0 "$GP" 2>/dev/null || break; sleep 0.1; done
gone=$(kill -0 "$GP" 2>/dev/null && print 0 || print 1)
ck "governor exited on TERM" $(( gone == 1 ? 0 : 1 ))
GP=""
s1=$(jstate "$ROOT/state.json"); s2=$(jstate "$ROOT/ah/status.json")
ck "state.json after stop is not GREEN" $([[ -n "$s1" && "$s1" != GREEN ]]; print $?) "state=$s1"
ck "Law-7 status.json after stop is not GREEN" $([[ -n "$s2" && "$s2" != GREEN ]]; print $?) "state=$s2"
sage=$(( $(date +%s) - $(stat -f %m "$ROOT/state" 2>/dev/null || print 0) ))
ck "the state file is de-published (stale) so forge-gate fails closed" $(( sage > 60 ? 0 : 1 )) "age=${sage}s"

kill "$WD" 2>/dev/null
print ""
print "[red-survival] $PASS passed, $FAIL failed"
(( FAIL == 0 ))
