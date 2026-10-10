#!/bin/zsh
# ============================================================================
# GOVERNOR RUNTIME GATE (T-173..T-176) — the REAL daemon, end to end
#
# Every scenario starts a private copy of forge-guardian in its own domain
# (FORGE_HEALTH_DIR / ARCHIE_HEALTH_DIR under one mktemp root) at POLL=1 unless it
# says otherwise, with:
#   * test/stub-sensor as its sensor (FORGE_GUARDIAN_SENSOR_BIN) where a sensor is
#     wanted -- it writes sensor.env per SCHEMA §3.1 from an obs file, and can be
#     told to die, freeze, skew its clock or raise a critical pressure event + USR2;
#   * the fallback commands (sysctl, memory_pressure, vm_stat, df, pmset) shadowed
#     on PATH by stubs reading $D/obs -- `pmset` in its Apple-Silicon form (no
#     CPU_Speed_Limit line: this Mac) or its Intel form;
#   * FORGE_GUARDIAN_NOTIFY_CMD / FORGE_GUARDIAN_DISKUTIL stubs, so nothing reaches
#     the desktop or a real disk query.
# Where a claim is "the parent tree did X", the parent (OLD_REV, default 834c7269)
# is materialised from git and run under the SAME stubs: the arms must differ.
#
# Safety: every pid this gate starts is recorded in a FILE (subshells cannot append
# to the parent's array); stub sensors are reaped only when `ps` shows they are this
# gate's own stub on this gate's own root; a wall-clock watchdog reaps everything;
# the one disk image is detached in the EXIT trap. Nothing outside $ROOT is written.
# Review 2026-10-08 regressions: s13/s14 (forge-gate argv + live-governor check, forge-nproc
# live-governor check), s17 (R5 hysteresis vs USR2 storms), s18 (FO-4 retraction on any
# exit), s19 (R6 torn appends on ENOSPC), s20 (SEM-4 red incident), s21 (R1 FIFO envelope),
# s22 (R12 publication onto a directory), s23 (ctl's figures in the C locale from any caller
# locale; ctl's evidence total = the governor's housekeeping set). forge-gate / forge-nproc /
# forge-guardian-ctl are taken from beside the governor under test, so
# `governor_runtime_gate.sh <old tree>/forge-guardian` runs the old tools.
# Usage: governor_runtime_gate.sh [path/to/forge-guardian]
#   GATE_ONLY=s1,s4    run a subset          GATE_BUDGET=900   watchdog seconds
#   FORK_POLL=5 FORK_SECONDS=60 GATE_ONLY=forks   the idle-cost measurement
# ============================================================================
set -u
setopt NULL_GLOB
zmodload zsh/datetime
SRC=${1:-${0:A:h}/../forge-guardian}
[[ -f "$SRC" ]] || { print -u2 "no guardian at $SRC"; exit 1 }
SRC=${SRC:A}
HERE=${0:A:h}
STUB=$HERE/stub-sensor
[[ -x $STUB ]] || { print -u2 "no stub sensor at $STUB"; exit 1 }
OLD_REV=${OLD_REV:-834c7269}
ONLY=${GATE_ONLY:-}
BUDGET=${GATE_BUDGET:-900}

PASS=0; FAIL=0; SKIP=0
typeset -a MEASURES
ck() { # ck <desc> <0=ok> [detail]
  if (( $2 == 0 )); then (( PASS++ )); print "    ok   $1${3:+  ($3)}"
  else (( FAIL++ )); print "    FAIL $1${3:+  ($3)}"; fi
}
skip() { (( SKIP++ )); print "    SKIP $1 (NOT a pass)" }
measure() { print "    measured: $1"; MEASURES+=("$1") }
want() { [[ -z $ONLY || ",$ONLY," == *",$1,"* ]] }
t3() { printf '%.3f' $1 }

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/fg_runtime.XXXXXX")
PIDF=$ROOT/started.pids; : > $PIDF
MNT=""
reap_all() {
  local p a f rest
  [[ -r $PIDF ]] && while read -r p; do [[ -n $p ]] && kill -9 $p 2>/dev/null; done < $PIDF
  for f in $ROOT/*/h/stub-sensor.pids $ROOT/mnt/h/stub-sensor.pids; do
    [[ -r $f ]] || continue
    while read -r p rest; do
      a=$(ps -o args= -p $p 2>/dev/null)
      [[ $a == *stub-sensor\ run\ --state-dir\ $ROOT* ]] && kill -9 $p 2>/dev/null
    done < $f
  done
  for f in $ROOT/*/hang.pids; do
    while read -r p; do a=$(ps -o args= -p $p 2>/dev/null); [[ $a == "sleep 30" ]] && kill -9 $p 2>/dev/null; done < $f
  done
  return 0
}
detach() { [[ -n $MNT ]] && { hdiutil detach "$MNT" -force >/dev/null 2>&1; MNT=""; }; return 0 }
cleanup() { reap_all; detach; [[ -n ${WD:-} ]] && kill -TERM $WD 2>/dev/null; rm -rf "$ROOT" }
trap cleanup EXIT
trap 'exit 143' TERM INT
{ trap 'kill $wsp 2>/dev/null; exit 0' TERM
  sleep $BUDGET & wsp=$!; wait $wsp
  print -u2 "[runtime] WALL-CLOCK EXCEEDED (${BUDGET}s): reaping and failing"
  reap_all; [[ -r $ROOT/mnt.path ]] && hdiutil detach "$(<$ROOT/mnt.path)" -force >/dev/null 2>&1
  kill -TERM $$ 2>/dev/null; sleep 2; kill -9 $$ 2>/dev/null; } &!
WD=$!

# ---- the parent tree ------------------------------------------------------------------
OLD=""
if top=$(git -C "$HERE" rev-parse --show-toplevel 2>/dev/null) && mkdir -p $ROOT/oldbin \
   && git -C "$top" show "${OLD_REV}:tools/guardian/forge-guardian" > $ROOT/oldbin/forge-guardian 2>/dev/null; then
  OLD=$ROOT/oldbin/forge-guardian
fi

# ---- domains -----------------------------------------------------------------------
# mkdom NAME as|intel -> D. `as` = Apple Silicon pmset (no CPU_Speed_Limit), `intel` = with it.
mkdom() {
  D=$ROOT/$1
  mkdir -p $D/h/jobs $D/ah $D/stub $D/bin
  cp "$SRC" $D/bin/forge-guardian
  local therm=""; [[ $2 == intel ]] && therm=100
  print -r -- "OBS_VMP=1
OBS_FREE=60
OBS_SWU=100
OBS_SWT=2048
OBS_PAGEOUTS=0
OBS_DISK=200
OBS_THERM=$therm" > $D/obs
  cat > $D/stub/sysctl <<EOF
#!/bin/zsh
source "$D/obs"
case "\$*" in
  *kern.memorystatus_vm_pressure_level*) print "\$OBS_VMP" ;;
  *kern.memorystatus_level*) print "\$OBS_FREE" ;;
  *vm.swapusage*) print "total = \${OBS_SWT}.00M  used = \${OBS_SWU}.00M  free = 1000.00M  (encrypted)" ;;
  *vm.loadavg*) print "{ 1.00 1.00 1.00 }" ;;
  *) /usr/sbin/sysctl "\$@" ;;
esac
EOF
  cat > $D/stub/memory_pressure <<EOF
#!/bin/zsh
source "$D/obs"
print "System-wide memory free percentage: \${OBS_FREE}%"
EOF
  cat > $D/stub/vm_stat <<EOF
#!/bin/zsh
source "$D/obs"
print "Mach Virtual Memory Statistics: (page size of 16384 bytes)"
print "Pageouts:                          \${OBS_PAGEOUTS}."
EOF
  cat > $D/stub/df <<EOF
#!/bin/zsh
source "$D/obs"
print "Filesystem 1G-blocks Used Avail Capacity Mounted on"
print "/dev/disk3s5      1000  500 \${OBS_DISK}     50%  /"
EOF
  cat > $D/stub/pmset <<EOF
#!/bin/zsh
source "$D/obs"
if [[ -n \$OBS_THERM ]]; then
  print "CPU_Scheduler_Limit \t= 100"
  print "CPU_Speed_Limit \t= \${OBS_THERM}"
else
  print "Note: No thermal warning level has been recorded"
  print "Note: No performance warning level has been recorded"
  print "Note: No CPU power status has been recorded"
fi
EOF
  print -r -- "#!/bin/zsh
print -r -- \"\$1|\$2\" >> $D/notified" > $D/notify
  print -r -- "#!/bin/zsh
print '<dict><key>SMARTStatus</key>
<string>Verified</string></dict>'" > $D/diskutil
  chmod +x $D/stub/* $D/notify $D/diskutil
}
obs() { # obs KEY=VALUE ... : rewrite $D/obs atomically
  local kv k
  typeset -A o
  local line; while IFS= read -r line; do o[${line%%=*}]=${line#*=}; done < $D/obs
  for kv in "$@"; do o[${kv%%=*}]=${kv#*=}; done
  : > $D/obs.tmp; for k in ${(k)o}; do print -r -- "$k=$o[$k]" >> $D/obs.tmp; done
  mv -f $D/obs.tmp $D/obs
}
# start_gd [VAR=VALUE ...] -> GP. Runs ${GD_BIN:-$D/bin/forge-guardian} in domain $D.
start_gd() {
  local bin=${GD_BIN:-$D/bin/forge-guardian}
  ( export FORGE_HEALTH_DIR=$D/h ARCHIE_HEALTH_DIR=$D/ah FORGE_GUARDIAN_POLL=1 \
      FORGE_GUARDIAN_NOTIFY_CMD=$D/notify FORGE_GUARDIAN_DISKUTIL=$D/diskutil PATH=$D/stub:$PATH
    unset FORGE_GUARDIAN_SENSOR_BIN FORGE_GUARDIAN_SENSOR FORGE_GUARDIAN_UNKNOWN_NOTIFY_S
    local a; for a in "$@"; do export "$a"; done
    exec zsh "$bin" ) >> $D/launch.out 2>&1 < /dev/null &
  GP=$!; print $GP >> $PIDF
}
stop_gd() {
  local i
  kill -TERM $GP 2>/dev/null
  for i in {1..50}; do kill -0 $GP 2>/dev/null || break; sleep 0.1; done
  kill -9 $GP 2>/dev/null; wait $GP 2>/dev/null
  return 0
}
st() { [[ -f $D/h/state ]] && print -r -- "$(<$D/h/state)" }
state_is() { [[ "$(st)" == $1 ]] }
jq_() { python3 -I -c 'import json,sys
try:
    d=json.load(open(sys.argv[1])); v=eval(sys.argv[2],{"d":d})
    print(v if isinstance(v,str) else json.dumps(v))
except Exception as e:
    print("ERR:"+type(e).__name__)' "$1" "$2" 2>/dev/null }
sj() { jq_ $D/h/state.json "$1" }
wait_until() { # wait_until SECONDS 'condition' -> 0 when it held; WAITED = seconds taken
  local t0=$EPOCHREALTIME lim=$1
  while (( EPOCHREALTIME - t0 < lim )); do
    eval "$2" && { WAITED=$(( EPOCHREALTIME - t0 )); return 0; }
    sleep 0.1
  done
  WAITED=$lim; return 1
}
sensor_pid() { [[ -f $D/h/sensor.env ]] && sed -n 's/^pid=//p' $D/h/sensor.env | head -1 }
ctl() { print -r -- "$1" > $D/h/stub.ctl }
# fake_gov H -> FGP. forge-gate and forge-nproc believe a fresh state only while
# H/guardian.lock names a LIVE process with the recorded start time and forge-guardian
# argv (review FO-4). The gate's own stand-in: a fork-free zsh named forge-guardian
# (lives <= 20 min, recorded in $PIDF), holding the lock exactly as the governor takes it.
mkdir -p $ROOT/fakegov
print -r -- 'zmodload zsh/zselect; integer i; for (( i = 0; i < 1200; i++ )); do zselect -t 100 2>/dev/null; done' > $ROOT/fakegov/forge-guardian
# utc_pstart PID -> REPLY = its start in EPOCH seconds: this gate's own oracle (ps prints
# lstart in UTC and it is read back in UTC), independent of the code under test.
utc_pstart() { local s; s=$(TZ=UTC LC_ALL=C ps -o lstart= -p $1 2>/dev/null); local TZ=UTC LC_ALL=C v=""
  strftime -r -s v '%a %b %d %H:%M:%S %Y' "${(j: :)${=s}}" 2>/dev/null; REPLY=$v }
# fake_gov H [legacy]: the lock the way the v2 governor writes it -- pid, pstart (epoch),
# started (lstart text) -- or, with `legacy`, the v1 way (no pstart). Review 2026-10-08
# round 2 (FO-4): pstart is what every reader compares, in any time zone.
fake_gov() {
  zsh $ROOT/fakegov/forge-guardian </dev/null >/dev/null 2>&1 &
  FGP=$!; print $FGP >> $PIDF
  sleep 0.2
  mkdir -p $1/guardian.lock
  print -r -- $FGP > $1/guardian.lock/pid
  if [[ ${2:-} != legacy ]]; then utc_pstart $FGP; print -r -- $REPLY > $1/guardian.lock/pstart; fi
  LC_ALL=C ps -p $FGP -o lstart= > $1/guardian.lock/started
}

print "[runtime] daemon under test: $SRC"
print "[runtime] parent tree:       ${OLD:-unavailable (git show $OLD_REV failed)}"
print "[runtime] root:              $ROOT"

# ==================================================================================
if want s1; then
print "== s1. no sensor binary + Apple-Silicon pmset (no CPU_Speed_Limit) -> never GREEN =="
mkdom s1 as
start_gd
seen=""
for i in {1..56}; do seen+=" $(st)"; sleep 0.25; done          # 14 s: two full 6-poll recoveries
ck "never published GREEN in 14 s at POLL=1" $([[ $seen != *GREEN* ]]; print $?) "$(print -r -- ${(u)${=seen}})"
ck "state is UNKNOWN" $([[ $(sj 'd["state"]') == UNKNOWN ]]; print $?)
ck "evidence.missing == [thermal]" $([[ $(sj 'd["evidence"]["missing"]') == '["thermal"]' ]]; print $?) "$(sj 'd["evidence"]')"
ck "evidence.source == fallback" $([[ $(sj 'd["evidence"]["source"]') == fallback ]]; print $?)
ck "heavy_jobs_ok and spawn_agents_ok are false" $([[ $(sj '[d["heavy_jobs_ok"],d["spawn_agents_ok"]]') == '[false, false]' ]]; print $?)
ck "cpu_speed_limit_pct is -1 (unavailable), not 100" $([[ $(sj 'd["observables"]["cpu_speed_limit_pct"]') == -1 ]]; print $?) "$(sj 'd["observables"]["cpu_speed_limit_pct"]')"
ck "thermal_state none" $([[ $(sj 'd["thermal_state"]') == none ]]; print $?)
ck "the signals that ARE sampled are published (vmp 1, swap 100/2048, disk 200)" \
   $([[ $(sj '[d["observables"][k] for k in ("vm_pressure_level","swap_used_mb","swap_total_mb","disk_avail_gb")]') == '[1, 100, 2048, 200]' ]]; print $?)
ck "Law-7 status.json: UNKNOWN, evidence_complete false" $([[ $(jq_ $D/ah/status.json '[d["state"],d["evidence_complete"]]') == '["UNKNOWN", false]' ]]; print $?)
stop_gd
mkdom s1c intel
start_gd
wait_until 15 'state_is GREEN'; r=$?
ck "control: the SAME box with a CPU_Speed_Limit line reaches GREEN" $r "after $(t3 $WAITED)s"
stop_gd
if [[ -n $OLD ]]; then
  mkdom s1old as
  GD_BIN=$OLD start_gd
  wait_until 15 'state_is GREEN'; r=$?
  ck "parent tree $OLD_REV publishes GREEN under the same stubs (the T-173 defect, reproduced)" $r "after $(t3 $WAITED)s"
  ck "  ...with cpu_speed_limit_pct 100: a default that reads as healthy" $([[ $(sj 'd["observables"]["cpu_speed_limit_pct"]') == 100 ]]; print $?)
  stop_gd
else skip "parent-tree arm of s1"; fi
fi

# ==================================================================================
if want s2; then
print "== s2. sensor killed -> UNKNOWN until fresh again; restarted (<= once per 30 s) =="
mkdom s2 as
start_gd FORGE_GUARDIAN_SENSOR_BIN=$STUB
wait_until 15 'state_is GREEN'; r=$?
ck "with a fresh stub sensor: GREEN" $r "after $(t3 $WAITED)s, source=$(sj 'd["evidence"]["source"]')"
p1=$(sensor_pid)
t_die=$EPOCHREALTIME; ctl die
wait_until 8 'state_is UNKNOWN'; r=$?
ck "sensor death -> UNKNOWN within sensor_stale_polls x POLL (+2 s)" $r "after $(t3 $WAITED)s"
measure "sensor death -> UNKNOWN: $(t3 $WAITED)s at POLL=1"
ck "  ...evidence.missing names the sensor" $([[ $(sj 'd["evidence"]["missing"]') == *sensor* ]]; print $?) "$(sj 'd["reason"]')"
wait_until 40 '[[ -n $(sensor_pid) && $(sensor_pid) != $p1 ]] && kill -0 $(sensor_pid) 2>/dev/null'; r=$?
ck "the governor restarted the sensor" $r "new pid $(sensor_pid) $(t3 $(( EPOCHREALTIME - t_die )))s after the death"
g1=$(grep -m1 'sensor started' $D/h/log/guardian.log | cut -c12-19); g2=$(grep 'sensor started' $D/h/log/guardian.log | sed -n 2p | cut -c12-19)
gap=$(( $(date -j -f %T "$g2" +%s 2>/dev/null || print 0) - $(date -j -f %T "$g1" +%s 2>/dev/null || print 0) ))
ck "  ...no sooner than 30 s after the previous start" $(( gap >= 30 ? 0 : 1 )) "starts at $g1 and $g2 (${gap}s)"
ck "  ...and logged the exit" $(grep -q "sensor pid=$p1 exited" $D/h/log/guardian.log; print $?)
wait_until 15 'state_is GREEN'; r=$?
ck "back to GREEN once the new snapshot is fresh" $r "after $(t3 $WAITED)s"
python3 -I - $D/h/history.jsonl $t_die > $ROOT/s2.hist <<'PY'
import json,sys
L=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
L=[l for l in L if l["t"]>=float(sys.argv[2])]
i=next((k for k,l in enumerate(L) if l["s"]=="GREEN"),None)
pre=0
if i is not None:
    k=i-1
    while k>=0 and L[k]["ev"]==1 and L[k]["s"]=="UNKNOWN": pre+=1; k-=1
print(i is not None, pre, sum(1 for l in L[:i] if l["s"]=="GREEN") if i else 0)
PY
read -r found pre greens < $ROOT/s2.hist
ck "GREEN only after deescalate_polls=6 fresh polls (5 UNKNOWN+complete, then the 6th)" $(( pre >= 5 ? 0 : 1 )) "fresh UNKNOWN polls before GREEN: $pre"
ck "no GREEN at all while the sensor was down" $(( greens == 0 ? 0 : 1 ))
p2=$(sensor_pid)
stop_gd
wait_until 3 '! kill -0 $p2 2>/dev/null'; r=$?
ck "an orderly governor stop takes its sensor with it" $r "sensor pid $p2"
fi

# ==================================================================================
if want s3; then
print "== s3. stale sensor.env -> UNKNOWN; malformed values -> UNKNOWN naming the signal =="
mkdom s3 as
start_gd FORGE_GUARDIAN_SENSOR_BIN=$STUB
wait_until 15 'state_is GREEN'; ck "setup: GREEN from the sensor" $?
ctl freeze
wait_until 8 'state_is UNKNOWN'; r=$?
ck "a frozen (alive, mute) sensor -> UNKNOWN" $r "after $(t3 $WAITED)s"
ck "  ...reason says stale" $([[ $(sj 'd["reason"]') == *stale* ]]; print $?) "$(sj 'd["reason"]')"
ck "  ...sensor_age_s > 3 (3 polls x 1 s)" $([[ $(sj 'd["evidence"]["sensor_age_s"]') -gt 3 ]]; print $?) "age=$(sj 'd["evidence"]["sensor_age_s"]')"
ctl thaw
wait_until 15 'state_is GREEN'; ck "thawed: fresh again and back to GREEN" $? "after $(t3 $WAITED)s"
print "vmp=abc" > $D/h/stub.obs
wait_until 5 'state_is UNKNOWN'; r=$?
ck "vmp=abc (vmp_st=ok) -> UNKNOWN at once" $r "after $(t3 $WAITED)s"
ck "  ...evidence.missing == [vm_pressure]" $([[ $(sj 'd["evidence"]["missing"]') == '["vm_pressure"]' ]]; print $?) "$(sj 'd["evidence"]["missing"]')"
ck "  ...reason names it invalid" $([[ $(sj 'd["reason"]') == *'vm_pressure(invalid)'* ]]; print $?) "$(sj 'd["reason"]')"
ck "  ...vm_pressure_level published as -1" $([[ $(sj 'd["observables"]["vm_pressure_level"]') == -1 ]]; print $?)
print "swap_used_mb=5000" > $D/h/stub.obs
wait_until 5 '[[ $(sj "d[\"evidence\"][\"missing\"]") == "[\"swap\"]" ]]'; r=$?
ck "swap used 5000 > total 2048 -> missing [swap]" $r "$(sj 'd["reason"]')"
print "disk_min_avail_gib=-3" > $D/h/stub.obs
wait_until 5 '[[ $(sj "d[\"evidence\"][\"missing\"]") == "[\"disk\"]" ]]'; r=$?
ck "disk_min_avail_gib=-3 -> missing [disk]" $r "$(sj 'd["reason"]')"
ck "governor survived every malformed snapshot" $(kill -0 $GP 2>/dev/null; print $?)
ck "no shell error in guardian.out" $(( $(grep -cE 'parameter not set|bad math|command not found|parse error' $D/h/log/guardian.out) == 0 ? 0 : 1 ))
stop_gd
fi

# ==================================================================================
crit_trial() { # crit_trial POLL -> LAT (s from the sensor's USR2 to RED published)
  rm -f $D/h/stub.usr2_sent
  ctl critical
  wait_until $(( $1 + 4 )) '[[ -s $D/h/stub.usr2_sent ]]' || { LAT=99; return 1; }
  local ts=$(<$D/h/stub.usr2_sent) i
  for i in {1..800}; do state_is RED && break; sleep 0.01; done
  LAT=$(( EPOCHREALTIME - ts ))
}
if want s4; then
print "== s4. critical pressure event + USR2 -> RED within 1 s, at POLL=5 =="
lats=()
for trial in 1 2 3; do
  mkdom s4_$trial as
  start_gd FORGE_GUARDIAN_SENSOR_BIN=$STUB FORGE_GUARDIAN_POLL=5
  wait_until 15 '[[ $(sj "d[\"evidence\"][\"source\"]") == sensor ]]' || true
  sleep $(( 0.7 * trial ))                                     # a different phase of the 5 s poll
  crit_trial 5
  lats+=($(t3 $LAT))
  ck "trial $trial: RED within 1 s of the sensor's USR2 (POLL=5)" $(( LAT < 1.0 ? 0 : 1 )) "$(t3 $LAT)s"
  if (( trial == 1 )); then
    ck "  ...critical_now true in state.json" $([[ $(sj 'd["critical_now"]') == true ]]; print $?)
    ck "  ...the transition event names the pressure event" $(grep -q '"to": "RED", "reason": "critical memory-pressure event' $D/h/events.jsonl; print $?)
    sleep 0.5
    n=$(ps -axo ppid=,args= | awk -v p=$GP '$1==p && $2=="sleep" {n++} END{print n+0}')
    ck "  ...the interrupted poll sleep was reaped (<= 1 sleep child)" $(( n <= 1 ? 0 : 1 )) "sleep children=$n"
  fi
  stop_gd
done
measure "USR2 -> RED latency at POLL=5: ${lats[*]} s"
if [[ -n $OLD ]]; then
  mkdom s4old intel
  GD_BIN=$OLD start_gd FORGE_GUARDIAN_POLL=5
  wait_until 15 '[[ -f $D/h/state ]]'; sleep 2.1
  t0=$EPOCHREALTIME; obs OBS_VMP=4
  wait_until 20 'state_is RED'; r=$?
  olat=$(( EPOCHREALTIME - t0 ))
  ck "parent tree $OLD_REV: vm_pressure=4 -> RED needs 2 polls (>= 5 s at POLL=5)" $(( r == 0 && olat >= 4.9 ? 0 : 1 )) "$(t3 $olat)s"
  measure "parent tree vm_pressure=4 -> RED at POLL=5: $(t3 $olat)s (no sensor, no wake-up, 2 confirming polls)"
  stop_gd
else skip "parent-tree arm of s4"; fi
fi

# ==================================================================================
if want s5; then
print "== s5. recovery: RED -> GREEN needs >= deescalate_polls (6) =="
mkdom s5 as
start_gd FORGE_GUARDIAN_SENSOR_BIN=$STUB
wait_until 15 'state_is GREEN'; ck "setup: GREEN" $?
crit_trial 1
ck "critical event -> RED" $(( LAT < 1.0 ? 0 : 1 )) "$(t3 $LAT)s"
t_red=$EPOCHREALTIME
wait_until 15 'state_is GREEN'; r=$?
ck "recovers to GREEN" $r "after $(t3 $WAITED)s"
python3 -I - $D/h/history.jsonl > $ROOT/s5.hist <<'PY'
import json,sys
L=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
i=next(k for k,l in enumerate(L) if l["s"]=="RED")
j=next(k for k,l in enumerate(L) if k>i and l["s"]=="GREEN")
print(j-i)
PY
nred=$(<$ROOT/s5.hist)
ck "RED held for >= 6 polls before GREEN" $(( nred >= 6 ? 0 : 1 )) "RED polls=$nred"
stop_gd
fi

# ==================================================================================
if want s6; then
print "== s6. clock skew -> UNKNOWN; a sleep gap is not a pageout spike =="
mkdom s6 as
start_gd FORGE_GUARDIAN_SENSOR_BIN=$STUB
wait_until 15 'state_is GREEN'; ck "setup: GREEN" $?
print "ts_offset=100" > $D/h/stub.obs
wait_until 5 'state_is UNKNOWN'; r=$?
ck "sensor ts 100 s in the future -> UNKNOWN" $r "after $(t3 $WAITED)s"
ck "  ...reason says clock skew" $([[ $(sj 'd["reason"]') == *'clock skew'* ]]; print $?) "$(sj 'd["reason"]')"
ck "  ...sensor_age_s <= -95" $([[ $(sj 'd["evidence"]["sensor_age_s"]') -le -95 ]]; print $?) "$(sj 'd["evidence"]["sensor_age_s"]')"
stop_gd
gap_arm() { # gap_arm BIN -> PEAK (max published pageout rate in the 5 s after a 12 s stop)
  GD_BIN=$1 start_gd
  wait_until 15 'state_is GREEN' || { PEAK=-2; return 1; }
  sleep 1.2
  kill -STOP $GP; obs OBS_PAGEOUTS=1000; sleep 12; kill -CONT $GP
  PEAK=-1; PEAKSTATES=""
  local i v
  for i in {1..25}; do
    v=$(sj 'd["observables"]["pageout_rate_pages_per_poll"]'); [[ $v == <-> ]] && (( v > PEAK )) && PEAK=$v
    PEAKSTATES+=" $(st)"; sleep 0.2
  done
  stop_gd
}
mkdom s6g intel; gap_arm ""
ck "12 s stop + 1000 pages: published rate stays below the YELLOW threshold (600 / 5 s)" $(( PEAK >= 0 && PEAK < 600 ? 0 : 1 )) "peak=$PEAK pages/5s"
ck "  ...and the state stays GREEN" $([[ $PEAKSTATES != *YELLOW* && $PEAKSTATES != *ORANGE* && $PEAKSTATES != *RED* ]]; print $?)
measure "after a 12 s gap with 1000 pageouts: v2 publishes $PEAK pages/5s"
if [[ -n $OLD ]]; then
  mkdom s6old intel; gap_arm $OLD
  ck "parent tree $OLD_REV publishes the gap as a one-poll spike (>= 600)" $(( PEAK >= 600 ? 0 : 1 )) "peak=$PEAK pages/poll"
  measure "parent tree after the same gap: $PEAK pages/poll"
else skip "parent-tree arm of s6"; fi
fi

# ==================================================================================
if want s7; then
print "== s7. log rotation, the aggregate cap, retention; live files kept =="
mkdom s7 intel
H=$D/h; mkdir -p $H/log $H/incidents/2026-01-01T000000Z-manual $H/incidents/2026-10-01T000000Z-red
# (SCHEMA §6 bounds: logs_cap_mib >= 8, so the files are sized for an 8 MiB cap)
print "logs_rotate_mib=1\nlogs_cap_mib=8\nlogs_generations=2\nlogs_history_mib=6\nlogs_retention_days=30" > $H/policy.env
mkf() { head -c $2 /dev/zero | tr '\0' x > $1 }
mkf $H/log/guardian.log 2621440; mkf $H/log/guardian.out 2621440; mkf $H/log/launchd.out 2621440
mkf $H/log/guardian.log.7 1048576; mkf $H/history.jsonl.3 1048576; mkf $H/events.jsonl.2 1048576
mkf $H/incidents/2026-01-01T000000Z-manual/blob 1048576; mkf $H/incidents/2026-10-01T000000Z-red/blob 1048576
mkf $H/keepme.bin 2097152
touch -t 202601010000 $H/log/guardian.log.7 $H/history.jsonl.3 $H/events.jsonl.2 $H/incidents/2026-01-01T000000Z-manual/blob $H/incidents/2026-01-01T000000Z-manual
touch -t 202610010000 $H/incidents/2026-10-01T000000Z-red/blob $H/incidents/2026-10-01T000000Z-red
k0=$(stat -f '%z %m' $H/keepme.bin); li0=$(stat -f %i $H/log/launchd.out)
start_gd
wait_until 15 'state_is GREEN'; ck "setup: GREEN (the transition is emitted AFTER the first rotation)" $?
sleep 1
sz() { stat -f %z $1 2>/dev/null || print -1 }
ck "guardian.log rotated: .1 holds the old 2.5 MiB, the live file is small" $(( $(sz $H/log/guardian.log.1) >= 2621440 && $(sz $H/log/guardian.log) < 1048576 ? 0 : 1 )) "log.1=$(sz $H/log/guardian.log.1) log=$(sz $H/log/guardian.log)"
ck "guardian.out rotated" $(( $(sz $H/log/guardian.out.1) >= 2621440 && $(sz $H/log/guardian.out) < 1048576 ? 0 : 1 )) "out.1=$(sz $H/log/guardian.out.1) out=$(sz $H/log/guardian.out)"
ck "  ...and REOPENED: the later GREEN transition is in the new guardian.out" $(grep -q 'UNKNOWN→GREEN' $H/log/guardian.out; print $?)
ck "launchd.out truncated IN PLACE (same inode)" $(( $(sz $H/log/launchd.out) < 1048576 && $(stat -f %i $H/log/launchd.out) == li0 ? 0 : 1 )) "size=$(sz $H/log/launchd.out)"
ck "rotated generations beyond policy (guardian.log.7, history.jsonl.3) removed" $([[ ! -e $H/log/guardian.log.7 && ! -e $H/history.jsonl.3 ]]; print $?)
ck "an incident older than logs_retention_days removed" $([[ ! -e $H/incidents/2026-01-01T000000Z-manual ]]; print $?)
ck "over the cap: the oldest rotated file (events.jsonl.2) removed" $([[ ! -e $H/events.jsonl.2 ]]; print $?)
ck "over the cap: then the oldest incident dir removed" $([[ ! -e $H/incidents/2026-10-01T000000Z-red ]]; print $?)
ck "a file that is not evidence (keepme.bin) is untouched" $([[ $(stat -f '%z %m' $H/keepme.bin) == $k0 ]]; print $?)
ck "live files kept: guardian.log guardian.out history.jsonl events.jsonl state.json" $([[ -s $H/log/guardian.log && -s $H/log/guardian.out && -s $H/history.jsonl && -s $H/events.jsonl && -s $H/state.json ]]; print $?)
# housekeeping runs before the same poll's rotation, so its lines are in guardian.log.1
hk=$(cat $H/log/guardian.log $H/log/guardian.log.1 2>/dev/null | grep -c 'housekeeping: removed')
# 1 by retention + 3 rotated (2 beyond generations, 1 over the cap) + 1 incident over the cap
ck "housekeeping logged each of its 5 removals" $(( hk == 5 ? 0 : 1 )) "$hk lines"
stop_gd
fi

# ==================================================================================
if want s8; then
print "== s8. publication fails on a full volume -> previous files intact, CRITICAL_NOW logged =="
# s8_arm LABEL BIN: the domain on a 2 MB HFS+ image; its log, events and history are
# symlinked to the real disk so the evidence of the failure survives the failure.
s8_arm() {
  local label=$1 bin=$2 i
  mkdir -p $ROOT/img $ROOT/mnt
  rm -f $ROOT/img/fg.dmg
  hdiutil create -size 2m -fs HFS+ -volname fgtest $ROOT/img/fg.dmg >/dev/null 2>&1 \
    && hdiutil attach $ROOT/img/fg.dmg -nobrowse -mountpoint $ROOT/mnt >/dev/null 2>&1 || return 1
  MNT=$ROOT/mnt; print -r -- $MNT > $ROOT/mnt.path
  mkdom s8_$label intel
  mkdir -p $MNT/h $MNT/ah $D/real_log; ln -s $D/real_log $MNT/h/log
  : > $D/real_events.jsonl; ln -s $D/real_events.jsonl $MNT/h/events.jsonl
  : > $D/real_hist.jsonl; ln -s $D/real_hist.jsonl $MNT/h/history.jsonl
  GD_BIN=$bin start_gd FORGE_HEALTH_DIR=$MNT/h ARCHIE_HEALTH_DIR=$MNT/ah
  wait_until 15 '[[ -f $MNT/h/state && "$(<$MNT/h/state)" == GREEN ]]'; S8_SETUP=$?
  cp $MNT/h/state.json $ROOT/s8.before.json 2>/dev/null
  dd if=/dev/zero of=$MNT/junk bs=65536 >/dev/null 2>&1
  dd if=/dev/zero of=$MNT/junk2 bs=4096 >/dev/null 2>&1
  i=0; while (( i < 64 )) && { print x > $MNT/fill.$i } 2>/dev/null; do (( i++ )); done
  sleep 3.5
  S8_PARSE=$(jq_ $MNT/h/state.json 'd["state"]'); S8_LAW7=$(jq_ $MNT/ah/status.json 'd["state"]')
  cmp -s $MNT/h/state.json $ROOT/s8.before.json; S8_SAME=$?
  lit=($MNT/h/*.tmp.* $MNT/ah/*.tmp.*); S8_LITTER=${lit[*]:-}
  kill -0 $GP 2>/dev/null; S8_ALIVE=$?
  rm -f $MNT/junk $MNT/junk2 $MNT/fill.*
  sleep 2.5
  S8_AFTER=$(jq_ $MNT/h/state.json 'd["state"]')
  stop_gd
  detach
  return 0
}
if s8_arm v2 ""; then
  ck "setup: GREEN on the tiny volume" $S8_SETUP
  ck "state.json still parses" $([[ $S8_PARSE != ERR:* ]]; print $?) "$S8_PARSE"
  ck "  ...and is the last GOOD publication (no partial file renamed over it)" $S8_SAME
  ck "Law-7 status.json still parses" $([[ $S8_LAW7 != ERR:* ]]; print $?)
  ck "no *.tmp.<pid> litter left on the full volume" $([[ -z $S8_LITTER ]]; print $?) "${S8_LITTER:-none}"
  ck "PUBLISH FAILED logged" $(grep -q 'PUBLISH FAILED' $D/real_log/guardian.log; print $?)
  ck "CRITICAL_NOW logged for the failed publication" $(grep -q 'CRITICAL_NOW: state publication failed' $D/real_log/guardian.log; print $?) "$(grep -m1 'CRITICAL_NOW: state' $D/real_log/guardian.log | cut -c21-120)"
  ck "publish_error event with file and errno 28 (ENOSPC)" $(grep -q '"kind": "publish_error", "file": "state", "errno": 28' $D/real_events.jsonl; print $?) "$(grep -m1 publish_error $D/real_events.jsonl)"
  ck "the governor is alive through it" $S8_ALIVE
  ck "space back: publication resumes, and the failure had driven it RED (CRITICAL_NOW acted)" $([[ $S8_AFTER == RED ]]; print $?) "state=$S8_AFTER"
  if [[ -n $OLD ]] && s8_arm parent $OLD; then
    ck "parent tree $OLD_REV: a failed publication changes nothing (still GREEN after, no event)" \
       $([[ $S8_AFTER == GREEN ]] && ! grep -q publish_error $D/real_events.jsonl; print $?) "state=$S8_AFTER; stderr: $(grep -m1 -o 'mv: rename.*' $D/launch.out | cut -c1-60)"
  else skip "parent-tree arm of s8"; fi
else
  skip "s8: could not create/attach a 2 MB disk image"
fi
fi

# ==================================================================================
if want s9; then
print "== s9. Law-7 directory safety =="
mkdom s9 intel
mkdir -p $D/ahreal; ln -s $D/ahreal $D/ahlink
start_gd ARCHIE_HEALTH_DIR=$D/ahlink
sleep 4
ck "a symlinked Law-7 dir is refused: nothing written through it" $([[ ! -e $D/ahreal/status.json ]]; print $?)
ck "  ...refusal logged ONCE over 4 polls" $(( $(grep -c 'REFUSING to write the Law-7 signal' $D/h/log/guardian.log) == 1 ? 0 : 1 )) "$(grep -m1 REFUSING $D/h/log/guardian.log | cut -c21-)"
ck "  ...state.json is still published" $([[ $(sj 'd["state"]') != ERR:* ]]; print $?)
stop_gd
mkdom s9b intel
start_gd ARCHIE_HEALTH_DIR=/usr/share
sleep 3
ck "a Law-7 dir owned by another uid (/usr/share, root) is refused" $(grep -q 'REFUSING to write the Law-7 signal: /usr/share is owned by uid 0' $D/h/log/guardian.log; print $?)
stop_gd
mkdom s9c intel
start_gd ARCHIE_HEALTH_DIR=$D/fresh_ah
sleep 2
ck "an absent Law-7 dir is created 0700 and written" $([[ $(stat -f %Lp $D/fresh_ah 2>/dev/null) == 700 && -s $D/fresh_ah/status.json ]]; print $?) "mode=$(stat -f %Lp $D/fresh_ah 2>/dev/null)"
stop_gd
fi

# ==================================================================================
if want s10; then
print "== s10. notifications: once per kind within the rate limit; a hung notifier is killed =="
mkdom s10 as
start_gd FORGE_GUARDIAN_SENSOR_BIN=$STUB FORGE_GUARDIAN_UNKNOWN_NOTIFY_S=2
wait_until 15 'state_is GREEN'; ck "setup: GREEN (after > 2 s of start-up UNKNOWN)" $?
crit_trial 1; wait_until 15 'state_is GREEN'
crit_trial 1; sleep 1.5
mkdir -p $D/h/quarantine $D/h/incidents
print '{}' > $D/h/quarantine/aaaa1111aaaa1111.json; sleep 1.5
print '{}' > $D/h/quarantine/bbbb2222bbbb2222.json; sleep 1.5
mkdir -p $D/h/incidents/2026-10-08T120000Z-manual; sleep 2
cnt() { local n; n=$(grep -c "$1" $D/notified 2>/dev/null); print ${n:-0} }   # grep -c prints 0 AND exits 1
ck "RED twice -> ONE 'red' notification" $(( $(cnt 'Forge Guardian: RED') == 1 ? 0 : 1 )) "$(cnt 'Forge Guardian: RED')"
ck "  ...the second was rate-limited (logged, not sent)" $(grep -q "notification 'red' rate-limited" $D/h/log/guardian.log; print $?)
ck "UNKNOWN > threshold -> ONE 'unknown' notification" $(( $(cnt 'state UNKNOWN') == 1 ? 0 : 1 )) "$(cnt 'state UNKNOWN')"
ck "two new quarantines -> ONE 'quarantine' notification" $(( $(cnt 'job quarantined') == 1 ? 0 : 1 )) "$(cnt 'job quarantined')"
ck "a new incident dir -> ONE 'incident' notification" $(( $(cnt 'incident recorded') == 1 ? 0 : 1 )) "$(cnt 'incident recorded')"
stop_gd
mkdom s10h as
print -r -- "#!/bin/zsh
print \$\$ >> $D/hang.pids
exec sleep 30" > $D/hang; chmod +x $D/hang
start_gd FORGE_GUARDIAN_UNKNOWN_NOTIFY_S=1 FORGE_GUARDIAN_NOTIFY_CMD=$D/hang
wait_until 6 '[[ -s $D/hang.pids ]]'; t_h=$EPOCHREALTIME; hp=$(head -1 $D/hang.pids 2>/dev/null)
wait_until 9 '! kill -0 $hp 2>/dev/null'; r=$?
ck "a notifier that hangs is killed after ~5 s" $r "gone $(t3 $(( EPOCHREALTIME - t_h )))s after it started"
wait_until 3 'grep -q "command killed after 5s" $D/h/log/guardian.log'; r=$?
ck "  ...and the governor logged it and carried on" $(( r == 0 ? 0 : 1 )) "$(kill -0 $GP 2>/dev/null && print alive || print DEAD)"
stop_gd
fi

# ==================================================================================
if want s11; then
print "== s11. restart-loop breaker: 6 quick restarts -> backoff, UNKNOWN published =="
mkdom s11 intel
print "guardian_restart_loop_backoff_s=10" > $D/h/policy.env          # SCHEMA §6 minimum
for n in 1 2 3 4; do
  start_gd; wait_until 8 '[[ -f $D/h/state ]] && grep -q ARMED $D/h/log/guardian.log'; sleep 0.5; stop_gd
done
ck "4 starts: no restart loop yet" $(( $(grep -c 'restart loop' $D/h/log/guardian.log) == 0 ? 0 : 1 ))
start_gd; sleep 2.5
ck "5th start within the window: backoff engaged (logged once)" $(( $(grep -c 'GUARDIAN guardian restart loop: 5 starts' $D/h/log/guardian.log) == 1 ? 0 : 1 ))
ck "  ...UNKNOWN published, reason says so" $([[ $(sj 'd["state"]') == UNKNOWN && $(sj 'd["reason"]') == *'restart loop'* ]]; print $?) "$(sj 'd["reason"]')"
ck "  ...guardian_restart_loop event appended" $(grep -q '"kind": "guardian_restart_loop", "starts": 5' $D/h/events.jsonl; print $?)
m1=$(stat -f %m $D/h/state); sleep 2.2; m2=$(stat -f %m $D/h/state)
ck "  ...re-published every poll during the backoff (gates stay closed, not stale)" $(( m2 > m1 ? 0 : 1 ))
t0=$EPOCHREALTIME; stop_gd
ck "  ...TERM during the backoff is honoured at once" $(( EPOCHREALTIME - t0 < 2 ? 0 : 1 )) "$(t3 $(( EPOCHREALTIME - t0 )))s"
start_gd; sleep 2
ck "6th start: still in backoff" $([[ $(sj 'd["reason"]') == *'6 starts'* ]]; print $?) "$(sj 'd["reason"]')"
wait_until 30 'state_is GREEN'; r=$?
ck "after backoff_s it governs normally again (reaches GREEN)" $r "after $(t3 $WAITED)s"
ck "  ...and said so" $(grep -q 'restart-loop backoff over' $D/h/log/guardian.log; print $?)
stop_gd
fi

# ==================================================================================
lstart_epoch() { local o w; o=$(LC_ALL=C ps -o lstart= -p $1 2>/dev/null); w=(${=o}); local LC_ALL=C; REPLY=""; strftime -r -s REPLY '%a %b %d %H:%M:%S %Y' "$w[1] $w[2] $w[3] $w[4] $w[5]" 2>/dev/null }
if want s12; then
print "== s12. eviction events (shed, cancel_latency, reap, stall), SMART, policy reload, 0700 domain =="
mkdom s12 intel
print -r -- '#!/bin/zsh
trap '"'"'print USR1 >> "$1"'"'"' USR1
trap '"'"'print TERM >> "$1"; exit 0'"'"' TERM
while true; do sleep 0.2 & wait $!; done' > $D/victim; chmod +x $D/victim
$D/victim $D/victim.log & VP=$!; print $VP >> $PIDF
/usr/bin/true & DP=$!; wait $DP
sleep 0.3; lstart_epoch $VP; vps=$REPLY
touch -t 202601010000 $D/hb
{ print "pid=$VP"; print "name=evict-probe"; print "priority=9"; print "can_restart=1"; print "peak_gb=1.5"; print "gpu=1"
  print "started=$EPOCHSECONDS"; print "schema=2"; print "pstart=$vps"; print "sig=0123456789abcdef"
  print "heartbeat=$D/hb"; print "stall_s=2"; print "cmd=victim"; } > $D/h/jobs/$VP.job
{ print "pid=$DP"; print "name=already-dead"; print "priority=5"; print "can_restart=1"; print "peak_gb=1"; print "started=$EPOCHSECONDS"; print "cmd=true"; } > $D/h/jobs/$DP.job
# SCHEMA §6 bounds smart_interval_s to >= 600 s; FORGE_GUARDIAN_SMART_S is the test override
# (like FORGE_GUARDIAN_POLL) that re-probes every second here.
obs OBS_VMP=4
start_gd FORGE_GUARDIAN_SETTLE=0 FORGE_GUARDIAN_TERM_GRACE=30 FORGE_GUARDIAN_SMART_S=1
wait_until 10 '! kill -0 $VP 2>/dev/null'; ck "RED -> stage 1 USR1 -> stage 3 TERM: the registered job was evicted" $? "victim log: $(tr '\n' ' ' < $D/victim.log 2>/dev/null)"
wait_until 4 'grep -q cancel_latency $D/h/events.jsonl'
# (a victim that dies at once has its cancel_latency logged in the TERM's own poll and its
# envelope reaped one poll LATER: wait for that poll rather than race it -- round-1 flake)
wait_until 4 'grep -q "\"kind\": \"reap\", \"pid\": $VP," $D/h/events.jsonl'
E=$D/h/events.jsonl
ck "shed events: USR1 then TERM, carrying the job signature" $(grep -q '"kind": "shed", "sig": "0123456789abcdef", "signal": "USR1", "pid": '$VP $E && grep -q '"signal": "TERM", "pid": '$VP $E; print $?)
ck "cancel_latency event (TERM sent -> pid gone)" $(grep -q '"kind": "cancel_latency", "pid": '$VP', "s": ' $E; print $?) "$(grep -m1 -o '"kind": "cancel_latency".*' $E)"
ck "reap event for the evicted job (why dead)" $(grep -q '"kind": "reap", "pid": '$VP', "why": "dead"' $E; print $?)
ck "reap event for an envelope whose process was already gone" $(grep -q '"kind": "reap", "pid": '$DP', "why": "dead"' $E; print $?)
ck "stall event: heartbeat older than stall_s, once" $(( $(grep -c '"kind": "stall", "pid": '$VP', "name": "evict-probe"' $E) == 1 ? 0 : 1 )) "$(grep -m1 -o '"kind": "stall".*' $E)"
ck "transition event to RED" $(grep -q '"kind": "transition", "from": "UNKNOWN", "to": "RED"' $E; print $?)
ck "every events.jsonl line is a JSON object with ts and kind" $(python3 -I -c 'import json,sys
L=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
sys.exit(0 if L and all(isinstance(x.get("ts"),(int,float)) and isinstance(x.get("kind"),str) for x in L) else 1)' $E; print $?)
ck "disk_hardware from the SMART stub: Verified" $([[ $(sj 'd["disk_hardware"]') == Verified ]]; print $?)
print -r -- "#!/bin/zsh
print '<key>SMARTStatus</key><string>Failing</string>'" > $D/diskutil
wait_until 5 '[[ $(sj "d[\"disk_hardware\"]") == Failing ]]'; ck "SMART Failing is published" $?
print -r -- "#!/bin/zsh
print 'garbage'" > $D/diskutil
wait_until 5 '[[ $(sj "d[\"disk_hardware\"]") == UNKNOWN ]]'; ck "unparseable SMART output -> UNKNOWN" $?
print "disk_floors_gib_yellow=300\ndisk_floors_gib_orange=200\ndisk_floors_gib_red=100" > $D/h/policy.env.tmp; mv $D/h/policy.env.tmp $D/h/policy.env
wait_until 5 'grep -q "policy reloaded" $D/h/log/guardian.log'; ck "policy.env change is picked up without a restart" $?
wait_until 3 '[[ $(sj "d[\"volumes\"][0][\"floor_gb\"]") == 300 ]]'; ck "  ...the new admission floor is published" $? "floor_gb=$(sj 'd["volumes"][0]["floor_gb"]')"
ck "state.json is mode 0600" $([[ $(stat -f %Lp $D/h/state.json) == 600 ]]; print $?) "$(stat -f %Lp $D/h/state.json)"
stop_gd
D2=$D; mkdom s12b intel
start_gd FORGE_HEALTH_DIR=$D/fresh/domain
wait_until 4 '[[ -f $D/fresh/domain/state.json ]]'
ck "an absent domain is created 0700 (dir, jobs/, log/)" $([[ $(stat -f %Lp $D/fresh/domain) == 700 && $(stat -f %Lp $D/fresh/domain/jobs) == 700 && $(stat -f %Lp $D/fresh/domain/log) == 700 ]]; print $?) "$(stat -f %Lp $D/fresh/domain) $(stat -f %Lp $D/fresh/domain/jobs) $(stat -f %Lp $D/fresh/domain/log)"
stop_gd
fi

# ==================================================================================
if want s13; then
print "== s13. forge-gate: freshness from BOTH clocks; optional resource fit via admit --dry-run =="
FG=${SRC:h}/forge-gate
OLDG=""; [[ -n $OLD ]] && git -C "$top" show "${OLD_REV}:tools/guardian/forge-gate" > $ROOT/oldbin/forge-gate 2>/dev/null && OLDG=$ROOT/oldbin/forge-gate
mkdom s13 intel; H=$D/h
fake_gov $H                                      # a live "governor" holds the lock (FO-4)
pub() { # pub STATE EPOCH_OFFSET
  print -r -- $1 > $H/state; print -- "{\n  \"state\": \"$1\",\n  \"epoch\": $(( EPOCHSECONDS + $2 )),\n  \"build_jobs_max\": 8\n}" > $H/state.json }
gate() { # gate BIN [args] -> RC, OUT
  OUT=$( FORGE_HEALTH_DIR=$H FORGE_GUARDIAN_SENSOR_BIN=${SB:-} STUB_SENSOR_LOG=$D/stub.log STUB_ADMIT_RC=${ARC:-0} zsh "$@" 2>&1 ); RC=$?
}
SB=""; ARC=0
pub GREEN 0; gate $FG --need green; ck "fresh GREEN admits" $RC "$OUT"
pub GREEN 0; touch -t $(date -v-120S +%Y%m%d%H%M.%S) $H/state; gate $FG --need green
ck "state mtime 120 s old -> deny" $(( RC == 1 ? 0 : 1 )) "$OUT"
pub GREEN -120; gate $FG --need green
ck "fresh mtime but state.json epoch 120 s old -> deny" $(( RC == 1 ? 0 : 1 )) "$OUT"
if [[ -n $OLDG ]]; then gate $OLDG --need green; ck "  parent tree's gate ADMITS that stale epoch (the defect)" $(( RC == 0 ? 0 : 1 )) "rc=$RC"; fi
pub GREEN 100; gate $FG --need green
ck "state.json epoch 100 s in the future -> deny (clock skew)" $(( RC == 1 ? 0 : 1 )) "$OUT"
if [[ -n $OLDG ]]; then gate $OLDG --need green; ck "  parent tree's gate ADMITS the skewed epoch" $(( RC == 0 ? 0 : 1 )) "rc=$RC"; fi
pub GREEN 0; touch -t $(date -v+100S +%Y%m%d%H%M.%S) $H/state; gate $FG --need green
ck "state mtime 100 s in the future -> deny" $(( RC == 1 ? 0 : 1 )) "$OUT"
pub GREEN 0; rm -f $H/state.json; gate $FG --need green
ck "state.json missing -> deny (freshness unverifiable)" $(( RC == 1 ? 0 : 1 )) "$OUT"
pub UNKNOWN 0; gate $FG --need red; ck "UNKNOWN admits only --need red" $RC
gate $FG --need orange; ck "UNKNOWN denies --need orange" $(( RC == 1 ? 0 : 1 ))
pub GREEN 0; : > $D/stub.log; SB=$STUB; ARC=0
gate $FG --need green --why build-x --peak-gb 8 --threads 4 --gpu
ck "--peak-gb: delegated to admit --dry-run, admitted" $RC
ck "  ...with the documented argv" $(grep -q "admit --dry-run --state-dir $H --pid [0-9]* --name build-x --need green --peak-gb 8 --threads 4 --gpu" $D/stub.log; print $?) "$(tail -1 $D/stub.log | cut -d' ' -f2-)"
ARC=1; gate $FG --need green --peak-gb 8; ck "admit exit 1 -> deny" $(( RC == 1 ? 0 : 1 )) "$OUT"
ARC=0; : > $D/stub.log; gate $FG --need green --disk-gb 5 --disk-path /tmp
ck "--disk-gb alone: --peak-gb 0 supplied (admit requires it)" $(grep -q -- '--peak-gb 0 --disk-gb 5 --disk-path /tmp' $D/stub.log; print $?)
ARC=78; t0=$EPOCHREALTIME; gate $FG --need green --wait 10 --peak-gb 8
ck "quarantined (78) denies at once, not after --wait" $(( RC == 1 && EPOCHREALTIME - t0 < 3 ? 0 : 1 )) "$(t3 $(( EPOCHREALTIME - t0 )))s"
ARC=0; SB=""; gate $FG --need green --peak-gb 8
ck "--peak-gb with NO sensor anywhere -> deny (fail closed)" $(( RC == 1 ? 0 : 1 )) "$OUT"
: > $D/stub.log; SB=$STUB; gate $FG --need green
ck "no resource flags: admit is never called (v1 behaviour)" $([[ $RC == 0 && ! -s $D/stub.log ]]; print $?)
gate $FG --need; ck "a flag without its value is a usage error (v1 looped for ever)" $(( RC == 2 ? 0 : 1 ))
print "  -- a malformed call never admits (review 2026-10-08 SEM-2, FO-1, FO-2) --"
SB=$STUB; ARC=0; bad=()
for s_ in RED UNKNOWN BOGUS; do
  pub $s_ 0
  for w in grn grren gren unknown light '' 'green ' ' green' 'GREEN ' 'red red'; do
    gate $FG --need "$w"; [[ $RC == 2 ]] || bad+=("$s_/'$w'->rc$RC")
  done
done
ck "state RED/UNKNOWN/BOGUS + a bad --need word -> exit 2 (usage), never admitted" $(( ${#bad} == 0 ? 0 : 1 )) "${bad[*]:-all exit 2}"
pub BOGUS 0; gate $FG --need red
ck "a state word the gate does not know denies even --need red" $(( RC == 1 ? 0 : 1 )) "rc=$RC"
pub GREEN 0; bad=(); : > $D/stub.log
for a_ in '--peak-gb=1000' '--disk-gb=100000 --disk-path=/tmp' '--peak_gb 1000' '-peak-gb 1000' '--peakgb 1000' 'stray'; do
  gate $FG --need green ${=a_}; [[ $RC == 2 ]] || bad+=("'$a_'->rc$RC")
done
ck "an unknown argument (--peak-gb=N, a misspelled flag) -> exit 2, never a skipped check" $(( ${#bad} == 0 ? 0 : 1 )) "${bad[*]:-all exit 2}"
ck "  ...and admit was never consulted for them" $([[ ! -s $D/stub.log ]]; print $?)
gate $FG --need GREEN; ck "control: --need GREEN (case-insensitive) still admits a fresh GREEN" $RC "$OUT"
print "  -- fresh files are not a live governor (review 2026-10-08 FO-4) --"
SB=""; pub GREEN 0
kill -9 $FGP 2>/dev/null; wait $FGP 2>/dev/null
gate $FG --need green
ck "the lock holder is dead: fresh GREEN files are DENIED" $(( RC == 1 ? 0 : 1 )) "$OUT"
rm -rf $H/guardian.lock; fake_gov $H; print $(( $(<$H/guardian.lock/pstart) - 100 )) > $H/guardian.lock/pstart; pub GREEN 0
gate $FG --need green
ck "the lock's pid is alive but guardian.lock/pstart is 100 s off (reused pid) -> deny" $(( RC == 1 ? 0 : 1 )) "$OUT"
rm -rf $H/guardian.lock; fake_gov $H legacy; print "Thu Jan  1 00:00:00 2026" > $H/guardian.lock/started; pub GREEN 0
gate $FG --need green
ck "a v1 lock (no pstart) whose started text names another start (reused pid) -> deny" $(( RC == 1 ? 0 : 1 )) "$OUT"
rm -rf $H/guardian.lock; fake_gov $H; print "garbage" > $H/guardian.lock/pstart; pub GREEN 0
gate $FG --need green
ck "a guardian.lock/pstart that is not an epoch -> deny (never a fall-back to the text)" $(( RC == 1 ? 0 : 1 )) "$OUT"
# SCHEMA §2.1: a symlinked pstart identifies nobody (review 2026-10-08 round 2, verify):
# a DANGLING one failed `-e` and was read as "no pstart", i.e. the v1 text path -- and
# the text (written in this zone) matched, so the gate admitted on an unverifiable lock.
rm -rf $H/guardian.lock; fake_gov $H; rm -f $H/guardian.lock/pstart; ln -s $H/no-such-pstart $H/guardian.lock/pstart; pub GREEN 0
gate $FG --need green
ck "a DANGLING guardian.lock/pstart symlink -> deny (never read as 'no pstart', the v1 text path)" $(( RC == 1 ? 0 : 1 )) "$OUT"
rm -rf $H/guardian.lock; fake_gov $H; mv $H/guardian.lock/pstart $H/pstart.real; ln -s $H/pstart.real $H/guardian.lock/pstart; pub GREEN 0
gate $FG --need green
ck "a guardian.lock/pstart SYMLINKED to the right epoch -> deny (a symlink identifies nobody)" $(( RC == 1 ? 0 : 1 )) "$OUT"
rm -f $H/pstart.real
bad=()
rm -rf $H/guardian.lock; fake_gov $H                    # the forms below all name THIS live governor
for v in "0$FGP" "+$FGP" "$(( FGP + 4294967296 ))"; do
  print -r -- "$v" > $H/guardian.lock/pid; pub GREEN 0
  gate $FG --need green; (( RC == 1 )) || bad+=("'$v'->rc$RC")
done
print -r -- $FGP > $H/guardian.lock/pid; pub GREEN 0; gate $FG --need green; ctl_rc=$RC
ck "a non-canonical guardian.lock/pid (0N, +N, 2^32+N) naming the live governor -> deny; the canonical form admits" $(( ${#bad} == 0 && ctl_rc == 0 ? 0 : 1 )) "${bad[*]:-all denied}; canonical rc=$ctl_rc"
sleep 600 </dev/null >/dev/null 2>&1 & NG=$!; print $NG >> $PIDF; sleep 0.2
print $NG > $H/guardian.lock/pid; utc_pstart $NG; print $REPLY > $H/guardian.lock/pstart; LC_ALL=C ps -p $NG -o lstart= > $H/guardian.lock/started; pub GREEN 0
gate $FG --need green
ck "the lock names a live process that is not a forge-guardian (its start right) -> deny" $(( RC == 1 ? 0 : 1 )) "$OUT"
kill $NG 2>/dev/null
rm -rf $H/guardian.lock; pub GREEN 0; gate $FG --need green
ck "no guardian.lock at all -> deny" $(( RC == 1 ? 0 : 1 )) "$OUT"
fake_gov $H; pub GREEN 0; gate $FG --need green
ck "control: a live governor holding the lock -> admitted" $RC "$OUT"
# THE ROUND-2 REGRESSION (FO-4): the lock's start was compared as local-time TEXT, so a
# caller in another time zone (TZ=UTC from a tool or CI, a system time-zone change) was
# denied by a live governor. guardian.lock/pstart is an epoch: every caller agrees.
bad=()
for e in TZ=UTC TZ=America/Los_Angeles TZ=Asia/Kolkata LC_ALL=de_DE.UTF-8 "LC_ALL=de_DE.UTF-8 TZ=Pacific/Auckland"; do
  pub GREEN 0; OUT=$( env ${=e} FORGE_HEALTH_DIR=$H zsh $FG --need green 2>&1 ); RC=$?
  (( RC == 0 )) || bad+=("$e->rc$RC:${OUT[1,120]}")
done
ck "a live governor's lock is recognised under TZ=UTC, America/Los_Angeles, Asia/Kolkata, de_DE, de_DE+Auckland -> admitted" $(( ${#bad} == 0 ? 0 : 1 )) "${bad[*]:-all admitted}"
rm -rf $H/guardian.lock; fake_gov $H legacy; pub GREEN 0; gate $FG --need green
ck "v1 compatibility: a lock with no pstart, read in the writer's zone -> admitted" $RC "$OUT"
rm -rf $H/guardian.lock; fake_gov $H
fi

# ==================================================================================
if want s14; then
print "== s14. forge-nproc: build_jobs_max minus threads reserved by OTHER live, verified jobs =="
FN=${SRC:h}/forge-nproc
OLDN=""; [[ -n $OLD ]] && git -C "$top" show "${OLD_REV}:tools/guardian/forge-nproc" > $ROOT/oldbin/forge-nproc 2>/dev/null && OLDN=$ROOT/oldbin/forge-nproc
mkdom s14 intel; H=$D/h
fake_gov $H                                      # a live "governor" holds the lock (FO-4)
print GREEN > $H/state; print -- "{\n  \"epoch\": $EPOCHSECONDS,\n  \"build_jobs_max\": 8\n}" > $H/state.json
np() { FORGE_HEALTH_DIR=$H zsh ${1:-$FN} 2>&1 }
env_() { # env_ FILE PID THREADS [started|-] [pstart]
  { print "pid=$2"; print "name=${1:t:r}"; print "priority=5"; print "can_restart=0"; print "peak_gb=1"; print "gpu=0"
    [[ ${4:--} != - ]] && print "started=$4"; [[ -n ${5:-} ]] && print "pstart=$5"; print "threads=$3"; print "cmd=x"; } > $H/jobs/$1 }
ck "no envelopes: build_jobs_max" $([[ $(np) == 8 ]]; print $?) "$(np)"
sleep 300 & S1=$!; print $S1 >> $PIDF; sleep 300 & S2=$!; print $S2 >> $PIDF; sleep 300 & S3=$!; print $S3 >> $PIDF
sleep 0.3
env_ other.job $S1 3 $EPOCHSECONDS
ck "another live job holding 3 threads: 8-3" $([[ $(np) == 5 ]]; print $?) "$(np)"
[[ -n $OLDN ]] && ck "  parent tree's forge-nproc ignores it (prints 8)" $([[ $(np $OLDN) == 8 ]]; print $?) "$(np $OLDN)"
env_ mine.job $$ 2 $EPOCHSECONDS
ck "the caller's own ancestor's reservation is not charged" $([[ $(np) == 5 ]]; print $?) "$(np)"
env_ unver.job $S2 2 -
ck "an unverifiable envelope (no started/pstart) is not counted" $([[ $(np) == 5 ]]; print $?) "$(np)"
env_ reused.job $S3 2 $(( EPOCHSECONDS - 3600 ))
ck "a reused-pid envelope (started an hour before its process) is not counted" $([[ $(np) == 5 ]]; print $?) "$(np)"
/usr/bin/true & dp=$!; wait $dp; env_ dead.job $dp 2 $EPOCHSECONDS
ck "a dead pid's envelope is not counted" $([[ $(np) == 5 ]]; print $?) "$(np)"
lstart_epoch $S2; env_ unver.job $S2 2 - $REPLY
ck "pstart (v2 identity) verifies: 8-3-2" $([[ $(np) == 3 ]]; print $?) "$(np)"
env_ big.job $S3 40 - $( lstart_epoch $S3; print $REPLY )
ck "never below 1" $([[ $(np) == 1 ]]; print $?) "$(np)"
print -- "{\n  \"epoch\": $(( EPOCHSECONDS - 120 )),\n  \"build_jobs_max\": 8\n}" > $H/state.json
ck "stale epoch -> 2 (fail safe)" $([[ $(np) == 2 ]]; print $?) "$(np)"
print "  -- the state is believed only while its governor lives (review 2026-10-08 FO-4) --"
rm -f $H/jobs/*.job
fresh() { print -- "{\n  \"epoch\": $EPOCHSECONDS,\n  \"build_jobs_max\": 8\n}" > $H/state.json }
fresh; ck "control: fresh state.json, live governor -> 8" $([[ $(np) == 8 ]]; print $?) "$(np)"
kill -9 $FGP 2>/dev/null; wait $FGP 2>/dev/null; fresh
ck "the governor holding the lock is dead -> 2 (its GREEN -j8 is not live)" $([[ $(np) == 2 ]]; print $?) "$(np)"
rm -rf $H/guardian.lock; fresh
ck "no guardian.lock -> 2" $([[ $(np) == 2 ]]; print $?) "$(np)"
fake_gov $H; print $(( $(<$H/guardian.lock/pstart) - 100 )) > $H/guardian.lock/pstart; fresh
ck "lock pid alive but guardian.lock/pstart 100 s off -> 2" $([[ $(np) == 2 ]]; print $?) "$(np)"
rm -rf $H/guardian.lock; fake_gov $H legacy; print "Thu Jan  1 00:00:00 2026" > $H/guardian.lock/started; fresh
ck "v1 lock (no pstart): pid alive but another start text -> 2" $([[ $(np) == 2 ]]; print $?) "$(np)"
rm -rf $H/guardian.lock; fake_gov $H; print -r -- "0$FGP" > $H/guardian.lock/pid; fresh
ck "a non-canonical guardian.lock/pid (0N) naming the live governor -> 2" $([[ $(np) == 2 ]]; print $?) "$(np)"
rm -rf $H/guardian.lock; fake_gov $H; rm -f $H/guardian.lock/pstart; ln -s $H/no-such-pstart $H/guardian.lock/pstart; fresh
ck "a DANGLING guardian.lock/pstart symlink -> 2 (never the v1 text path; SCHEMA §2.1)" $([[ $(np) == 2 ]]; print $?) "$(np)"
rm -rf $H/guardian.lock; fake_gov $H; mv $H/guardian.lock/pstart $H/pstart.real; ln -s $H/pstart.real $H/guardian.lock/pstart; fresh
ck "a guardian.lock/pstart SYMLINKED to the right epoch -> 2" $([[ $(np) == 2 ]]; print $?) "$(np)"
rm -f $H/pstart.real
sleep 600 </dev/null >/dev/null 2>&1 & NG=$!; print $NG >> $PIDF; sleep 0.2
rm -rf $H/guardian.lock; mkdir -p $H/guardian.lock; print $NG > $H/guardian.lock/pid; utc_pstart $NG; print $REPLY > $H/guardian.lock/pstart; fresh
ck "the lock names a live process that is not a forge-guardian (its start right) -> 2" $([[ $(np) == 2 ]]; print $?) "$(np)"
kill $NG 2>/dev/null
rm -rf $H/guardian.lock; fake_gov $H; fresh
ck "control: a live governor again -> 8" $([[ $(np) == 8 ]]; print $?) "$(np)"
bad=()
for e in TZ=UTC TZ=America/Los_Angeles TZ=Asia/Kolkata LC_ALL=de_DE.UTF-8 "LC_ALL=de_DE.UTF-8 TZ=Pacific/Auckland"; do
  fresh; v=$( env ${=e} FORGE_HEALTH_DIR=$H zsh $FN 2>&1 ); [[ $v == 8 ]] || bad+=("$e->$v")
done
ck "a live governor's lock is recognised under TZ=UTC, America/Los_Angeles, Asia/Kolkata, de_DE, de_DE+Auckland -> 8 (FO-4 round 2)" $(( ${#bad} == 0 ? 0 : 1 )) "${bad[*]:-all 8}"
rm -rf $H/guardian.lock; fake_gov $H legacy; fresh
ck "v1 compatibility: a lock with no pstart, read in the writer's zone -> 8" $([[ $(np) == 8 ]]; print $?) "$(np)"
rm -rf $H/guardian.lock; fake_gov $H; fresh
env_ pad.job 0$S1 3 $EPOCHSECONDS
ck "a non-canonical pid (0$S1) is an invalid envelope: not counted (ACT-3)" $([[ $(np) == 8 ]]; print $?) "$(np)"
kill $S1 $S2 $S3 2>/dev/null
fi

# ==================================================================================
if want s15; then
print "== s15. fuzz: garbage in every sensor.env key and hostile envelopes never crash the governor =="
mkdom s15 as
H=$D/h
# hostile envelopes (none may ever be signalled: no live verifiable pid among them)
print 'pid=abc\nname=$(touch '$D'/PWNED)\npriority=zz\ncan_restart=1\npeak_gb=1e9\nstarted=abc\ncmd=x' > $H/jobs/a.job
print 'pid=-5\npriority=-3\ncan_restart=1\npeak_gb=-1\ncmd=y' > $H/jobs/b.job
print -n 'pid=99999999999999999999999\npriority=9999999999999999999999\ncan_restart=1' > $H/jobs/c.job
head -c 70000 /dev/zero | tr '\0' 'p' > $H/jobs/d.job
printf 'pid=1\nname=`id`\npriority=9\ncan_restart=1\nstarted=1\ncmd=z' > $H/jobs/e.job
head -c 300 /dev/urandom > $H/jobs/f.job
print 'not an envelope' > $H/jobs/readme.txt
start_gd FORGE_GUARDIAN_SENSOR_BIN=$STUB FORGE_GUARDIAN_SETTLE=0
keys=(vmp vmp_st freepct freepct_st swap_used_mb swap_total_mb swap_st pageout_rate_ps pageouts_st thermal thermal_st
      disk_min_avail_gib disk_st vol_n vol0_avail_b vol0_st vol0_mount pevent pevent_ts pevent_crit_n pevent_st reserved_b
      budget_b overcommit jobs_n job0_pid job0_identity job0_hb_age_s load1 mem_st cpu_st ts_s pid schema poll_s seq)
vals=("" "-1" "abc" "1e9" "99999999999999999999999" "1.2.3" " " '$(touch '$D'/PWNED2)' '`id`' "nan" "-0" "0x10" "1;2"
      "$(head -c 3000 /dev/zero | tr '\0' 9)" "ü" "ok" "invalid" "critical" "4" "0" "2" "stale" "unavailable" "none" "1.5" "-9999")
bad=0 polls=0 states=""
for round in {1..45}; do
  : > $H/stub.obs.tmp
  for k in $keys; do (( RANDOM % 3 == 0 )) && print -r -- "$k=${vals[$(( RANDOM % ${#vals} + 1 ))]}" >> $H/stub.obs.tmp; done
  (( round % 9 == 0 )) && print 'vmp=4\nvmp_st=ok\nschema=forge.guardian.sensor/1' >> $H/stub.obs.tmp   # later lines win: force RED, run the actuation paths
  (( round % 15 == 0 )) && ctl critical
  mv -f $H/stub.obs.tmp $H/stub.obs
  sleep 0.33
  v=$(jq_ $H/state.json 'd["state"]'); states+=" $v"
  [[ $v == (GREEN|YELLOW|ORANGE|RED|UNKNOWN) ]] || (( bad++ ))
done
ck "governor alive after 15 s of garbage" $(kill -0 $GP 2>/dev/null; print $?)
ck "state.json parsed with a legal state on every sample" $(( bad == 0 ? 0 : 1 )) "bad samples=$bad; seen:$(print -r -- ${(u)${=states}})"
ck "no shell error in guardian.out" $(( $(grep -cE 'parameter not set|bad math|bad pattern|bad substitution|not an identifier|command not found|parse error|number truncated|bad floating' $H/log/guardian.out) == 0 ? 0 : 1 )) "$(grep -m2 -E 'parameter not set|bad math|bad pattern|bad substitution|not an identifier|command not found|parse error|number truncated|bad floating' $H/log/guardian.out)"
ck "no injected command ran (\$(...) and backticks in values stay text)" $([[ ! -e $D/PWNED && ! -e $D/PWNED2 ]]; print $?)
ck "the governor shed nothing it could not verify (no 'shed sig=' for a hostile envelope)" $(( $(grep -c 'shed sig=' $H/log/guardian.log) == 0 ? 0 : 1 ))
ck "it did reach RED and actuate (the paths ran)" $(grep -q 'RED stage1' $H/log/guardian.log; print $?)
ck "pid=1 was never signalled (refused, or reaped as 'no valid pid')" \
   $( ! grep -q "shed sig=.*pid=1\$" $H/log/guardian.log && grep -qE 'REFUSED to signal protected pid=1 |reaped envelope e.job pid=1: no valid pid' $H/log/guardian.log; print $?)
ck "unparseable / oversize envelopes reaped, with an event each" $([[ ! -e $H/jobs/a.job && ! -e $H/jobs/d.job && ! -e $H/jobs/f.job ]] && grep -q '"kind": "reap"' $H/events.jsonl; print $?)
ck "a non-.job file in jobs/ is left alone" $([[ -e $H/jobs/readme.txt ]]; print $?)
stop_gd
fi

# ==================================================================================
if want s16; then
print "== s16. TERM at the SHIPPED poll (5 s): lock released and process gone at once, in backoff too =="
# Every other scenario runs POLL=1, where a sleep that outlives TERM costs < 1 s and
# hides. zsh defers `exit` until a `wait` inside a function returns, so a stop that
# does not end the in-flight poll sleep waits out the poll (measured 4.3 s).
for mode in normal backoff; do
  mkdom s16_$mode intel
  if [[ $mode == backoff ]]; then n=$EPOCHSECONDS; for i in 1 2 3 4 5 6 7; do print $(( n - 100 + i )); done > $D/h/guardian.starts; fi
  ( export FORGE_HEALTH_DIR=$D/h ARCHIE_HEALTH_DIR=$D/ah FORGE_GUARDIAN_NOTIFY_CMD=$D/notify FORGE_GUARDIAN_DISKUTIL=$D/diskutil PATH=$D/stub:$PATH
    unset FORGE_GUARDIAN_POLL FORGE_GUARDIAN_SENSOR_BIN FORGE_GUARDIAN_SENSOR
    exec zsh ${GD_BIN:-$D/bin/forge-guardian} ) >> $D/launch.out 2>&1 < /dev/null &
  GP=$!; print $GP >> $PIDF
  wait_until 12 '[[ -f $D/h/state ]]'; st0=$(stat -f %m $D/h/state 2>/dev/null)
  wait_until 12 '[[ $(stat -f %m $D/h/state 2>/dev/null) != $st0 ]]'      # right after a publish: a full poll of sleep ahead
  sleep 0.3
  t0=$EPOCHREALTIME; kill -TERM $GP
  wait_until 6 '[[ ! -d $D/h/guardian.lock ]]'; tl=$(( EPOCHREALTIME - t0 ))
  wait_until 6 '! kill -0 $GP 2>/dev/null'; tp=$(( EPOCHREALTIME - t0 ))
  ck "$mode: lock released < 1 s after TERM at POLL=5" $(( tl < 1.0 ? 0 : 1 )) "$(t3 $tl)s"
  ck "$mode: process gone < 1 s after TERM at POLL=5" $(( tp < 1.0 ? 0 : 1 )) "$(t3 $tp)s"
  ck "$mode: UNKNOWN published on the way out" $([[ $(st) == UNKNOWN ]]; print $?)
  stop_gd
done
fi

# ==================================================================================
# A victim that records each signal with its time (s17/s18), and plants its envelope.
mkvictim() { # mkvictim -> VP (running $D/victim2 logging to $D/victim2.log)
  print -r -- '#!/bin/zsh
zmodload zsh/datetime
trap '"'"'print "USR1 $EPOCHREALTIME" >> "$1"'"'"' USR1
trap '"'"'print "TERM $EPOCHREALTIME" >> "$1"; exit 0'"'"' TERM
while true; do sleep 0.2 & wait $!; done' > $D/victim2; chmod +x $D/victim2
  $D/victim2 $D/victim2.log & VP=$!; print $VP >> $PIDF
  sleep 0.3; lstart_epoch $VP
  { print "pid=$VP"; print "name=ladder-probe"; print "priority=9"; print "can_restart=1"; print "peak_gb=1"; print "gpu=0"
    print "started=$(( EPOCHSECONDS - 1000 ))"; print "pstart=$REPLY"; print "cmd=victim"; } > $D/h/jobs/$VP.job
}
hist_last_vmp() { tail -1 $D/h/history.jsonl 2>/dev/null | sed -n 's/.*"vmp":\([-0-9]*\).*/\1/p' }
if want s17; then
print "== s17. hysteresis counts EVIDENCE, not USR2 wake-ups (review 2026-10-08 R5), POLL=2 =="
mkdom s17 intel
obs OBS_VMP=4
start_gd FORGE_GUARDIAN_POLL=2
wait_until 8 'state_is RED'; ck "setup: vm_pressure=4 -> RED (CRITICAL_NOW)" $? "after $(t3 $WAITED)s"
obs OBS_VMP=1
wait_until 8 '[[ $(hist_last_vmp) == 1 ]]'; ck "setup: one poll has seen vm_pressure=1 (RED, 1 of 6 recovery polls)" $?
n0=$(wc -l < $D/h/history.jsonl)
t_s=$EPOCHREALTIME
for i in {1..8}; do kill -USR2 $GP 2>/dev/null; sleep 0.15; done
sleep 0.3
n1=$(wc -l < $D/h/history.jsonl)
ck "a storm of 8 USR2 re-polled the governor (>= 4 extra polls)" $(( n1 - n0 >= 4 ? 0 : 1 )) "$(( n1 - n0 )) polls in $(t3 $(( EPOCHREALTIME - t_s )))s"
ck "  ...but RED holds: wake-up re-reads are not recovery evidence" $([[ $(st) == RED ]]; print $?) "state=$(st)"
wait_until 25 'state_is GREEN'; r=$?
ck "  ...RED -> GREEN only after deescalate_polls fresh polls (>= 8 s at POLL=2)" $(( r == 0 && EPOCHREALTIME - t_s >= 8 ? 0 : 1 )) "GREEN $(t3 $(( EPOCHREALTIME - t_s )))s after the storm"
stop_gd
mkdom s17b intel
mkvictim
obs OBS_VMP=4
start_gd FORGE_GUARDIAN_POLL=2 FORGE_GUARDIAN_SETTLE=0 FORGE_GUARDIAN_TERM_GRACE=60
wait_until 8 'grep -q ^USR1 $D/victim2.log 2>/dev/null'; ck "setup: RED stage 1 checkpointed the registered job" $?
t_u=$(sed -n 's/^USR1 //p' $D/victim2.log | head -1)
for i in {1..6}; do kill -USR2 $GP 2>/dev/null; sleep 0.1; done
sleep 0.8
ck "a USR2 storm right after stage 1 does NOT climb the ladder to a TERM" $(grep -q ^TERM $D/victim2.log 2>/dev/null; (( $? != 0 )) ; print $?) "$(tr '\n' ' ' < $D/victim2.log)"
wait_until 10 'grep -q ^TERM $D/victim2.log 2>/dev/null'; r=$?
t_t=$(sed -n 's/^TERM //p' $D/victim2.log | head -1)
ck "  ...the stage-3 TERM comes >= 2 fresh polls after the USR1 (>= 3 s at POLL=2)" $(( r == 0 && t_t - t_u >= 3 ? 0 : 1 )) "USR1->TERM $(t3 $(( ${t_t:-0} - ${t_u:-0} )))s"
stop_gd
fi

# ==================================================================================
if want s18; then
print "== s18. a governor that dies retracts what it published; consumers check it lives (FO-4) =="
FG=${SRC:h}/forge-gate; FN=${SRC:h}/forge-nproc
gn() { GATE_RC=$( FORGE_HEALTH_DIR=$D/h zsh $FG --need green >/dev/null 2>&1; print $? ); NPROC=$( FORGE_HEALTH_DIR=$D/h zsh $FN 2>/dev/null ) }
mkdom s18 intel
start_gd
wait_until 15 'state_is GREEN'; ck "setup: GREEN" $?
gn; ck "control: forge-gate admits and forge-nproc gives the GREEN -j" $([[ $GATE_RC == 0 && $NPROC -gt 2 ]]; print $?) "gate=$GATE_RC nproc=$NPROC"
ck "state.json and status.json name their producer (guardian_pid, guardian_started = the lock's)" \
   $([[ $(sj 'd["guardian_pid"]') == $GP && $(sj 'd["guardian_started"]') == "$(print -r -- ${(j: :)${=$(<$D/h/guardian.lock/started)}})" \
        && $(jq_ $D/ah/status.json 'd["guardian_pid"]') == $GP ]]; print $?) "$(sj 'd["guardian_pid"]') '$(sj 'd["guardian_started"]')'"
kill -HUP $GP
wait_until 4 '! kill -0 $GP 2>/dev/null'; ck "SIGHUP ends the governor" $?
ck "  ...state.json retracted to UNKNOWN, heavy_jobs_ok false" $([[ $(sj '[d["state"],d["heavy_jobs_ok"]]') == '["UNKNOWN", false]' ]]; print $?) "$(sj '[d["state"],d["heavy_jobs_ok"],d["reason"]]')"
ck "  ...Law-7 status.json retracted to UNKNOWN" $([[ $(jq_ $D/ah/status.json 'd["state"]') == UNKNOWN ]]; print $?) "$(jq_ $D/ah/status.json 'd["state"]')"
gn; ck "  ...forge-gate denies and forge-nproc falls back to 2" $([[ $GATE_RC == 1 && $NPROC == 2 ]]; print $?) "gate=$GATE_RC nproc=$NPROC"
start_gd
wait_until 15 'state_is GREEN'; ck "setup: a new governor reaches GREEN" $?
kill -9 $GP; wait $GP 2>/dev/null
ck "SIGKILL (no trap can run): state.json still says GREEN" $([[ $(sj 'd["state"]') == GREEN ]]; print $?)
gn; ck "  ...but forge-gate denies and forge-nproc gives 2: the lock holder is dead" $([[ $GATE_RC == 1 && $NPROC == 2 ]]; print $?) "gate=$GATE_RC nproc=$NPROC"
rm -rf $D/h/guardian.lock
# An ERROR exit (set -u has killed this daemon before): the EXIT trap must retract too.
# (a script FILE, not `zsh -c`: zsh runs no EXIT trap when a -c string dies of an error)
print -r -- 'set -u; source "$1"; mkdir "$LOCK_D" && print $$ > "$LOCK_D/pid"; LOCK_HELD=1; DAEMON_UP=1
trap release_lock EXIT
EVIDENCE_COMPLETE=1; publish GREEN nominal 8
print -r -- "${THIS_IS_NOT_SET_ANYWHERE}"' > $D/errexit.zsh
( export FORGE_HEALTH_DIR=$D/h ARCHIE_HEALTH_DIR=$D/ah FORGE_GUARDIAN_LIB=1 PATH=$D/stub:$PATH
  exec zsh $D/errexit.zsh $D/bin/forge-guardian ) > $D/errexit.out 2>&1
ck "an error exit under set -u (the trap path) ..." $(grep -q 'parameter not set' $D/errexit.out; print $?) "$(tail -1 $D/errexit.out)"
ck "  ...retracts state.json to UNKNOWN, heavy_jobs_ok false" $([[ $(sj '[d["state"],d["heavy_jobs_ok"]]') == '["UNKNOWN", false]' ]]; print $?) "$(sj '[d["state"],d["reason"]]')"
ck "  ...and the Law-7 status.json" $([[ $(jq_ $D/ah/status.json 'd["state"]') == UNKNOWN ]]; print $?)
ck "  ...and still back-dates the state file" $(( EPOCHSECONDS - $(stat -f %m $D/h/state) > 3600 ? 0 : 1 ))
# Round-2 residual: VTALRM, PROF and SYS (and ABRT, EMT) are trappable and terminate by
# default; each left the governor dead behind a fresh published state. Each is an orderly
# stop now. One fresh domain per signal (the restart-loop breaker counts starts).
bad=()
for sg in VTALRM PROF SYS ABRT EMT; do
  mkdom s18_$sg intel
  start_gd
  wait_until 8 '[[ -d $D/h/guardian.lock && -f $D/h/state.json ]]'; sleep 0.5
  kill -$sg $GP 2>/dev/null
  wait_until 4 '! kill -0 $GP 2>/dev/null' || bad+=("$sg:still-alive")
  r_=$(sj 'd["reason"]'); a_=$(jq_ $D/ah/status.json 'd["reason"]')
  [[ $r_ == "guardian stopped (SIG$sg)" && $a_ == "guardian stopped (SIG$sg)" && ! -d $D/h/guardian.lock ]] || bad+=("$sg:'$r_'/'$a_'")
  stop_gd
done
ck "SIGVTALRM, SIGPROF, SIGSYS, SIGABRT, SIGEMT: an orderly stop -- state.json and status.json say 'guardian stopped (SIG...)', lock released" $(( ${#bad} == 0 ? 0 : 1 )) "${bad[*]:-all retracted}"
# Round-2 FO-4 regression, end to end with the REAL governor: it records its start as an
# EPOCH (guardian.lock/pstart, published as guardian_pstart) and every caller recognises it
# from any time zone or locale -- forge-gate, forge-nproc and forge-guardian-ctl.
CTL=${SRC:h}/forge-guardian-ctl
mkdom s18tz intel
start_gd
wait_until 15 'state_is GREEN'; ck "setup: a real governor at GREEN" $?
utc_pstart $GP; gps=$REPLY; lps=$(<$D/h/guardian.lock/pstart 2>/dev/null)
ck "guardian.lock/pstart is the governor's start in epoch seconds (+-1), and state.json/status.json publish it as guardian_pstart" \
   $([[ $lps == <-> ]] && (( lps - gps <= 1 && gps - lps <= 1 )) && [[ $(sj 'd["guardian_pstart"]') == $lps && $(jq_ $D/ah/status.json 'd["guardian_pstart"]') == $lps ]]; print $?) "lock=$lps ps=$gps"
ctl_st() { env "$@" FORGE_GUARDIAN_HOME=$D/home FORGE_HEALTH_DIR=$D/h FORGE_GUARDIAN_LAUNCHCTL=/usr/bin/false zsh $CTL status 2>/dev/null | head -1 }
mkdir -p $D/home
bad=()
for e in TZ=UTC TZ=America/Los_Angeles TZ=Asia/Kolkata LC_ALL=de_DE.UTF-8 "LC_ALL=de_DE.UTF-8 TZ=Pacific/Auckland"; do
  g_=$( env ${=e} FORGE_HEALTH_DIR=$D/h zsh $FG --need green >/dev/null 2>&1; print $? )
  n_=$( env ${=e} FORGE_HEALTH_DIR=$D/h zsh $FN 2>/dev/null )
  c_=$( ctl_st ${=e} )
  [[ $g_ == 0 && $n_ -gt 2 && $c_ == "RUNNING pid=$GP "* ]] || bad+=("$e: gate=$g_ nproc=$n_ ctl='${c_[1,60]}'")
done
ck "the live governor is recognised under TZ=UTC, America/Los_Angeles, Asia/Kolkata, de_DE, de_DE+Auckland by forge-gate, forge-nproc and ctl status" \
   $(( ${#bad} == 0 ? 0 : 1 )) "${bad[*]:-all recognised}"
stop_gd
# ctl never takes a stale or foreign lock for the governor (status only: read-only)
mkdom s18ctl intel; H=$D/h; mkdir -p $D/home
print GREEN > $H/state; print -- "{\n  \"state\": \"GREEN\",\n  \"epoch\": $EPOCHSECONDS,\n  \"build_jobs_max\": 8\n}" > $H/state.json
ctl_h() { env TZ=UTC FORGE_GUARDIAN_HOME=$D/home FORGE_HEALTH_DIR=$H FORGE_GUARDIAN_LAUNCHCTL=/usr/bin/false zsh $CTL status 2>/dev/null | head -1 }
bad=()
fake_gov $H; c_=$(ctl_h); [[ $c_ == "RUNNING pid=$FGP "* ]] || bad+=("control:'$c_'")
print $(( $(<$H/guardian.lock/pstart) - 100 )) > $H/guardian.lock/pstart; c_=$(ctl_h); [[ $c_ == RUNNING* ]] && bad+=("reused:'$c_'")
rm -rf $H/guardian.lock; fake_gov $H; print -r -- "0$FGP" > $H/guardian.lock/pid; c_=$(ctl_h); [[ $c_ == RUNNING* ]] && bad+=("non-canonical:'$c_'")
rm -rf $H/guardian.lock; fake_gov $H; print garbage > $H/guardian.lock/pstart; c_=$(ctl_h); [[ $c_ == RUNNING* ]] && bad+=("bad-pstart:'$c_'")
sleep 600 </dev/null >/dev/null 2>&1 & NG=$!; print $NG >> $PIDF; sleep 0.2
rm -rf $H/guardian.lock; mkdir -p $H/guardian.lock; print $NG > $H/guardian.lock/pid; utc_pstart $NG; print $REPLY > $H/guardian.lock/pstart
c_=$(ctl_h); [[ $c_ == RUNNING* ]] && bad+=("not-forge-guardian:'$c_'")
kill $NG 2>/dev/null; wait $NG 2>/dev/null; c_=$(ctl_h); [[ $c_ == RUNNING* ]] && bad+=("dead:'$c_'")
ck "ctl status (TZ=UTC) names only a verified governor: control RUNNING; reused pstart, 0N pid, bad pstart, a non-forge-guardian, a dead pid -> not RUNNING" \
   $(( ${#bad} == 0 ? 0 : 1 )) "${bad[*]:-as expected}"
# SCHEMA §2.1 (review 2026-10-08 round 2, verify): ctl read the lock through symlinks -- a
# pstart symlinked to the right epoch verified, and a DANGLING one was "no pstart", so the
# lstart text (this zone's: ctl_h0 runs in the writer's zone) verified instead.
ctl_h0() { env FORGE_GUARDIAN_HOME=$D/home FORGE_HEALTH_DIR=$H FORGE_GUARDIAN_LAUNCHCTL=/usr/bin/false zsh $CTL status 2>/dev/null | head -1 }
bad=()
rm -rf $H/guardian.lock; fake_gov $H; c_=$(ctl_h0); [[ $c_ == "RUNNING pid=$FGP "* ]] || bad+=("control:'$c_'")
rm -f $H/guardian.lock/pstart; ln -s $H/no-such-pstart $H/guardian.lock/pstart; c_=$(ctl_h0); [[ $c_ == RUNNING* ]] && bad+=("dangling:'$c_'")
rm -rf $H/guardian.lock; fake_gov $H; mv $H/guardian.lock/pstart $H/pstart.real; ln -s $H/pstart.real $H/guardian.lock/pstart
c_=$(ctl_h); [[ $c_ == RUNNING* ]] && bad+=("symlinked:'$c_'")
rm -f $H/guardian.lock/pstart; mv $H/pstart.real $H/guardian.lock/pstart; mv $H/guardian.lock/pid $H/pid.real; ln -s $H/pid.real $H/guardian.lock/pid
c_=$(ctl_h); [[ $c_ == RUNNING* ]] && bad+=("symlinked-pid:'$c_'")
rm -f $H/pid.real
ck "ctl status never reads guardian.lock through a symlink: control RUNNING; a dangling pstart symlink (writer's zone), a pstart or pid symlinked to the right value -> not RUNNING" \
   $(( ${#bad} == 0 ? 0 : 1 )) "${bad[*]:-as expected}"
fi

# ==================================================================================
if want s19; then
print "== s19. ENOSPC mid-append: the torn record is taken back, every line parses, the next record survives (R6) =="
# Two arms. `dd`: no sensor binary, so the governor's undo is `dd ... seek=N` (and a stub
# sensor without `append` falls back to the same). `helper`: the real sensor's
# `append --truncate-to N --if-size M` -- built from the tree beside the governor under
# test unless RUNTIME_SENSOR_BIN names a prebuilt one. In both, the governor's own three
# JSONL/log appends (events.jsonl, history.jsonl, guardian.log) hit a volume with 0 bytes
# free and the last block's slack, so each write is SHORT; then a second writer (the
# sensor) and the governor append again. Round 1 left `{"ts": 1791506480.` behind and the
# sensor's next record was glued to it (review 2026-10-08 round 2).
jsonl_bad() { # jsonl_bad FILE -> non-empty lines that are not one whole JSON value (plutil: native)
  local l; integer n=0
  while IFS= read -r l || [[ -n $l ]]; do
    [[ -z $l ]] && continue
    print -r -- "$l" | plutil -convert json -o /dev/null - >/dev/null 2>&1 || (( n++ ))
  done < $1
  print $n
}
R19S=${RUNTIME_SENSOR_BIN:-}
if [[ -z $R19S && -x ${SRC:h}/sensor/build.sh ]] && command -v xcrun >/dev/null 2>&1; then
  zsh ${SRC:h}/sensor/build.sh --out $ROOT/s19bin > $ROOT/s19build.log 2>&1 && R19S=$ROOT/s19bin/forge-guardian-sensor
fi
print -r -- 'set -u
source "$1"; M=$2; arm=$3
event before "\"n\": 0"; log "before"; pub_values; REASON=nominal; history_append
for bs in 65536 4096 512 1; do dd if=/dev/zero bs=$bs 2>/dev/null >> $M/fill; done
printf -v pad "%9000s" ""; pad=${pad// /p}
event torn "\"pad\": \"$pad\""
log "torn line $pad"
REASON="torn-history $pad"; history_append
rm -f $M/fill
if [[ $arm == helper ]]; then "$SENSOR_BIN" append --file $M/h/events.jsonl --line "{\"ts\": 2.0, \"kind\": \"other_writer\"}"
else print -r -- "{\"ts\": 2.0, \"kind\": \"other_writer\"}" >> $M/h/events.jsonl; fi
event after "\"n\": 2"; log "after the disk was freed"; REASON=after; history_append' > $ROOT/r19.zsh
for arm in dd helper; do
  if [[ $arm == helper && ( -z $R19S || ! -x $R19S ) ]]; then skip "s19 helper arm: no sensor binary (see $ROOT/s19build.log)"; continue; fi
  mkdir -p $ROOT/img19$arm $ROOT/mnt19$arm
  if hdiutil create -size 2m -fs HFS+ -volname fgr6 $ROOT/img19$arm/r6.dmg >/dev/null 2>&1 \
     && hdiutil attach $ROOT/img19$arm/r6.dmg -nobrowse -mountpoint $ROOT/mnt19$arm >/dev/null 2>&1; then
    MNT=$ROOT/mnt19$arm; print -r -- $MNT > $ROOT/mnt.path
    mkdom s19$arm intel
    ( export FORGE_HEALTH_DIR=$MNT/h ARCHIE_HEALTH_DIR=$MNT/ah FORGE_GUARDIAN_LIB=1
      unset FORGE_GUARDIAN_SENSOR_BIN; [[ $arm == helper ]] && export FORGE_GUARDIAN_SENSOR_BIN=$R19S
      exec zsh $ROOT/r19.zsh $D/bin/forge-guardian $MNT $arm ) > $D/r6.out 2>&1
    EVF=$MNT/h/events.jsonl; HIF=$MNT/h/history.jsonl; LGF=$MNT/h/log/guardian.log
    ck "$arm: setup -- each append on the full volume failed part-way and was reported" \
       $(grep -q 'APPEND FAILED: events.jsonl' $LGF && grep -q 'APPEND FAILED: history.jsonl' $LGF; print $?) "$(grep -c 'APPEND FAILED' $LGF) APPEND FAILED lines"
    ck "$arm: ...each torn record was TAKEN BACK (the file kept its previous length), none left behind" \
       $(! grep -q 'a partial record remains' $LGF && grep -q 'the record was not written; the file keeps its previous length' $LGF; print $?) "$(grep -m2 'APPEND FAILED' $LGF | cut -c21-130)"
    eb=$(jsonl_bad $EVF); hb=$(jsonl_bad $HIF)
    ck "$arm: events.jsonl -- every line parses ($eb invalid), no torn record, and before/other_writer/after all present" \
       $(( eb == 0 ? 0 : 1 )) "$(grep -c . $EVF) lines; kinds: $(grep -o '"kind": *"[a-z_]*"' $EVF | tr '\n' ' ')"
    ck "$arm: ...the other writer's record and the governor's next one both survive" \
       $(grep -q '"kind": "other_writer"' $EVF && grep -q '"kind": "after"' $EVF && ! grep -q '"kind": "torn"' $EVF; print $?)
    ck "$arm: history.jsonl -- every line parses ($hb invalid); the torn history record is gone, the next one is there" \
       $(( hb == 0 ? 0 : 1 )) "$(grep -c . $HIF) lines"
    ck "$arm: ...history: 'after' present, 'torn-history' absent" $(grep -q '"r":"after"' $HIF && ! grep -q 'torn-history' $HIF; print $?)
    ck "$arm: guardian.log -- no torn text; every line starts with its timestamp" \
       $(! grep -q 'torn line' $LGF && ! grep -vqE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2} ' $LGF && grep -q 'after the disk was freed' $LGF; print $?)
    detach
  else
    skip "s19 $arm arm: could not create/attach a 2 MB disk image"
  fi
done
fi

# ==================================================================================
if want s20; then
print "== s20. every transition INTO RED records a 'red' incident through the sensor (SEM-4) =="
mkdom s20 as
start_gd FORGE_GUARDIAN_SENSOR_BIN=$STUB STUB_SENSOR_LOG=$D/stub.log
wait_until 15 'state_is GREEN'; ck "setup: GREEN from the stub sensor" $?
crit_trial 1
ck "critical event -> RED" $(( LAT < 1.0 ? 0 : 1 )) "$(t3 $LAT)s"
wait_until 5 '[[ -n $(print $D/h/incidents/*-red(N/)) ]]'; r=$?
ck "an incidents/<UTC>-red bundle appears" $r "$(print $D/h/incidents/*(N:t))"
ck "  ...requested as: incident --state-dir <domain> --kind red --note <why>" \
   $(grep -q "incident --state-dir $D/h --kind red --note " $D/stub.log; print $?) "$(grep incident $D/stub.log | cut -d' ' -f2- | head -1)"
stop_gd
fi

# ==================================================================================
if want s21; then
print "== s21. a FIFO named *.job never wedges the governor (R1) =="
mkdom s21 intel
start_gd
wait_until 15 'state_is GREEN'; ck "setup: GREEN" $?
mkfifo $D/h/jobs/424242.job
m0=$(stat -f %m $D/h/state); sleep 4; m1=$(stat -f %m $D/h/state)
ck "the governor keeps publishing with a FIFO in jobs/" $(( m1 >= m0 + 2 ? 0 : 1 )) "state mtime $m0 -> $m1"
ck "  ...and the FIFO is left alone" $([[ -p $D/h/jobs/424242.job ]]; print $?)
stop_gd
rm -f $D/h/jobs/424242.job
fi

# ==================================================================================
if want s22; then
print "== s22. a publication target replaced by a directory is a FAILED publication (R12) =="
mkdom s22 intel
start_gd
wait_until 15 'state_is GREEN'; ck "setup: GREEN" $?
rm -f $D/ah/status.json; mkdir $D/ah/status.json
wait_until 4 'grep -q "PUBLISH FAILED: status.json(errno 21)" $D/h/log/guardian.log'; r=$?
ck "PUBLISH FAILED status.json(errno 21) is logged" $r "$(grep -m1 'PUBLISH FAILED' $D/h/log/guardian.log | cut -c21-)"
ck "  ...with a publish_error event" $(grep -q '"kind": "publish_error", "file": "status.json", "errno": 21' $D/h/events.jsonl; print $?)
ck "  ...and nothing is moved inside the directory" $([[ -z "$(print $D/ah/status.json/*(N))" ]]; print $?) "$(print $D/ah/status.json/*(N:t))"
stop_gd
fi

# ==================================================================================
if want s23; then
print "== s23. forge-guardian-ctl: C-locale numbers from any locale; the evidence total is the governor's set =="
# Review 2026-10-08 round 2 (verify-install-r2, CORE scope): `status` and `reservations`
# formatted GiB/MiB with printf %.1f in the CALLER's locale, so the same figure read '0.6'
# or '0,6' depending on who asked ('36,0 GiB' under de_DE: install_gate's section-10 strings
# failed under LANG=de_DE). And `status` summed log/, history, events and incidents WITHOUT
# dot-files (incidents/.ratelimit), reservations.history.jsonl* or crashes/ -- not the set the
# governor's housekeeping holds under logs.cap_mib (R13) -- so 'X MiB of N MiB cap' read low.
# No governor runs here: status/reservations are read-only reports over a fixed domain.
CTL=${SRC:h}/forge-guardian-ctl
mkdom s23 intel; H=$D/h; mkdir -p $D/home $H/log $H/crashes $H/incidents/.ratelimit
sleep 600 </dev/null >/dev/null 2>&1 & JP=$!; print $JP >> $PIDF; sleep 0.2
utc_pstart $JP
print -r -- "pid=$JP
pstart=$REPLY
name=locale-job
peak_gb=2.5
priority=normal
can_restart=0
gpu=0" > $H/jobs/$JP.job
# GiB figures chosen off every .x5 tie: 0.5588 36 1.5 30 2.5 1.2 1.3 100
print -r -- "pid=$JP
ts_s=$EPOCHSECONDS
version=gate
seq=1
errors=0
mem_avail_b=600000000
mem_total_b=38654705664
mem_compressed_b=1610612736
budget_b=32212254720
reserved_b=2684354560
overcommit=0
jobs_n=1
job0_pid=$JP
job0_identity=ok
job0_fp_b=1288490188
job0_peak_fp_b=1395864371
job0_reserved_b=2684354560
vol_n=1
vol0_mount=/
vol0_avail_b=107374182400
vol0_growth_b_min=0
vol0_st=ok" > $H/sensor.env
# the evidence aggregate (SCHEMA §2): 1 MiB log + a crash ledger + the reservations history +
# the incidents' rate-limit stamp = 1677722 bytes = 1.6 MiB in 4 files
head -c 1048576 /dev/zero > $H/log/guardian.log
head -c 314573 /dev/zero > $H/crashes/0123456789abcdef.jsonl
head -c 209715 /dev/zero > $H/reservations.history.jsonl
head -c 104858 /dev/zero > $H/incidents/.ratelimit/red
ctl_o() { local c=$1; shift
  env -u LC_ALL -u LC_NUMERIC -u LANG "$@" FORGE_GUARDIAN_HOME=$D/home FORGE_HEALTH_DIR=$H FORGE_GUARDIAN_LAUNCHCTL=/usr/bin/false zsh $CTL $c 2>&1 }
bad=()
for e in LC_ALL=C LC_ALL=de_DE.UTF-8 LANG=de_DE.UTF-8 LC_NUMERIC=fr_FR.UTF-8 "LC_ALL=de_DE.UTF-8 TZ=Pacific/Auckland"; do
  so=$(ctl_o status ${=e}); ro=$(ctl_o reservations ${=e})
  for w in "avail 0.6 / total 36.0 GiB, compressed 1.5" "reservations: reserved 2.5 / budget 30.0 GiB, overcommit=0" \
           "footprint=1.2GiB reserved=2.5GiB" "/  100.0 GiB free" "logs+evidence: 1.6 MiB of 64 MiB cap (4 files)"; do
    [[ $so == *"$w"* ]] || bad+=("$e status lacks '$w'")
  done
  sl=("${(@f)so}"); rl=("${(@f)ro}")
  [[ $ro == *"reserved 2.5 GiB of budget 30.0 GiB (memory 36.0 GiB, available now 0.6 GiB), overcommit=0"* ]] || bad+=("$e reservations header: '${rl[1]:-}'")
  rw=(${(M)rl:#locale-job*})
  [[ ${rw[1]:-} == locale-job*" ok "*" 2.5 "*" 1.3 "*" 2.5 "* ]] || bad+=("$e reservations row: '${rw[1]:-}'")
  cm=(${(M)sl:#*[0-9],[0-9]*} ${(M)rl:#*[0-9],[0-9]*})
  (( ${#cm} )) && bad+=("$e ${#cm} line(s) with a decimal comma, e.g. '${cm[1]}'")
done
ck "ctl status/reservations print the same C-decimal figures under C, de_DE (LC_ALL and LANG), fr_FR LC_NUMERIC, de_DE+Auckland" \
   $(( ${#bad} == 0 ? 0 : 1 )) "${bad[*]:-identical everywhere}"
# The governor's own housekeeping total over the same domain (library mode: nothing pruned,
# 1.6 MiB is far under the 64 MiB cap) is the figure ctl must report.
hk=$( export FORGE_GUARDIAN_LIB=1 FORGE_HEALTH_DIR=$H ARCHIE_HEALTH_DIR=$D/ah; source $D/bin/forge-guardian >/dev/null 2>&1
      load_policy >/dev/null 2>&1; housekeeping >/dev/null 2>&1; print -r -- ${HK_TOTAL:-?} )
ck "  ...and the governor's housekeeping counts the same 1677722 bytes that ctl reports as 1.6 MiB" $([[ $hk == 1677722 ]]; print $?) "HK_TOTAL=$hk"
kill $JP 2>/dev/null; wait $JP 2>/dev/null
fi

# ==================================================================================
if want forks; then
FP=${FORK_POLL:-1}; FS=${FORK_SECONDS:-15}
print "== forks. steady-state cost with a healthy sensor (POLL=$FP, ${FS}s window) =="
FARM=$ROOT/farm; mkdir -p $FARM
cat > $ROOT/shim <<'S'
#!/bin/zsh -f
zmodload zsh/datetime
gpp=$(/bin/ps -o ppid= -p $PPID 2>/dev/null)
print -r -- "$EPOCHREALTIME $PPID ${gpp//[[:space:]]/} ${0:t}" >> $SHIM_LOG
for d in ${(s.:.)SHIM_ORIG_PATH}; do [[ -x $d/${0:t} && ! -d $d/${0:t} ]] && exec $d/${0:t} "$@"; done
exit 127
S
chmod +x $ROOT/shim
for d in /bin /usr/bin /usr/sbin /sbin; do for f in $d/*(N-*); do [[ -e $FARM/${f:t} ]] || ln -s $ROOT/shim $FARM/${f:t}; done; done
fork_arm() { # fork_arm LABEL BIN [env...] -> prints execs/poll and CPU
  local label=$1 bin=$2; shift 2
  mkdom forks_$label as
  [[ $bin == SELF ]] && bin=$D/bin/forge-guardian
  local LOGF=$D/shim.log; : > $LOGF
  ( export FORGE_HEALTH_DIR=$D/h ARCHIE_HEALTH_DIR=$D/ah FORGE_GUARDIAN_POLL=$FP FORGE_GUARDIAN_NOTIFY_CMD=$D/notify \
      FORGE_GUARDIAN_DISKUTIL=$D/diskutil SHIM_LOG=$LOGF SHIM_ORIG_PATH=/usr/bin:/bin:/usr/sbin:/sbin PATH=$FARM
    unset FORGE_GUARDIAN_SENSOR_BIN FORGE_GUARDIAN_SENSOR
    local a; for a in "$@"; do export "$a"; done
    exec /bin/zsh "$bin" ) >> $D/launch.out 2>&1 < /dev/null &
  GP=$!; print $GP >> $PIDF
  sleep $(( FP * 8 + 3 ))                                    # past start-up, SMART, first housekeeping
  local spid=$(sensor_pid) t1=$EPOCHREALTIME c1 c2 r2
  c1=$(ps -o time= -p $GP | tr -d ' ')
  sleep $FS
  local t2=$EPOCHREALTIME
  c2=$(ps -o time= -p $GP | tr -d ' '); r2=$(ps -o rss= -p $GP | tr -d ' ')
  local polls=$(( (t2 - t1) / FP ))
  local direct=$(awk -v a=$t1 -v b=$t2 -v g=$GP '$1>=a && $1<=b && $2==g' $LOGF | wc -l | tr -d ' ')
  local viasub=$(awk -v a=$t1 -v b=$t2 -v g=$GP -v s=${spid:-0} '$1>=a && $1<=b && $2!=g && $2!=s && $3==g' $LOGF | wc -l | tr -d ' ')
  local what=$(awk -v a=$t1 -v b=$t2 -v g=$GP -v s=${spid:-0} '$1>=a && $1<=b && ($2==g || ($3==g && $2!=s)) {print $4}' $LOGF | sort | uniq -c | sort -rn | head -8 | awk '{printf "%s%sx%s", (NR>1?", ":""), $2, $1}')
  local secs1 secs2
  secs1=$(print -r -- $c1 | awk -F: '{print $1*60+$2}'); secs2=$(print -r -- $c2 | awk -F: '{print $1*60+$2}')
  FORK_DIRECT=$direct; FORK_SUB=$viasub; FORK_POLLS=$polls
  measure "$label: $(printf '%.2f' $(( (direct + viasub) * 1.0 / polls ))) execs/poll over $(printf '%.0f' $polls) polls [$what]; governor CPU $(printf '%.3f' $(( secs2 - secs1 )))s in $(printf '%.0f' $(( t2 - t1 )))s; RSS ${r2} KiB"
  stop_gd
}
fork_arm v2 SELF FORGE_GUARDIAN_SENSOR_BIN=$STUB
ck "v2 steady state: exactly one exec per poll (the sleep) and none from subshells" \
   $(( FORK_SUB == 0 && FORK_DIRECT <= FORK_POLLS + 1 ? 0 : 1 )) "direct=$FORK_DIRECT subshell=$FORK_SUB polls=$FORK_POLLS"
if [[ -n $OLD ]]; then
  fork_arm parent $OLD
else skip "parent-tree arm of forks"; fi
fi

kill -TERM $WD 2>/dev/null
print ""
(( ${#MEASURES} )) && { print "[runtime] measurements:"; for m in $MEASURES; do print "   - $m"; done; }
print "[runtime] $PASS passed, $FAIL failed, $SKIP skipped"
(( FAIL == 0 ))
