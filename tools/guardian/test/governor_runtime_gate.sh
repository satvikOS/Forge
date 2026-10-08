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
print "logs_rotate_mib=1\nlogs_cap_mib=3\nlogs_generations=2\nlogs_history_mib=6\nlogs_retention_days=30" > $H/policy.env
mkf() { head -c $2 /dev/zero | tr '\0' x > $1 }
mkf $H/log/guardian.log 1572864; mkf $H/log/guardian.out 1572864; mkf $H/log/launchd.out 1572864
mkf $H/log/guardian.log.7 1048576; mkf $H/history.jsonl.3 1048576; mkf $H/events.jsonl.2 1048576
mkf $H/incidents/2026-01-01T000000Z-manual/blob 1048576; mkf $H/incidents/2026-10-01T000000Z-red/blob 524288
mkf $H/keepme.bin 2097152
touch -t 202601010000 $H/log/guardian.log.7 $H/history.jsonl.3 $H/events.jsonl.2 $H/incidents/2026-01-01T000000Z-manual/blob $H/incidents/2026-01-01T000000Z-manual
touch -t 202610010000 $H/incidents/2026-10-01T000000Z-red/blob $H/incidents/2026-10-01T000000Z-red
k0=$(stat -f '%z %m' $H/keepme.bin); li0=$(stat -f %i $H/log/launchd.out)
start_gd
wait_until 15 'state_is GREEN'; ck "setup: GREEN (the transition is emitted AFTER the first rotation)" $?
sleep 1
sz() { stat -f %z $1 2>/dev/null || print -1 }
ck "guardian.log rotated: .1 holds the old 1.5 MiB, the live file is small" $(( $(sz $H/log/guardian.log.1) >= 1572864 && $(sz $H/log/guardian.log) < 1048576 ? 0 : 1 )) "log.1=$(sz $H/log/guardian.log.1) log=$(sz $H/log/guardian.log)"
ck "guardian.out rotated" $(( $(sz $H/log/guardian.out.1) >= 1572864 && $(sz $H/log/guardian.out) < 1048576 ? 0 : 1 )) "out.1=$(sz $H/log/guardian.out.1) out=$(sz $H/log/guardian.out)"
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
print "guardian_restart_loop_backoff_s=8" > $D/h/policy.env
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
wait_until 20 'state_is GREEN'; r=$?
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
print "smart_interval_s=1" > $D/h/policy.env
obs OBS_VMP=4
start_gd FORGE_GUARDIAN_SETTLE=0 FORGE_GUARDIAN_TERM_GRACE=30
wait_until 10 '! kill -0 $VP 2>/dev/null'; ck "RED -> stage 1 USR1 -> stage 3 TERM: the registered job was evicted" $? "victim log: $(tr '\n' ' ' < $D/victim.log 2>/dev/null)"
wait_until 4 'grep -q cancel_latency $D/h/events.jsonl'
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
print "smart_interval_s=1\ndisk_floors_gib_yellow=300\ndisk_floors_gib_orange=200\ndisk_floors_gib_red=100" > $D/h/policy.env.tmp; mv $D/h/policy.env.tmp $D/h/policy.env
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
fi

# ==================================================================================
if want s14; then
print "== s14. forge-nproc: build_jobs_max minus threads reserved by OTHER live, verified jobs =="
FN=${SRC:h}/forge-nproc
OLDN=""; [[ -n $OLD ]] && git -C "$top" show "${OLD_REV}:tools/guardian/forge-nproc" > $ROOT/oldbin/forge-nproc 2>/dev/null && OLDN=$ROOT/oldbin/forge-nproc
mkdom s14 intel; H=$D/h
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
